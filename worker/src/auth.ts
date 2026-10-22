import { verifyToken } from "@clerk/backend";
import { unauthorized, unavailable } from "./errors";

export interface SessionIdentity {
  clerkUserId: string;
  sessionId: string;
}

export type TokenVerifier = (
  token: string,
  options: Parameters<typeof verifyToken>[1],
) => Promise<{ sub?: string; sid?: string; iss?: string; exp?: number; nbf?: number; aud?: unknown }>;

function configuredAudience(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || /\s|[\u0000-\u001f\u007f]/u.test(value)) {
    throw unavailable();
  }
  return value;
}

function matchesAudience(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") return audience === expected;
  return Array.isArray(audience) && audience.length > 0 &&
    audience.every(value => typeof value === "string" && value.length > 0) && audience.includes(expected);
}

export async function verifySession(
  request: Request,
  env: Env,
  verifier: TokenVerifier = verifyToken,
): Promise<SessionIdentity> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) throw unauthorized();
  if (!env.CLERK_SECRET_KEY || !env.CLERK_ISSUER) throw unavailable();
  const expectedAudience = configuredAudience(env.CLERK_AUDIENCE);

  try {
    const claims = await verifier(match[1], {
      secretKey: env.CLERK_SECRET_KEY,
      ...(expectedAudience !== undefined ? { audience: expectedAudience } : {}),
      ...(env.FRONTEND_ORIGIN ? { authorizedParties: [env.FRONTEND_ORIGIN] } : {}),
    });
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== env.CLERK_ISSUER || typeof claims.exp !== "number" || claims.exp <= now ||
        (typeof claims.nbf === "number" && claims.nbf > now) ||
        typeof claims.sub !== "string" || !claims.sub || typeof claims.sid !== "string" || !claims.sid) {
      throw unauthorized();
    }
    // Only inspect claims returned after successful SDK signature verification.
    // The SDK alone does not enforce missing or array-valued audience claims.
    if (expectedAudience !== undefined && !matchesAudience(claims.aud, expectedAudience)) {
      throw unauthorized();
    }
    return { clerkUserId: claims.sub, sessionId: claims.sid };
  } catch {
    throw unauthorized();
  }
}
