import { Client, type ClientConfig } from "pg";
import { ApiError, unavailable } from "../errors";
import type { TenantMetadata } from "../neon/provisioning";
import { CELL_ROW_CHARS, RESULT_BYTES, ROW_LIMIT } from "./sql-policy";

export interface RuntimeCredential {
  reference: string; projectId: string; branchId: string; database: string;
  user: string; host: string; port: number; password: string; ca?: string; serverName?: string;
}
export interface CredentialResolver { resolve(tenant: TenantMetadata): Promise<RuntimeCredential> }
export interface ReadResult { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; elapsedMs: number }
export interface ReadTransport { read(tenant: TenantMetadata, sql: string, parameters?: readonly unknown[], limit?: number): Promise<ReadResult> }

export class LocalRuntimeCredentials implements CredentialResolver {
  constructor(private readonly bindings: Env, private readonly request: Request) {}
  async resolve(tenant: TenantMetadata): Promise<RuntimeCredential> {
    if (this.bindings.DATABASE_RUNTIME_MODE !== "local" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(this.request.url).hostname)) throw unavailable();
    try {
      const entries: unknown = JSON.parse(this.bindings.DATABASE_RUNTIME_CONFIG ?? "");
      if (!Array.isArray(entries) || entries.length > 100) throw new Error();
      const matches = entries.filter(entry => entry && typeof entry === "object" && entry.reference === tenant.credential_reference);
      if (matches.length !== 1) throw new Error();
      return matches[0];
    } catch { throw unavailable(); }
  }
}

export class PgReadTransport implements ReadTransport {
  constructor(private readonly credentials: CredentialResolver, private readonly timeoutMs = 3000, private readonly options: {external?:boolean;clientFactory?:(config:ClientConfig)=>Client} = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5000) throw unavailable();
  }
  async read(tenant: TenantMetadata, sql: string, parameters: readonly unknown[] = [], limit = ROW_LIMIT): Promise<ReadResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > ROW_LIMIT) throw unavailable();
    const credential = await this.credentials.resolve(tenant);
    if (credential.reference !== tenant.credential_reference || credential.projectId !== tenant.project_id || credential.branchId !== tenant.branch_id ||
        credential.database !== tenant.database_name || credential.user !== tenant.runtime_role || typeof credential.password !== "string" || !credential.password ||
        typeof credential.host !== "string" || !/^[a-zA-Z0-9.-]+$/.test(credential.host) || !Number.isInteger(credential.port) || credential.port < 1 || credential.port > 65535 ||
        (credential.ca !== undefined && typeof credential.ca !== "string")) throw unavailable();
    const started = Date.now();
    const client = (this.options.clientFactory??(config=>new Client(config)))({ host: credential.host, port: credential.port, database: credential.database, user: credential.user, password: credential.password,
      ssl: { rejectUnauthorized: true, ...(credential.serverName?{servername:credential.serverName}:{}), ...(credential.ca ? { ca: credential.ca } : {}) },
      connectionTimeoutMillis: 3000, statement_timeout: this.timeoutMs, query_timeout: this.timeoutMs + 1000,
      application_name: "substrata-readonly", options: "-c default_transaction_read_only=on" });
    client.on("error", () => { /* no credentials, SQL, driver details or result values in logs */ });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL statement_timeout = '${this.timeoutMs}ms'`);
      await client.query("SET LOCAL lock_timeout = '500ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5000ms'");
      await client.query("SET LOCAL search_path = pg_catalog");
      const schema=tenant.schema_name??"tenant_data";
      if(!/^[_a-zA-Z][_a-zA-Z0-9]{0,62}$/.test(schema))throw unavailable();
      const profile = await client.query(`SELECT current_database() AS database, current_user AS role,
        r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit AS elevated,
        r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS external_elevated,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS memberships,
        has_database_privilege(current_user, current_database(), 'CREATE') OR has_database_privilege(current_user, current_database(), 'TEMPORARY') AS ddl,
        has_schema_privilege(current_user, $1, 'CREATE') AS schema_create,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m') AND
          (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE'))) AS writes,
        EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql') OR EXISTS (SELECT 1 FROM pg_foreign_server) OR
          EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')) AS unsafe_objects,
        EXISTS (SELECT 1 FROM pg_database d WHERE d.datallowconn AND NOT d.datistemplate AND d.datname <> current_database() AND has_database_privilege(current_user,d.oid,'CONNECT')) AS foreign_access
        FROM pg_roles r WHERE r.rolname = current_user`,[schema]);
      const role = profile.rows[0];
      if (!role || role.database !== tenant.database_name || role.role !== tenant.runtime_role ||
          (this.options.external ? [role.external_elevated,role.memberships,role.schema_create,role.writes,role.unsafe_objects] : [role.elevated, role.memberships, role.ddl, role.schema_create, role.writes, role.unsafe_objects, role.foreign_access]).some(value => value !== false)) throw unavailable();
      // Text-valued cells preserve bigint/decimal precision and keep JSON/date/
      // binary representations explicit. NULL stays null, never fabricated data.
      const result = await client.query<{ row_json: string }>(`SELECT left((SELECT json_object_agg(key,value) FROM json_each_text(row_to_json(substrata_result)))::text, ${CELL_ROW_CHARS + 1}) AS row_json FROM (${sql}) AS substrata_result LIMIT ${limit + 1}`, [...parameters]);
      const rows: Record<string, unknown>[] = [];
      let bytes = 0;
      let truncated = result.rows.length > limit;
      for (const row of result.rows.slice(0, limit)) {
        if (row.row_json.length > CELL_ROW_CHARS) { truncated = true; break; }
        bytes += new TextEncoder().encode(row.row_json).byteLength;
        if (bytes > RESULT_BYTES) { truncated = true; break; }
        rows.push(JSON.parse(row.row_json));
      }
      await client.query("COMMIT");
      return { columns: rows[0] ? Object.keys(rows[0]) : [], rows, truncated, elapsedMs: Date.now() - started };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      throw new ApiError(code === "57014" ? 408 : 503, code === "57014" ? "QUERY_TIMEOUT" : "DATABASE_UNAVAILABLE", code === "57014" ? "Query exceeded its time limit." : "Database request could not be completed.");
    } finally { await client.end().catch(() => undefined); }
  }
}
