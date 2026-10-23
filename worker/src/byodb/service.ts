import { ApiError, badRequest, unavailable } from "../errors";
import { PgReadTransport, type ReadTransport, type CredentialResolver } from "../database/transport";
import type { DataSource } from "../database/sources";
import { selectedDestination, destinationDigest } from "./policy";
import { externalStore, ExternalCredentialStore } from "./credentials";
export interface ExternalRow {
    id: string;
    workspace_id: string;
    organization_id: string;
    name: string;
    destination_id: string;
    destination_digest: string;
    database_name: string;
    runtime_role: string;
    schema_name: string;
    credential_reference: string;
    state: string;
    revision: number;
    disconnected: number;
    checked_at: string | null;
    last_error: string | null;
}
export function externalSource(row: ExternalRow): DataSource { return { ...row, kind: 'external', state: row.state === 'active' ? 'active' : 'failed', project_id: 'external', branch_id: row.destination_id, operation_ids: '[]', claim_id: null, retry_not_before: 0 }; }
export class ExternalResolver implements CredentialResolver {
    constructor(private env: Env, private store: () => ExternalCredentialStore = () => externalStore(env), private provided?: {
        row: ExternalRow;
        password: string;
    }) { }
    async resolve(tenant: DataSource) {
        const row = this.provided?.row ?? await this.env.METADATA.prepare('SELECT * FROM external_databases WHERE id=? AND workspace_id=? AND organization_id=?').bind(tenant.id, tenant.workspace_id, tenant.organization_id).first<ExternalRow>();
        if (!row || row.disconnected || row.state !== 'active' || tenant.kind !== 'external' || tenant.database_name !== row.database_name || tenant.runtime_role !== row.runtime_role || tenant.credential_reference !== row.credential_reference)
            throw unavailable();
        const d = selectedDestination(this.env.BYODB_ALLOWED_DESTINATIONS, row.destination_id, row.database_name, row.runtime_role, row.schema_name);
        if (destinationDigest(d) !== row.destination_digest)
            throw unavailable();
        const password = this.provided?.password ?? await this.store().read({ organizationId: row.organization_id, workspaceId: row.workspace_id, connectionId: row.id }, row.credential_reference);
        // No DNS lookup: connect to this approved public IP. TLS still authenticates
        // the approved hostname. Untrusted hostnames/connection strings are never used.
        return { reference: row.credential_reference, projectId: 'external', branchId: row.destination_id, database: row.database_name, user: row.runtime_role, host: d.address, port: d.port, password, serverName: d.hostname };
    }
}
export interface ExternalServices {
    store: (env: Env) => ExternalCredentialStore;
    test: (env: Env, row: ExternalRow, password: string) => Promise<void>;
}
export const defaultExternalServices: ExternalServices = { store: externalStore, test: async (env, row, password) => {
        try {
            await new PgReadTransport(new ExternalResolver(env, () => externalStore(env), { row, password }), 3000, { external: true }).read(externalSource(row), 'SELECT current_database() AS database, current_user AS role', [], 1);
        }
        catch {
            throw new ApiError(503, 'EXTERNAL_CONNECTION_FAILED', 'Connection validation failed. Check the approved endpoint, TLS certificate and restricted read-only role.');
        }
    } };
export function externalTransport(env: Env): ReadTransport { return new PgReadTransport(new ExternalResolver(env), 3000, { external: true }); }
export function metadata(row: ExternalRow) { return { id: row.id, name: row.name, engine: 'postgresql', destinationId: row.destination_id, databaseName: row.database_name, username: row.runtime_role, schema: row.schema_name, state: row.disconnected ? 'disconnected' : row.state, checkedAt: row.checked_at, revision: row.revision, error: row.last_error ? 'Connection check failed; review the restricted role, endpoint or TLS configuration.' : null }; }
