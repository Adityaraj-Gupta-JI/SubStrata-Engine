import { badRequest } from "./errors";

export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw badRequest("Invalid resource ID.");
  }
  return value;
}

export function pagination(url: URL): { limit: number; offset: number } {
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw badRequest("Invalid pagination.");
  }
  return { limit, offset };
}

export async function nameAndSlug(request: Request): Promise<{ name: string; slug: string }> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw badRequest("JSON body required.");
  const reader = request.body?.getReader();
  if (!reader) throw badRequest("JSON body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw badRequest("Request body too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw badRequest("Invalid JSON body."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Invalid body.");
  const value = body as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const slug = typeof value.slug === "string" ? value.slug.trim() : "";
  if (name.length < 2 || name.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 63) {
    throw badRequest("Name or slug is invalid.");
  }
  return { name, slug };
}
