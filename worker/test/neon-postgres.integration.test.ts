import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { type CredentialStore, type NeonConfig, type PrivilegedSession, type ProvisioningConnections, type TenantTarget } from "../src/neon/contracts";
import { SqlRestrictedRoles } from "../src/neon/restricted-roles";

// Opt-in real LOCAL PostgreSQL, not Neon. Cached image only, no ports/mounts,
// no network, no production credentials. Each run creates its own empty cluster.
const enabled = process.env.SUBSTRATA_LOCAL_POSTGRES === "1";
const container = `substrata-cp2-${randomUUID()}`;
const adminPassword = randomBytes(32).toString("hex");
const passwords = new Map<string, string>();
let owned = false;
const config: NeonConfig = { projectId: "local-project", branchId: "br-local", ownerRole: "postgres", apiKey: "local-fixture-not-a-key", approvedDisposableEnvironment: true };
const target = (digit: string): TenantTarget => ({ database: `ss_t_${digit.repeat(32)}`, runtimeRole: `ss_r_${digit.repeat(32)}`, credentialReference: `neon-runtime/${digit.repeat(32)}` });
const a = target("a");
const b = target("b");

function docker(args: string[], input?: string, password?: string): string {
  const result = spawnSync("docker", args, {
    input, encoding: "utf8", timeout: 30000,
    env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}), POSTGRES_PASSWORD: adminPassword },
  });
  if (result.status !== 0) {
    // Never echo SQL, stdout, stderr, environment or subprocess arguments.
    const match = result.stderr?.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/);
    // libpq/psql cannot expose SQLSTATE for a startup failure. This test-only
    // adapter recognizes only PostgreSQL's explicit CONNECT-denial diagnostic,
    // including its privilege detail. Never classify generic connection errors.
    const denied = /FATAL:\s+permission denied for database "[a-z0-9_]+"/.test(result.stderr ?? "") &&
      /User does not have CONNECT privilege/.test(result.stderr ?? "");
    throw Object.assign(new Error("Local PostgreSQL test command failed."), { code: match?.[1] ?? (denied ? "42501" : "LOCAL_POSTGRES_FAILURE") });
  }
  return result.stdout.trim();
}
function sql(database: string, role: string, password: string, input: string): string {
  return docker(["exec", "-i", "--env", "PGPASSWORD", container, "psql", "-X", "-q", "-t", "-A", "-h", "127.0.0.1", "-U", role, "-d", database, "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose"], input, password);
}
function bind(text: string, parameters: readonly unknown[] = []): string {
  return text.replace(/\$(\d+)/g, (_placeholder, index: string) => {
    const value = parameters[Number(index) - 1];
    if (typeof value !== "string") throw new Error("Unexpected local test parameter.");
    return `'${value.replaceAll("'", "''")}'`;
  });
}
function session(database: string, role: string, password: string): PrivilegedSession {
  return {
    query: async <T extends Record<string, unknown>>(text: string, parameters?: readonly unknown[]): Promise<T[]> =>
      JSON.parse(sql(database, role, password, `SELECT coalesce(json_agg(row_to_json(result)), '[]'::json) FROM (${bind(text, parameters)}) AS result;`)),
    transaction: async commands => { sql(database, role, password, `BEGIN;\n${commands.map(command => bind(command.sql, command.parameters) + ";").join("\n")}\nCOMMIT;`); },
  };
}
const credentials: CredentialStore = { ensure: async reference => {
  if (!passwords.has(reference)) passwords.set(reference, randomBytes(32).toString("hex"));
  return passwords.get(reference)!;
} };
const connections: ProvisioningConnections = {
  admin: async (database, run) => run(session(database, "postgres", adminPassword)),
  runtime: async (tenant, database, run) => {
    const password = passwords.get(tenant.credentialReference);
    if (!password) throw new Error("Missing local test credential.");
    // Force connection even when the callback performs no queries.
    sql(database, tenant.runtimeRole, password, "SELECT 1;");
    return run(session(database, tenant.runtimeRole, password));
  },
};
const roles = new SqlRestrictedRoles(config, connections, credentials);

beforeAll(async () => {
  if (!enabled) return;
  const endpoint = docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  if (!endpoint.startsWith("npipe://")) throw new Error("Local Windows Docker context required.");
  docker(["run", "--detach", "--pull", "never", "--name", container, "--label", "substrata.checkpoint=cp2-local-test", "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=trust", "postgres:16-alpine"]);
  owned = true;
  const deadline = Date.now() + 20000;
  for (;;) {
    try { sql("postgres", "postgres", adminPassword, "SELECT 1;"); break; }
    catch { if (Date.now() >= deadline) throw new Error("Local PostgreSQL did not become ready."); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  sql("postgres", "postgres", adminPassword, `CREATE DATABASE "${a.database}"; CREATE DATABASE "${b.database}";`);
}, 30000);
afterAll(() => {
  if (owned) {
    // Only the unique container created above is eligible for removal.
    const label = docker(["inspect", "--format", '{{index .Config.Labels "substrata.checkpoint"}}', container]);
    if (label !== "cp2-local-test") throw new Error("Unexpected test container ownership.");
    docker(["rm", "--force", container]);
  }
});

describe.runIf(enabled)("real disposable PostgreSQL 16 isolation (not Neon)", () => {
  it("executes the actual role policy and verifies both isolation directions", async () => {
    await roles.configure(a);
    await roles.configure(b);
    await roles.validateIsolation(a);
    await roles.validateIsolation(b);
    // Wrong password must fail as authentication, not merely ACL failure.
    expect(() => sql(a.database, a.runtimeRole, "wrong-local-test-password", "SELECT 1;")).toThrow();
  });
  it("permits own-tenant reads but denies writes, foreign access and privilege escalation", async () => {
    for (const tenant of [a, b]) {
      sql(tenant.database, "postgres", adminPassword, "CREATE TABLE tenant_data.poc (value text NOT NULL); INSERT INTO tenant_data.poc VALUES ('disposable');");
      await connections.runtime(tenant, tenant.database, async current => {
        expect(await current.query("SELECT count(*)::int AS count FROM tenant_data.poc")).toEqual([{ count: 1 }]);
      });
      const password = passwords.get(tenant.credentialReference)!;
      const other = tenant === a ? b : a;
      expect(() => sql(other.database, tenant.runtimeRole, password, "SELECT 1;")).toThrow(expect.objectContaining({ code: "42501" }));
      for (const statement of ["INSERT INTO tenant_data.poc VALUES ('denied');", "UPDATE tenant_data.poc SET value='denied';", "DELETE FROM tenant_data.poc;", "CREATE DATABASE forbidden_poc_database;", "CREATE ROLE forbidden_poc_role;", "SET ROLE postgres;", "CREATE EXTENSION dblink WITH SCHEMA tenant_data;", "CREATE TABLE public.forbidden_poc (id int);", "CREATE TABLE tenant_data.forbidden_poc (id int);"]) {
        expect(() => sql(tenant.database, tenant.runtimeRole, password, statement)).toThrow(expect.objectContaining({ code: "42501" }));
      }
    }
  });
  it("reconciles the managed role without changing credentials", async () => {
    const before = passwords.get(a.credentialReference);
    await roles.configure(a);
    await roles.validateIsolation(a);
    expect(passwords.get(a.credentialReference)).toBe(before);
  });
});
