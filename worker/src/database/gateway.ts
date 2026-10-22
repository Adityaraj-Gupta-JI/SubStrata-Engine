import { ApiError, badRequest, json, notFound, unavailable } from "../errors";
import { requireRole, workspaceAccess } from "../metadata";
import { ProvisioningError } from "../neon/contracts";
import { type TenantMetadata, type TenantProvisioner } from "../neon/provisioning";
import { pagination, uuid } from "../validation";
import { approvedSelect, quoteIdentifier } from "./sql-policy";
import { LocalRuntimeCredentials, PgReadTransport, type ReadTransport } from "./transport";

export interface DatabaseServices {
  transport: ReadTransport;
  // Hosted provisioning must be wired ONLY with a durable external vault.
  provisioning?: { durableSecrets: true; service: TenantProvisioner };
}
export function defaultDatabaseServices(env: Env, request: Request): DatabaseServices {
  return { transport: new PgReadTransport(new LocalRuntimeCredentials(env, request)) };
}
function publicTenant(row: TenantMetadata) {
  return { id: row.id, workspaceId: row.workspace_id, name: row.database_name, state: row.state,
    retryAvailable: row.state === "failed" && !row.claim_id && row.last_error !== "QUARANTINE_REQUIRED",
    error: row.state === "failed" ? "Provisioning requires attention. Retry when configuration is available." : null };
}
async function queryBody(request: Request): Promise<{ sql?: unknown; parameters?: unknown }> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw badRequest("JSON body required.");
  const reader = request.body?.getReader();
  if (!reader) throw badRequest("JSON body required.");
  const parts: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 16384) { await reader.cancel(); throw badRequest("Query body too large."); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["sql", "parameters"].includes(key))) throw new Error();
    return body;
  } catch { throw badRequest("Invalid query body."); }
}

export async function databaseRoute(request: Request, env: Env, userId: string, requestId: string, services: DatabaseServices): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/databases(?:\/([^/]+))?(?:\/(retry|schemas|tables|relation|rows|query))?$/);
  if (!match) return null;
  const workspaceId = uuid(match[1]);
  const access = await workspaceAccess(env.METADATA, workspaceId, userId);
  const canProvision = ["owner", "admin"].includes(access.role);
  // All existing workspace roles explicitly have read permission. Membership and
  // assignment are enforced by workspaceAccess, including disabled organizations.
  requireRole(access.role, ["owner", "admin", "member", "viewer"]);
  const capabilities = { canRead: true, canProvision, provisioningConfigured: !!services.provisioning?.durableSecrets };
  if (!match[2]) {
    if (request.method === "GET") {
      const rows = await env.METADATA.prepare("SELECT * FROM managed_tenant_databases WHERE workspace_id = ? AND organization_id = ?").bind(workspaceId, access.workspace.organization_id).all<TenantMetadata>();
      return json({ data: rows.results.map(publicTenant), capabilities, requestId }, 200, requestId);
    }
    if (request.method !== "POST") throw notFound();
    requireRole(access.role, ["owner", "admin"]);
    if (!services.provisioning?.durableSecrets) throw unavailable();
    try { return json({ data: publicTenant(await services.provisioning.service.provision(workspaceId, userId)), requestId }, 202, requestId); }
    catch (error) { if (error instanceof ProvisioningError) throw unavailable(); throw error; }
  }
  if (!/^[a-f0-9]{32}$/.test(match[2])) throw badRequest("Invalid database ID.");
  const tenant = await env.METADATA.prepare("SELECT * FROM managed_tenant_databases WHERE id = ? AND workspace_id = ? AND organization_id = ?")
    .bind(match[2], workspaceId, access.workspace.organization_id).first<TenantMetadata>();
  if (!tenant) throw notFound();
  const action = match[3];
  if (!action && request.method === "GET") return json({ data: publicTenant(tenant), capabilities, requestId }, 200, requestId);
  if (action === "retry" && request.method === "POST") {
    requireRole(access.role, ["owner", "admin"]);
    if (tenant.state !== "failed" || tenant.claim_id || tenant.last_error === "QUARANTINE_REQUIRED") throw new ApiError(409, "NOT_RETRYABLE", "Database provisioning cannot be retried now.");
    if (!services.provisioning?.durableSecrets) throw unavailable();
    try { return json({ data: publicTenant(await services.provisioning.service.provision(workspaceId, userId)), requestId }, 202, requestId); }
    catch (error) { if (error instanceof ProvisioningError) throw unavailable(); throw error; }
  }
  if (!action || !["schemas", "tables", "relation", "rows", "query"].includes(action) || (action === "query" ? request.method !== "POST" : request.method !== "GET")) throw notFound();
  if (tenant.state !== "active") throw new ApiError(409, "DATABASE_NOT_READY", "Database is not ready.");
  const audit = async (outcome: string) => {
    await env.METADATA.prepare("INSERT INTO audit_events (id, organization_id, actor_user_id, action, resource_type, resource_id, outcome, request_id) VALUES (?, ?, ?, ?, 'database', ?, ?, ?)")
      .bind(crypto.randomUUID(), tenant.organization_id, userId, `database.${action}`, tenant.id, outcome, requestId).run();
  };
  try {
    const run = (sql: string, params: readonly unknown[] = [], limit?: number) => services.transport.read(tenant, sql, params, limit);
    const inspect = async (sql: string, params: readonly unknown[] = []) => {
      const result = await run(sql, params);
      if (result.truncated) throw new ApiError(413, "METADATA_LIMIT", "Schema metadata exceeds the inspection limit.");
      return result;
    };
    let data: unknown;
    const schema = url.searchParams.get("schema") ?? "tenant_data";
    const table = url.searchParams.get("table") ?? "";
    if (schema !== "tenant_data") throw badRequest("Schema is not available.");
    if (action === "schemas") data = (await inspect("SELECT nspname AS name FROM pg_namespace WHERE nspname = 'tenant_data' AND has_schema_privilege(current_user, oid, 'USAGE')")).rows;
    else if (action === "tables") data = (await inspect("SELECT c.relname AS name, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE 'table' END AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m') AND has_table_privilege(current_user,c.oid,'SELECT') ORDER BY c.relname", [schema])).rows;
    else if (action === "relation" || action === "rows") {
      quoteIdentifier(table);
      const relation = (await inspect("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p','v','m') AND has_table_privilege(current_user,c.oid,'SELECT')", [schema, table])).rows[0];
      if (!relation) throw notFound();
      if (action === "relation") {
        const columns = await inspect("SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null FROM pg_attribute a WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [relation.oid]);
        const keys = await inspect("SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1 AND contype IN ('p','f') ORDER BY conname", [relation.oid]);
        const indexes = await inspect("SELECT indexrelid::regclass::text AS name, pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indrelid=$1 ORDER BY indexrelid", [relation.oid]);
        data = { columns: columns.rows, keys: keys.rows, indexes: indexes.rows };
      } else {
        const page = pagination(url);
        const keys = await inspect("SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1 AND i.indisprimary ORDER BY a.attnum", [relation.oid]);
        const order = keys.rows.length ? ` ORDER BY ${keys.rows.map(row => quoteIdentifier(String(row.name))).join(", ")}` : "";
        const rows = await run(`SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}${order} LIMIT $1 OFFSET $2`, [page.limit, page.offset], page.limit);
        data = { ...rows, page, stableOrder: !!order, hasMore: rows.rows.length === page.limit };
      }
    } else {
      const body = await queryBody(request);
      const query = approvedSelect(body.sql, body.parameters);
      data = await run(query.sql, query.parameters);
    }
    if (new TextEncoder().encode(JSON.stringify({ data, requestId })).byteLength > 65536) {
      throw new ApiError(413, "RESULT_LIMIT", "Result exceeded the response size limit.");
    }
    await audit("success");
    return json({ data, requestId }, 200, requestId);
  } catch (error) {
    await audit("denied");
    throw error;
  }
}
