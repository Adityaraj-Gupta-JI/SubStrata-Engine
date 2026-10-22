import { describe, expect, it, vi } from "vitest";
import { identifier, type NeonConfig, ProvisioningError, type TenantTarget, validateConfig } from "../src/neon/contracts";
import { NeonApiProvider } from "../src/neon/provider";

export const config: NeonConfig = { projectId: "local-project", branchId: "br-local", ownerRole: "admin_owner", apiKey: "local-fixture-not-a-key", approvedDisposableEnvironment: true };
export const target: TenantTarget = { database: `ss_t_${"a".repeat(32)}`, runtimeRole: `ss_r_${"a".repeat(32)}`, credentialReference: `neon-runtime/${"a".repeat(32)}` };
const database = { name: target.database, owner_name: config.ownerRole, branch_id: config.branchId };
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });

describe("Neon API contract (mocked transport, no Neon requests)", () => {
  it("fails closed without approval, credentials or pinned IDs", () => {
    for (const overrides of [{ approvedDisposableEnvironment: false }, { apiKey: "" }, { apiKey: "bad\nvalue" }, { projectId: "../wrong" }, { branchId: "" }, { ownerRole: "neon_superuser" }]) {
      expect(() => validateConfig({ ...config, ...overrides })).toThrow(ProvisioningError);
    }
  });
  it.each(["x; DROP DATABASE other", "MixedCase", "pg_monitor", "neon_superuser", "a".repeat(64), 'name"quoted', ""])("rejects unsafe identifier %s", value => {
    expect(() => identifier(value)).toThrow(ProvisioningError);
  });
  it("creates only the pinned database owned by the admin, with redirects disabled", async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => init.method === "GET" ? json({ databases: [] }) : json({ database }, 201));
    expect((await new NeonApiProvider(config, transport).ensureDatabase(target)).name).toBe(target.database);
    expect(transport).toHaveBeenCalledTimes(2);
    const [url, options] = transport.mock.calls[1];
    expect(url).toBe("https://console.neon.tech/api/v2/projects/local-project/branches/br-local/databases");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(String(options.body))).toEqual({ database: { name: target.database, owner_name: config.ownerRole } });
    expect(url).not.toMatch(/roles|password|delete/);
  });
  it("reconciles an existing database without a second creation", async () => {
    const transport = vi.fn(async () => json({ databases: [database] }));
    await new NeonApiProvider(config, transport).ensureDatabase(target);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("refuses a database owned by another role or branch", async () => {
    for (const overrides of [{ owner_name: "attacker" }, { branch_id: "br-other" }]) {
      const provider = new NeonApiProvider(config, async () => json({ databases: [{ ...database, ...overrides }] }));
      await expect(provider.ensureDatabase(target)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    }
  });
  it("does not send SQL-injected or inconsistent tenant names", async () => {
    const transport = vi.fn();
    const provider = new NeonApiProvider(config, transport);
    await expect(provider.ensureDatabase({ ...target, database: "other" })).rejects.toMatchObject({ code: "INVALID_TENANT_TARGET" });
    await expect(provider.ensureDatabase({ ...target, credentialReference: "postgres://name:password@host/db" })).rejects.toMatchObject({ code: "INVALID_TENANT_TARGET" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([423, 429, 503])("records retry backoff for HTTP %i without replaying mutations", async status => {
    const transport = vi.fn(async () => json({ error: "PRIVATE_SENTINEL" }, status, { "Retry-After": "9" }));
    await expect(new NeonApiProvider(config, transport).ensureDatabase(target)).rejects.toMatchObject({ code: "PROVIDER_RETRY", retryAfterMs: 9000 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 500])("sanitizes HTTP %i provider failures", async status => {
    try { await new NeonApiProvider(config, async () => json({ error: "PRIVATE_SENTINEL" }, status)).ensureDatabase(target); }
    catch (error) { expect(error).toBeInstanceOf(ProvisioningError); expect(String(error)).not.toContain("PRIVATE_SENTINEL"); return; }
    throw new Error("Expected failure");
  });
  it("never blindly retries a POST whose response was lost", async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "GET") return json({ databases: [] });
      throw new Error("PRIVATE_SENTINEL");
    });
    await expect(new NeonApiProvider(config, transport).ensureDatabase(target)).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("reconciles a successful POST after its response was lost without creating twice", async () => {
    let created = false;
    let posts = 0;
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "GET") return json({ databases: created ? [database] : [] });
      created = true;
      posts++;
      throw new Error("response lost");
    });
    const provider = new NeonApiProvider(config, transport);
    await expect(provider.ensureDatabase(target)).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
    expect((await provider.ensureDatabase(target)).name).toBe(target.database);
    expect(posts).toBe(1);
  });
  it("fails closed on malformed or oversized responses", async () => {
    for (const response of [new Response("not-json"), json({ databases: null }), new Response("x".repeat(1024 * 1024 + 1))]) {
      await expect(new NeonApiProvider(config, async () => response).ensureDatabase(target)).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL" });
    }
  });
  it("reads controlled operation status and rejects malformed operations", async () => {
    const id = "12345678-1234-4234-8234-123456789012";
    const provider = new NeonApiProvider(config, async () => json({ operation: { id, status: "running", error: "PRIVATE_SENTINEL" } }));
    expect(await provider.operation(id)).toEqual({ id, status: "running" });
    await expect(provider.operation("../wrong")).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    await expect(new NeonApiProvider(config, async () => json({ operation: { id, status: "unknown" } })).operation(id)).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL" });
  });
});
