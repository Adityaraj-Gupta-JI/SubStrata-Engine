import { describe, it, expect, vi } from "vitest";
import { OpenRouterProvider } from "../src/ai/openrouter";
const key = "local-provider-fixture-key-not-real";
describe("OpenRouter official HTTP contract (mocked provider, no live calls)", () => {
    it("validates using GET /key and discovers sanitized model metadata", async () => {
        const send = vi.fn<typeof fetch>(async (input) => new Response(JSON.stringify(String(input).endsWith("/key") ? { data: { limit: null } } : { data: [{ id: "test/model", name: "Test", context_length: 4096, supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" } }] })));
        const provider = new OpenRouterProvider(send);
        await provider.validate(key);
        expect((await provider.models(key))[0]).toMatchObject({ id: "test/model", tools: true, contextLength: 4096 });
        expect(send.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/key");
        expect(send.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: `Bearer ${key}` } });
    });
    for (const [status, code] of [[401, "AI_KEY_INVALID"], [403, "AI_KEY_INVALID"], [402, "AI_CREDITS_EXHAUSTED"], [429, "AI_RATE_LIMIT"], [500, "AI_PROVIDER_ERROR"], [504, "AI_TIMEOUT"]] as const) {
        it(`controls provider ${status} without exposing its body`, async () => { const provider = new OpenRouterProvider(async () => new Response(`PRIVATE ${key}`, { status })); await expect(provider.validate(key)).rejects.toMatchObject({ code }); await expect(provider.validate(key)).rejects.not.toHaveProperty("message", expect.stringContaining(key)); });
    }
    it("validates completion contract, usage and redacts credential echoes", async () => {
        const send = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: `Answer ${key}`, tool_calls: [] } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
        const result = await new OpenRouterProvider(send).complete(key, "test/model", [{ role: "user", content: "Hello" }], []);
        expect(result.content).toBe("Answer [redacted]");
        expect(result.usage?.totalTokens).toBe(5);
        expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toMatchObject({ stream: false, max_tokens: 1600, model: "test/model" });
    });
    it("handles malformed models, embedded errors, redirects and network errors safely", async () => {
        await expect(new OpenRouterProvider(async () => Response.json({ data: "bad" })).models(key)).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
        await expect(new OpenRouterProvider(async () => Response.json({ error: { code: 402, message: key } })).models(key)).rejects.toMatchObject({ code: "AI_CREDITS_EXHAUSTED" });
        await expect(new OpenRouterProvider(async () => { throw new Error(key); }).models(key)).rejects.toMatchObject({ publicMessage: "OpenRouter request failed." });
    });
    it("honors cancellation and timeouts", async () => {
        const waiting: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener("abort", () => reject(new Error("PRIVATE")), { once: true }); });
        await expect(new OpenRouterProvider(waiting, 10).models(key)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
        const abort = new AbortController();
        const request = new OpenRouterProvider(waiting).models(key, abort.signal);
        abort.abort();
        await expect(request).rejects.toMatchObject({ code: "AI_CANCELLED" });
    });
    it("streams actual SSE deltas and redacts a key split across frames", async () => {
        const header = "x".repeat(key.length + 30) + " Header ";
        const frames = [header, key.slice(0, 9), key.slice(9), " tail"].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join("") + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`;
        const send = vi.fn<typeof fetch>(async () => new Response(frames, { headers: { "Content-Type": "text/event-stream" } }));
        const deltas: string[] = [];
        const result = await new OpenRouterProvider(send).complete(key, "test/model", [{ role: "user", content: "hi" }], [], undefined, delta => deltas.push(delta));
        expect(deltas.join("")).toBe(header + "[redacted] tail");
        expect(result.content).toBe(header + "[redacted] tail");
        expect(deltas.length).toBeGreaterThan(1);
        expect(result.usage?.totalTokens).toBe(5);
        expect(JSON.parse(send.mock.calls[0][1]!.body as string).stream).toBe(true);
    });
});
