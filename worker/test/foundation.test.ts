import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { verifySession, type TokenVerifier } from "../src/auth";
import { createHandler } from "../src/index";
import { requireRole, workspaceAccess } from "../src/metadata";

const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const clerkIssuer = "https://trusted.clerk.example";

function env(db?: D1Database): Env {
  return {
    METADATA: db,
    CLERK_SECRET_KEY: "test-only-secret",
    CLERK_ISSUER: clerkIssuer,
    CLERK_AUDIENCE: "test-audience",
    FRONTEND_ORIGIN: "http://localhost:3000",
  } as Env;
}

function request(path: string, token?: string, method = "GET", body?: object): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function claims(overrides: Record<string, unknown> = {}) {
  return { sub: "clerk-user-A", sid: "session-A", iss: clerkIssuer, exp: Math.floor(Date.now() / 1000) + 300, aud: "test-audience", ...overrides };
}

describe("Clerk session verification contract", () => {
  it("rejects missing and malformed bearer tokens", async () => {
    const verifier = vi.fn<TokenVerifier>();
    await expect(verifySession(request("/api/v1/auth/session"), env(), verifier)).rejects.toMatchObject({ status: 401 });
    await expect(verifySession(request("/api/v1/auth/session", "bad token"), env(), verifier)).rejects.toMatchObject({ status: 401 });
    expect(verifier).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures, expiry, wrong issuer, and missing session IDs", async () => {
    const rejected: TokenVerifier = async () => { throw new Error("invalid signature"); };
    await expect(verifySession(request("/api/v1/auth/session", "bad.jwt.token"), env(), rejected)).rejects.toMatchObject({ status: 401 });
    for (const value of [claims({ exp: 1 }), claims({ iss: "https://forged.example" }), claims({ sid: "" })]) {
      const verifier: TokenVerifier = async () => value;
      await expect(verifySession(request("/api/v1/auth/session", "bad.jwt.token"), env(), verifier)).rejects.toMatchObject({ status: 401 });
    }
  });
  it("resolves identity only from verified claims and passes issuer-bound settings", async () => {
    const verifier = vi.fn<TokenVerifier>().mockResolvedValue(claims());
    const result = await verifySession(request("/api/v1/auth/session", "signed.token.value"), env(), verifier);
    expect(result.clerkUserId).toBe("clerk-user-A");
    expect(verifier).toHaveBeenCalledWith("signed.token.value", expect.objectContaining({ audience: "test-audience", secretKey: "test-only-secret" }));
  });
});

function fakeDb(membership: { organizationId: string; userId: string; role: string } | null = null) {
  const batch = vi.fn();
  const prepare = vi.fn((sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => {
        if (sql.includes("FROM users")) return { id: "internal-user-A", clerk_user_id: "clerk-user-A", status: "active" };
        if (sql.includes("FROM memberships")) {
          return membership && params[0] === membership.organizationId && params[1] === membership.userId
            ? { role: membership.role, status: "active" } : null;
        }
        if (sql.includes("FROM workspaces")) return params[0] === workspaceB
          ? { id: workspaceB, organization_id: orgB, slug: "b", name: "B", created_at: "now" } : null;
        if (sql.includes("FROM workspace_memberships")) return null;
        if (sql.includes("FROM organizations")) return params[0] === orgB ? { id: orgB, slug: "b", name: "B", status: "active" } : null;
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    }),
  }));
  return { db: { prepare, batch } as unknown as D1Database, prepare, batch };
}

describe("deny-by-default API and tenant isolation", () => {
  const authenticate = async () => ({ clerkUserId: "clerk-user-A", sessionId: "session-A" });
  it("serves health, rejects unknown routes, and fails safely without D1", async () => {
    const handler = createHandler(authenticate);
    expect((await handler(request("/api/v1/health"), env())).status).toBe(200);
    expect((await handler(request("/api/v1/missing"), env(fakeDb().db))).status).toBe(404);
    const missing = await handler(request("/api/v1/auth/session"), env());
    expect(missing.status).toBe(503);
    expect(JSON.stringify(await missing.json())).not.toContain("test-only-secret");
  });
  it("rejects protected requests without authentication", async () => {
    const { db, prepare } = fakeDb();
    const response = await createHandler()(request("/api/v1/auth/session"), env(db));
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("resolves the internal user from the verified subject, ignoring a forged user query", async () => {
    const { db } = fakeDb();
    const response = await createHandler(authenticate)(request("/api/v1/auth/session?user_id=forged-user"), env(db));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: "internal-user-A" }, session: { authenticated: true } });
  });
  it("rejects organization B reads and writes for organization A user", async () => {
    const { db, batch } = fakeDb({ organizationId: orgA, userId: "internal-user-A", role: "owner" });
    const handler = createHandler(authenticate);
    expect((await handler(request(`/api/v1/organizations/${orgB}`), env(db))).status).toBe(404);
    expect((await handler(request(`/api/v1/organizations/${orgB}/workspaces`, undefined, "POST", { name: "Forged", slug: "forged", organization_id: orgA, user_id: "internal-user-A" }), env(db))).status).toBe(404);
    expect(batch).not.toHaveBeenCalled();
  });
  it("does not allow viewers to create workspaces or unassigned members to read them", async () => {
    expect(() => requireRole("viewer", ["owner", "admin"])).toThrow();
    const viewer = fakeDb({ organizationId: orgB, userId: "internal-user-A", role: "viewer" });
    const response = await createHandler(authenticate)(request(`/api/v1/organizations/${orgB}/workspaces`, undefined, "POST", { name: "Denied", slug: "denied" }), env(viewer.db));
    expect(response.status).toBe(403);
    expect(viewer.batch).not.toHaveBeenCalled();
    const { db } = fakeDb({ organizationId: orgB, userId: "internal-user-A", role: "member" });
    await expect(workspaceAccess(db, workspaceB, "internal-user-A")).rejects.toMatchObject({ status: 404 });
  });
  it("has no unrestricted SQL route and validates pagination and body", async () => {
    const { db } = fakeDb();
    const handler = createHandler(authenticate);
    expect((await handler(request("/api/v1/execute-sql", undefined, "POST", { query: "DROP TABLE users" }), env(db))).status).toBe(501);
    expect((await handler(request("/api/v1/organizations?limit=999", undefined), env(db))).status).toBe(400);
    expect((await handler(request("/api/v1/organizations", undefined, "POST", { name: "x", slug: "Bad Slug" }), env(db))).status).toBe(400);
  });
  it("does not expose internal errors and restricts CORS origins", async () => {
    const { db } = fakeDb();
    const handler = createHandler(async () => { throw new Error("SECRET_SENTINEL"); });
    const response = await handler(request("/api/v1/auth/session"), env(db));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SECRET_SENTINEL");
    const denied = await createHandler()(new Request("https://api.example.test/api/v1/health", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env(db));
    expect(denied.status).toBe(403);
  });
});

describe("D1 metadata migration constraints", () => {
  it("applies to disposable SQLite and enforces membership, ownership, and indexes", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(new URL("../migrations/0001_metadata.sql", import.meta.url), "utf8"));
      db.prepare("INSERT INTO users (id, clerk_user_id) VALUES (?, ?)").run("user-a", "clerk-a");
      db.prepare("INSERT INTO organizations (id, slug, name, created_by) VALUES (?, ?, ?, ?)").run(orgA, "org-a", "A", "user-a");
      db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").run("member-a", orgA, "user-a", "owner");
      expect(() => db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").run("duplicate", orgA, "user-a", "owner")).toThrow();
      expect(() => db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").run("orphan", orgB, "user-a", "owner")).toThrow();
      expect(() => db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)").run("invalid-role", orgA, "user-a", "root")).toThrow();
      db.prepare("INSERT INTO workspaces (id, organization_id, slug, name, created_by) VALUES (?, ?, ?, ?, ?)").run(workspaceB, orgA, "main", "Main", "user-a");
      expect(() => db.prepare("INSERT INTO workspaces (id, organization_id, slug, name, created_by) VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), orgA, "main", "Duplicate", "user-a")).toThrow();
      db.prepare("INSERT INTO organizations (id, slug, name, created_by) VALUES (?, ?, ?, ?)").run(orgB, "org-b", "B", "user-a");
      expect(() => db.prepare("INSERT INTO connections (id, organization_id, workspace_id, engine, display_name, connection_type) VALUES (?, ?, ?, ?, ?, ?)").run("cross-org", orgB, workspaceB, "postgresql", "Wrong tenant", "managed")).toThrow();
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[];
      expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining(["idx_memberships_user_status", "idx_workspaces_org", "idx_connections_workspace_org", "idx_audit_org_created"]));
    } finally {
      db.close();
    }
  });
});
