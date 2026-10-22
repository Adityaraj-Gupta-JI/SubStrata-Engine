export interface ApiErrorBody { error: { code: string; message: string; requestId: string } }
export interface Page<T> { data: T[]; page: { limit: number; offset: number }; requestId: string }
export interface Organization { id: string; slug: string; name: string; status: string; created_at: string }
export interface Workspace { id: string; organization_id: string; slug: string; name: string; created_at: string }
export interface Session { user: { id: string }; session: { authenticated: boolean }; requestId: string }

export class PlatformApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export async function platformToken(getToken: (options?: { template?: string }) => Promise<string | null>): Promise<string> {
  const template = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
  if (template !== undefined && (!template || /\s/.test(template))) {
    throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform token configuration is invalid.");
  }
  const token = await getToken(template ? { template } : undefined);
  if (!token) throw new PlatformApiError(401, "UNAUTHENTICATED", "Session token unavailable.");
  return token;
}

function platformOrigin(): string {
  const base = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  if (!base) throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform API is not configured.");
  let url: URL;
  try { url = new URL(base); } catch { throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform API origin is invalid."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(process.env.NODE_ENV === "development" && local && url.protocol === "http:")) ||
      (process.env.NODE_ENV === "production" && local)) {
    throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform API origin is invalid.");
  }
  return url.origin;
}

async function platformRequest<T>(path: string, token: string, method: "GET" | "POST", payload?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${platformOrigin()}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      cache: "no-store",
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (error) {
    if (error instanceof PlatformApiError) throw error;
    throw new PlatformApiError(503, "NETWORK_ERROR", "Platform API could not be reached.");
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new PlatformApiError(response.ok ? 502 : response.status, "API_ERROR", "Platform API returned an invalid response."); }
  if (!response.ok) {
    const error = (body as Partial<ApiErrorBody>)?.error;
    throw new PlatformApiError(response.status, error?.code ?? "API_ERROR", error?.message ?? "Request failed.");
  }
  return body as T;
}

export function platformGet<T>(path: string, token: string): Promise<T> {
  return platformRequest(path, token, "GET");
}

export function platformPost<T>(path: string, token: string, payload: unknown): Promise<T> {
  return platformRequest(path, token, "POST", payload);
}
