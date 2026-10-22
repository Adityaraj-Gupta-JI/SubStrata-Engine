import { unavailable } from "../errors";
import type { DatabaseServices } from "../database/gateway";
import { PgReadTransport, type CredentialResolver } from "../database/transport";
import { PgProvisioningConnections, type NeonEndpoint, validateEndpoint, type PasswordReader } from "./connections";
import { EncryptedCredentialVault, type VaultBucket } from "./credential-vault";
import { NeonApiProvider } from "./provider";
import { TenantProvisioner } from "./provisioning";
import { SqlRestrictedRoles } from "./restricted-roles";

export interface ApprovedDevelopment extends NeonEndpoint { approvedProjectId: string; approvedBranchId: string; allowBranchPublicRevocation: true; environment: "disposable-development" }
export function developmentConfig(value: string | undefined): ApprovedDevelopment {
  try {
    const config: ApprovedDevelopment = JSON.parse(value ?? "");
    validateEndpoint(config);
    if (config.environment !== "disposable-development" || config.allowBranchPublicRevocation !== true ||
        config.approvedProjectId !== config.projectId || config.approvedBranchId !== config.branchId) throw new Error();
    return Object.freeze({ ...config });
  } catch { throw unavailable(); }
}
export class VaultRuntimeCredentials implements CredentialResolver {
  constructor(private readonly endpoint: NeonEndpoint, private readonly vault: PasswordReader) { validateEndpoint(endpoint); }
  async resolve(tenant: Parameters<CredentialResolver["resolve"]>[0]) {
    if (tenant.project_id !== this.endpoint.projectId || tenant.branch_id !== this.endpoint.branchId || tenant.state !== "active" ||
        tenant.database_name !== `ss_t_${tenant.id}` || tenant.runtime_role !== `ss_r_${tenant.id}` || tenant.credential_reference !== `neon-runtime/${tenant.id}`) throw unavailable();
    try {
      return { reference: tenant.credential_reference, projectId: tenant.project_id, branchId: tenant.branch_id, database: tenant.database_name,
        user: tenant.runtime_role, host: this.endpoint.host, port: 5432, password: await this.vault.read(tenant.credential_reference) };
    } catch { throw unavailable(); }
  }
}
export type DevelopmentBindings = Omit<Env, "TENANT_CREDENTIALS"> & { TENANT_CREDENTIALS?: VaultBucket };
export function developmentServices(env: DevelopmentBindings): DatabaseServices {
  try {
    if (!env.TENANT_CREDENTIALS || !env.NEON_VAULT_KEYS || !env.NEON_VAULT_KEY_ID) throw unavailable();
    const config = developmentConfig(env.NEON_DEVELOPMENT_CONFIG);
    const vault = new EncryptedCredentialVault(env.TENANT_CREDENTIALS, `${config.projectId}/${config.branchId}`, env.NEON_VAULT_KEYS, env.NEON_VAULT_KEY_ID, async reference => {
      const row = await env.METADATA.prepare("SELECT id, workspace_id FROM managed_tenant_databases WHERE credential_reference = ? AND project_id = ? AND branch_id = ?").bind(reference, config.projectId, config.branchId).first<{id:string;workspace_id:string}>();
      if (!row) throw unavailable();
      return {tenantId:row.id,workspaceId:row.workspace_id,purpose:"postgres-runtime"};
    });
    const result: DatabaseServices = { transport: new PgReadTransport(new VaultRuntimeCredentials(config, { read: reference => vault.read(reference) })) };
    if (env.NEON_PROVISIONING_APPROVAL !== `${config.projectId}/${config.branchId}` || !env.NEON_API_KEY || !env.NEON_ADMIN_PASSWORD) return result;
    // Constructing this service does no I/O. Only the authorized POST path calls it.
    const neon = { ...config, apiKey: env.NEON_API_KEY, approvedDisposableEnvironment: true };
    const api = new NeonApiProvider(neon);
    const provider = { projectId: config.projectId, branchId: config.branchId,
      ensureDatabase: async (target: Parameters<NeonApiProvider["ensureDatabase"]>[0]) => {
        await api.verifyEndpoint(config.host);
        const existing = await api.findDatabase(target);
        // Persist before creating a new database; never regenerate a lost secret
        // for an existing database/role during reconciliation.
        if (existing) { await vault.read(target.credentialReference); return existing; }
        await vault.ensure(target.credentialReference);
        return api.ensureDatabase(target);
      },
      operation: (id: string) => api.operation(id) };
    const connections = new PgProvisioningConnections(config, env.NEON_ADMIN_PASSWORD, { read: reference => vault.read(reference) });
    result.provisioning = { durableSecrets: true, service: new TenantProvisioner(env.METADATA, provider, new SqlRestrictedRoles(neon, connections, vault)) };
    return result;
  } catch { throw unavailable(); }
}
