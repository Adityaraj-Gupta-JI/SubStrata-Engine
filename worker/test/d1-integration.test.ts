import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { verifyToken } from "@clerk/backend";
import { verifySession } from "../src/auth";
import { createHandler } from "../src/index";

// Real local D1 + real SDK signature validation. No Clerk network or production data.
let runtime: Miniflare;
let db: D1Database;
let privateKey: KeyObject;
let pem: string;
let env: Env;
let alice: string;
let bob: string;
let orgA: string;
let orgB: string;
let assigned: string;
let restricted: string;
let foreign: string;
const issuer = "https://local-test.clerk.example";
const audience = "local-d1-tests";
const origin = "http://localhost:3000";
const handler = createHandler((request, bindings) => verifySession(request, bindings,
  (token, options) => verifyToken(token, { ...options, jwtKey: pem })));

function bearer(subject: string, overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "d1-local-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: subject, sid: "local-session", iss: issuer, aud: audience, azp: origin, iat: now - 30, nbf: now - 30, exp: now + 300, ...overrides })).toString("base64url");
  const message = `${header}.${payload}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")}`;
}

async function call(path: string, subject: string | null, method = "GET", body?: object) {
  return handler(new Request(`http://localhost:8787/api/v1${path}`, {
    method,
    headers: { ...(subject ? { Authorization: `Bearer ${bearer(subject)}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
}

async function create(path: string, subject: string, name: string): Promise<string> {
  const response = await call(path, subject, "POST", { name, slug: name.toLowerCase() });
  expect(response.status).toBe(201);
  const body = await response.json() as { data: { id: string } };
  return body.data.id;
}

beforeAll(async () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('local test'); } };", compatibilityDate: "2026-10-22", d1Databases: ["METADATA"] }), telemetry: { enabled: false } });
  db = await runtime.getD1Database("METADATA");
  const statements = readFileSync(new URL("../migrations/0001_metadata.sql", import.meta.url), "utf8").split(";").map(sql => sql.trim()).filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
  env = { METADATA: db, CLERK_SECRET_KEY: "local-test-fixture", CLERK_ISSUER: issuer, CLERK_AUDIENCE: audience, FRONTEND_ORIGIN: origin };
  const first = await (await call("/auth/session", "clerk-alice")).json() as { user: { id: string } };
  const second = await (await call("/auth/session", "clerk-bob")).json() as { user: { id: string } };
  alice = first.user.id;
  bob = second.user.id;
  orgA = await create("/organizations", "clerk-alice", "Alice");
  orgB = await create("/organizations", "clerk-bob", "Bob");
  assigned = await create(`/organizations/${orgA}/workspaces`, "clerk-alice", "Assigned");
  restricted = await create(`/organizations/${orgA}/workspaces`, "clerk-alice", "Restricted");
  foreign = await create(`/organizations/${orgB}/workspaces`, "clerk-bob", "Foreign");
  await db.batch([
    db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, 'viewer')").bind(crypto.randomUUID(), orgA, bob),
    db.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'viewer')").bind(crypto.randomUUID(), assigned, bob),
  ]);
}, 30000);

afterAll(async () => { await runtime?.dispose(); });

describe("local D1 integration with two verified test identities", () => {
  it("applies all metadata tables without credential columns", async () => {
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const expected = ["users", "organizations", "memberships", "workspaces", "workspace_memberships", "database_tenants", "connections", "audit_events"];
    expect(tables.results.map(row => row.name)).toEqual(expect.arrayContaining(expected));
    for (const table of expected) {
      const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(columns.results.some(column => /password|api_key|secret|token/i.test(column.name))).toBe(false);
    }
  });

  it("creates and resolves distinct users from verified subjects", async () => {
    expect(alice).not.toBe(bob);
    const response = await call("/auth/session?user_id=forged", "clerk-alice");
    expect(await response.json()).toMatchObject({ user: { id: alice } });
    expect(await db.prepare("SELECT count(*) AS count FROM users").first("count")).toBe(2);
  });

  it("persists organization/workspace ownership and successful audit events", async () => {
    expect(await db.prepare("SELECT created_by FROM organizations WHERE id = ?").bind(orgA).first("created_by")).toBe(alice);
    expect(await db.prepare("SELECT organization_id FROM workspaces WHERE id = ?").bind(assigned).first("organization_id")).toBe(orgA);
    expect(await db.prepare("SELECT count(*) AS count FROM audit_events WHERE outcome = 'success'").first("count")).toBe(5);
  });

  it("denies foreign organization reads, writes and workspace access", async () => {
    expect((await call(`/organizations/${orgB}`, "clerk-alice")).status).toBe(404);
    expect((await call(`/organizations/${orgB}/workspaces`, "clerk-alice", "POST", { name: "Forged", slug: "forged", user_id: bob, organization_id: orgA })).status).toBe(404);
    expect((await call(`/workspaces/${foreign}`, "clerk-alice")).status).toBe(404);
    expect((await call(`/workspaces/${foreign}/connections`, "clerk-alice")).status).toBe(404);
  });

  it("enforces viewer restrictions and assignments within an organization", async () => {
    expect((await call(`/workspaces/${assigned}`, "clerk-bob")).status).toBe(200);
    expect((await call(`/workspaces/${restricted}`, "clerk-bob")).status).toBe(404);
    expect((await call(`/organizations/${orgA}/workspaces`, "clerk-bob", "POST", { name: "Denied", slug: "denied" })).status).toBe(403);
    const body = await (await call(`/organizations/${orgA}/workspaces`, "clerk-bob")).json() as { data: { id: string }[] };
    expect(body.data.map(row => row.id)).toEqual([assigned]);
  });

  it("rejects unauthenticated requests and preserves the disabled SQL path", async () => {
    expect((await call("/organizations", null)).status).toBe(401);
    const invalid = await handler(new Request("http://localhost:8787/api/v1/organizations", { headers: { Authorization: "Bearer invalid.jwt.token" } }), env);
    expect(invalid.status).toBe(401);
    expect((await call("/execute-sql", "clerk-alice", "POST", { query: "DROP TABLE users" })).status).toBe(501);
    expect(await db.prepare("SELECT count(*) AS count FROM users").first("count")).toBe(2);
  });
});
