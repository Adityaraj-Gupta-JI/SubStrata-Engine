import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { platformGet, PlatformApiError } from "../src/lib/api/platform.ts";

const previousBase = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
const previousFetch = globalThis.fetch;
afterEach(() => {
  if (previousBase === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  else process.env.NEXT_PUBLIC_PLATFORM_API_URL = previousBase;
  globalThis.fetch = previousFetch;
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
