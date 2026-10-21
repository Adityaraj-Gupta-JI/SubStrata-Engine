const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function apiGet(path: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1${path}`);
}

export function apiPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
