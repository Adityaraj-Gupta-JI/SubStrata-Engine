import { ApiError, badRequest, json, notFound } from '../errors';
import { requireRole, workspaceAccess } from '../metadata';
import { uuid } from '../validation';
import { fields, jsonBody } from '../http';
import { destinations, destinationDigest, selectedDestination } from './policy';
import { metadata, defaultExternalServices, type ExternalServices, type ExternalRow } from './service';
export async function externalRoute(request: Request, env: Env, user: string, requestId: string, services: ExternalServices = defaultExternalServices): Promise<Response | null> {
    const match = new URL(request.url).pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/external-connections(?:\/([a-f0-9]{32}|destinations))?$/);
    if (!match)
        return null;
    const workspace = uuid(match[1]), access = await workspaceAccess(env.METADATA, workspace, user), organization = access.workspace.organization_id;
    const audit = async (action: string, outcome: string) => env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) VALUES (?,?,?,?,'workspace',?,?,?)").bind(crypto.randomUUID(), organization, user, `external.${action}`, workspace, outcome, requestId).run();
    if (request.method === 'GET' && !match[2]) {
        const rows = await env.METADATA.prepare('SELECT * FROM external_databases WHERE workspace_id=? AND organization_id=? ORDER BY created_at DESC').bind(workspace, organization).all<ExternalRow>();
        return json({ data: rows.results.map(metadata), canManage: ['owner', 'admin'].includes(access.role), mysql: { available: false, reason: 'MySQL transport, TLS pinning and authorization are not validated.' }, requestId }, 200, requestId);
    }
    requireRole(access.role, ['owner', 'admin']);
    if (request.method === 'GET' && match[2] === 'destinations')
        return json({ data: destinations(env.BYODB_ALLOWED_DESTINATIONS).map(d => ({ id: d.id, hostname: d.hostname, databases: d.databases, roles: d.roles, schemas: d.schemas })), requestId }, 200, requestId);
    if (request.method !== 'POST')
        throw notFound();
    const value = await jsonBody(request);
    fields(value, ['action', 'name', 'destinationId', 'database', 'username', 'schema', 'password', 'revision', 'engine']);
    if (value.engine !== undefined && value.engine !== 'postgresql')
        throw new ApiError(501, 'MYSQL_UNAVAILABLE', 'MySQL transport is not available. PostgreSQL is supported through approved destinations.');
    const old = match[2] ? await env.METADATA.prepare('SELECT * FROM external_databases WHERE id=? AND workspace_id=? AND organization_id=?').bind(match[2], workspace, organization).first<ExternalRow>() : null;
    if (match[2] && !old)
        throw notFound();
    const action = typeof value.action === 'string' ? value.action : 'save';
    if (action === 'rotate' && !old)
        throw notFound();
    if (!['save', 'rename', 'rotate', 'test', 'disconnect'].includes(action))
        throw badRequest('Invalid connection action.');
    if (old && value.revision !== old.revision)
        throw new ApiError(409, 'CONNECTION_CHANGED', 'Connection changed. Refresh before retrying.');
    await audit(action, 'requested');
    if (action === 'disconnect') {
        if (!old)
            throw notFound();
        if (!old.disconnected) {
            const changes = await env.METADATA.batch([env.METADATA.prepare("UPDATE external_databases SET disconnected=1,state='failed',revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=?").bind(old.id, old.revision), env.METADATA.prepare("UPDATE connections SET status='disabled' WHERE id=? AND changes()=1").bind(old.id)]);
            if (changes[0].meta.changes !== 1)
                throw new ApiError(409, 'CONNECTION_CHANGED', 'Connection changed. Refresh before retrying.');
        }
        await services.store(env).revoke({ organizationId: organization, workspaceId: workspace, connectionId: old.id }, old.credential_reference);
        await audit(action, 'success');
        return json({ data: { disconnected: true }, requestId }, 200, requestId);
    }
    if (old?.disconnected)
        throw new ApiError(409, 'CONNECTION_DISCONNECTED', 'Create a new connection after disconnecting.');
    if (action === 'rename') {
        if (!old || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100)
            throw badRequest('Enter a name of 1–100 characters.');
        const changes = await env.METADATA.batch([env.METADATA.prepare("UPDATE external_databases SET name=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=?").bind(value.name.trim(), old.id, old.revision), env.METADATA.prepare('UPDATE connections SET display_name=? WHERE id=? AND changes()=1').bind(value.name.trim(), old.id)]);
        if (changes[0].meta.changes !== 1)
            throw new ApiError(409, 'CONNECTION_CHANGED', 'Connection changed. Refresh before retrying.');
        await audit(action, 'success');
        return json({ data: { metadataSaved: true }, requestId }, 200, requestId);
    }
    const store = services.store(env);
    const name = typeof value.name === 'string' ? value.name.trim() : old?.name;
    const destinationId = typeof value.destinationId === 'string' ? value.destinationId : old?.destination_id;
    const database = typeof value.database === 'string' ? value.database : old?.database_name, role = typeof value.username === 'string' ? value.username : old?.runtime_role, schema = typeof value.schema === 'string' ? value.schema : old?.schema_name;
    if (!name || name.length > 100 || !destinationId || !database || !role || !schema)
        throw badRequest('Complete the connection metadata.');
    const destination = selectedDestination(env.BYODB_ALLOWED_DESTINATIONS, destinationId, database, role, schema);
    const id = old?.id ?? crypto.randomUUID().replaceAll('-', ''), reference = `byodb-postgresql/${crypto.randomUUID()}`;
    const row: ExternalRow = { id, workspace_id: workspace, organization_id: organization, name, destination_id: destinationId, destination_digest: destinationDigest(destination), database_name: database, runtime_role: role, schema_name: schema, credential_reference: action === 'test' && old ? old.credential_reference : reference, state: 'active', revision: old?.revision ?? 1, disconnected: 0, checked_at: null, last_error: null };
    const password = action === 'test' && old ? await store.read({ organizationId: organization, workspaceId: workspace, connectionId: id }, old.credential_reference) : value.password;
    if (typeof password !== 'string' || !password || password.length > 512 || password.includes('\0'))
        throw badRequest('Enter the database password.');
    try {
        await services.test(env, row, password);
    }
    catch (error) {
        if (old)
            await env.METADATA.prepare("UPDATE external_databases SET last_error='CONNECTION_FAILED',checked_at=datetime('now') WHERE id=? AND revision=? AND disconnected=0").bind(old.id, old.revision).run();
        await audit(action, 'failed');
        throw error;
    }
    if (action === 'test') {
        if (old)
            await env.METADATA.prepare("UPDATE external_databases SET last_error=NULL,checked_at=datetime('now') WHERE id=? AND revision=? AND disconnected=0").bind(old.id, old.revision).run();
        await audit(action, 'success');
        return json({ data: { validated: true }, requestId }, 200, requestId);
    }
    await store.put({ organizationId: organization, workspaceId: workspace, connectionId: id }, reference, password);
    try {
        if (old) {
            const results = await env.METADATA.batch([env.METADATA.prepare("UPDATE external_databases SET credential_reference=?,destination_id=?,destination_digest=?,database_name=?,runtime_role=?,schema_name=?,last_error=NULL,checked_at=datetime('now'),revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND disconnected=0").bind(reference, destinationId, row.destination_digest, database, role, schema, id, old.revision), env.METADATA.prepare('UPDATE connections SET configuration_reference=? WHERE id=? AND EXISTS(SELECT 1 FROM external_databases WHERE id=? AND credential_reference=?)').bind(reference, id, id, reference)]);
            if (results[0].meta.changes !== 1)
                throw new ApiError(409, 'CONNECTION_CHANGED', 'Connection changed. Refresh before retrying.');
        }
        else
            await env.METADATA.batch([env.METADATA.prepare("INSERT INTO external_databases(id,workspace_id,organization_id,name,destination_id,destination_digest,database_name,runtime_role,schema_name,credential_reference,state,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,'active',datetime('now'))").bind(id, workspace, organization, name, destinationId, row.destination_digest, database, role, schema, reference), env.METADATA.prepare("INSERT INTO connections(id,organization_id,workspace_id,engine,display_name,connection_type,configuration_reference,status) VALUES (?,?,?,'postgresql',?,'byodb',?,'active')").bind(id, organization, workspace, name, reference)]);
    }
    catch (error) {
        await store.revoke({ organizationId: organization, workspaceId: workspace, connectionId: id }, reference);
        await audit(action, 'failed');
        throw error;
    }
    if (old) {
        try {
            await store.revoke({ organizationId: organization, workspaceId: workspace, connectionId: id }, old.credential_reference);
        }
        catch {
            await env.METADATA.prepare("UPDATE external_databases SET last_error='CREDENTIAL_CLEANUP_REQUIRED' WHERE id=? AND credential_reference=?").bind(id, reference).run();
            await audit('credential-cleanup', 'failed');
            throw new ApiError(503, 'CREDENTIAL_CLEANUP_REQUIRED', 'New credentials are active. Previous encrypted credential cleanup requires administrator attention.');
        }
    }
    await audit(action, 'success');
    return json({ data: { id, saved: true, validated: true }, requestId }, old ? 200 : 201, requestId);
}
