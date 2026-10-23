import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { platformGet, platformPost, platformToken, PlatformApiError } from "../src/lib/api/platform.ts";

const previousBase = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
const previousFetch = globalThis.fetch;
const previousTemplate = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
const previousMode = process.env.NODE_ENV;
afterEach(() => {
  if (previousBase === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  else process.env.NEXT_PUBLIC_PLATFORM_API_URL = previousBase;
  globalThis.fetch = previousFetch;
  if (previousTemplate === undefined) delete process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
  else process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE = previousTemplate;
  if (previousMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousMode;
});

test("uses standard Clerk sessions unless a template is explicitly configured", async () => {
  delete process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
  assert.equal(await platformToken(async options => { assert.equal(options, undefined); return "standard-session"; }), "standard-session");
  process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE = "substrata-api";
  assert.equal(await platformToken(async options => { assert.deepEqual(options, { template: "substrata-api" }); return "template-session"; }), "template-session");
});

test("rejects unavailable tokens and malformed template configuration", async () => {
  delete process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
  await assert.rejects(platformToken(async () => null), error => error instanceof PlatformApiError && error.status === 401);
  process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE = " ";
  await assert.rejects(platformToken(async () => { throw new Error("must not run"); }), error => error instanceof PlatformApiError && error.status === 503);
});

test("permits HTTP loopback only during local development", async () => {
  process.env.NEXT_PUBLIC_PLATFORM_API_URL = "http://localhost:8787";
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }));
  process.env.NODE_ENV = "development";
  await platformGet("/organizations", "session");
  process.env.NODE_ENV = "production";
  await assert.rejects(platformGet("/organizations", "session"), error => error instanceof PlatformApiError && error.code === "NOT_CONFIGURED");
});

test("rejects credential-bearing, insecure, and non-origin API URLs", async () => {
  process.env.NODE_ENV = "production";
  globalThis.fetch = async () => { throw new Error("must not send a token"); };
  for (const base of ["http://api.example.test", "https://localhost", "https://name:password@api.example.test", "https://api.example.test/path", "https://api.example.test?query=1"]) {
    process.env.NEXT_PUBLIC_PLATFORM_API_URL = base;
    await assert.rejects(platformGet("/organizations", "session"), error => error instanceof PlatformApiError && error.code === "NOT_CONFIGURED");
  }
});

test("posts metadata to the real API contract and returns only its response", async () => {
  process.env.NEXT_PUBLIC_PLATFORM_API_URL = "https://api.example.test";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.example.test/api/v1/organizations");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer session");
    assert.deepEqual(JSON.parse(options.body), { name: "Test", slug: "test" });
    return new Response(JSON.stringify({ data: { id: "persisted-id" } }), { status: 201 });
  };
  assert.deepEqual(await platformPost("/organizations", "session", { name: "Test", slug: "test" }), { data: { id: "persisted-id" } });
});

test("controls network and non-JSON errors without echoing transport details", async () => {
  process.env.NEXT_PUBLIC_PLATFORM_API_URL = "https://api.example.test";
  globalThis.fetch = async () => { throw new Error("PRIVATE_SENTINEL"); };
  await assert.rejects(platformGet("/auth/session", "session"), error => error.code === "NETWORK_ERROR" && !error.message.includes("PRIVATE_SENTINEL"));
  globalThis.fetch = async () => new Response("not-json", { status: 502 });
  await assert.rejects(platformGet("/auth/session", "session"), error => error.code === "API_ERROR" && error.status === 502);
});

test("requires a configured platform API instead of silently using localhost", async () => {
  delete process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  await assert.rejects(platformGet("/auth/session", "token"), error => error instanceof PlatformApiError && error.code === "NOT_CONFIGURED");
});

test("sends the Clerk session token and returns verified API data", async () => {
  process.env.NEXT_PUBLIC_PLATFORM_API_URL = "https://api.example.test";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.example.test/api/v1/organizations");
    assert.equal(options.headers.Authorization, "Bearer signed-session");
    assert.equal(options.cache, "no-store");
    return new Response(JSON.stringify({ data: [{ id: "org-a" }], page: { limit: 25, offset: 0 } }), { status: 200 });
  };
  const result = await platformGet("/organizations", "signed-session");
  assert.equal(result.data[0].id, "org-a");
});

test("surfaces structured unauthorized errors without pretending the request succeeded", async () => {
  process.env.NEXT_PUBLIC_PLATFORM_API_URL = "https://api.example.test";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Authentication required.", requestId: "r1" } }), { status: 401 });
  await assert.rejects(platformGet("/auth/session", "invalid"), error => error instanceof PlatformApiError && error.status === 401 && error.code === "UNAUTHENTICATED");
});

// Agent progress uses the same authenticated SSE transport as chat.
test("streams persisted agent identity, ordered steps and completion without inventing success", async () => {
  const { platformStream } = await import("../src/lib/api/platform.ts");
  process.env.NEXT_PUBLIC_PLATFORM_API_URL = "https://api.example.test";
  const events = [], chunks = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer session");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(JSON.parse(options.body), { goal: "Inspect schema" });
    const frames = [
      ["status", { runId: "persisted-run", status: "running" }],
      ["step", { sequence: 1, kind: "tool", name: "list_tables", status: "success" }],
      ["delta", { text: "Actual streamed text" }],
      ["complete", { runId: "persisted-run", status: "completed", messages: [] }],
    ];
    return new Response(frames.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  };
  const result = await platformStream("/workspaces/w/agents/a/run", "session", { goal: "Inspect schema" }, text => chunks.push(text), undefined, (name, data) => events.push([name, data]));
  assert.deepEqual(chunks, ["Actual streamed text"]);
  assert.deepEqual(events.map(([name]) => name), ["status", "step", "delta", "complete"]);
  assert.equal(result.runId, "persisted-run");
  assert.equal(result.status, "completed");
});

test("does not turn an interrupted agent stream into a completed execution", async () => {
  const { platformStream } = await import("../src/lib/api/platform.ts");
  process.env.NEXT_PUBLIC_PLATFORM_API_URL = "https://api.example.test";
  globalThis.fetch = async () => new Response('event: status\ndata: {"runId":"r","status":"running"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  await assert.rejects(platformStream("/workspaces/w/agents/a/run", "session", { goal: "Inspect" }, () => {}), error => error.code === "STREAM_INTERRUPTED");
});
