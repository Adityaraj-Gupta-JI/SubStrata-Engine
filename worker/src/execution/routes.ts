import { ApiError, badRequest, forbidden, json, notFound, unavailable } from '../errors';
import { workspaceAccess } from '../metadata';
import { dataSource, type DataSource } from '../database/sources';
import { fields, jsonBody } from '../http';
import { uuid } from '../validation';
import { changeSQL, hash, type Change } from './policy';
import { targets, targetDigest, PgExecutionService, ExecutionCredentials, type ExecutionService, type ExecutionTarget } from './service';
interface Access {
    enabled: number;
    revision: number;
}
export async function executionRoute(request: Request, env: Env, user: string, requestId: string, service: ExecutionService = new PgExecutionService()): Promise<Response | null> {
    const match = new URL(request.url).pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/databases\/([a-f0-9]{32})\/(write-access|change-preview|change-execute|change-history)$/);
    if (!match)
        return null;
    const workspace = uuid(match[1]), database = match[2], access = await workspaceAccess(env.METADATA, workspace, user), source = await dataSource(env.METADATA, database, workspace, access.workspace.organization_id);
    if (source.dialect === 'mysql')
        throw new ApiError(409, 'MYSQL_READ_ONLY', 'MySQL connections are read-only.');
    if (source.state !== 'active')
        throw new ApiError(409, 'DATABASE_NOT_READY', 'Select an active database.');
    const audit = (action: string, outcome: string) => env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) VALUES (?,?,?,?,'database',?,?,?)").bind(crypto.randomUUID(), source.organization_id, user, action, database, outcome, requestId);
    const grant = () => env.METADATA.prepare('SELECT enabled,revision FROM database_write_access WHERE database_id=? AND workspace_id=?').bind(database, workspace).first<Access>();
    const version = async () => { const row = await env.METADATA.prepare('SELECT version FROM workspace_permission_versions WHERE workspace_id=?').bind(workspace).first<{
        version: number;
    }>(); if (!row)
        throw unavailable(); return row.version; };
    if (match[3] === 'write-access') {
        if (request.method === 'GET') {
            const available = targets(env, source), permission = await grant();
            return json({ data: { dialect: 'postgresql', databaseName: source.database_name, enabled: permission?.enabled === 1, canWrite: ['owner', 'admin', 'member'].includes(access.role) && permission?.enabled === 1 && available.some(t => t.capability === 'write'), canAdmin: ['owner', 'admin'].includes(access.role) && permission?.enabled === 1 && available.some(t => t.capability === 'admin'), canManage: access.role === 'owner', configured: available.length > 0, reason: available.length ? 'An owner must explicitly enable verified execution roles.' : 'Separate encrypted execution credentials and approved roles are not configured.' }, requestId }, 200, requestId);
        }
        if (request.method !== 'POST')
            throw notFound();
        if (access.role !== 'owner')
            throw forbidden();
        const body = await jsonBody(request);
        fields(body, ['enabled', 'confirmation', 'action', 'capability', 'password']);
        if (body.action === 'register') {
            const target = targets(env, source).find(t => t.capability === body.capability);
            if (!target || body.confirmation !== `REGISTER ${source.database_name}` || typeof body.password !== 'string' || !body.password || body.password.length > 512 || body.password.includes('\0'))
                throw badRequest('Confirm the database and provide the approved role password.');
            if (!env.TENANT_CREDENTIALS || !env.SQL_VAULT_KEYS || !env.SQL_VAULT_KEY_ID)
                throw unavailable();
            const scope = { workspaceId: workspace, organizationId: source.organization_id, databaseId: database, capability: target.capability, role: target.role }, store = new ExecutionCredentials(env.TENANT_CREDENTIALS, env.SQL_VAULT_KEYS, env.SQL_VAULT_KEY_ID);
            await env.METADATA.batch([env.METADATA.prepare("INSERT INTO database_write_access(database_id,workspace_id,enabled,approved_by) VALUES (?,?,0,?) ON CONFLICT(database_id) DO UPDATE SET enabled=0,revision=revision+1,approved_by=excluded.approved_by").bind(database, workspace, user), audit('sql.credential', 'registration-requested')]);
            await store.put(scope, target.reference, body.password);
            try {
                await service.verify(env, source, target);
            }
            catch (error) {
                await store.revoke(scope, target.reference);
                await audit('sql.credential', 'verification-failed').run();
                throw error;
            }
            await audit('sql.credential', 'verified').run();
            return json({ data: { verified: true, enabled: false }, requestId }, 200, requestId);
        }
        if (body.action !== undefined)
            throw badRequest('Unsupported access action.');
        if (typeof body.enabled !== 'boolean' || body.confirmation !== `ENABLE ${source.database_name}`)
            throw badRequest('Confirm the exact database name before changing write access.');
        const permissionVersion=await version();await audit('sql.access', 'requested').run();
        if (body.enabled) {
            const roles = targets(env, source);
            if (!roles.length)
                throw unavailable();
            for (const role of roles)
                await service.verify(env, source, role);
        }
        if((await workspaceAccess(env.METADATA,workspace,user)).role!=='owner'||await version()!==permissionVersion)throw new ApiError(409,'PERMISSIONS_CHANGED','Permissions changed during verification. Refresh before retrying.');
        const result=await env.METADATA.batch([env.METADATA.prepare("INSERT INTO database_write_access(database_id,workspace_id,enabled,approved_by) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_permission_versions WHERE workspace_id=? AND version=?) ON CONFLICT(database_id) DO UPDATE SET enabled=excluded.enabled,approved_by=excluded.approved_by,revision=revision+1,updated_at=datetime('now') WHERE EXISTS(SELECT 1 FROM workspace_permission_versions WHERE workspace_id=? AND version=?)").bind(database,workspace,body.enabled?1:0,user,workspace,permissionVersion,workspace,permissionVersion),env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) SELECT ?,?,?,'sql.access','database',?,?,? WHERE changes()=1").bind(crypto.randomUUID(),source.organization_id,user,database,body.enabled?'enabled':'disabled',requestId)]);if(result[0].meta.changes!==1)throw new ApiError(409,'PERMISSIONS_CHANGED','Permissions changed during verification. Refresh before retrying.');
        return json({ data: { enabled: body.enabled }, requestId }, 200, requestId);
    }
    if (match[3] === 'change-history' && request.method === 'GET') {
        await env.METADATA.prepare("UPDATE sql_executions SET status='unknown',error_code='OUTCOME_UNKNOWN' WHERE workspace_id=? AND database_id=? AND status='executing' AND created_at<datetime('now','-30 seconds')").bind(workspace, database).run();
        const rows = await env.METADATA.prepare('SELECT id,operation,risk,status,affected_rows,error_code,created_at,finished_at FROM sql_executions WHERE workspace_id=? AND database_id=? AND user_id=? ORDER BY rowid DESC LIMIT 50').bind(workspace, database, user).all();
        return json({ data: rows.results, requestId }, 200, requestId);
    }
    if (request.method !== 'POST')
        throw notFound();
    const body = await jsonBody(request);
    fields(body, match[3] === 'change-preview' ? ['sql', 'parameters'] : ['sql', 'parameters', 'approvalToken', 'confirmation']);
    const change = changeSQL(body.sql, body.parameters ?? [], source.schema_name ?? 'tenant_data');
    const authorize = async (): Promise<{
        permission: Access;
        target: ExecutionTarget;
        context: string;
        version: number;
    }> => {
        if (!(await env.METADATA.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(user).first()))
            throw forbidden();
        const fresh = await workspaceAccess(env.METADATA, workspace, user);
        if (!['owner', 'admin', 'member'].includes(fresh.role) || change.capability === 'admin' && !['owner', 'admin'].includes(fresh.role) || change.elevated && fresh.role !== 'owner')
            throw forbidden();
        const current = await dataSource(env.METADATA, database, workspace, source.organization_id);
        if (current.state !== 'active')
            throw unavailable();
        const permission = await grant();
        if (permission?.enabled !== 1)
            throw new ApiError(409, 'WRITES_DISABLED', 'Write access is disabled. An owner must opt in using verified separate database roles.');
        const target = targets(env, current).find(t => t.capability === change.capability);
        if (!target)
            throw unavailable();
        const v = await version();
        return { permission, target, version: v, context: hash(JSON.stringify([fresh.role, v, permission.revision, targetDigest(env, current, target)])) };
    };
    let auth:Awaited<ReturnType<typeof authorize>>;try{auth=await authorize();}catch(error){await audit('sql.authorization','denied').run();throw error;}
    if (match[3] === 'change-preview') {
        await service.verify(env, source, auth.target);
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''), expires = Date.now() + 60000;
        await env.METADATA.batch([env.METADATA.prepare('INSERT INTO sql_approvals(token_hash,user_id,workspace_id,database_id,sql_digest,context_digest,permission_version,access_revision,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(hash(token), user, workspace, database, change.digest, auth.context, auth.version, auth.permission.revision, expires), audit('sql.preview', 'issued')]);
        return json({ data: { sql: change.sql, parameters: change.parameters, operation: change.operation, risk: change.elevated ? 'elevated' : change.capability === 'admin' ? 'schema-change' : 'write', capability: change.capability, confirmation: change.elevated ? `APPLY ${source.database_name}` : 'CONFIRM', approvalToken: token, expiresAt: expires, dialect: 'postgresql' }, requestId }, 200, requestId);
    }
    if (typeof body.approvalToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.approvalToken) || body.confirmation !== (change.elevated ? `APPLY ${source.database_name}` : 'CONFIRM'))
        throw badRequest('Explicit confirmation matching this preview is required.');
    const execution = crypto.randomUUID(), consumedAt = Date.now();
    const consumed = await env.METADATA.batch([
        env.METADATA.prepare('UPDATE sql_approvals SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND user_id=? AND workspace_id=? AND database_id=? AND sql_digest=? AND context_digest=? AND expires_at>? AND permission_version=(SELECT version FROM workspace_permission_versions WHERE workspace_id=?) AND access_revision=(SELECT revision FROM database_write_access WHERE database_id=? AND enabled=1)').bind(consumedAt, hash(body.approvalToken), user, workspace, database, change.digest, auth.context, consumedAt, workspace, database),
        env.METADATA.prepare("INSERT INTO sql_executions(id,user_id,workspace_id,database_id,sql_digest,operation,risk,status) SELECT ?,?,?,?,?,?,?,'executing' WHERE changes()=1").bind(execution, user, workspace, database, change.digest, change.operation, change.elevated ? 'elevated' : change.capability),
        env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) SELECT ?,?,?,'sql.execute','database',?,'started',? WHERE changes()=1").bind(crypto.randomUUID(), source.organization_id, user, database, requestId)
    ]);
    if(consumed[0].meta.changes!==1){await audit('sql.execute','approval-denied').run();throw new ApiError(409,'APPROVAL_INVALID','Approval expired, was consumed, or no longer matches the SQL, database or permissions. Preview again.');}
    const check = async () => { const current = await authorize(); if (current.context !== auth.context)
        throw new ApiError(409, 'PERMISSIONS_CHANGED', 'Permissions changed; transaction must be rolled back.'); };
    try {
        await check();
        const result = await service.execute(env, source, auth.target, change, check);
        await env.METADATA.batch([env.METADATA.prepare("UPDATE sql_executions SET status='committed',affected_rows=?,finished_at=datetime('now') WHERE id=?").bind(result.affectedRows, execution), audit('sql.execute', 'committed')]);
        return json({ data: { executionId: execution, status: 'committed', ...result }, requestId }, 200, requestId);
    }
    catch (error) {
        const code = error instanceof ApiError ? error.code : 'CHANGE_FAILED';
        await env.METADATA.batch([env.METADATA.prepare("UPDATE sql_executions SET status=?,error_code=?,finished_at=datetime('now') WHERE id=?").bind(error instanceof ApiError && error.status !== 503 ? 'failed' : 'unknown', code, execution), audit('sql.execute', 'not-confirmed')]);
        throw error instanceof ApiError ? error : unavailable();
    }
}
