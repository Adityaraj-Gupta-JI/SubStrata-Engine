import { type DatabaseResult, type NeonConfig, type NeonProvider, type ProviderOperation, ProvisioningError, type TenantTarget, validateConfig, validateTarget } from "./contracts";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProvisioningError("PROVIDER_PROTOCOL");
  return value as Record<string, unknown>;
}
function operation(value: unknown): ProviderOperation {
  const row = object(value);
  if (typeof row.id !== "string" || !/^[a-f0-9-]{36}$/i.test(row.id) ||
      !["scheduling", "running", "finished", "skipped", "failed", "error", "cancelling", "cancelled"].includes(String(row.status))) {
    throw new ProvisioningError("PROVIDER_PROTOCOL");
  }
  return { id: row.id, status: row.status as ProviderOperation["status"] };
}

export class NeonApiProvider implements NeonProvider {
  readonly projectId: string;
  readonly branchId: string;
  constructor(private readonly config: NeonConfig, private readonly transport: Fetcher = fetch) {
    validateConfig(config);
    this.config = Object.freeze({ ...config });
    this.projectId = config.projectId;
    this.branchId = config.branchId;
  }
  private async request(path: string, method: "GET" | "POST", payload?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.transport(`https://console.neon.tech/api/v2/projects/${this.projectId}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch {
      // POST may have succeeded: next attempt MUST read/reconcile, never blindly replay.
      throw new ProvisioningError("RECONCILE_REQUIRED");
    }
    if (!response.ok) {
      await response.body?.cancel();
      const retry = response.headers.get("Retry-After");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN;
      const date = retry ? Date.parse(retry) : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000;
      if (!Number.isSafeInteger(delay) || !Number.isSafeInteger(Date.now() + delay)) throw new ProvisioningError("PROVIDER_PROTOCOL");
      if ([423, 429, 503].includes(response.status)) throw new ProvisioningError("PROVIDER_RETRY", Math.max(1000, delay));
      if (response.status === 409) throw new ProvisioningError("RECONCILE_REQUIRED");
      throw new ProvisioningError([401, 403].includes(response.status) ? "PROVIDER_CREDENTIALS" : "PROVIDER_FAILURE");
    }
    // Bounded API responses; never buffer arbitrary provider error pages or echo bodies.
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const parts: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1024 * 1024) { await reader.cancel(); throw new Error(); }
          parts.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return object(JSON.parse(new TextDecoder().decode(bytes)));
    } catch { throw new ProvisioningError("PROVIDER_PROTOCOL"); }
  }
  async ensureDatabase(target: TenantTarget): Promise<DatabaseResult> {
    const existing = await this.findDatabase(target);
    if (existing) return existing;
    const result = await this.request(`/branches/${this.branchId}/databases`, "POST", { database: { name: target.database, owner_name: this.config.ownerRole } });
    return this.databaseResult(target, result);
  }
  async findDatabase(target: TenantTarget): Promise<DatabaseResult | null> {
    validateTarget(target);
    const path = `/branches/${this.branchId}/databases`;
    const listed = await this.request(path, "GET");
    if (!Array.isArray(listed.databases)) throw new ProvisioningError("PROVIDER_PROTOCOL");
    const matches = listed.databases.map(object).filter(row => row.name === target.database);
    if (matches.length > 1) throw new ProvisioningError("RESOURCE_CONFLICT");
    return matches.length ? this.databaseResult(target, { database: matches[0] }) : null;
  }
  private databaseResult(target: TenantTarget, result: Record<string, unknown>): DatabaseResult {
    const database = object(result.database);
    if (database.name !== target.database || database.owner_name !== this.config.ownerRole || database.branch_id !== this.branchId) {
      throw new ProvisioningError("RESOURCE_CONFLICT");
    }
    // Database creation currently returns DatabaseResponse, not an async operation chain.
    // Preserve operation support if a response includes it; SQL readiness is still checked later.
    if (result.operations !== undefined && !Array.isArray(result.operations)) throw new ProvisioningError("PROVIDER_PROTOCOL");
    return { name: target.database, owner: this.config.ownerRole, operations: (result.operations ?? []).map(operation) };
  }
  async verifyEndpoint(host: string): Promise<void> {
    const branch = object((await this.request(`/branches/${this.branchId}`, "GET")).branch);
    if (branch.id !== this.branchId || branch.project_id !== this.projectId || branch.protected === true) throw new ProvisioningError("RESOURCE_CONFLICT");
    const result = await this.request(`/branches/${this.branchId}/endpoints`, "GET");
    if (!Array.isArray(result.endpoints) || !result.endpoints.some(value => {
      const endpoint = object(value);
      return endpoint.host === host && endpoint.branch_id === this.branchId && endpoint.project_id === this.projectId && endpoint.type === "read_write";
    })) throw new ProvisioningError("RESOURCE_CONFLICT");
  }
  async operation(id: string): Promise<ProviderOperation> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ProvisioningError("INVALID_OPERATION");
    return operation((await this.request(`/operations/${id}`, "GET")).operation);
  }
}
