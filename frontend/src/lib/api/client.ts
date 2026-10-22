const API_BASE_URL = process.env.NEXT_PUBLIC_LEGACY_API_URL;

function legacyUrl(path: string): string {
  if (!API_BASE_URL) throw new Error("Legacy chat API is not configured.");
  return `${API_BASE_URL}/api/v1${path}`;
}

export function apiGet(path: string): Promise<Response> {
  return fetch(legacyUrl(path));
}

export function apiPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(legacyUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
