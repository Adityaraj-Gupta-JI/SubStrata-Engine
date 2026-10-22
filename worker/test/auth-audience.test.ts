import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { verifyToken } from "@clerk/backend";
import { verifySession, type TokenVerifier } from "../src/auth";
import { createHandler } from "../src/index";

const audience = "substrata-test-api";
const issuer = "https://trusted.clerk.example";
const origin = "http://localhost:3000";
let privateKey: KeyObject;
let forgedKey: KeyObject;
let publicKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  forgedKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
});

function configuration(): Env {
  return {
    CLERK_SECRET_KEY: "test-fixture-only",
    CLERK_ISSUER: issuer,
    CLERK_AUDIENCE: audience,
    FRONTEND_ORIGIN: origin,
  } as Env;
}

function signedToken(overrides: Record<string, unknown> = {}, key = privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "local-test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "clerk-test-user", sid: "test-session", iss: issuer,
    aud: audience, azp: origin, iat: now - 30, nbf: now - 30, exp: now + 300,
    ...overrides,
  })).toString("base64url");
  const message = `${header}.${payload}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), key).toString("base64url")}`;
}

function request(token?: string): Request {
  return new Request("https://api.example.test/api/v1/auth/session", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// Only key retrieval is replaced. The installed SDK performs real verification,
// including signature and temporal checks, using an ephemeral public test key.
const localVerifier: TokenVerifier = (token, options) => verifyToken(token, { ...options, jwtKey: publicKey });

describe("verified Clerk audience enforcement with local RSA keys", () => {
  it.each([
    { name: "correct string", aud: audience },
    { name: "correct audience in an array", aud: ["another-api", audience] },
  ])("accepts $name", async ({ aud }) => {
    await expect(verifySession(request(signedToken({ aud })), configuration(), localVerifier)).resolves.toEqual({
      clerkUserId: "clerk-test-user", sessionId: "test-session",
    });
  });

  it.each([
    { name: "missing audience", aud: undefined },
    { name: "null audience", aud: null },
    { name: "empty string", aud: "" },
    { name: "wrong string", aud: "another-api" },
    { name: "different case", aud: audience.toUpperCase() },
    { name: "unrelated array", aud: ["another-api"] },
    { name: "empty array", aud: [] },
    { name: "numeric audience", aud: 123 },
    { name: "object audience", aud: { audience } },
    { name: "mixed array containing the correct audience", aud: [audience, null] },
    { name: "nested array", aud: [[audience]] },
    { name: "array containing an empty audience", aud: [audience, ""] },
  ])("rejects $name", async ({ aud }) => {
    await expect(verifySession(request(signedToken({ aud })), configuration(), localVerifier)).rejects.toMatchObject({
      status: 401, code: "UNAUTHENTICATED", publicMessage: "Authentication required.",
    });
  });

  it("still rejects a forged signature with the correct audience", async () => {
    await expect(verifySession(request(signedToken({}, forgedKey)), configuration(), localVerifier)).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    { name: "expired token", claims: () => ({ exp: Math.floor(Date.now() / 1000) - 60 }) },
    { name: "wrong issuer", claims: () => ({ iss: "https://other.clerk.example" }) },
    { name: "future activation", claims: () => ({ nbf: Math.floor(Date.now() / 1000) + 300 }) },
  ])("still rejects $name with the correct audience", async ({ claims }) => {
    await expect(verifySession(request(signedToken(claims())), configuration(), localVerifier)).rejects.toMatchObject({ status: 401 });
  });

  it("keeps the documented optional policy when audience configuration is absent", async () => {
    const env = configuration();
    delete env.CLERK_AUDIENCE;
    await expect(verifySession(request(signedToken({ aud: undefined })), env, localVerifier)).resolves.toMatchObject({ clerkUserId: "clerk-test-user" });
    await expect(verifySession(request(signedToken({ aud: undefined }, forgedKey)), env, localVerifier)).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    { name: "empty", value: "" },
    { name: "whitespace only", value: " \t" },
    { name: "leading whitespace", value: ` ${audience}` },
    { name: "embedded whitespace", value: "api audience" },
    { name: "control character", value: `${audience}\u0000` },
    { name: "null", value: null },
    { name: "number", value: 123 },
    { name: "array", value: [audience] },
    { name: "object", value: { audience } },
  ])("fails closed for $name audience configuration", async ({ value }) => {
    const env = { ...configuration(), CLERK_AUDIENCE: value } as unknown as Env;
    const verifier = vi.fn(localVerifier);
    await expect(verifySession(request(signedToken()), env, verifier)).rejects.toMatchObject({
      status: 503, code: "SERVICE_UNAVAILABLE", publicMessage: "Service unavailable.",
    });
    expect(verifier).not.toHaveBeenCalled();
  });
});

describe("protected D1 resources remain inaccessible on authentication failure", () => {
  it.each(["missing token", "forged signature", "missing audience", "wrong audience array", "malformed configuration"])("blocks %s before database access", async scenario => {
    const prepare = vi.fn();
    const batch = vi.fn();
    const env = { ...configuration(), METADATA: { prepare, batch } as unknown as D1Database };
    let token: string | undefined;
    if (scenario === "forged signature") token = signedToken({}, forgedKey);
    if (scenario === "missing audience") token = signedToken({ aud: undefined });
    if (scenario === "wrong audience array") token = signedToken({ aud: ["another-api"] });
    if (scenario === "malformed configuration") {
      env.CLERK_AUDIENCE = " ";
      token = signedToken();
    }
    const handler = createHandler((incoming, bindings) => verifySession(incoming, bindings, localVerifier));
    const response = await handler(request(token), env);
    const misconfigured = scenario === "malformed configuration";
    expect(response.status).toBe(misconfigured ? 503 : 401);
    expect(await response.json()).toEqual({ error: {
      code: misconfigured ? "SERVICE_UNAVAILABLE" : "UNAUTHENTICATED",
      message: misconfigured ? "Service unavailable." : "Authentication required.",
      requestId: expect.any(String),
    } });
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });
});
