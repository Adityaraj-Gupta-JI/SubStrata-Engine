import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHandler } from "../src/index";
import { unauthorized } from "../src/errors";
import { SqlRestrictedRoles } from "../src/neon/restricted-roles";
import { type PrivilegedSession, type ProvisioningConnections, type TenantTarget } from "../src/neon/contracts";
import { PgReadTransport, type CredentialResolver, type RuntimeCredential, LocalRuntimeCredentials } from "../src/database/transport";
import type { TenantMetadata } from "../src/neon/provisioning";
import { TenantProvisioner } from "../src/neon/provisioning";
import { databaseApi } from "../../frontend/src/lib/api/databases";

const enabled = process.env.SUBSTRATA_LOCAL_POSTGRES === "1";
const container = `substrata-gateway-${randomUUID()}`;
const password = randomBytes(32).toString("hex");
const passwords = new Map<string, string>();
const project = "local-project", branch = "br-local";
const wa = "11111111-1111-4111-8111-111111111111", wb = "22222222-2222-4222-8222-222222222222";
const ta = "a".repeat(32), tb = "b".repeat(32);
const target = (id: string): TenantTarget => ({ database: `ss_t_${id}`, runtimeRole: `ss_r_${id}`, credentialReference: `neon-runtime/${id}` });
let port: number, ca: string, directory: string, owned = false;
let runtime: Miniflare, db: D1Database, env: Env;
let handler: ReturnType<typeof createHandler>;
let transport: PgReadTransport;
let resolver: CredentialResolver;
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
function session(client: Client): PrivilegedSession {
  return {
    query: async (sql, parameters) => (await client.query(sql, parameters ? [...parameters] : undefined)).rows,
    transaction: async commands => {
      await client.query("BEGIN");
      try { for (const command of commands) await client.query(command.sql, command.parameters ? [...command.parameters] : undefined); await client.query("COMMIT"); }
      catch (error) { await client.query("ROLLBACK"); throw error; }
    },
  };
}
async function call(path: string, method = "GET", body?: object, subject = "owner") {
  return handler(new Request(`https://local.test/api/v1/workspaces/${path}`, { method, headers: { Authorization: `Bearer ${subject}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}
beforeAll(async () => {
  if (!enabled) return;
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
  const connections: ProvisioningConnections = {
    admin: (database, run) => withClient(database, "postgres", password, client => run(session(client))),
    runtime: (tenant, database, run) => withClient(database, tenant.runtimeRole, passwords.get(tenant.credentialReference)!, client => run(session(client))),
  };
  const roles = new SqlRestrictedRoles({ projectId: project, branchId: branch, ownerRole: "postgres", apiKey: "test-fixture", approvedDisposableEnvironment: true }, connections, { ensure: async reference => { if (!passwords.has(reference)) passwords.set(reference, randomBytes(32).toString("hex")); return passwords.get(reference)!; } });
  for (const id of [ta, tb]) {
    await roles.configure(target(id));
    await roles.validateIsolation(target(id));
    await withClient(target(id).database, "postgres", password, async client => {
      await client.query("CREATE TABLE tenant_data.departments (id int PRIMARY KEY); INSERT INTO tenant_data.departments VALUES (1); CREATE TABLE tenant_data.items (id int PRIMARY KEY, department_id int REFERENCES tenant_data.departments(id), name text NOT NULL, precise bigint); CREATE INDEX items_name_idx ON tenant_data.items(name); INSERT INTO tenant_data.items SELECT n, 1, 'item-' || n, 9007199254740993 FROM generate_series(1,250) n; CREATE VIEW tenant_data.items_view AS SELECT id,name FROM tenant_data.items; CREATE VIEW tenant_data.slow AS SELECT id, pg_sleep(0.02)::text AS waited FROM tenant_data.items; CREATE TABLE tenant_data.large (value text); INSERT INTO tenant_data.large VALUES (repeat('x',10000));");
    });
  }
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('local'); } };", compatibilityDate: "2026-10-22", d1Databases: ["METADATA"] }), telemetry: { enabled: false } });
  db = await runtime.getD1Database("METADATA");
  for (const file of ["0001_metadata.sql", "0002_neon_poc.sql"]) {
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
  resolver = { resolve: async tenant => ({ reference: tenant.credential_reference, projectId: project, branchId: branch, database: tenant.database_name, user: tenant.runtime_role, host: "127.0.0.1", port, password: passwords.get(tenant.credential_reference)!, ca }) };
  transport = new PgReadTransport(resolver);
  handler = createHandler(async request => {
    const subject = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!["owner", "other", "viewer"].includes(subject ?? "")) throw unauthorized();
    return { clerkUserId: subject!, sessionId: "mocked-clerk-test-session" };
  }, { transport });
}, 60000);
afterAll(async () => {
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
});

describe.runIf(enabled)("gateway with real TLS PostgreSQL + D1 (mocked Clerk identity, no Neon)", () => {
  it("serves schemas, tables/views, columns, keys, indexes and stable bounded previews", async () => {
    for (const action of ["schemas","tables","relation?table=items","rows?table=items&limit=20&offset=20"]) {
      const response = await call(`${wa}/databases/${ta}/${action}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: Record<string, unknown> };
      if (action.startsWith("relation")) { expect(body.data.keys).toHaveLength(2); expect(body.data.indexes).toHaveLength(2); }
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
      const query = await databaseApi.query(wa,ta,"SELECT name FROM tenant_data.items LIMIT 2","owner");
      expect(query.data.rows).toHaveLength(2);
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
});
