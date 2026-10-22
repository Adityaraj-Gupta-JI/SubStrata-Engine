import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import { type NeonProvider, ProvisioningError, type RestrictedRoles, type TenantTarget } from "../src/neon/contracts";
import { TenantProvisioner } from "../src/neon/provisioning";

let runtime: Miniflare;
let db: D1Database;
let clock = 10000;
const owner = "local-owner";
const foreign = "local-other";
const workspace = "local-workspace";
const otherWorkspace = "other-workspace";
const provider: NeonProvider = {
  projectId: "local-project", branchId: "br-local",
  ensureDatabase: vi.fn(async target => ({ name: target.database, owner: "admin_owner", operations: [] })),
  operation: vi.fn(),
};
const roles: RestrictedRoles = { configure: vi.fn(async () => undefined), validateIsolation: vi.fn(async () => undefined) };
const provisioner = () => new TenantProvisioner(db, provider, roles, () => clock);

beforeAll(async () => {
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('local'); } };", compatibilityDate: "2026-10-22", d1Databases: ["METADATA"] }), telemetry: { enabled: false } });
  db = await runtime.getD1Database("METADATA");
  for (const migration of ["0001_metadata.sql", "0002_neon_poc.sql"]) {
    const sql = readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
    await db.batch(sql.split(";").map(part => part.trim()).filter(Boolean).map(part => db.prepare(part)));
  }
  await db.batch([
    db.prepare("INSERT INTO users (id, clerk_user_id) VALUES (?, ?), (?, ?)").bind(owner, "clerk-local-owner", foreign, "clerk-local-other"),
    db.prepare("INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-one', 'one', 'One', ?), ('org-two', 'two', 'Two', ?)").bind(owner, foreign),
    db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES ('membership-one', 'org-one', ?, 'owner'), ('membership-two', 'org-two', ?, 'owner')").bind(owner, foreign),
    db.prepare("INSERT INTO workspaces (id, organization_id, slug, name, created_by) VALUES (?, 'org-one', 'one', 'One', ?), (?, 'org-two', 'two', 'Two', ?)").bind(workspace, owner, otherWorkspace, foreign),
  ]);
}, 30000);
beforeEach(async () => {
  await db.prepare("DELETE FROM managed_tenant_databases").run();
  clock = 10000;
  vi.mocked(provider.ensureDatabase).mockReset().mockImplementation(async target => ({ name: target.database, owner: "admin_owner", operations: [] }));
  vi.mocked(provider.operation).mockReset();
  vi.mocked(roles.configure).mockReset().mockResolvedValue();
  vi.mocked(roles.validateIsolation).mockReset().mockResolvedValue();
});
afterAll(async () => { await runtime?.dispose(); });

describe("Neon lifecycle with real disposable D1 and mocked provider/SQL", () => {
  it("maps a workspace to credential references only, then deduplicates requests", async () => {
    const first = await provisioner().provision(workspace, owner);
    expect(first.state).toBe("active");
    expect(first.database_name).toBe(`ss_t_${first.id}`);
    expect(first.runtime_role).toBe(`ss_r_${first.id}`);
    expect(first.credential_reference).toBe(`neon-runtime/${first.id}`);
    expect(first.project_id).toBe(provider.projectId);
    expect(first.branch_id).toBe(provider.branchId);
    expect(first.claim_id).toBeNull();
    expect((await provisioner().provision(workspace, owner)).id).toBe(first.id);
    expect(provider.ensureDatabase).toHaveBeenCalledTimes(1);
    expect(roles.validateIsolation).toHaveBeenCalledTimes(1);
    const columns = await db.prepare("PRAGMA table_info(managed_tenant_databases)").all<{ name: string }>();
    expect(columns.results.some(row => /password|connection_string|api_key/.test(row.name))).toBe(false);
  });
  it("serializes concurrent requests with an atomic D1 claim", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(provider.ensureDatabase).mockImplementation(async target => { started(); await gate; return { name: target.database, owner: "admin_owner", operations: [] }; });
    const first = provisioner().provision(workspace, owner);
    await entered;
    const second = await provisioner().provision(workspace, owner);
    expect(second.claim_id).not.toBeNull();
    expect(provider.ensureDatabase).toHaveBeenCalledTimes(1);
    release();
    expect((await first).state).toBe("active");
    expect(await db.prepare("SELECT count(*) AS n FROM managed_tenant_databases").first("n")).toBe(1);
  });
  it("recovers partial role failures by reconciling the same database and credential reference", async () => {
    vi.mocked(roles.configure).mockRejectedValueOnce(new Error("PRIVATE_SENTINEL"));
    await expect(provisioner().provision(workspace, owner)).rejects.toMatchObject({ code: "PROVISIONING_FAILED" });
    const failed = await provisioner().status(workspace, owner);
    expect(failed).toMatchObject({ state: "failed", claim_id: null, last_error: "PROVISIONING_FAILED" });
    expect(JSON.stringify(failed)).not.toContain("PRIVATE_SENTINEL");
    const recovered = await provisioner().provision(workspace, owner);
    expect(recovered.id).toBe(failed?.id);
    expect(recovered.state).toBe("active");
    const calls = vi.mocked(provider.ensureDatabase).mock.calls;
    expect(calls[0][0]).toEqual(calls[1][0]);
  });
  it("persists retry deadlines and reconciles after provider failure", async () => {
    vi.mocked(provider.ensureDatabase).mockRejectedValueOnce(new ProvisioningError("PROVIDER_RETRY", 9000));
    await expect(provisioner().provision(workspace, owner)).rejects.toMatchObject({ code: "PROVIDER_RETRY" });
    expect((await provisioner().provision(workspace, owner)).retry_not_before).toBe(19000);
    expect(provider.ensureDatabase).toHaveBeenCalledTimes(1);
    clock = 19000;
    expect((await provisioner().provision(workspace, owner)).state).toBe("active");
  });
  it("persists and polls pending provider operations before any SQL grants", async () => {
    const operationId = "12345678-1234-4234-8234-123456789012";
    vi.mocked(provider.ensureDatabase).mockImplementation(async target => ({ name: target.database, owner: "admin_owner", operations: [{ id: operationId, status: "running" }] }));
    vi.mocked(provider.operation).mockResolvedValue({ id: operationId, status: "running" });
    await expect(provisioner().provision(workspace, owner)).rejects.toMatchObject({ code: "PROVIDER_RETRY" });
    expect((await provisioner().status(workspace, owner))?.operation_ids).toBe(JSON.stringify([operationId]));
    expect(roles.configure).not.toHaveBeenCalled();
    clock += 1000;
    vi.mocked(provider.operation).mockResolvedValue({ id: operationId, status: "finished" });
    expect((await provisioner().provision(workspace, owner)).state).toBe("active");
  });
  it("never marks failed isolation as active", async () => {
    vi.mocked(roles.validateIsolation).mockRejectedValue(new ProvisioningError("ISOLATION_FAILED"));
    await expect(provisioner().provision(workspace, owner)).rejects.toMatchObject({ code: "ISOLATION_FAILED" });
    expect((await provisioner().status(workspace, owner))?.state).toBe("failed");
  });
  it("requires operator recovery when runtime quarantine could not be confirmed", async () => {
    vi.mocked(roles.validateIsolation).mockRejectedValue(new ProvisioningError("QUARANTINE_REQUIRED"));
    await expect(provisioner().provision(workspace, owner)).rejects.toMatchObject({ code: "QUARANTINE_REQUIRED" });
    expect((await provisioner().provision(workspace, owner)).last_error).toBe("QUARANTINE_REQUIRED");
    expect(provider.ensureDatabase).toHaveBeenCalledTimes(1);
  });
  it("denies foreign workspace reads and provisioning before provider access", async () => {
    await expect(provisioner().provision(otherWorkspace, owner)).rejects.toMatchObject({ status: 404 });
    await expect(provisioner().status(workspace, foreign)).rejects.toMatchObject({ status: 404 });
    expect(provider.ensureDatabase).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT count(*) AS n FROM managed_tenant_databases").first("n")).toBe(0);
  });
  it("rejects viewers even with workspace membership", async () => {
    await db.batch([
      db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES ('viewer', 'org-one', ?, 'viewer')").bind(foreign),
      db.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ('viewer', ?, ?, 'viewer')").bind(workspace, foreign),
    ]);
    try { await expect(provisioner().provision(workspace, foreign)).rejects.toMatchObject({ status: 403 }); }
    finally { await db.batch([db.prepare("DELETE FROM workspace_memberships WHERE id = 'viewer'"), db.prepare("DELETE FROM memberships WHERE id = 'viewer'")]); }
    expect(provider.ensureDatabase).not.toHaveBeenCalled();
  });
  it("refuses provider branch reassignment and never auto-steals a crashed claim", async () => {
    const row = await provisioner().provision(workspace, owner);
    await expect(new TenantProvisioner(db, { ...provider, branchId: "br-other" }, roles).provision(workspace, owner)).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    await db.prepare("UPDATE managed_tenant_databases SET state = 'role_pending', claim_id = 'interrupted' WHERE id = ?").bind(row.id).run();
    clock += 1000000;
    expect((await provisioner().provision(workspace, owner)).claim_id).toBe("interrupted");
    expect(provider.ensureDatabase).toHaveBeenCalledTimes(1);
  });
  it("D1 enforces workspace consistency and rejects credential URLs", async () => {
    const row = await provisioner().provision(workspace, owner);
    await expect(db.prepare("UPDATE managed_tenant_databases SET organization_id = 'org-two' WHERE id = ?").bind(row.id).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE managed_tenant_databases SET credential_reference = 'postgres://user:password@host/db' WHERE id = ?").bind(row.id).run()).rejects.toThrow();
    expect((await provisioner().status(workspace, owner))?.organization_id).toBe("org-one");
  });
  it("keeps different tenants in different database/role mappings", async () => {
    const a = await provisioner().provision(workspace, owner);
    const b = await provisioner().provision(otherWorkspace, foreign);
    expect(a.database_name).not.toBe(b.database_name);
    expect(a.runtime_role).not.toBe(b.runtime_role);
    expect(a.credential_reference).not.toBe(b.credential_reference);
  });
});
