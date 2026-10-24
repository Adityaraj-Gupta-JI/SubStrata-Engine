import {tableSelect} from "../../frontend/src/lib/product-workflow";
import {PgExecutionService,ExecutionCredentials} from "../src/execution/service";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import {ExternalResolver,externalSource,type ExternalRow} from "../src/byodb/service";
import {ExternalCredentialStore} from "../src/byodb/credentials";
import {destinationDigest} from "../src/byodb/policy";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, appendFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHandler } from "../src/index";
import { unauthorized } from "../src/errors";
import { SqlRestrictedRoles } from "../src/neon/restricted-roles";
import { type TenantTarget } from "../src/neon/contracts";
import { PgReadTransport, type CredentialResolver, LocalRuntimeCredentials } from "../src/database/transport";
import type { TenantMetadata } from "../src/neon/provisioning";
import { TenantProvisioner } from "../src/neon/provisioning";
import { databaseApi } from "../../frontend/src/lib/api/databases";
import { EncryptedCredentialVault } from "../src/neon/credential-vault";
import { PgProvisioningConnections } from "../src/neon/connections";
import { VaultRuntimeCredentials } from "../src/neon/development";

const enabled = process.env.SUBSTRATA_LOCAL_POSTGRES === "1";
const container = `substrata-gateway-${randomUUID()}`;
const password = randomBytes(32).toString("hex");
const passwords = new Map<string, string>();
const project = "local-project", branch = "br-local";
const wa = "11111111-1111-4111-8111-111111111111", wb = "22222222-2222-4222-8222-222222222222";
const browserWorkspace=process.env.SUBSTRATA_BROWSER_WORKSPACE_ID;
const ta = browserWorkspace?randomUUID().replaceAll("-",""):"a".repeat(32), tb = browserWorkspace?randomUUID().replaceAll("-",""):"b".repeat(32);
const browserDir=resolve(".wrangler","cp8b-browser"), browserRuntime=join(browserDir,"runtime.env"), browserSeed=join(browserDir,"seed.sql");
function browserMetadata(sql:string){writeFileSync(browserSeed,sql);const result=spawnSync(process.execPath,[resolve("node_modules/wrangler/bin/wrangler.js"),"d1","execute","METADATA","--local","--persist-to",".wrangler/r3-local","--file",browserSeed,"--env-file","types.env.example","--json"],{encoding:"utf8",timeout:30000,env:{...process.env,WRANGLER_SEND_METRICS:"false"}});if(result.status!==0)throw new Error("Local browser fixture metadata operation failed.");return result.stdout;}
const target = (id: string): TenantTarget => ({ database: `ss_t_${id}`, runtimeRole: `ss_r_${id}`, credentialReference: `neon-runtime/${id}` });
let port: number, ca: string, directory: string, owned = false;
let browserOwned=false,browserSeeded=false;
let runtime: Miniflare, db: D1Database, env: Env;
let handler: ReturnType<typeof createHandler>;
let transport: PgReadTransport;
let resolver: CredentialResolver;
let vault: EncryptedCredentialVault;
function docker(args: string[]) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30000, env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (result.status !== 0) throw new Error("Disposable gateway container operation failed.");
  return result.stdout.trim();
}
async function withClient<T>(database: string, user: string, secret: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ host: "127.0.0.1", port, database, user, password: secret, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 3000 });
  client.on("error", () => undefined);
  try { await client.connect(); return await run(client); }
  finally { await client.end().catch(() => undefined); }
}
async function call(path: string, method = "GET", body?: object, subject = "owner") {
  return handler(new Request(`https://local.test/api/v1/workspaces/${path}`, { method, headers: { Authorization: `Bearer ${subject}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}
beforeAll(async () => {
  if (!enabled) return;
  if(browserWorkspace&&existsSync(browserRuntime))throw new Error("Existing private browser fixture must be reviewed before reuse");
  if (!docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).startsWith("npipe://")) throw new Error("Local Windows Docker context required.");
  const certificateRoot = resolve(".wrangler", "gateway-certificates");
  mkdirSync(certificateRoot, { recursive: true });
  directory = mkdtempSync(join(certificateRoot, "test-"));
  const openssl = process.env.SUBSTRATA_OPENSSL ?? "openssl";
  const cert = join(directory, "server.crt"), key = join(directory, "server.key");
  const certificate = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", key, "-out", cert], { encoding: "utf8", timeout: 15000 });
  if (certificate.status !== 0) throw new Error("Local TLS certificate creation failed.");
  ca = readFileSync(cert, "utf8");
  docker(["create", "--pull", "never", "--name", container, "--label", "substrata.checkpoint=cp2-gateway-test", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=trust", "--entrypoint", "sh", "postgres:16-alpine", "-c", "chown postgres:postgres /tmp/server.key /tmp/server.crt && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key"]);
  owned = true;
  docker(["cp", cert, `${container}:/tmp/server.crt`]); docker(["cp", key, `${container}:/tmp/server.key`]);
  docker(["start", container]);
  port = Number(docker(["inspect", "--format", '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', container]));
  const deadline = Date.now() + 20000;
  for (;;) {
    try { await withClient("postgres", "postgres", password, async client => { await client.query("SELECT 1"); }); break; }
    catch { if (Date.now() >= deadline) throw new Error("Disposable TLS PostgreSQL did not become ready."); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  for (const id of [ta, tb]) await withClient("postgres", "postgres", password, async client => { await client.query(`CREATE DATABASE "ss_t_${id}"`); });
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('local'); } };", compatibilityDate: "2026-10-22", d1Databases: ["METADATA"], r2Buckets: ["VAULT"] }), telemetry: { enabled: false } });
  db = await runtime.getD1Database("METADATA");
  const bucket = await runtime.getR2Bucket("VAULT");
  vault = new EncryptedCredentialVault({get:async key=>{const object=await bucket.get(key);return object?{size:object.size,etag:object.etag,json:()=>object.json()}:null;},put:(key,value,options)=>bucket.put(key,value,options)},`${project}/${branch}`,JSON.stringify({test:randomBytes(32).toString("hex")}),"test",async reference=>({tenantId:reference.split("/")[1],workspaceId:reference.endsWith(ta)?wa:wb,purpose:"postgres-runtime"}));
  const endpoint = {projectId:project,branchId:branch,ownerRole:"postgres",host:"ep-local.region.aws.neon.tech",controlDatabase:"postgres"};
  // Only the test client factory maps the approved endpoint to local TLS Docker.
  const connections = new PgProvisioningConnections(endpoint,password,vault,options=>new Client({...options,host:"127.0.0.1",port,ssl:{ca,rejectUnauthorized:true}}));
  const roles = new SqlRestrictedRoles({ projectId: project, branchId: branch, ownerRole: "postgres", apiKey: "test-fixture", approvedDisposableEnvironment: true }, connections, { ensure: async reference => { const secret=await vault.ensure(reference); passwords.set(reference,secret); return secret; } });
  for (const id of [ta, tb]) {
    await roles.configure(target(id));
    await roles.validateIsolation(target(id));
    await withClient(target(id).database, "postgres", password, async client => {
      await client.query("CREATE TABLE tenant_data.departments (id int PRIMARY KEY); INSERT INTO tenant_data.departments VALUES (1); CREATE TABLE tenant_data.items (id int PRIMARY KEY, department_id int REFERENCES tenant_data.departments(id), name text NOT NULL, precise bigint); CREATE INDEX items_name_idx ON tenant_data.items(name); INSERT INTO tenant_data.items SELECT n, 1, 'item-' || n, 9007199254740993 FROM generate_series(1,250) n; CREATE VIEW tenant_data.items_view AS SELECT id,name FROM tenant_data.items; CREATE VIEW tenant_data.slow AS SELECT id, pg_sleep(0.02)::text AS waited FROM tenant_data.items; CREATE TABLE tenant_data.large (value text); INSERT INTO tenant_data.large VALUES (repeat('x',10000));");
    });
  }
  for (const file of ["0001_metadata.sql", "0002_neon_poc.sql", "0004_external_databases.sql", "0007_mysql_databases.sql"]) {
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await db.batch(sql.split(";").map(part => part.trim()).filter(Boolean).map(part => db.prepare(part)));
  }
  await db.batch([
    db.prepare("INSERT INTO users (id,clerk_user_id) VALUES ('u-a','owner'),('u-b','other'),('u-view','viewer')"),
    db.prepare("INSERT INTO organizations (id,slug,name,created_by) VALUES ('o-a','a','A','u-a'),('o-b','b','B','u-b')"),
    db.prepare("INSERT INTO memberships (id,organization_id,user_id,role) VALUES ('m-a','o-a','u-a','owner'),('m-b','o-b','u-b','owner'),('m-view','o-a','u-view','viewer')"),
    db.prepare("INSERT INTO workspaces (id,organization_id,slug,name,created_by) VALUES (?,'o-a','a','A','u-a'),(?,'o-b','b','B','u-b')").bind(wa,wb),
    db.prepare("INSERT INTO workspace_memberships (id,workspace_id,user_id,role) VALUES ('v',?,'u-view','viewer')").bind(wa),
    ...[[ta,wa,"o-a"],[tb,wb,"o-b"]].map(([id,workspace,org]) => db.prepare("INSERT INTO managed_tenant_databases (id,workspace_id,organization_id,project_id,branch_id,database_name,runtime_role,credential_reference,state) VALUES (?,?,?,?,?,?,?,?,'active')").bind(id,workspace,org,project,branch,`ss_t_${id}`,`ss_r_${id}`,`neon-runtime/${id}`)),
  ]);
  env = { METADATA: db };
  const runtimeCredentials = new VaultRuntimeCredentials(endpoint,vault);
  resolver = { resolve: async tenant => ({ ...await runtimeCredentials.resolve(tenant), host: "127.0.0.1", port, ca }) };
  transport = new PgReadTransport(resolver);
  handler = createHandler(async request => {
    const subject = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!["owner", "other", "viewer"].includes(subject ?? "")) throw unauthorized();
    return { clerkUserId: subject!, sessionId: "mocked-clerk-test-session" };
  }, { transport });
  if(browserWorkspace){
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(browserWorkspace))throw new Error("Invalid browser workspace fixture ID");
    mkdirSync(browserDir,{recursive:true});
    if(existsSync(browserRuntime))throw new Error("An existing private browser runtime must be reviewed before starting another fixture");
    const seeded=browserMetadata(`INSERT INTO managed_tenant_databases(id,workspace_id,organization_id,project_id,branch_id,database_name,runtime_role,credential_reference,state) SELECT '${ta}',w.id,w.organization_id,'${project}','${branch}','ss_t_${ta}','ss_r_${ta}','neon-runtime/${ta}','active' FROM workspaces w JOIN organizations o ON o.id=w.organization_id WHERE w.id='${browserWorkspace}' AND w.slug='cp8b-local' AND o.slug='cp8b-smoke-20261024'; SELECT id FROM managed_tenant_databases WHERE id='${ta}' AND workspace_id='${browserWorkspace}';`);
    if(!seeded.includes(ta))throw new Error("Create the named disposable CP8B organization/workspace through the real browser first");
    // Secrets are copied privately for Wrangler, never parsed/displayed by the test.
    browserSeeded=true;
    copyFileSync('.dev.vars',browserRuntime);
    browserOwned=true;
    copyFileSync(cert,join(browserDir,'ca.crt'));
    const entries=[ta,tb].map(id=>({reference:`neon-runtime/${id}`,projectId:project,branchId:branch,database:`ss_t_${id}`,user:`ss_r_${id}`,host:'127.0.0.1',port,password:passwords.get(`neon-runtime/${id}`),ca}));
    appendFileSync(browserRuntime,`\nDATABASE_RUNTIME_MODE=local\nDATABASE_RUNTIME_CONFIG='${JSON.stringify(entries)}'\n`);
    console.log('CP8B_BROWSER_READY: disposable real TLS PostgreSQL; genuine Clerk required.');
  }
}, 60000);
afterAll(async () => {
  let cleanupError: unknown;
  if(browserWorkspace&&browserSeeded){
    const deadline=Date.now()+60*60*1000;
    while(browserOwned&&!existsSync(join(browserDir,'stop'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,500));
    try { browserMetadata(`DELETE FROM managed_tenant_databases WHERE id='${ta}' AND workspace_id='${browserWorkspace}';`); } catch(error) { cleanupError=error; }
    for(const path of [browserRuntime,browserSeed,join(browserDir,'ca.crt')])if(existsSync(path))unlinkSync(path);
    if(existsSync(join(browserDir,'stop')))unlinkSync(join(browserDir,'stop'));
  }
  await runtime?.dispose();
  if (owned) {
    if (docker(["inspect", "--format", '{{index .Config.Labels "substrata.checkpoint"}}',container]) !== "cp2-gateway-test") throw new Error("Unexpected container ownership.");
    docker(["rm","--force",container]);
  }
  if (directory) {
    const root = resolve(".wrangler", "gateway-certificates") + sep;
    if (!resolve(directory).startsWith(root)) throw new Error("Unexpected certificate directory.");
    rmSync(directory, { recursive: true, force: true });
  }
  if(cleanupError)throw cleanupError;
});

describe.runIf(enabled)("gateway with real TLS PostgreSQL + D1 (mocked Clerk identity, no Neon)", () => {
  it("reads an external schema over real TLS with a pinned-IP config, encrypted password and no writable role", async () => {
    const externalId='e'.repeat(32), ref='byodb-postgresql/'+randomUUID();
    const approved={id:'local-fixture',hostname:'db.example.com',address:'8.8.8.8',port:5432,databases:[target(ta).database],roles:[target(ta).runtimeRole],schemas:['app']};
    await withClient(target(ta).database,'postgres',password,async client=>{await client.query(`CREATE SCHEMA app; CREATE TABLE app.customers(id int PRIMARY KEY,name text); INSERT INTO app.customers VALUES (1,'local row'); GRANT USAGE ON SCHEMA app TO "${target(ta).runtimeRole}"; GRANT SELECT ON app.customers TO "${target(ta).runtimeRole}";`);});
    const r2=await runtime.getR2Bucket('VAULT');
    const bucket={get:async(key:string)=>{const o=await r2.get(key);return o?{size:o.size,etag:o.etag,json:()=>o.json()}:null;},put:(key:string,value:string,options:any)=>r2.put(key,value,options)};
    const store=new ExternalCredentialStore(bucket,JSON.stringify({test:randomBytes(32).toString('hex')}),'test');
    await store.put({organizationId:'o-a',workspaceId:wa,connectionId:externalId},ref,passwords.get(target(ta).credentialReference)!);
    await db.prepare("INSERT INTO external_databases(id,workspace_id,organization_id,name,destination_id,destination_digest,database_name,runtime_role,schema_name,credential_reference,state) VALUES (?,?,'o-a','External','local-fixture',?,?,?,'app',?,'active')").bind(externalId,wa,destinationDigest(approved),target(ta).database,target(ta).runtimeRole,ref).run();
    const configuration={...env,BYODB_ALLOWED_DESTINATIONS:JSON.stringify([approved])};
    const external=new PgReadTransport(new ExternalResolver(configuration,()=>store),3000,{external:true,clientFactory:config=>{
      expect(config.host).toBe(approved.address);expect(config.port).toBe(5432);expect(config.ssl).toMatchObject({rejectUnauthorized:true,servername:approved.hostname});
      // Disposable TLS fixture only: production config remains pinned above.
      return new Client({...config,host:'127.0.0.1',port,ssl:{rejectUnauthorized:true,servername:'localhost',ca}});
    }});
    const externalHandler=createHandler(async()=>({clerkUserId:'owner',sessionId:'mocked'}),{transport:external});
    const request=async(action:string,sql?:string)=>externalHandler(new Request(`https://local.test/api/v1/workspaces/${wa}/databases/${externalId}/${action}`,{...(sql?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql})}:{})}),configuration);
    for(const action of ['schemas','tables','relation?table=customers','rows?table=customers'])expect((await request(action)).status).toBe(200);
    expect(await (await request('query','SELECT name FROM app.customers')).json()).toMatchObject({data:{rows:[{name:'local row'}]}});
    for(const sql of ['DELETE FROM app.customers','DROP TABLE app.customers','SELECT * FROM app.customers; SELECT * FROM pg_roles','SELECT * FROM tenant_data.items'])expect((await request('query',sql)).status).toBe(400);
    const row=(await db.prepare('SELECT * FROM external_databases WHERE id=?').bind(externalId).first<ExternalRow>())!;
    await expect(external.read(externalSource(row),'DELETE FROM app.customers RETURNING id')).rejects.toThrow();
    await withClient(target(ta).database,'postgres',password,async client=>{await client.query(`GRANT INSERT ON app.customers TO "${target(ta).runtimeRole}"`);});
    expect((await request('schemas')).status).toBe(503);
    await withClient(target(ta).database,'postgres',password,async client=>{await client.query(`REVOKE INSERT ON app.customers FROM "${target(ta).runtimeRole}"`);});
    expect((await request('schemas')).status).toBe(200);
  });
  it("serves schemas, tables/views, columns, keys, indexes and stable bounded previews", async () => {
    for (const action of ["schemas","tables","relation?table=items","rows?table=items&limit=20&offset=20"]) {
      const response = await call(`${wa}/databases/${ta}/${action}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: Record<string, unknown> };
      if (action.startsWith("relation")) { expect(body.data.keys).toHaveLength(2); expect(body.data.indexes).toHaveLength(2); expect(body.data.foreignKeys).toEqual([{name:"items_department_id_fkey",column:"department_id",target_table:"departments",target_column:"id"}]); }
      if (action.startsWith("rows")) { expect(body.data.rows).toHaveLength(20); expect(body.data.stableOrder).toBe(true); }
    }
  });
  it("executes parameterized reads, preserves bigint precision and bounds rows/bytes", async () => {
    const response = await call(`${wa}/databases/${ta}/query`, "POST", { sql: "SELECT * FROM tenant_data.items WHERE id > $1 ORDER BY id", parameters: [0] });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { rows: Record<string,unknown>[]; truncated: boolean } };
    expect(body.data.rows).toHaveLength(100); expect(body.data.truncated).toBe(true);
    expect(body.data.rows[0].precise).toBe("9007199254740993");
    const count = await call(`${wa}/databases/${ta}/query`, "POST", { sql: "SELECT count(*) AS total FROM tenant_data.items" });
    expect(await count.json()).toMatchObject({ data: { rows: [{ total: "250" }] } });
    const tenant = (await db.prepare("SELECT * FROM managed_tenant_databases WHERE id=?").bind(ta).first<TenantMetadata>())!;
    expect((await transport.read(tenant,"SELECT current_setting('transaction_read_only') AS mode")).rows).toEqual([{ mode:"on" }]);
    const large = await call(`${wa}/databases/${ta}/query`, "POST", { sql: "SELECT * FROM tenant_data.large" });
    expect(await large.json()).toMatchObject({ data: { rows: [], truncated: true } });
  });
  it("rejects writes, DDL, injection, multiple statements and unsafe functions", async () => {
    for (const sql of ["INSERT INTO tenant_data.items(id) VALUES (999)", "UPDATE tenant_data.items SET name='bad'", "DELETE FROM tenant_data.items", "DROP TABLE tenant_data.items", "SELECT * FROM tenant_data.items; SELECT * FROM pg_roles", "SELECT pg_sleep(9) FROM tenant_data.items", "SELECT * FROM tenant_data.items WHERE id=1 OR 1=1; DROP TABLE tenant_data.items"]) {
      expect((await call(`${wa}/databases/${ta}/query`,"POST",{sql})).status).toBe(400);
    }
    const injection = await call(`${wa}/databases/${ta}/rows?table=${encodeURIComponent('items"; DROP TABLE tenant_data.items; --')}`);
    expect(injection.status).toBe(404);
  });
  it("denies foreign databases/workspaces, invalid tokens and viewer provisioning", async () => {
    expect((await call(`${wa}/databases/${tb}/schemas`)).status).toBe(404);
    expect((await call(`${wb}/databases/${tb}/schemas`)).status).toBe(404);
    expect((await call(`${wa}/databases`,"GET",undefined,"invalid")).status).toBe(401);
    expect((await call(`${wa}/databases`,"POST",{},"viewer")).status).toBe(403);
    expect((await call(`${wa}/databases/${ta}/schemas`,"GET",undefined,"viewer")).status).toBe(200);
    expect((await call(`${wa}/databases`,"POST",{})).status).toBe(503);
    expect((await createHandler()(new Request(`https://local.test/api/v1/workspaces/${wa}/databases`), env)).status).toBe(401);
  });
  it("routes idempotent provisioning and retry through the existing lifecycle (mocked provider/roles)", async () => {
    const workspace = "33333333-3333-4333-8333-333333333333";
    await db.prepare("INSERT INTO workspaces(id,organization_id,slug,name,created_by) VALUES (?,'o-a','provision','Provision','u-a')").bind(workspace).run();
    const ensureDatabase = vi.fn(async (tenant:TenantTarget) => ({name:tenant.database,owner:"postgres",operations:[]}));
    const provisioner = new TenantProvisioner(db,{projectId:project,branchId:branch,ensureDatabase,operation:vi.fn()}, {configure:vi.fn(async()=>undefined),validateIsolation:vi.fn(async()=>undefined)});
    const configured = createHandler(async()=>({clerkUserId:"owner",sessionId:"mocked-session"}),{transport,provisioning:{durableSecrets:true,service:provisioner}});
    const request = (suffix="") => configured(new Request(`https://local.test/api/v1/workspaces/${workspace}/databases${suffix}`,{method:"POST"}),env);
    const first = await request();
    expect(first.status).toBe(202);
    const firstBody = await first.json() as {data:{id:string}};
    expect((await request()).status).toBe(202);
    expect(ensureDatabase).toHaveBeenCalledTimes(1);
    await db.prepare("UPDATE managed_tenant_databases SET state='failed' WHERE id=?").bind(firstBody.data.id).run();
    expect((await request(`/${firstBody.data.id}/retry`)).status).toBe(202);
    expect(ensureDatabase).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(firstBody)).not.toMatch(/credential|project_id|branch_id|runtime_role/);
    const auditRows=await db.prepare("SELECT action,outcome FROM audit_events WHERE resource_id=?").bind(workspace).all<{action:string;outcome:string}>();
    expect(auditRows.results).toEqual(expect.arrayContaining([
      {action:"database.provision",outcome:"requested"},{action:"database.provision",outcome:"success"},
      {action:"database.retry",outcome:"requested"},{action:"database.retry",outcome:"success"},
    ]));
    await db.prepare("UPDATE managed_tenant_databases SET state='failed' WHERE id=?").bind(firstBody.data.id).run();
    ensureDatabase.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_SENTINEL"));
    const failed=await request(`/${firstBody.data.id}/retry`);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("PRIVATE_PROVIDER_SENTINEL");
    expect(await db.prepare("SELECT outcome FROM audit_events WHERE resource_id=? AND outcome='failed'").bind(workspace).first()).toMatchObject({outcome:"failed"});
    await db.prepare("CREATE TRIGGER fail_provision_audit BEFORE INSERT ON audit_events WHEN NEW.action='database.retry' BEGIN SELECT RAISE(ABORT, 'fixture'); END").run();
    try {
      const before=ensureDatabase.mock.calls.length;
      expect((await request(`/${firstBody.data.id}/retry`)).status).toBe(503);
      expect(ensureDatabase).toHaveBeenCalledTimes(before);
    } finally { await db.prepare("DROP TRIGGER fail_provision_audit").run(); }
  });
  it("enforces statement timeout, trusted TLS, and generic credential errors", async () => {
    const tenant = (await db.prepare("SELECT * FROM managed_tenant_databases WHERE id=?").bind(ta).first<TenantMetadata>())!;
    await expect(new PgReadTransport(resolver,50).read(tenant,"SELECT * FROM tenant_data.slow")).rejects.toMatchObject({ status:408,code:"QUERY_TIMEOUT" });
    const wrong: CredentialResolver = { resolve: async row => ({ ...await resolver.resolve(row), password:"PRIVATE_SENTINEL" }) };
    await expect(new PgReadTransport(wrong).read(tenant,"SELECT * FROM tenant_data.items")).rejects.toMatchObject({ status:503,publicMessage:"Database request could not be completed." });
    const untrusted: CredentialResolver = { resolve: async row => ({ ...await resolver.resolve(row), ca:undefined }) };
    await expect(new PgReadTransport(untrusted).read(tenant,"SELECT * FROM tenant_data.items")).rejects.toMatchObject({ status:503 });
    await expect(new LocalRuntimeCredentials(env,new Request("https://hosted.test")).resolve(tenant)).rejects.toMatchObject({status:503});
  });
  it("uses the actual frontend service contract against the gateway", async () => {
    const previous = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
    process.env.NEXT_PUBLIC_PLATFORM_API_URL="https://local.test";
    vi.stubGlobal("fetch", (input: string, init:RequestInit) => handler(new Request(input,init),env));
    try {
      const listed = await databaseApi.list(wa,"owner");
      expect(listed.data[0].id).toBe(ta);
      expect(listed.capabilities.provisioningConfigured).toBe(false);
      expect(JSON.stringify(listed)).not.toMatch(/password|credential_reference|project_id|branch_id|claim_id/);
      expect((await databaseApi.schemas(wa,ta,"owner")).data).toEqual([{name:"tenant_data"}]);
      expect((await databaseApi.tables(wa,ta,"tenant_data","owner")).data.some(row=>row.name==="items_view")).toBe(true);
      expect((await databaseApi.relation(wa,ta,"tenant_data","items","owner")).data.keys).toHaveLength(2);
      expect((await databaseApi.rows(wa,ta,"tenant_data","items",100,"owner")).data.rows[0].id).toBe("101");
      const query = await databaseApi.query(wa,ta,tableSelect("tenant_data","items"),"owner");
      expect(query.data.rows).toHaveLength(20);
      await expect(databaseApi.provision(wa,"owner")).rejects.toMatchObject({status:503});
      await expect(databaseApi.retry(wa,ta,"owner")).rejects.toMatchObject({status:409});
    } finally { vi.unstubAllGlobals(); if(previous===undefined) delete process.env.NEXT_PUBLIC_PLATFORM_API_URL; else process.env.NEXT_PUBLIC_PLATFORM_API_URL=previous; }
  });
  it("persists safe success and denied audit events without SQL or secrets", async () => {
    const rows = await db.prepare("SELECT action,outcome FROM audit_events WHERE resource_type='database'").all<{action:string;outcome:string}>();
    expect(rows.results.some(row=>row.outcome==="success")).toBe(true);
    expect(rows.results.some(row=>row.outcome==="denied")).toBe(true);
    expect(JSON.stringify(rows.results)).not.toMatch(/PRIVATE_SENTINEL|SELECT |password/);
  });
  it("executes approved changes using separate real TLS roles and rolls back failing PostgreSQL transactions",async()=>{
    await db.batch(readFileSync(new URL('../migrations/0006_sql_approvals.sql',import.meta.url),'utf8').split('\n').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    const writer='writer_cp6',admin='schema_admin_cp6',writerSecret=randomBytes(32).toString('hex'),adminSecret=randomBytes(32).toString('hex');
    await withClient(target(ta).database,'postgres',password,async c=>{await c.query(`CREATE ROLE ${writer} LOGIN PASSWORD '${writerSecret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; CREATE ROLE ${admin} LOGIN PASSWORD '${adminSecret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; GRANT CONNECT ON DATABASE "${target(ta).database}" TO ${writer},${admin}; GRANT USAGE ON SCHEMA tenant_data TO ${writer}; ALTER SCHEMA tenant_data OWNER TO ${admin};`);});
    const r2=await runtime.getR2Bucket('VAULT'),bucket={get:async(key:string)=>{const o=await r2.get(key);return o?{size:o.size,etag:o.etag,json:()=>o.json()}:null;},put:(key:string,value:string,options:any)=>r2.put(key,value,options)};
    const keyring=JSON.stringify({test:randomBytes(32).toString('hex')}),store=new ExecutionCredentials(bucket,keyring,'test');
    const roles=await Promise.all(([['write',writer,writerSecret],['admin',admin,adminSecret]] as const).map(async([capability,role,secret])=>{const reference='sql-role/'+randomUUID();return {databaseId:ta,capability,destinationId:'cp6-approved',role,reference,readRole:target(ta).runtimeRole,writeRole:writer};}));
    const configuration:Env={...env,TENANT_CREDENTIALS:bucket as R2Bucket,SQL_VAULT_KEYS:keyring,SQL_VAULT_KEY_ID:'test',DATABASE_EXECUTION_TARGETS:JSON.stringify(roles),BYODB_ALLOWED_DESTINATIONS:JSON.stringify([{id:'cp6-approved',hostname:'db.example.com',address:'8.8.8.8',port:5432,databases:[target(ta).database],roles:[writer,admin],schemas:['tenant_data']}])};
    const execution=new PgExecutionService(config=>{expect(config.host).toBe('8.8.8.8');expect(config.ssl).toMatchObject({rejectUnauthorized:true,servername:'db.example.com'});return new Client({...config,options:'-c standard_conforming_strings=off',host:'127.0.0.1',port,ssl:{ca,rejectUnauthorized:true,servername:'localhost'}});});
    const approvedHandler=createHandler(async()=>({clerkUserId:'owner',sessionId:'mocked'}),{transport},undefined,{execution});
    const request=(action:string,payload:object)=>approvedHandler(new Request(`https://local.test/api/v1/workspaces/${wa}/databases/${ta}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),configuration);
    for(const [capability,secret] of [['write',writerSecret],['admin',adminSecret]])expect((await request('write-access',{action:'register',capability,password:secret,confirmation:'REGISTER '+target(ta).database})).status).toBe(200);
    expect((await request('write-access',{enabled:true,confirmation:'ENABLE '+target(ta).database})).status).toBe(200);
    const apply=async(sql:string,parameters:unknown[]=[])=>{const preview=await request('change-preview',{sql,parameters});expect(preview.status,await preview.clone().text()).toBe(200);const value=(await preview.json() as any).data;return request('change-execute',{sql:value.sql,parameters:value.parameters,approvalToken:value.approvalToken,confirmation:value.confirmation});};
    expect((await apply('CREATE TABLE tenant_data.editor_records(id integer PRIMARY KEY,name text NOT NULL)')).status).toBe(200);
    expect((await apply('INSERT INTO tenant_data.editor_records(id,name) VALUES ($1,$2)',[1,'actual inserted row'])).status).toBe(200);
    expect(await (await call(`${wa}/databases/${ta}/query`,'POST',{sql:'SELECT * FROM tenant_data.editor_records'})).json()).toMatchObject({data:{rows:[{id:'1',name:'actual inserted row'}]}});
    const literal="slash\\' ; DELETE FROM tenant_data.editor_records WHERE id=1; --";
    expect((await apply("INSERT INTO tenant_data.editor_records(id,name) VALUES (9,'"+literal.replaceAll("'","''")+"')")).status).toBe(200);
    await withClient(target(ta).database,'postgres',password,async c=>{expect((await c.query('SELECT name FROM tenant_data.editor_records WHERE id=9')).rows[0].name).toBe(literal);expect((await c.query('SELECT count(*)::int AS n FROM tenant_data.editor_records WHERE id=1')).rows[0].n).toBe(1);await c.query('DELETE FROM tenant_data.editor_records WHERE id=9');});
    expect((await apply('UPDATE tenant_data.editor_records SET name=$1 WHERE id=$2',['updated',1])).status).toBe(200);
    await withClient(target(ta).database,'postgres',password,async c=>{await c.query("INSERT INTO tenant_data.editor_records(id,name) SELECT n,'unchanged' FROM generate_series(2,1002) n");});
    expect((await apply("UPDATE tenant_data.editor_records SET name='mass-change' WHERE 1=1")).status).toBe(409);
    await withClient(target(ta).database,'postgres',password,async c=>{expect((await c.query("SELECT count(*)::int AS n FROM tenant_data.editor_records WHERE name='mass-change'")).rows[0].n).toBe(0);await c.query('DELETE FROM tenant_data.editor_records WHERE id>1');});
    expect((await apply('ALTER TABLE tenant_data.editor_records ADD COLUMN age integer')).status).toBe(200);
    expect((await apply('CREATE INDEX editor_name ON tenant_data.editor_records(name)')).status).toBe(200);
    expect((await apply("INSERT INTO tenant_data.editor_records(id,name) VALUES (2,'first'),(1,'duplicate')")).status).toBe(503);
    await withClient(target(ta).database,'postgres',password,async c=>{expect((await c.query('SELECT count(*)::int AS n FROM tenant_data.editor_records WHERE id=2')).rows[0].n).toBe(0);});
    await withClient(target(ta).database,'postgres',password,async c=>{await c.query('CREATE TABLE tenant_data.cp6_cascade_child(id int REFERENCES tenant_data.editor_records(id) ON DELETE CASCADE)');});
    expect((await request('change-preview',{sql:'DELETE FROM tenant_data.editor_records WHERE id=1',parameters:[]})).status).toBe(503);
    await withClient(target(ta).database,'postgres',password,async c=>{await c.query('DROP TABLE tenant_data.cp6_cascade_child');});
    expect((await apply('DELETE FROM tenant_data.editor_records WHERE id=$1',[1])).status).toBe(200);
    expect((await apply('DROP TABLE tenant_data.editor_records')).status).toBe(200);
    const otherDatabase={...roles[0],databaseId:tb};const tenantB=(await db.prepare('SELECT * FROM managed_tenant_databases WHERE id=?').bind(tb).first<TenantMetadata>())!;
    await expect(execution.verify(configuration,tenantB,otherDatabase)).rejects.toThrow();
  },30000);
  it("revoked vault entries disable runtime reads even with active D1 metadata",async()=>{
    await vault.revoke(`neon-runtime/${ta}`);
    expect((await call(`${wa}/databases/${ta}/schemas`)).status).toBe(503);
  });
});
