import { requireRole, workspaceAccess } from "../metadata";
import { type NeonProvider, ProvisioningError, type RestrictedRoles, type TenantTarget } from "./contracts";

export interface TenantMetadata {
  kind?: "managed"|"external";schema_name?:string;display_name?:string;
  id: string; workspace_id: string; organization_id: string; project_id: string; branch_id: string;
  database_name: string; runtime_role: string; credential_reference: string;
  state: "pending" | "database_pending" | "role_pending" | "validating" | "active" | "failed";
  operation_ids: string; claim_id: string | null; retry_not_before: number; last_error: string | null;
}
const SAFE_CODES = new Set(["PROVIDER_RETRY", "RECONCILE_REQUIRED", "PROVIDER_CREDENTIALS", "PROVIDER_FAILURE", "PROVIDER_PROTOCOL", "RESOURCE_CONFLICT", "UNSAFE_ROLE", "ISOLATION_FAILED", "UNSAFE_EXTENSION_OR_ROUTINE", "ROLE_CONFIGURATION_FAILED", "MISSING_CREDENTIALS", "QUARANTINE_REQUIRED"]);

// Internal entry point only. actorUserId must come from Clerk-verified resolution.
// The authorized route composes this service only with approved provider/vault
// dependencies. No background timer or automatic project creation is enabled.
export class TenantProvisioner {
  constructor(private readonly db: D1Database, private readonly provider: NeonProvider, private readonly roles: RestrictedRoles, private readonly now: () => number = Date.now) {}

  private async authorized(workspaceId: string, actorUserId: string): Promise<string> {
    const access = await workspaceAccess(this.db, workspaceId, actorUserId);
    requireRole(access.role, ["owner", "admin"]);
    return access.workspace.organization_id;
  }
  async status(workspaceId: string, actorUserId: string): Promise<TenantMetadata | null> {
    await this.authorized(workspaceId, actorUserId);
    return this.db.prepare("SELECT * FROM managed_tenant_databases WHERE workspace_id = ?").bind(workspaceId).first<TenantMetadata>();
  }
  async provision(workspaceId: string, actorUserId: string): Promise<TenantMetadata> {
    const organizationId = await this.authorized(workspaceId, actorUserId);
    const id = crypto.randomUUID().replaceAll("-", "");
    await this.db.prepare(`INSERT INTO managed_tenant_databases
      (id, workspace_id, organization_id, project_id, branch_id, database_name, runtime_role, credential_reference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO NOTHING`)
      .bind(id, workspaceId, organizationId, this.provider.projectId, this.provider.branchId, `ss_t_${id}`, `ss_r_${id}`, `neon-runtime/${id}`).run();
    const row = await this.status(workspaceId, actorUserId);
    if (!row) throw new ProvisioningError("PROVISIONING_FAILED");
    if (row.project_id !== this.provider.projectId || row.branch_id !== this.provider.branchId) throw new ProvisioningError("RESOURCE_CONFLICT");
    if (row.state === "active" || row.claim_id || row.last_error === "QUARANTINE_REQUIRED" || row.retry_not_before > this.now()) return row;
    const claim = crypto.randomUUID();
    const result = await this.db.prepare(`UPDATE managed_tenant_databases SET claim_id = ?, updated_at = datetime('now')
      WHERE id = ? AND claim_id IS NULL AND state <> 'active' AND retry_not_before <= ?`).bind(claim, row.id, this.now()).run();
    if (result.meta.changes !== 1) return (await this.status(workspaceId, actorUserId))!;
    const target: TenantTarget = { database: row.database_name, runtimeRole: row.runtime_role, credentialReference: row.credential_reference };
    const update = async (state: TenantMetadata["state"], operations: string[]) => {
      const result = await this.db.prepare("UPDATE managed_tenant_databases SET state = ?, operation_ids = ?, updated_at = datetime('now') WHERE id = ? AND claim_id = ?")
        .bind(state, JSON.stringify(operations), row.id, claim).run();
      if (result.meta.changes !== 1) throw new ProvisioningError("RESOURCE_CONFLICT");
    };
    try {
      // Recheck membership before privileged side effects; no client tenant/name input.
      await this.authorized(workspaceId, actorUserId);
      const oldOperations: unknown = JSON.parse(row.operation_ids);
      if (!Array.isArray(oldOperations) || !oldOperations.every(value => typeof value === "string")) throw new ProvisioningError("PROVIDER_PROTOCOL");
      const checkOperations = async (ids: string[]) => {
        for (const operationId of ids) {
          const operation = await this.provider.operation(operationId);
          if (["failed", "error", "cancelled", "cancelling"].includes(operation.status)) throw new ProvisioningError("PROVIDER_FAILURE");
          if (!["finished", "skipped"].includes(operation.status)) throw new ProvisioningError("PROVIDER_RETRY", 1000);
        }
      };
      await checkOperations(oldOperations);
      await update("database_pending", oldOperations);
      const database = await this.provider.ensureDatabase(target);
      if (database.name !== target.database) throw new ProvisioningError("RESOURCE_CONFLICT");
      const operations = database.operations.map(operation => operation.id);
      await update("database_pending", operations);
      await checkOperations(operations);
      await update("role_pending", operations);
      await this.roles.configure(target);
      await update("validating", operations);
      await this.roles.validateIsolation(target);
      await this.authorized(workspaceId, actorUserId);
      const finished = await this.db.prepare("UPDATE managed_tenant_databases SET state = 'active', claim_id = NULL, last_error = NULL, retry_not_before = 0, updated_at = datetime('now') WHERE id = ? AND claim_id = ?")
        .bind(row.id, claim).run();
      if (finished.meta.changes !== 1) throw new ProvisioningError("RESOURCE_CONFLICT");
    } catch (error) {
      const code = error instanceof ProvisioningError && SAFE_CODES.has(error.code) ? error.code : "PROVISIONING_FAILED";
      const delay = error instanceof ProvisioningError && Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs) : 0;
      await this.db.prepare("UPDATE managed_tenant_databases SET state = 'failed', claim_id = NULL, last_error = ?, retry_not_before = ?, updated_at = datetime('now') WHERE id = ? AND claim_id = ?")
        .bind(code, this.now() + delay, row.id, claim).run();
      throw new ProvisioningError(code, delay);
    }
    return (await this.status(workspaceId, actorUserId))!;
  }
}
