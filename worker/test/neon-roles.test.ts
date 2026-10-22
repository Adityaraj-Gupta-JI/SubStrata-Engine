import { describe, expect, it, vi } from "vitest";
import { type NeonConfig, type PrivilegedSession, type ProvisioningConnections, ProvisioningError, type SqlCommand, type TenantTarget } from "../src/neon/contracts";
import { SqlRestrictedRoles } from "../src/neon/restricted-roles";

const config: NeonConfig = { projectId: "local-project", branchId: "br-local", ownerRole: "admin_owner", apiKey: "local-fixture-not-a-key", approvedDisposableEnvironment: true };
const target: TenantTarget = { database: `ss_t_${"a".repeat(32)}`, runtimeRole: `ss_r_${"a".repeat(32)}`, credentialReference: `neon-runtime/${"a".repeat(32)}` };
const foreign = `ss_t_${"b".repeat(32)}`;
const profile = { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolinherit: false, memberships: 0, marker: `substrata:${target.database}` };

function fixture(options: { existing?: boolean; unsafe?: object; foreignConnect?: boolean; denialCode?: string; extension?: boolean; acceptsForeign?: boolean; schemaCreate?: boolean } = {}) {
  const commands: SqlCommand[] = [];
  let exists = options.existing ?? true;
  // Mocked SQL boundary: this is NOT PostgreSQL privilege enforcement evidence.
  const query = async (sql: string, parameters?: readonly unknown[]) => {
    if (sql.includes("FROM pg_roles")) return exists ? [{ ...profile, ...options.unsafe }] : [];
    if (sql.includes("pg_get_userbyid")) return [{ owner: config.ownerRole }];
    if (sql.includes("FROM pg_database")) return [{ datname: target.database }, { datname: foreign }];
    if (sql.includes("has_database_privilege")) return [{ connect: parameters?.[1] === target.database || !!options.foreignConnect, create: false, temporary: false }];
    if (sql.includes("FROM pg_extension")) return options.extension ? [{ extname: "dblink" }] : [];
    if (sql.includes("count(*)")) return [{ count: 0 }];
    if (sql.includes("current_database()")) return [{ database: target.database, role: target.runtimeRole, schema_create: options.schemaCreate ?? false, public_create: false }];
    throw new Error("Unrecognized mock query");
  };
  const session: PrivilegedSession = {
    // A generic mock must satisfy each requested row shape at the test boundary.
    query: vi.fn(query) as PrivilegedSession["query"],
    transaction: vi.fn(async (batch: readonly SqlCommand[]) => { commands.push(...batch); if (batch.some(command => command.sql.includes("CREATE ROLE"))) exists = true; }),
  };
  const connections: ProvisioningConnections = {
    admin: async (_database, run) => run(session),
    runtime: async (_target, database, run) => {
      if (database !== target.database && !options.acceptsForeign) throw { code: options.denialCode ?? "42501" };
      return run(session);
    },
  };
  const credentials = { ensure: vi.fn(async () => "a".repeat(64)) };
  return { roles: new SqlRestrictedRoles(config, connections, credentials), commands, credentials, connections };
}

describe("restricted role policy (mocked PostgreSQL executor)", () => {
  it("creates a restricted SQL role without putting its password into SQL text", async () => {
    const f = fixture({ existing: false });
    await f.roles.configure(target);
    const text = f.commands.map(command => command.sql).join("\n");
    expect(text).toContain("NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS");
    expect(text).not.toContain("a".repeat(64));
    expect(f.commands[0].parameters).toEqual(["a".repeat(64)]);
    expect(text).toContain(`REVOKE ALL ON DATABASE "${foreign}" FROM PUBLIC`);
    expect(text).toContain(`GRANT CONNECT ON DATABASE "${target.database}" TO "${target.runtimeRole}"`);
    expect(text).not.toMatch(/GRANT (?:CREATE|ALL|INSERT|UPDATE|DELETE|neon_superuser)/);
    expect(text).toContain("REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
    expect(text).toContain("NOLOGIN");
    expect(text).not.toMatch(/ALTER ROLE .*" LOGIN/);
  });
  it.each(["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "rolinherit"])("rejects existing %s escalation before modifying roles", async attribute => {
    const f = fixture({ unsafe: { [attribute]: true } });
    await expect(f.roles.configure(target)).rejects.toMatchObject({ code: "UNSAFE_ROLE" });
    expect(f.commands).toHaveLength(0);
  });
  it("rejects inherited memberships and foreign ownership markers", async () => {
    for (const unsafe of [{ memberships: 1 }, { marker: "unmanaged" }]) {
      const f = fixture({ unsafe });
      await expect(f.roles.configure(target)).rejects.toMatchObject({ code: "UNSAFE_ROLE" });
      expect(f.commands).toHaveLength(0);
    }
  });
  it("does not rotate an existing managed role's password during reconciliation", async () => {
    const f = fixture();
    await f.roles.configure(target);
    expect(f.credentials.ensure).not.toHaveBeenCalled();
    expect(f.commands.map(command => command.sql).join("\n")).not.toContain("CREATE ROLE");
  });
  it("rejects a missing/weak credential and sanitizes executor errors", async () => {
    const f = fixture({ existing: false });
    f.credentials.ensure.mockResolvedValue("");
    await expect(f.roles.configure(target)).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    f.connections.admin = async () => { throw new Error("PRIVATE_PASSWORD_SENTINEL"); };
    try { await f.roles.configure(target); }
    catch (error) { expect(error).toBeInstanceOf(ProvisioningError); expect(String(error)).not.toContain("PRIVATE_PASSWORD_SENTINEL"); }
  });
  it("requires an own-database login and explicit permission-denied on foreign databases", async () => {
    await expect(fixture().roles.validateIsolation(target)).resolves.toBeUndefined();
    for (const options of [{ acceptsForeign: true }, { denialCode: "ETIMEDOUT" }, { foreignConnect: true }, { schemaCreate: true }]) {
      const f = fixture(options);
      await expect(f.roles.validateIsolation(target)).rejects.toMatchObject({ code: "ISOLATION_FAILED" });
      expect(f.commands.at(-1)?.sql).toContain("NOLOGIN");
    }
  });
  it("rejects unreviewed extensions and quarantines the role", async () => {
    const f = fixture({ extension: true });
    await expect(f.roles.validateIsolation(target)).rejects.toMatchObject({ code: "UNSAFE_EXTENSION_OR_ROUTINE" });
    expect(f.commands.at(-1)?.sql).toContain("NOLOGIN");
  });
  it("reports quarantine failure rather than treating a failed login as isolation", async () => {
    const f = fixture({ extension: true });
    f.connections.admin = async () => { throw new Error("unreachable"); };
    await expect(f.roles.validateIsolation(target)).rejects.toMatchObject({ code: "QUARANTINE_REQUIRED" });
  });
});
