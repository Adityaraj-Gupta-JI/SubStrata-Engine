import { type CredentialStore, identifier, type NeonConfig, type PrivilegedSession, type ProvisioningConnections, ProvisioningError, type RestrictedRoles, type TenantTarget, validateConfig, validateTarget } from "./contracts";

interface RoleProfile extends Record<string, unknown> {
  rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean;
  rolbypassrls: boolean; rolinherit: boolean; memberships: number; marker: string | null;
}
const PROFILE = `SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit,
  (SELECT count(*)::int FROM pg_auth_members WHERE member = r.oid) AS memberships,
  shobj_description(r.oid, 'pg_authid') AS marker FROM pg_roles r WHERE r.rolname = $1`;

function safeRole(profile: RoleProfile | undefined, target: TenantTarget): void {
  if (!profile || [profile.rolsuper, profile.rolcreatedb, profile.rolcreaterole, profile.rolreplication, profile.rolbypassrls, profile.rolinherit].some(value => value !== false) ||
      profile.memberships !== 0 || profile.marker !== `substrata:${target.database}`) throw new ProvisioningError("UNSAFE_ROLE");
}

// No transport is constructed here: live wiring requires an approved private admin
// connection factory and an external credential store, neither is supplied by D1.
export class SqlRestrictedRoles implements RestrictedRoles {
  constructor(private readonly config: NeonConfig, private readonly connections: ProvisioningConnections, private readonly credentials: CredentialStore) {
    validateConfig(config);
    this.config = Object.freeze({ ...config });
  }
  private async databases(session: PrivilegedSession): Promise<string[]> {
    const rows = await session.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname");
    const names = rows.map(row => row.datname);
    if (!names.length) throw new ProvisioningError("ISOLATION_FAILED");
    names.forEach(identifier);
    return names;
  }
  async configure(target: TenantTarget): Promise<void> {
    validateTarget(target);
    const role = identifier(target.runtimeRole);
    const database = identifier(target.database);
    const owner = identifier(this.config.ownerRole);
    try {
      await this.connections.admin(target.database, async session => {
        const databaseOwner = await session.query<{ owner: string }>("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()");
        if (databaseOwner[0]?.owner !== this.config.ownerRole) throw new ProvisioningError("RESOURCE_CONFLICT");
        const existing = await session.query<RoleProfile>(PROFILE, [target.runtimeRole]);
        if (existing.length) safeRole(existing[0], target);
        else {
          const password = await this.credentials.ensure(target.credentialReference);
          if (!/^[a-f0-9]{64}$/.test(password)) throw new ProvisioningError("MISSING_CREDENTIALS");
          await session.transaction([
            { sql: "SELECT set_config('substrata.runtime_password', $1, true)", parameters: [password] },
            { sql: `DO $substrata$ BEGIN EXECUTE format('CREATE ROLE %I WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', '${target.runtimeRole}', current_setting('substrata.runtime_password')); END; $substrata$` },
            { sql: `COMMENT ON ROLE ${role} IS 'substrata:${target.database}'` },
          ]);
        }
        // PUBLIC grants are additive. Revoking from just this role is insufficient.
        // Approved disposable branch only; do not execute against an existing customer branch.
        const databases = await this.databases(session);
        await session.transaction([
          { sql: `ALTER ROLE ${role} NOLOGIN` },
          ...databases.flatMap(name => [
            { sql: `REVOKE ALL ON DATABASE ${identifier(name)} FROM PUBLIC` },
            { sql: `REVOKE ALL ON DATABASE ${identifier(name)} FROM ${role}` },
          ]),
          { sql: `GRANT CONNECT ON DATABASE ${database} TO ${role}` },
          { sql: "REVOKE ALL ON SCHEMA public FROM PUBLIC" },
          { sql: "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC" },
          { sql: "CREATE SCHEMA IF NOT EXISTS tenant_data" },
          { sql: "REVOKE ALL ON SCHEMA tenant_data FROM PUBLIC" },
          { sql: "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tenant_data FROM PUBLIC" },
          { sql: `GRANT USAGE ON SCHEMA tenant_data TO ${role}` },
          { sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant_data TO ${role}` },
          { sql: `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tenant_data TO ${role}` },
          { sql: `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA tenant_data GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}` },
          { sql: `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA tenant_data GRANT USAGE, SELECT ON SEQUENCES TO ${role}` },
          { sql: `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` },
        ]);
        safeRole((await session.query<RoleProfile>(PROFILE, [target.runtimeRole]))[0], target);
      });
    } catch (error) {
      if (error instanceof ProvisioningError) throw error;
      throw new ProvisioningError("ROLE_CONFIGURATION_FAILED");
    }
  }
  async validateIsolation(target: TenantTarget): Promise<void> {
    validateTarget(target);
    try {
      const databases = await this.connections.admin(target.database, async session => {
        safeRole((await session.query<RoleProfile>(PROFILE, [target.runtimeRole]))[0], target);
        const names = await this.databases(session);
        for (const name of names) {
          const rows = await session.query<{ connect: boolean; create: boolean; temporary: boolean }>(
            "SELECT has_database_privilege($1, $2, 'CONNECT') AS connect, has_database_privilege($1, $2, 'CREATE') AS create, has_database_privilege($1, $2, 'TEMPORARY') AS temporary", [target.runtimeRole, name]);
          if (rows.length !== 1 || rows[0].connect !== (name === target.database) || rows[0].create !== false || rows[0].temporary !== false) throw new ProvisioningError("ISOLATION_FAILED");
        }
        // Conservative PoC allowlist: additional Neon/system extensions require review.
        const extensions = await session.query<{ extname: string }>("SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'");
        const foreignServers = await session.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_foreign_server");
        const definers = await session.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')");
        if (extensions.length || foreignServers[0]?.count !== 0 || definers[0]?.count !== 0) throw new ProvisioningError("UNSAFE_EXTENSION_OR_ROUTINE");
        await session.transaction([{ sql: `ALTER ROLE ${identifier(target.runtimeRole)} LOGIN` }]);
        return names;
      });
      await this.connections.runtime(target, target.database, async session => {
        const rows = await session.query<{ database: string; role: string; schema_create: boolean; public_create: boolean }>("SELECT current_database() AS database, current_user AS role, has_schema_privilege(current_user, 'tenant_data', 'CREATE') AS schema_create, has_schema_privilege(current_user, 'public', 'CREATE') AS public_create");
        if (rows[0]?.database !== target.database || rows[0]?.role !== target.runtimeRole || rows[0]?.schema_create !== false || rows[0]?.public_create !== false) throw new ProvisioningError("ISOLATION_FAILED");
      });
      for (const database of databases.filter(name => name !== target.database)) {
        let denied = false;
        try { await this.connections.runtime(target, database, async () => undefined); }
        catch (error) {
          // A network/timeout failure is NOT evidence of access denial.
          denied = !!error && typeof error === "object" && "code" in error && error.code === "42501";
        }
        if (!denied) throw new ProvisioningError("ISOLATION_FAILED");
      }
    } catch (error) {
      // Validation failure must not leave a usable runtime login behind.
      try {
        await this.connections.admin(target.database, async session => {
          safeRole((await session.query<RoleProfile>(PROFILE, [target.runtimeRole]))[0], target);
          await session.transaction([{ sql: `ALTER ROLE ${identifier(target.runtimeRole)} NOLOGIN` }]);
        });
      } catch { throw new ProvisioningError("QUARANTINE_REQUIRED"); }
      if (error instanceof ProvisioningError) throw error;
      throw new ProvisioningError("ISOLATION_FAILED");
    }
  }
}
