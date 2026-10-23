import { createConnection, type Connection, type ConnectionOptions, type RowDataPacket } from 'mysql2/promise';
import { connect } from 'node:net';
import { ApiError, unavailable,badRequest } from '../errors';
import { ExecutionCredentials } from '../execution/service';
import { destinations, destinationDigest } from '../byodb/policy';
import { mysqlSelect } from './policy';
export interface MySQLSource {
    id: string;
    workspace_id: string;
    organization_id: string;
    name: string;
    destination_id: string;
    destination_digest: string;
    database_name: string;
    runtime_role: string;
    credential_reference: string;
    state: string;
    revision: number;
    disconnected: number;
}
export class MySQLTransport {
    constructor(private factory: (options: ConnectionOptions) => Promise<Connection> = createConnection) { }
    store(env: Env) { if (!env.TENANT_CREDENTIALS || !env.MYSQL_VAULT_KEYS || !env.MYSQL_VAULT_KEY_ID)
        throw unavailable(); return new ExecutionCredentials(env.TENANT_CREDENTIALS, env.MYSQL_VAULT_KEYS, env.MYSQL_VAULT_KEY_ID); }
    scope(source: MySQLSource) { return { workspaceId: source.workspace_id, organizationId: source.organization_id, databaseId: source.id, capability: 'mysql-read', role: source.runtime_role }; }
    async run<T>(env: Env, source: MySQLSource, action: (connection: Connection) => Promise<T>, provided?: string): Promise<T> {
        if (source.state !== 'active' || source.disconnected)
            throw unavailable();
        const d = destinations(env.MYSQL_ALLOWED_DESTINATIONS, 3306).find(d => d.id === source.destination_id);
        if (!d || !d.databases.includes(source.database_name) || !d.roles.includes(source.runtime_role) || source.destination_digest !== destinationDigest(d))
            throw unavailable();
        const password = provided ?? await this.store(env).read(this.scope(source), source.credential_reference);
        let connection: Connection | undefined;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
            connection = await this.factory({ host: d.hostname, port: 3306, stream: () => connect({ host: d.address, port: 3306 }), user: source.runtime_role, password, database: source.database_name, ssl: { rejectUnauthorized: true, verifyIdentity: true }, connectTimeout: 3000, disableEval:true, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, flags: ['-LOCAL_FILES'] });
            connection.on('error', () => { });
            deadline = setTimeout(() => connection?.destroy(), 5000);
            const [status] = await connection.query<RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
            if (!status[0]?.Value)
                throw unavailable();
            const [identity] = await connection.query<RowDataPacket[]>('SELECT CURRENT_USER() AS identity, DATABASE() AS db, CURRENT_ROLE() AS roles');
            if (identity[0]?.db !== source.database_name || String(identity[0]?.identity).split('@')[0] !== source.runtime_role || identity[0]?.roles !== 'NONE')
                throw unavailable();
            const [grants] = await connection.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()');
            let select = false;
            for (const row of grants) {
                const grant = String(Object.values(row)[0]);
                if (/^GRANT USAGE ON \*\.\* TO /.test(grant))
                    continue;
                const prefix = `GRANT SELECT ON \`${source.database_name}\`.* TO `;
                if (!grant.startsWith(prefix))
                    throw unavailable();
                select = true;
            }
            if (!select)
                throw unavailable();
            await connection.query('SET SESSION MAX_EXECUTION_TIME=3000');
            await connection.query('START TRANSACTION READ ONLY');
            const result = await action(connection);
            await connection.query('ROLLBACK');
            return result;
        }
        catch (error) {
            if (error instanceof ApiError)
                throw error;
            throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'MySQL connection or read failed. Verify TLS, the approved endpoint, MySQL 8 role grants and query syntax.');
        }
        finally {
            if (deadline)
                clearTimeout(deadline);
            connection?.destroy();
        }
    }
    async query(env: Env, source: MySQLSource, sql: unknown) { const validated = mysqlSelect(sql, source.database_name); return this.run(env, source, async (connection) => this.dataRows(connection,validated.sql,source.database_name,validated.table,validated.selectedColumns)); }

    async dataRows(connection:Connection,sql:string,database:string,table:string,selected:string[]|null=null){
      const started=Date.now();const [objects]=await connection.execute<RowDataPacket[]>('SELECT TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[database,table]);if(objects[0]?.TABLE_TYPE!=='BASE TABLE'||objects[0]?.ENGINE!=='InnoDB')throw badRequest('MySQL row reads currently require an approved InnoDB base table. Views and other engines need a separate security review.');
      const [metadata]=await connection.execute<RowDataPacket[]>('SELECT COLUMN_NAME AS name,DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 101',[database,table]);if(!metadata.length||metadata.length>100)throw badRequest('Read tables with 1–100 columns.');const names=selected??metadata.map(c=>String(c.name));for(const name of names)if(!/^[_a-zA-Z][_a-zA-Z0-9]{0,62}$/.test(name)||!metadata.some(c=>c.name===name))throw badRequest('Unsupported MySQL column.');
      const pairs=names.map(name=>{const type=metadata.find(c=>c.name===name)!.type,ref='substrata_result.`'+name+'`';return "'"+name+"',IF("+ref+" IS NULL,NULL,"+(/blob|binary/.test(String(type))?'HEX('+ref+')':'CAST('+ref+' AS CHAR)')+')';}).join(',');
      const [values]=await connection.query<RowDataPacket[]>(`SELECT LEFT(CAST(JSON_OBJECT(${pairs}) AS CHAR),8193) AS row_json FROM (${sql}) AS substrata_result LIMIT 101`);
      const rows:Record<string,string|null>[]=[];let bytes=0,truncated=values.length>100;for(const value of values.slice(0,100)){const raw=String(value.row_json),length=new TextEncoder().encode(raw).length;if(raw.length>8192||length>8192||bytes+length>60000){truncated=true;break;}bytes+=length;rows.push(JSON.parse(raw));}return {columns:names,rows,truncated,elapsedMs:Date.now()-started};
    }
    async rows(connection: Connection, sql: string, parameters: (string | number | boolean | null)[] = []) { const started = Date.now(); const [values, fields] = await connection.execute<RowDataPacket[]>(sql, parameters); let bytes = 0, truncated = values.length > 100; const rows: Record<string, string | null>[] = []; for (const row of values.slice(0, 100)) {
        const item = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)]));
        const size = new TextEncoder().encode(JSON.stringify(item)).length;
        if (size > 8192 || bytes + size > 60000) {
            truncated = true;
            break;
        }
        bytes += size;
        rows.push(item);
    } return { columns: fields.map(f => f.name), rows, truncated, elapsedMs: Date.now() - started }; }
}
