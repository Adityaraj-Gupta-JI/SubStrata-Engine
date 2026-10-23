import { ApiError } from "../errors";
import type { AIProvider, ChatMessage, Completion, Model, ToolDefinition, ToolCall } from "./contracts";
const fail = (status = 502, code = "AI_PROVIDER_ERROR", message = "OpenRouter request failed.") => new ApiError(status, code, message);
export function providerFailure(status: number): ApiError {
    if (status === 401 || status === 403)
        return fail(401, "AI_KEY_INVALID", "OpenRouter rejected the key.");
    if (status === 402)
        return fail(402, "AI_CREDITS_EXHAUSTED", "OpenRouter credits are exhausted.");
    if (status === 429)
        return fail(429, "AI_RATE_LIMIT", "OpenRouter rate limit reached. Try again later.");
    if (status === 408 || status === 504)
        return fail(504, "AI_TIMEOUT", "OpenRouter request timed out.");
    return fail();
}
export function validateKey(key: unknown): asserts key is string {
    if (typeof key !== "string" || key.length < 16 || key.length > 512 || !/^[!-~]+$/.test(key))
        throw fail(400, "AI_KEY_FORMAT", "Enter a complete OpenRouter key without whitespace.");
}
export const modelId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,199}$/.test(id);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export class OpenRouterProvider implements AIProvider {
    constructor(private readonly send: typeof fetch = fetch, private readonly timeoutMs = 25000) { }
    private async request(path: string, key: string, signal?: AbortSignal, body?: object): Promise<Record<string, unknown>> {
        validateKey(key);
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        try {
            const response = await this.send(`https://openrouter.ai/api/v1${path}`, { method: body ? "POST" : "GET", redirect: "error", signal: combined, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "SubStrata Engine" }, ...(body ? { body: JSON.stringify(body) } : {}) });
            if (!response.ok) {
                await response.body?.cancel();
                throw providerFailure(response.status);
            }
            const reader = response.body?.getReader();
            if (!reader)
                throw fail();
            const chunks: Uint8Array[] = [];
            let size = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.length;
                if (size > 2000000) {
                    await reader.cancel();
                    throw fail();
                }
                chunks.push(value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) {
                bytes.set(part, offset);
                offset += part.length;
            }
            const data = record(JSON.parse(new TextDecoder().decode(bytes)));
            if (data.error) {
                const code = Number(record(data.error).code);
                throw providerFailure(code);
            }
            return data;
        }
        catch (error) {
            if (signal?.aborted)
                throw fail(499, "AI_CANCELLED", "Request cancelled.");
            if (timeout.aborted)
                throw fail(504, "AI_TIMEOUT", "OpenRouter request timed out.");
            if (error instanceof ApiError)
                throw error;
            throw fail();
        }
    }
    async validate(key: string, signal?: AbortSignal) {
        const result = await this.request("/key", key, signal);
        if (!result.data || typeof result.data !== "object")
            throw fail();
    }
    async models(key: string, signal?: AbortSignal): Promise<Model[]> {
        const result = await this.request("/models", key, signal);
        if (!Array.isArray(result.data))
            throw fail();
        return result.data.slice(0, 5000).flatMap(value => {
            const row = record(value), pricing = record(row.pricing);
            if (!modelId(row.id) || row.id.includes(key) || typeof row.name !== "string")
                return [];
            return [{ id: row.id, name: row.name.slice(0, 160).replaceAll(key, "[redacted]"), contextLength: Number.isSafeInteger(row.context_length) ? Number(row.context_length) : 0, tools: Array.isArray(row.supported_parameters) && row.supported_parameters.includes("tools"), pricing: { prompt: typeof pricing.prompt === "string" && /^\d+(?:\.\d+)?(?:e-?\d+)?$/.test(pricing.prompt) ? pricing.prompt : "unknown", completion: typeof pricing.completion === "string" && /^\d+(?:\.\d+)?(?:e-?\d+)?$/.test(pricing.completion) ? pricing.completion : "unknown" } }];
        });
    }
    private async stream(key: string, body: object, signal: AbortSignal | undefined, onDelta: (text: string) => void): Promise<Record<string, unknown>> {
        validateKey(key);
        const timeout = AbortSignal.timeout(this.timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            const response = await this.send("https://openrouter.ai/api/v1/chat/completions", { method: "POST", redirect: "error", signal: combined, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "SubStrata Engine" }, body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }) });
            if (!response.ok) {
                await response.body?.cancel();
                throw providerFailure(response.status);
            }
            reader = response.body?.getReader();
            if (!reader)
                throw fail();
            const decoder = new TextDecoder();
            let buffer = "", content = "", emitted = "", size = 0, done = false, finish = false, usage: unknown;
            const calls = new Map<number, {
                id: string;
                type: string;
                function: {
                    name: string;
                    arguments: string;
                };
            }>();
            const emit = (flush = false) => { const safe = content.replaceAll(key, "[redacted]"); const ready = flush ? safe : safe.slice(0, Math.max(0, safe.length - key.length)); if (!ready.startsWith(emitted))
                throw fail(); const delta = ready.slice(emitted.length); if (delta)
                onDelta(delta); emitted = ready; };
            while (!done) {
                const part = await reader.read();
                if (part.done)
                    break;
                size += part.value.length;
                if (size > 2000000)
                    throw fail();
                buffer = (buffer + decoder.decode(part.value, { stream: true })).replace(/\r\n/g, "\n");
                let boundary: number;
                while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                    const frame = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const text = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
                    if (!text)
                        continue;
                    if (text === "[DONE]") {
                        done = true;
                        break;
                    }
                    const data = record(JSON.parse(text));
                    if (data.error)
                        throw providerFailure(Number(record(data.error).code));
                    if (data.usage)
                        usage = data.usage;
                    if (!Array.isArray(data.choices) || !data.choices.length)
                        continue;
                    const choice = record(data.choices[0]), delta = record(choice.delta);
                    if (choice.finish_reason === "error")
                        throw fail();
                    if (choice.finish_reason)
                        finish = true;
                    if (typeof delta.content === "string") {
                        content += delta.content;
                        if (content.length > 20000)
                            throw fail();
                        emit();
                    }
                    if (delta.tool_calls !== undefined) {
                        if (!Array.isArray(delta.tool_calls))
                            throw fail();
                        for (const value of delta.tool_calls) {
                            const item = record(value), index = item.index;
                            if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 5)
                                throw fail();
                            const current = calls.get(index) ?? { id: "", type: "function", function: { name: "", arguments: "" } }, fn = record(item.function);
                            if (typeof item.id === "string")
                                current.id += item.id;
                            if (typeof item.type === "string")
                                current.type = item.type;
                            if (typeof fn.name === "string")
                                current.function.name += fn.name;
                            if (typeof fn.arguments === "string")
                                current.function.arguments += fn.arguments;
                            if (current.function.arguments.length > 16000 || current.id.length > 120 || current.function.name.length > 100)
                                throw fail();
                            calls.set(index, current);
                        }
                    }
                }
                if (buffer.length > 65536)
                    throw fail();
            }
            if (!done && !finish)
                throw fail();
            emit(true);
            return { choices: [{ message: { content, tool_calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value) } }], usage };
        }
        catch (error) {
            if (signal?.aborted)
                throw fail(499, "AI_CANCELLED", "Request cancelled.");
            if (timeout.aborted)
                throw fail(504, "AI_TIMEOUT", "OpenRouter request timed out.");
            if (error instanceof ApiError)
                throw error;
            throw fail();
        }
        finally {
            await reader?.cancel().catch(() => undefined);
        }
    }
    async complete(key: string, model: string, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal, onDelta?: (text: string) => void): Promise<Completion> {
        const body = { model, messages, max_tokens: 1600, temperature: 0.2, ...(tools.length ? { tools, tool_choice: "auto", parallel_tool_calls: false } : {}) };
        const data = onDelta ? await this.stream(key, body, signal, onDelta) : await this.request("/chat/completions", key, signal, { ...body, stream: false });
        if (!Array.isArray(data.choices) || !data.choices.length)
            throw fail();
        const choice = record(data.choices[0]), msg = record(choice.message);
        if (choice.finish_reason === "error")
            throw fail();
        const content = typeof msg.content === "string" ? msg.content.slice(0, 20000).replaceAll(key, "[redacted]") : "";
        const toolCalls: ToolCall[] = [];
        if (msg.tool_calls !== undefined) {
            if (!Array.isArray(msg.tool_calls) || msg.tool_calls.length > 6)
                throw fail();
            for (const value of msg.tool_calls) {
                const call = record(value), fn = record(call.function);
                if (typeof call.id !== "string" || !/^[-\w]{1,120}$/.test(call.id) || call.type !== "function" || typeof fn.name !== "string" || typeof fn.arguments !== "string" || fn.arguments.length > 16000)
                    throw fail();
                toolCalls.push({ id: call.id, type: "function", function: { name: fn.name, arguments: fn.arguments } });
            }
        }
        if (!content && !toolCalls.length)
            throw fail();
        const u = record(data.usage);
        const nums = [u.prompt_tokens, u.completion_tokens, u.total_tokens];
        const usage = nums.every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0) ? { promptTokens: Number(nums[0]), completionTokens: Number(nums[1]), totalTokens: Number(nums[2]) } : null;
        return { content, toolCalls, usage };
    }
}
