import { badRequest } from './errors';
export async function jsonBody(request: Request, maxBytes = 20000): Promise<Record<string, unknown>> {
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
        throw badRequest('JSON body required.');
    const reader = request.body?.getReader();
    if (!reader)
        throw badRequest('JSON body required.');
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done)
            break;
        size += value.length;
        if (size > maxBytes) {
            await reader.cancel();
            throw badRequest('Request too large.');
        }
        parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let position = 0;
    for (const part of parts) {
        bytes.set(part, position);
        position += part.length;
    }
    try {
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error();
        return value as Record<string, unknown>;
    }
    catch {
        throw badRequest('Invalid JSON body.');
    }
}
export function fields(value: Record<string, unknown>, allowed: readonly string[]) { if (Object.keys(value).some(key => !allowed.includes(key)))
    throw badRequest('Unexpected request field.'); }
