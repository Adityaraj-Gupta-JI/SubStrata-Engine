import { ModelRegistry } from "./registry";
import { ApiError, badRequest, json, notFound, unavailable } from "../errors";
import { workspaceAccess } from "../metadata";
import { uuid } from "../validation";
import { defaultDatabaseServices, type DatabaseServices } from "../database/gateway";
import { OpenRouterProvider, modelId, validateKey } from "./openrouter";
import { aiKeyStore, type UserCredentialStore } from "./credentials";
import type { AIProvider } from "./contracts";
import { conversationAccess, conversationMessages, publicConversation, type ConversationRow } from "./conversations";
import { runConversation } from "./orchestration";
export interface AIServices {
    provider: AIProvider;
    credentials: (env: Env) => UserCredentialStore;
}
const defaults: AIServices = { provider: new OpenRouterProvider(), credentials: aiKeyStore };
interface CredentialRow {
    credential_reference: string;
    status: string;
    default_model: string | null;
}
async function body(request: Request): Promise<Record<string, unknown>> {
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
        throw badRequest("JSON body required.");
    const reader = request.body?.getReader();
    if (!reader)
        throw badRequest("JSON body required.");
    let size = 0;
    const parts: Uint8Array[] = [];
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.length;
        if (size > 20000) {
            await reader.cancel();
            throw badRequest("Request too large.");
        }
        parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
        bytes.set(p, offset);
        offset += p.length;
    }
    try {
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error();
        return value as Record<string, unknown>;
    }
    catch {
        throw badRequest("Invalid JSON body.");
    }
}
function only(value: Record<string, unknown>, keys: string[]) {
    if (Object.keys(value).some(key => !keys.includes(key)))
        throw badRequest("Unexpected request field.");
}
export async function aiRoute(request: Request, env: Env, userId: string, requestId: string, databases?: DatabaseServices, services: AIServices = defaults, context?: ExecutionContext): Promise<Response | null> {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const credential = () => env.METADATA.prepare("SELECT credential_reference,status,default_model FROM ai_provider_credentials WHERE user_id=? AND provider='openrouter'").bind(userId).first<CredentialRow>();
    const runtimeKey = async () => {
        const row = await credential();
        if (!row || row.status !== "active")
            throw new ApiError(409, "AI_SETUP_REQUIRED", "Add and validate your OpenRouter key in AI settings.");
        return { key: await services.credentials(env).read(userId, row.credential_reference), row };
    };
    if (path === "/api/v1/ai/providers/openrouter") {
        if (method === "GET") {
            const row = await credential();
            let storageConfigured = true;
            try {
                services.credentials(env);
            }
            catch {
                storageConfigured = false;
            }
            return json({ data: { provider: "openrouter", configured: row?.status === "active", storageConfigured, defaultModel: row?.default_model ?? null }, requestId }, 200, requestId);
        }
        const value = await body(request);
        only(value, ["key", "action", "model"]);
        if (method !== "POST")
            throw notFound();
        if (value.action === "revoke") {
            const row = await credential();
            if (row?.status === "active") {
                await env.METADATA.prepare("UPDATE ai_provider_credentials SET status='revoked',updated_at=datetime('now') WHERE user_id=?").bind(userId).run();
                await services.credentials(env).revoke(userId, row.credential_reference);
            }
            return json({ data: { revoked: true }, requestId }, 200, requestId);
        }
        if (value.action === "preferences") {
            if (!modelId(value.model))
                throw badRequest("Choose a valid model.");
            const { key, row } = await runtimeKey();
            const models = await services.provider.models(key, request.signal);
            if (!models.some(m => m.id === value.model))
                throw badRequest("Model is not available.");
            await env.METADATA.prepare("UPDATE ai_provider_credentials SET default_model=?,updated_at=datetime('now') WHERE user_id=? AND credential_reference=? AND status='active'").bind(value.model, userId, row.credential_reference).run();
            return json({ data: { defaultModel: value.model }, requestId }, 200, requestId);
        }
        validateKey(value.key);
        const store = services.credentials(env);
        await services.provider.validate(value.key, request.signal);
        if (value.action === "validate")
            return json({ data: { valid: true }, requestId }, 200, requestId);
        if (value.action !== undefined && value.action !== "save")
            throw badRequest("Invalid action.");
        const reference = `ai-openrouter/${crypto.randomUUID()}`;
        await store.put(userId, reference, value.key);
        await env.METADATA.prepare("INSERT INTO ai_provider_credentials(user_id,credential_reference,status) VALUES (?,?,'active') ON CONFLICT(user_id) DO UPDATE SET credential_reference=excluded.credential_reference,status='active',verified_at=datetime('now'),updated_at=datetime('now')").bind(userId, reference).run();
        return json({ data: { configured: true, validated: true }, requestId }, 200, requestId);
    }
    if (path === "/api/v1/ai/models" && method === "GET") {
        const { key } = await runtimeKey();
        return json({ data: await new ModelRegistry(services.provider).list(key, request.signal), requestId }, 200, requestId);
    }
    const match = path.match(/^\/api\/v1\/workspaces\/([^/]+)\/ai\/(conversations|activity)(?:\/([^/]+))?(?:\/(messages))?$/);
    if (!match)
        return null;
    const workspace = uuid(match[1]);
    const access = await workspaceAccess(env.METADATA, workspace, userId);
    if (match[2] === "activity" && method === "GET") {
        const result = await env.METADATA.prepare("SELECT id,action,resource_type,resource_id,outcome,created_at FROM audit_events WHERE organization_id=? AND actor_user_id=? AND ((resource_type='workspace' AND resource_id=?) OR (resource_type='database' AND resource_id IN (SELECT id FROM managed_tenant_databases WHERE workspace_id=?))) ORDER BY created_at DESC,id LIMIT 20").bind(access.workspace.organization_id, userId, workspace, workspace).all();
        return json({ data: result.results, requestId }, 200, requestId);
    }
    if (!match[3]) {
        if (method === "GET") {
            const rows = await env.METADATA.prepare("SELECT * FROM ai_conversations WHERE user_id=? AND workspace_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 50").bind(userId, workspace).all<ConversationRow>();
            return json({ data: rows.results.map(publicConversation), requestId }, 200, requestId);
        }
        if (method !== "POST")
            throw notFound();
        const value = await body(request);
        only(value, ["model", "databaseId", "title", "allowRows"]);
        const { row, key } = await runtimeKey();
        const model = value.model ?? row.default_model;
        if (!modelId(model))
            throw badRequest("Choose a model first.");
        if (!(await services.provider.models(key, request.signal)).some(m => m.id === model))
            throw badRequest("Model is not available.");
        const database = value.databaseId ?? null;
        if (database !== null && (typeof database !== "string" || !/^[a-f0-9]{32}$/.test(database)))
            throw badRequest("Invalid database ID.");
        if (database && !await env.METADATA.prepare("SELECT id FROM managed_tenant_databases WHERE id=? AND workspace_id=? AND state='active'").bind(database, workspace).first())
            throw notFound();
        if (value.allowRows !== undefined && typeof value.allowRows !== "boolean")
            throw badRequest("Invalid row-context permission.");
        const title = typeof value.title === "string" ? value.title.slice(0, 100) : "New conversation", id = crypto.randomUUID();
        if (title.includes(key))
            throw badRequest("Do not include credentials in a conversation title.");
        await env.METADATA.prepare("INSERT INTO ai_conversations(id,workspace_id,user_id,database_id,title,model,allow_rows) VALUES (?,?,?,?,?,?,?)").bind(id, workspace, userId, database, title, model, value.allowRows === true ? 1 : 0).run();
        return json({ data: publicConversation(await conversationAccess(env.METADATA, workspace, userId, id)), requestId }, 201, requestId);
    }
    const row = await conversationAccess(env.METADATA, workspace, userId, uuid(match[3]));
    if (method === "GET" && !match[4])
        return json({ data: { conversation: publicConversation(row), messages: await conversationMessages(env.METADATA, row.id) }, requestId }, 200, requestId);
    if (method === "POST" && match[4] === "messages") {
        const value = await body(request);
        only(value, ["content", "stream"]);
        if (value.stream !== undefined && typeof value.stream !== "boolean")
            throw badRequest("Invalid stream option.");
        if (typeof value.content !== "string" || !value.content.trim() || value.content.length > 6000)
            throw badRequest("Enter a message of 1–6000 characters.");
        const { key } = await runtimeKey();
        await env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) VALUES (?,?,?,'ai.turn','workspace',?,'requested',?)").bind(crypto.randomUUID(), access.workspace.organization_id, userId, workspace, requestId).run();
        const auditOutcome = async (status: string) => env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) VALUES (?,?,?,'ai.turn','workspace',?,?,?)").bind(crypto.randomUUID(), access.workspace.organization_id, userId, workspace, status, requestId).run();
        const run = async (signal: AbortSignal, onDelta?: (text: string) => void) => {
            const result = await runConversation(env, services.provider, databases ?? defaultDatabaseServices(env, request), row, key, value.content as string, requestId, signal, onDelta);
            await auditOutcome(result.status);
            return result;
        };
        if (value.stream === true) {
            const abort = new AbortController(), signal = AbortSignal.any([request.signal, abort.signal]);
            const encoder = new TextEncoder();
            let cancelled = false;
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    const event = (type: string, data: unknown) => { if (cancelled)
                        return; try {
                        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
                    }
                    catch {
                        cancelled = true;
                        abort.abort();
                    } };
                    event("status", { message: "Preparing authorized context" });
                    const operation = (async () => { try {
                        const result = await run(signal, text => event("delta", { text }));
                        event("complete", result);
                    }
                    catch (error) {
                        event("error", { code: error instanceof ApiError ? error.code : "AI_UNAVAILABLE", message: error instanceof ApiError ? error.publicMessage : "AI request could not be completed." });
                    }
                    finally {
                        if (!cancelled)
                            controller.close();
                    } })();
                    context?.waitUntil(operation);
                    return operation;
                },
                cancel() { cancelled = true; abort.abort(); }
            });
            return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Request-Id": requestId } });
        }
        return json({ data: await run(request.signal), requestId }, 200, requestId);
    }
    throw notFound();
}
