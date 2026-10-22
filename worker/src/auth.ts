import { verifyToken } from "@clerk/backend";
import { unauthorized, unavailable } from "./errors";

export interface SessionIdentity {
  clerkUserId: string;
  sessionId: string;
}

export type TokenVerifier = (
  token: string,
  options: Parameters<typeof verifyToken>[1],
) => Promise<{ sub?: string; sid?: string; iss?: string; exp?: number; nbf?: number }>;

export async function verifySession(
  request: Request,
  env: Env,
  verifier: TokenVerifier = verifyToken,
): Promise<SessionIdentity> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) throw unauthorized();
  if (!env.CLERK_SECRET_KEY || !env.CLERK_ISSUER) throw unavailable();

  try {
    const claims = await verifier(match[1], {
      secretKey: env.CLERK_SECRET_KEY,
      ...(env.CLERK_AUDIENCE ? { audience: env.CLERK_AUDIENCE } : {}),
      ...(env.FRONTEND_ORIGIN ? { authorizedParties: [env.FRONTEND_ORIGIN] } : {}),
    });
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== env.CLERK_ISSUER || typeof claims.exp !== "number" || claims.exp <= now ||
        (typeof claims.nbf === "number" && claims.nbf > now) ||
        typeof claims.sub !== "string" || !claims.sub || typeof claims.sid !== "string" || !claims.sid) {
      throw unauthorized();
    }
    return { clerkUserId: claims.sub, sessionId: claims.sid };
  } catch {
    throw unauthorized();
  }
}
