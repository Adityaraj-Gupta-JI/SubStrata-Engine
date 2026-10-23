import { Client, type ClientConfig } from 'pg';
import { CredentialCipher } from '../credentials/cipher';
import type { VaultBucket } from '../neon/credential-vault';
import { ApiError, unavailable } from '../errors';
import type { DataSource } from '../database/sources';
import { selectedDestination, destinationDigest } from '../byodb/policy';
import { hash, identifier, type Change } from './policy';
export interface ExecutionTarget {
    databaseId: string;
    capability: 'write' | 'admin';
    destinationId: string;
    role: string;
    reference: string;
    readRole: string;
    writeRole: string;
}
export interface Scope {
    workspaceId: string;
    organizationId: string;
    databaseId: string;
    capability: string;
    role: string;
}
export class ExecutionCredentials {
    private cipher: CredentialCipher;
    constructor(private bucket: VaultBucket, keys: string, keyId: string) { this.cipher = new CredentialCipher(keys, keyId); }
    private path(ref: string) { if (!/^sql-role\/[a-f0-9-]{36}$/.test(ref))
        throw unavailable(); return `execution-credentials/${ref}.json`; }
    private aad(scope: Scope, ref: string) { return async (keyId: string) => new TextEncoder().encode(JSON.stringify(['sql-role-v1', scope.organizationId, scope.workspaceId, scope.databaseId, scope.capability, scope.role, ref, keyId])); }
    async put(scope: Scope, ref: string, password: string) { if (!password || password.length > 512 || password.includes('\0'))
        throw unavailable(); if (!await this.bucket.put(this.path(ref), JSON.stringify(await this.cipher.encrypt(password, this.aad(scope, ref))), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } }))
        throw unavailable(); }
    async read(scope: Scope, ref: string) { try {
        const o = await this.bucket.get(this.path(ref));
        if (!o || o.size > 8192)
            throw unavailable();
        const password = await this.cipher.decrypt(await o.json(), this.aad(scope, ref));
        if (!password || password.length > 512 || password.includes('\0'))
            throw unavailable();
        return password;
    }
    catch {
        throw unavailable();
    } }
    async revoke(scope: Scope, ref: string) { const object = await this.bucket.get(this.path(ref)); if (!object || object.size > 8192)
        throw unavailable(); const value = await object.json() as {
        revoked?: boolean;
    }; if (value?.revoked)
        return; await this.read(scope, ref); if (!await this.bucket.put(this.path(ref), JSON.stringify({ version: 1, revoked: true }), { onlyIf: { etagMatches: object.etag }, httpMetadata: { contentType: 'application/json' } }))
        throw unavailable(); }
}
export function targets(env: Env, source: DataSource): ExecutionTarget[] { try {
    const values: unknown = JSON.parse(env.DATABASE_EXECUTION_TARGETS ?? '[]');
    if (!Array.isArray(values) || values.length > 100)
        throw unavailable();
    const found = values.filter(x => x?.databaseId === source.id);
    const caps = new Set<string>();
    const result = found.map(t => { if (Object.keys(t).some(k => !['databaseId', 'capability', 'destinationId', 'role', 'reference', 'readRole', 'writeRole'].includes(k)) || !['write', 'admin'].includes(t.capability) || caps.has(t.capability) || !/^sql-role\/[a-f0-9-]{36}$/.test(t.reference))
        throw unavailable(); for (const role of [t.role, t.readRole, t.writeRole])
        identifier(role); if (t.readRole !== source.runtime_role || t.writeRole === t.readRole || t.role === t.readRole || t.capability === 'write' && t.role !== t.writeRole || t.capability === 'admin' && t.role === t.writeRole)
        throw unavailable(); const d = selectedDestination(env.BYODB_ALLOWED_DESTINATIONS, t.destinationId, source.database_name, t.role, source.schema_name ?? 'tenant_data'); if (source.kind === 'external' && (t.destinationId !== source.branch_id || source.destination_digest !== destinationDigest(d)))
        throw unavailable(); caps.add(t.capability); return Object.freeze({ ...t }); });
    const writer = result.find(t => t.capability === 'write');
    if (result.some(t => t.capability === 'admin' && (!writer || t.writeRole !== writer.role)))
        throw unavailable();
    return result;
}
catch {
    throw unavailable();
} }
export function targetDigest(env: Env, source: DataSource, target: ExecutionTarget) { const d = selectedDestination(env.BYODB_ALLOWED_DESTINATIONS, target.destinationId, source.database_name, target.role, source.schema_name ?? 'tenant_data'); return hash(JSON.stringify([target, destinationDigest(d), source.credential_reference, source.state])); }
export interface WriteResult {
    affectedRows: number;
    elapsedMs: number;
}
export interface ExecutionService {
    verify(env: Env, source: DataSource, target: ExecutionTarget): Promise<void>;
    execute(env: Env, source: DataSource, target: ExecutionTarget, change: Change, check: () => Promise<void>): Promise<WriteResult>;
}
export class PgExecutionService implements ExecutionService {
    constructor(private factory: (config: ClientConfig) => Client = config => new Client(config)) { }
    private async session<T>(env: Env, source: DataSource, target: ExecutionTarget, action: (client: Client) => Promise<T>): Promise<T> {
        if (!env.TENANT_CREDENTIALS || !env.SQL_VAULT_KEYS || !env.SQL_VAULT_KEY_ID)
            throw unavailable();
        const destination = selectedDestination(env.BYODB_ALLOWED_DESTINATIONS, target.destinationId, source.database_name, target.role, source.schema_name ?? 'tenant_data');
        const scope = { workspaceId: source.workspace_id, organizationId: source.organization_id, databaseId: source.id, capability: target.capability, role: target.role };
        const password = await new ExecutionCredentials(env.TENANT_CREDENTIALS, env.SQL_VAULT_KEYS, env.SQL_VAULT_KEY_ID).read(scope, target.reference);
        const client = this.factory({ host: destination.address, port: destination.port, user: target.role, password, database: source.database_name, ssl: { rejectUnauthorized: true, servername: destination.hostname }, application_name: 'substrata-approved-change', connectionTimeoutMillis: 3000, statement_timeout: 3000, query_timeout: 4000 });
        client.on('error', () => { });
        try {
            await client.connect();
            await client.query('BEGIN');
            await client.query("SET LOCAL statement_timeout='3000ms'");
            await client.query("SET LOCAL lock_timeout='500ms'");
            await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
            await client.query('SET LOCAL search_path=pg_catalog');
            await client.query('SET LOCAL standard_conforming_strings=on');
            const schema = source.schema_name ?? 'tenant_data';
            const profile = await client.query(`SELECT current_database() AS database,current_user AS role,r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit AS elevated,
   EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,
   has_database_privilege(current_user,current_database(),'CREATE') OR has_database_privilege(current_user,current_database(),'TEMPORARY') AS database_ddl,
   (SELECT pg_get_userbyid(nspowner)=current_user FROM pg_namespace WHERE nspname=$1) AS schema_owner,
   has_schema_privilege(current_user,$1,'CREATE') AS schema_create,has_schema_privilege(current_user,$1,'USAGE') AS schema_usage,
   EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema',$1) AND nspname NOT LIKE 'pg_%' AND has_schema_privilege(current_user,oid,'CREATE')) AS other_create,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m') AND n.nspname NOT IN ('pg_catalog','information_schema',$1) AND (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE'))) AS other_write,
   EXISTS(SELECT 1 FROM pg_extension WHERE extname<>'plpgsql') OR EXISTS(SELECT 1 FROM pg_foreign_server) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')) OR EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal) OR EXISTS(SELECT 1 FROM pg_rewrite rw JOIN pg_class rc ON rc.oid=rw.ev_class JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE rn.nspname NOT IN ('pg_catalog','information_schema') AND rw.rulename<>'_RETURN') OR EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND (confdeltype IN ('c','n','d') OR confupdtype IN ('c','n','d'))) AS unsafe,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND has_table_privilege(current_user,c.oid,'TRUNCATE')) AS truncate_access,
   EXISTS(SELECT 1 FROM pg_database d WHERE d.datallowconn AND NOT d.datistemplate AND d.datname<>current_database() AND has_database_privilege(current_user,d.oid,'CONNECT')) AS foreign_access
   FROM pg_roles r WHERE r.rolname=current_user`, [schema]);
            const p = profile.rows[0];
            if (!p || p.schema_usage !== true || p.database !== source.database_name || p.role !== target.role || [p.elevated, p.memberships, p.database_ddl, p.other_create, p.other_write, p.unsafe, ...(source.kind === 'external' ? [] : [p.foreign_access])].some(v => v !== false) || p.schema_owner !== (target.capability === 'admin') || p.schema_create !== (target.capability === 'admin')||target.capability==='write'&&p.truncate_access!==false)
                throw unavailable();
            const result = await action(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK').catch(() => { });
            if (error instanceof ApiError)
                throw error;
            const timeout = error && typeof error === 'object' && 'code' in error && error.code === '57014';
            throw new ApiError(timeout ? 408 : 503, timeout ? 'QUERY_TIMEOUT' : 'CHANGE_FAILED', timeout ? 'Change exceeded its deadline and was rolled back.' : 'Change failed or its outcome could not be confirmed. Check history before retrying.');
        }
        finally {
            await client.end().catch(() => { });
        }
    }
    async verify(env: Env, source: DataSource, target: ExecutionTarget) { await this.session(env, source, target, async () => { }); }
    async execute(env: Env, source: DataSource, target: ExecutionTarget, change: Change, check: () => Promise<void>) {
        const start = Date.now();
        return this.session(env, source, target, async (client) => {
            const schema = source.schema_name ?? 'tenant_data';
            if (change.capability === 'write') {
                const grants = await client.query(`SELECT c.relkind,c.relrowsecurity,has_table_privilege(current_user,c.oid,$3) AS permitted FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`, [schema, change.table, change.operation.toUpperCase()]);
                if (grants.rows[0]?.relkind !== 'r' || grants.rows[0]?.permitted !== true)
                    throw unavailable();
            }
            await check();
            const result = await client.query(change.sql, change.parameters);
            if ((result.rowCount ?? 0) > 1000)
                throw new ApiError(409, 'MUTATION_LIMIT', 'Changes affecting more than 1000 rows are rolled back. Narrow the query.');
            if (change.operation === 'create table') {
                const q = (v: string) => '"' + identifier(v) + '"';
                await client.query(`GRANT SELECT ON ${q(schema)}.${q(change.table)} TO ${q(target.readRole)}`);
                await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${q(schema)}.${q(change.table)} TO ${q(target.writeRole)}`);
            }
            await check();
            return { affectedRows: result.rowCount ?? 0, elapsedMs: Date.now() - start };
        });
    }
}
