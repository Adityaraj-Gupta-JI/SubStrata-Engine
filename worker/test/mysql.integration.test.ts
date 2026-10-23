import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync,spawn,type ChildProcess } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, rmSync,writeFileSync } from 'node:fs';
import { resolve, join, sep,dirname } from 'node:path';
import { connect,createServer } from 'node:net';
import { createConnection, type Connection } from 'mysql2/promise';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { MySQLTransport, type MySQLSource } from '../src/mysql/transport';
import { ExecutionCredentials } from '../src/execution/service';
import { destinationDigest } from '../src/byodb/policy';
import { createHandler } from '../src/index';
import { AuthorizedAITools } from '../src/ai/tools';
import { unauthorized } from '../src/errors';
const enabled = process.env.SUBSTRATA_LOCAL_MYSQL === '1', container = 'substrata-mysql-' + randomUUID(), password = randomBytes(32).toString('hex'), readerSecret = randomBytes(32).toString('hex');
const w = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', u = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nativeBinary=process.env.SUBSTRATA_MYSQL_BINARY;let nativeProcess:ChildProcess|undefined,rootReady=true;
let directory = '', owned = false, ca = '', port = 0, mf: Miniflare, db: D1Database, env: Env, transport: MySQLTransport, handler: ReturnType<typeof createHandler>, source: MySQLSource;
function docker(args: string[]) { const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000, env: { ...process.env, MYSQL_ROOT_PASSWORD: password } }); if (result.status !== 0)
    throw new Error('Disposable MySQL container operation failed.'); return result.stdout.trim(); }
async function admin<T>(fn: (c: Connection) => Promise<T>) { const c = await createConnection({ host: 'localhost', port, stream: () => connect({ host: '127.0.0.1', port }), user: 'root', password:rootReady?password:'', ssl: { ca, rejectUnauthorized: true, verifyIdentity: true }, multipleStatements: true, connectTimeout: 3000 }); try {
    return await fn(c);
}
finally {
    c.destroy();
} }
async function call(action: string, method = 'GET', body?: object, workspace = w, subject = 'owner') { return handler(new Request(`https://local.test/api/v1/workspaces/${workspace}/databases/${source.id}/${action}`, { method, headers: { Authorization: 'Bearer ' + subject, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env); }
beforeAll(async () => {
    if (!enabled)
        return;
    if (!nativeBinary&&!docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).startsWith('npipe://'))
        throw new Error('Local Windows Docker required.');
    const base = resolve('.wrangler', 'mysql-certificates');
    mkdirSync(base, { recursive: true });
    directory = mkdtempSync(join(base, 'test-'));
    const cert = join(directory, 'server.crt'), key = join(directory, 'server.key');
    const result = spawnSync(process.env.SUBSTRATA_OPENSSL ?? 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0)
        throw new Error('TLS fixture generation failed.');
    ca = readFileSync(cert, 'utf8');
    writeFileSync(join(directory,'.substrata-cp6-owned'),'cp6-local-mysql');
    if(nativeBinary){
      const data=join(directory,'data');mkdirSync(data);const init=spawnSync(nativeBinary,['--no-defaults','--initialize-insecure',`--basedir=${dirname(dirname(nativeBinary))}`,`--datadir=${data}`,`--log-error=${join(directory,'initialization.log')}`],{encoding:'utf8',windowsHide:true,timeout:60000});if(init.status!==0)throw new Error('Disposable native MySQL initialization failed.');
      port=await new Promise<number>((resolve,reject)=>{const listener=createServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const address=listener.address();if(!address||typeof address==='string')return reject(new Error('No local fixture port.'));listener.close(()=>resolve(address.port));});});
      rootReady=false;nativeProcess=spawn(nativeBinary,['--no-defaults',`--basedir=${dirname(dirname(nativeBinary))}`,`--datadir=${data}`,'--bind-address=127.0.0.1',`--port=${port}`,'--mysqlx=OFF',`--ssl-ca=${cert}`,`--ssl-cert=${cert}`,`--ssl-key=${key}`,'--require-secure-transport=ON','--general-log=OFF','--slow-query-log=OFF',`--log-error=${join(directory,'server.log')}`],{windowsHide:true,stdio:'ignore'});nativeProcess.on('error',()=>{});
    }else{
    docker(['create', '--pull', 'never', '--name', container, '--label', 'substrata.checkpoint=cp6-mysql', '--publish', '127.0.0.1::3306', '--tmpfs', '/var/lib/mysql:rw', '--env', 'MYSQL_ROOT_PASSWORD', '--env', 'MYSQL_ROOT_HOST=%', '--entrypoint', 'sh', 'mysql:8.4', '-c', 'chown mysql:mysql /tmp/server.crt /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh mysqld --ssl-ca=/tmp/server.crt --ssl-cert=/tmp/server.crt --ssl-key=/tmp/server.key --require-secure-transport=ON']);
    owned = true;
    docker(['cp', cert, container + ':/tmp/server.crt']);
    docker(['cp', key, container + ':/tmp/server.key']);
    docker(['start', container]);
    port = Number(docker(['inspect', '--format', '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}', container]));
    }
    const deadline = Date.now() + 60000;
    for (;;) {
        try {
            await admin(async (c) => { await c.query('SELECT 1'); });
            break;
        }
        catch {
            if (Date.now() > deadline)
                throw new Error('Disposable TLS MySQL did not become ready.');
            await new Promise(r => setTimeout(r, 500));
        }
    }
    if(nativeBinary){await admin(async c=>{const [rows]=await c.query('SELECT @@datadir AS directory');const actual=(rows as {directory:string}[])[0]?.directory;if(!actual||resolve(actual).toLowerCase()!==resolve(join(directory,'data')).toLowerCase())throw new Error('Unexpected MySQL data directory.');await c.query(`ALTER USER 'root'@'localhost' IDENTIFIED BY '${password}'`);});rootReady=true;}
    await admin(async (c) => { await c.query(`CREATE DATABASE tenant_a; CREATE DATABASE tenant_b; CREATE TABLE tenant_a.items(id int PRIMARY KEY,name varchar(100)); INSERT INTO tenant_a.items VALUES (1,'actual MySQL row'); CREATE TABLE tenant_a.child_items(id int PRIMARY KEY,item_id int,CONSTRAINT child_parent FOREIGN KEY(item_id) REFERENCES tenant_a.items(id)); CREATE TABLE tenant_b.private_data(id int); CREATE TABLE tenant_a.large_data(value LONGTEXT); INSERT INTO tenant_a.large_data VALUES(REPEAT('x',1000000)); CREATE VIEW tenant_a.unsafe_view AS SELECT * FROM tenant_b.private_data; CREATE USER 'reader_a'@'%' IDENTIFIED BY '${readerSecret}' REQUIRE SSL; GRANT SELECT ON tenant_a.* TO 'reader_a'@'%';`); });
    mf = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('local')}}", compatibilityDate: '2026-10-22', d1Databases: ['DB'], r2Buckets: ['VAULT'] }), telemetry: { enabled: false } });
    db = await mf.getD1Database('DB');
    for (const name of ['0001_metadata.sql', '0002_neon_poc.sql', '0004_external_databases.sql', '0007_mysql_databases.sql'])
        await db.batch(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8').split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    await db.batch([db.prepare("INSERT INTO users(id,clerk_user_id) VALUES (?,'owner')").bind(u), db.prepare("INSERT INTO organizations(id,slug,name,created_by) VALUES ('org','org','Org',?)").bind(u), db.prepare("INSERT INTO memberships(id,organization_id,user_id,role) VALUES ('m','org',?,'owner')").bind(u), db.prepare("INSERT INTO workspaces(id,organization_id,slug,name,created_by) VALUES (?,'org','a','A',?),(?,'org','b','B',?)").bind(w, u, other, u)]);
    const r2 = await mf.getR2Bucket('VAULT'), bucket = { get: async (key: string) => { const o = await r2.get(key); return o ? { size: o.size, etag: o.etag, json: () => o.json() } : null; }, put: (key: string, value: string, options: any) => r2.put(key, value, options) };
    const keys = JSON.stringify({ test: randomBytes(32).toString('hex') });
    const d = { id: 'mysql-approved', hostname: 'db.example.com', address: '8.8.8.8', port: 3306, databases: ['tenant_a'], roles: ['reader_a'], schemas: ['tenant_a'] };
    env = { METADATA: db, TENANT_CREDENTIALS: bucket as R2Bucket, MYSQL_ALLOWED_DESTINATIONS: JSON.stringify([d]), MYSQL_VAULT_KEYS: keys, MYSQL_VAULT_KEY_ID: 'test' };
    transport = new MySQLTransport(options => { expect(options.host).toBe('db.example.com');expect(options.disableEval).toBe(true); expect(options.ssl).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true }); expect(typeof options.stream).toBe('function'); return createConnection({ ...options, host: 'localhost', port, stream: () => connect({ host: '127.0.0.1', port }), ssl: { ca, rejectUnauthorized: true, verifyIdentity: true } }); });
    handler = createHandler(async (r) => { if (r.headers.get('Authorization') !== 'Bearer owner')
        throw unauthorized(); return { clerkUserId: 'owner', sessionId: 'mocked' }; }, { transport: { read: vi.fn() }, mysql: transport }, undefined, { mysql: transport });
    const created = await handler(new Request(`https://local.test/api/v1/workspaces/${w}/mysql-connections`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Actual local MySQL', destinationId: d.id, database: 'tenant_a', username: 'reader_a', password: readerSecret }) }), env);
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await created.json() as any).data.id;
    source = (await db.prepare('SELECT * FROM mysql_databases WHERE id=?').bind(id).first<MySQLSource>())!;
    expect(source.destination_digest).toBe(destinationDigest(d));
}, 90000);
afterAll(async()=>{
 await mf?.dispose();
 if(nativeProcess&&nativeProcess.exitCode===null){const child=nativeProcess;const stopped=new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});await admin(async c=>{await c.query('SHUTDOWN');}).catch(()=>{});await stopped;}
 if(owned){if(docker(['inspect','--format','{{index .Config.Labels "substrata.checkpoint"}}',container])!=='cp6-mysql')throw new Error('Unexpected container identity.');docker(['rm','--force',container]);}
 if(directory){if(!resolve(directory).startsWith(resolve('.wrangler','mysql-certificates')+sep)||readFileSync(join(directory,'.substrata-cp6-owned'),'utf8')!=='cp6-local-mysql')throw new Error('Unexpected fixture path or ownership.');rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},30000);

describe.runIf(enabled)('MySQL: actual disposable TLS database + encrypted R2 + D1; mocked Clerk identity', () => {
    it('returns actual schemas, tables, metadata, primary keys and bounded rows', async () => { for (const action of ['schemas', 'tables', 'relation?table=items', 'rows?table=items'])
        expect((await call(action)).status).toBe(200); expect(await (await call('query', 'POST', { sql: 'SELECT id,name FROM tenant_a.items ORDER BY id LIMIT 5' })).json()).toMatchObject({ data: { rows: [{ id: '1', name: 'actual MySQL row' }] } }); });
    it('returns authorized structured relationships without scanning records',async()=>{expect(await(await call('relation?table=child_items')).json()).toMatchObject({data:{primaryKey:['id'],foreignKeys:[{name:'child_parent',column:'item_id',target_table:'items',target_column:'id'}]}});expect((await call('relation?schema=tenant_b&table=private_data')).status).toBe(400);});
    it('bounds large cells on the server before buffering and denies definer-view escapes',async()=>{const response=await call('query','POST',{sql:'SELECT * FROM tenant_a.large_data'});expect(response.status).toBe(200);const text=await response.text();expect(text.length).toBeLessThan(65536);expect(JSON.parse(text)).toMatchObject({data:{rows:[],truncated:true}});expect((await call('query','POST',{sql:'SELECT * FROM tenant_a.unsafe_view'})).status).toBe(400);});
    it('rejects writes, multiple statements, cross-database/workspace reads and invalid sessions', async () => { for (const sql of ['DELETE FROM tenant_a.items', 'DROP TABLE tenant_a.items', 'SELECT * FROM tenant_b.private_data', 'SELECT * FROM tenant_a.items; SELECT 1'])
        expect((await call('query', 'POST', { sql })).status).toBe(400); expect((await call('schemas', 'GET', undefined, other)).status).toBe(404); expect((await call('schemas', 'GET', undefined, w, 'invalid')).status).toBe(401); await expect(transport.run(env, source, async (c) => { await c.query('SELECT * FROM tenant_b.private_data'); })).rejects.toThrow(); await expect(transport.run(env, source, async (c) => { await c.query("UPDATE tenant_a.items SET name='bad'"); })).rejects.toThrow(); });
    it('provides real dialect-aware AI context but never a mutation tool', async () => { const tools = new AuthorizedAITools(env, { transport: { read: vi.fn() }, mysql: transport }, { workspaceId: w, userId: u, databaseId: source.id, allowRows: false }, 'test'); const context = await tools.context(); expect(context).toContain('mysql'); expect(context).toContain('items'); expect(context).toContain('varchar'); await expect(tools.execute('execute_sql', '{}')).rejects.toThrow(); });
    it('keeps plaintext out of D1 and API responses, rejects wrong scope and overprivileged roles', async () => { expect(JSON.stringify(source)).not.toContain(readerSecret); const store = new ExecutionCredentials(env.TENANT_CREDENTIALS!, env.MYSQL_VAULT_KEYS!, env.MYSQL_VAULT_KEY_ID!); await expect(store.read({ ...transport.scope(source), workspaceId: other }, source.credential_reference)).rejects.toThrow(); expect(await (await call('query', 'POST', { sql: 'SELECT * FROM tenant_a.items' })).text()).not.toContain(readerSecret); await admin(async (c) => { await c.query("GRANT INSERT ON tenant_a.* TO 'reader_a'@'%'"); }); expect((await call('schemas')).status).toBe(503); await admin(async (c) => { await c.query("REVOKE INSERT ON tenant_a.* FROM 'reader_a'@'%'"); }); expect((await call('schemas')).status).toBe(200); });
 it('rotates encrypted credentials and disconnects without modifying the external database',async()=>{
  const original=source.credential_reference,root=`https://local.test/api/v1/workspaces/${w}/mysql-connections/${source.id}`;
  const request=(body:object)=>handler(new Request(root,{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(body)}),env);
  expect((await request({action:'save',name:source.name,destinationId:source.destination_id,database:source.database_name,username:source.runtime_role,password:readerSecret,revision:source.revision})).status).toBe(200);
  source=(await db.prepare('SELECT * FROM mysql_databases WHERE id=?').bind(source.id).first<MySQLSource>())!;
  await expect(transport.store(env).read(transport.scope(source),original)).rejects.toThrow();expect((await call('rows?table=items')).status).toBe(200);
  expect((await request({action:'disconnect',revision:source.revision})).status).toBe(200);expect((await call('schemas')).status).toBe(409);
  await admin(async c=>{const [rows]=await c.query('SELECT name FROM tenant_a.items WHERE id=1');expect((rows as {name:string}[])[0].name).toBe('actual MySQL row');});
 });

});
