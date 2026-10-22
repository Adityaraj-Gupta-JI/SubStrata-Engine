// Privileged provisioning contracts. No public credential or admin SQL endpoint.
export class ProvisioningError extends Error {
  constructor(public readonly code: string, public readonly retryAfterMs = 0) {
    super("Tenant provisioning is unavailable.");
  }
}

export interface NeonConfig {
  projectId: string;
  branchId: string;
  ownerRole: string;
  apiKey: string;
  approvedDisposableEnvironment: boolean;
}

export function identifier(value: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(value) || /^(pg_|neon_)/.test(value)) {
    throw new ProvisioningError("INVALID_IDENTIFIER");
  }
  return `"${value}"`;
}

export function validateConfig(config: NeonConfig): void {
  if (config.approvedDisposableEnvironment !== true) throw new ProvisioningError("APPROVAL_REQUIRED");
  if (![config.projectId, config.branchId].every(value => typeof value === "string" && /^[a-z0-9-]{1,60}$/.test(value))) {
    throw new ProvisioningError("INVALID_CONFIGURATION");
  }
  identifier(config.ownerRole);
  if (typeof config.apiKey !== "string" || !config.apiKey || /[\s\u0000-\u001f\u007f]/.test(config.apiKey)) {
    throw new ProvisioningError("MISSING_CREDENTIALS");
  }
}

export interface TenantTarget {
  database: string;
  runtimeRole: string;
  credentialReference: string;
}

export function validateTarget(target: TenantTarget): void {
  if (!/^ss_t_[a-f0-9]{32}$/.test(target.database) || !/^ss_r_[a-f0-9]{32}$/.test(target.runtimeRole) ||
      target.database.slice(5) !== target.runtimeRole.slice(5) ||
      target.credentialReference !== `neon-runtime/${target.database.slice(5)}`) {
    throw new ProvisioningError("INVALID_TENANT_TARGET");
  }
  identifier(target.database);
  identifier(target.runtimeRole);
}

export interface ProviderOperation { id: string; status: "scheduling" | "running" | "finished" | "skipped" | "failed" | "error" | "cancelling" | "cancelled" }
export interface DatabaseResult { name: string; owner: string; operations: ProviderOperation[] }
export interface NeonProvider {
  readonly projectId: string;
  readonly branchId: string;
  ensureDatabase(target: TenantTarget): Promise<DatabaseResult>;
  operation(id: string): Promise<ProviderOperation>;
}

export interface SqlCommand { sql: string; parameters?: readonly unknown[] }
export interface PrivilegedSession {
  query<T extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<T[]>;
  // One connection and one transaction for the entire batch. Discard all results
  // (set_config returns a sensitive value). Disable parameter/statement logging.
  transaction(commands: readonly SqlCommand[]): Promise<void>;
}
export interface ProvisioningConnections {
  // Implementations must use the pinned project/branch, TLS, and close connections.
  // Never route these credentials through a normal tenant query client.
  admin<T>(database: string, run: (session: PrivilegedSession) => Promise<T>): Promise<T>;
  runtime<T>(target: TenantTarget, database: string, run: (session: PrivilegedSession) => Promise<T>): Promise<T>;
}
export interface CredentialStore {
  // Atomic create-if-absent; generate >= 128 bits entropy and persist outside D1.
  // Return the SAME password on reconciliation. Never log parameters/results.
  ensure(reference: string): Promise<string>;
}
export interface RestrictedRoles {
  configure(target: TenantTarget): Promise<void>;
  validateIsolation(target: TenantTarget): Promise<void>;
}
