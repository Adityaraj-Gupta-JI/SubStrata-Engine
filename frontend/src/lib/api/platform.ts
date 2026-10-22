export interface ApiErrorBody { error: { code: string; message: string; requestId: string } }
export interface Page<T> { data: T[]; page: { limit: number; offset: number }; requestId: string }
export interface Organization { id: string; slug: string; name: string; status: string; created_at: string }
export interface Workspace { id: string; organization_id: string; slug: string; name: string; created_at: string }
export interface Session { user: { id: string }; session: { authenticated: boolean }; requestId: string }

export class PlatformApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export async function platformGet<T>(path: string, token: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  if (!base) throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform API is not configured.");
  const response = await fetch(`${base}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = (body as Partial<ApiErrorBody>)?.error;
    throw new PlatformApiError(response.status, error?.code ?? "API_ERROR", error?.message ?? "Request failed.");
  }
  return body as T;
}
