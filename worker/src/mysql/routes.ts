import { json, badRequest, notFound, forbidden, ApiError } from '../errors';
import { workspaceAccess } from '../metadata';
import { uuid } from '../validation';
import { jsonBody, fields } from '../http';
import { destinations, destinationDigest } from '../byodb/policy';
import { MySQLTransport, type MySQLSource } from './transport';
const publicRow = (r: MySQLSource) => ({ id: r.id, name: r.name, dialect: 'mysql', state: r.disconnected ? 'disconnected' : r.state, revision: r.revision, database: r.database_name, destinationId: r.destination_id, username: r.runtime_role });
export async function mysqlConnectionRoute(request: Request, env: Env, user: string, requestId: string, transport = new MySQLTransport()): Promise<Response | null> {
    const match = new URL(request.url).pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/mysql-connections(?:\/([a-f0-9]{32}|destinations))?$/);
    if (!match)
        return null;
    const workspace = uuid(match[1]), access = await workspaceAccess(env.METADATA, workspace, user), org = access.workspace.organization_id;
    if (request.method === 'GET' && !match[2]) {
        const rows = await env.METADATA.prepare('SELECT * FROM mysql_databases WHERE workspace_id=? AND organization_id=?').bind(workspace, org).all<MySQLSource>();
        return json({ data: rows.results.map(publicRow), canManage: ['owner', 'admin'].includes(access.role), requestId }, 200, requestId);
    }
    if (!['owner', 'admin'].includes(access.role))
        throw forbidden();
    if (request.method === 'GET' && match[2] === 'destinations')
        return json({ data: destinations(env.MYSQL_ALLOWED_DESTINATIONS, 3306).map(d => ({ id: d.id, hostname: d.hostname, databases: d.databases, roles: d.roles })), requestId }, 200, requestId);
    if (request.method !== 'POST')
        throw notFound();
    const body = await jsonBody(request);
    fields(body, ['action', 'name', 'destinationId', 'database', 'username', 'password', 'revision']);
    const old = match[2] ? await env.METADATA.prepare('SELECT * FROM mysql_databases WHERE id=? AND workspace_id=? AND organization_id=?').bind(match[2], workspace, org).first<MySQLSource>() : null;
    if (match[2] && !old)
        throw notFound();
    if (old && body.revision !== old.revision)
        throw badRequest('Connection changed. Refresh before retrying.');
    const audit = (outcome: string,conditional=false) => env.METADATA.prepare(conditional?"INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) SELECT ?,?,?,'mysql.connection','workspace',?,?,? WHERE changes()=1":"INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) VALUES (?,?,?,'mysql.connection','workspace',?,?,?)").bind(crypto.randomUUID(), org, user, workspace, outcome, requestId);
    if (body.action === 'disconnect') {
        if (!old)
            throw notFound();
        const changed = await env.METADATA.batch([env.METADATA.prepare("UPDATE mysql_databases SET disconnected=1,state='failed',revision=revision+1 WHERE id=? AND revision=?").bind(old.id, old.revision), audit('disconnected',true)]);
        if (changed[0].meta.changes !== 1)
            throw badRequest('Connection changed; refresh.');
        await transport.store(env).revoke(transport.scope(old), old.credential_reference);
        return json({ data: { disconnected: true }, requestId }, 200, requestId);
    }
    if (old?.disconnected)
        throw badRequest('Disconnected connections cannot be reused.');
    if (body.action !== undefined && !['save', 'test'].includes(String(body.action)))
        throw badRequest('Unsupported MySQL action.');
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || typeof body.password !== 'string' || !body.password || body.password.length > 512 || body.password.includes('\0'))
        throw badRequest('Enter a connection name and password.');
    const d = destinations(env.MYSQL_ALLOWED_DESTINATIONS, 3306).find(d => d.id === body.destinationId);
    if (!d || typeof body.database !== 'string' || !d.databases.includes(body.database) || typeof body.username !== 'string' || !d.roles.includes(body.username))
        throw badRequest('Choose an approved MySQL destination, database and role.');
    const row: MySQLSource = { id: old?.id ?? crypto.randomUUID().replaceAll('-', ''), workspace_id: workspace, organization_id: org, name: body.name.trim(), destination_id: d.id, destination_digest: destinationDigest(d), database_name: body.database, runtime_role: body.username, credential_reference: 'sql-role/' + crypto.randomUUID(), state: 'active', revision: old?.revision ?? 1, disconnected: 0 };
    await audit('validation-requested').run();
    try {
        await transport.run(env, row, async () => { }, body.password);
    }
    catch (error) {
        await audit('validation-failed').run();
        throw error;
    }
    if (body.action === 'test')
        return json({ data: { validated: true }, requestId }, 200, requestId);
    const store = transport.store(env);
    await store.put(transport.scope(row), row.credential_reference, body.password);
    const changed = await env.METADATA.batch([env.METADATA.prepare("INSERT INTO mysql_databases(id,workspace_id,organization_id,name,destination_id,destination_digest,database_name,runtime_role,credential_reference,state,checked_at) VALUES (?,?,?,?,?,?,?,?,?,'active',datetime('now')) ON CONFLICT(id) DO UPDATE SET credential_reference=excluded.credential_reference,name=excluded.name,destination_id=excluded.destination_id,destination_digest=excluded.destination_digest,database_name=excluded.database_name,runtime_role=excluded.runtime_role,revision=revision+1,checked_at=datetime('now') WHERE mysql_databases.revision=? AND disconnected=0").bind(row.id, workspace, org, row.name, d.id, row.destination_digest, row.database_name, row.runtime_role, row.credential_reference, row.revision), audit('saved',true)]);
    if (changed[0].meta.changes !== 1) {
        await store.revoke(transport.scope(row), row.credential_reference);
        throw badRequest('Connection changed; refresh.');
    }
    if (old)
        await store.revoke(transport.scope(old), old.credential_reference);
    return json({ data: { id: row.id, validated: true }, requestId }, old ? 200 : 201, requestId);
}
export async function mysqlDatabaseAction(request: Request, env: Env, source: MySQLSource, action: string, requestId: string, transport = new MySQLTransport()): Promise<Response> {
    const url = new URL(request.url);
    let data: unknown;
    const schema = url.searchParams.get('schema') ?? source.database_name, table = url.searchParams.get('table') ?? '';
    if (schema !== source.database_name)
        throw badRequest('Only the approved MySQL database is available.');
    const validTable = () => { if (!/^[_a-zA-Z][_a-zA-Z0-9]{0,62}$/.test(table))
        throw badRequest('Invalid MySQL table.'); };
    if (action === 'query' && request.method === 'POST') {
        const body = await jsonBody(request);
        fields(body, ['sql', 'parameters']);
        if (body.parameters !== undefined && (!Array.isArray(body.parameters) || body.parameters.length))
            throw badRequest('MySQL parameter binding is not available in this SELECT subset.');
        data = await transport.query(env, source, body.sql);
    }
    else if (request.method === 'GET' && ['schemas', 'tables', 'relation', 'rows'].includes(action))
        data = await transport.run(env, source, async (connection) => {
            if (action === 'schemas')
                return [{ name: source.database_name }];
            if (action === 'tables')
                return (await transport.rows(connection, "SELECT TABLE_NAME AS name, CASE WHEN TABLE_TYPE='VIEW' THEN 'view' ELSE 'table' END AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME LIMIT 100", [schema])).rows;
            validTable();
            const columns = (await transport.rows(connection, "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,CASE WHEN IS_NULLABLE='NO' THEN 'true' ELSE 'false' END AS not_null,COLUMN_KEY AS column_key FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 100", [schema, table])).rows;
            if (!columns.length)
                throw notFound();
            if (action === 'relation') {
                const indexes = (await transport.rows(connection, 'SELECT INDEX_NAME AS name, COLUMN_NAME AS definition FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 100', [schema, table])).rows;
                return { columns, keys: columns.filter(c => c.column_key === 'PRI').map(c => ({ name: c.name, type: 'p', definition: 'PRIMARY KEY' })), indexes, primaryKey: columns.filter(c => c.column_key === 'PRI').map(c => c.name) };
            }
            const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 20);
            if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100)
                throw badRequest('Invalid page.');
            const pk = columns.filter(c => c.column_key === 'PRI').map(c => '`' + c.name + '`').join(',');
            const result = await transport.dataRows(connection, `SELECT * FROM \`${schema}\`.\`${table}\`${pk ? ' ORDER BY ' + pk : ''} LIMIT ${limit + 1} OFFSET ${offset}`,schema,table);
            return { ...result, rows: result.rows.slice(0, limit), page: { limit, offset }, stableOrder: !!pk, hasMore: result.rows.length > limit };
        });
    else
        throw notFound();
    if(new TextEncoder().encode(JSON.stringify({data,requestId})).length>65536)throw new ApiError(413,'RESULT_TOO_LARGE','MySQL result exceeds the response budget. Narrow the selection.');
    return json({ data, requestId }, 200, requestId);
}
