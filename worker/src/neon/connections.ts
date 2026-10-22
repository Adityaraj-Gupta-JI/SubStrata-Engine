import { Client, type ClientConfig } from "pg";
import { identifier, type PrivilegedSession, type ProvisioningConnections, ProvisioningError, type TenantTarget, validateTarget } from "./contracts";

export interface NeonEndpoint { projectId: string; branchId: string; host: string; ownerRole: string; controlDatabase: string }
export interface PasswordReader { read(reference: string): Promise<string> }
export function validateEndpoint(endpoint: NeonEndpoint): void {
  if (![endpoint.projectId, endpoint.branchId].every(value => /^[a-z0-9-]{1,60}$/.test(value)) ||
      !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(endpoint.host) || endpoint.host.includes("-pooler.")) throw new ProvisioningError("INVALID_CONFIGURATION");
  identifier(endpoint.ownerRole); identifier(endpoint.controlDatabase);
}

// Admin credentials exist only in this privileged factory; the query transport
// receives a separate runtime resolver backed by the vault's read-only port.
export class PgProvisioningConnections implements ProvisioningConnections {
  constructor(private readonly endpoint: NeonEndpoint, private readonly adminPassword: string, private readonly vault: PasswordReader, private readonly createClient: (config: ClientConfig) => Client = config => new Client(config)) {
    validateEndpoint(endpoint);
    this.endpoint = Object.freeze({ ...endpoint });
    if (typeof adminPassword !== "string" || !adminPassword) throw new ProvisioningError("MISSING_CREDENTIALS");
  }
  private async connect<T>(database: string, user: string, password: string, run: (session: PrivilegedSession) => Promise<T>): Promise<T> {
    identifier(database);
    const client = this.createClient({ host: this.endpoint.host, port: 5432, database, user, password,
      ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000,
      application_name: "substrata-provisioning" });
    client.on("error", () => undefined);
    try {
      await client.connect();
      const identity = (await client.query("SELECT current_user AS role, current_database() AS database")).rows[0];
      if (identity?.role !== user || identity?.database !== database) throw new ProvisioningError("RESOURCE_CONFLICT");
      const session: PrivilegedSession = {
        query: async (sql, parameters) => (await client.query(sql, parameters ? [...parameters] : undefined)).rows,
        transaction: async commands => {
          await client.query("BEGIN");
          try {
            await client.query("SET LOCAL lock_timeout = '1000ms'");
            await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
            for (const command of commands) await client.query(command.sql, command.parameters ? [...command.parameters] : undefined);
            await client.query("COMMIT");
          } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
        },
      };
      return await run(session);
    } finally { await client.end().catch(() => undefined); }
  }
  async admin<T>(database: string, run: (session: PrivilegedSession) => Promise<T>): Promise<T> {
    if (!/^ss_t_[a-f0-9]{32}$/.test(database)) throw new ProvisioningError("INVALID_TENANT_TARGET");
    return this.connect(database, this.endpoint.ownerRole, this.adminPassword, run);
  }
  async runtime<T>(target: TenantTarget, database: string, run: (session: PrivilegedSession) => Promise<T>): Promise<T> {
    validateTarget(target);
    return this.connect(database, target.runtimeRole, await this.vault.read(target.credentialReference), run);
  }
}
