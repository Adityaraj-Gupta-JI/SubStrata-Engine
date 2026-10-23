import { ApiError, badRequest, json, notFound, unavailable } from '../errors';
import { workspaceAccess } from '../metadata';
import { fields, jsonBody } from '../http';
import { uuid } from '../validation';
import { dataSource } from '../database/sources';
import { defaultDatabaseServices, type DatabaseServices } from '../database/gateway';
import { defaultAIServices, type AIServices } from '../ai/routes';
import { modelId } from '../ai/openrouter';
import { runConversation } from '../ai/orchestration';
import { conversationAccess, conversationMessages } from '../ai/conversations';
import { agentTemplates, type AgentTemplate } from './templates';
import type { ExecutionStep } from '../ai/contracts';
interface AgentRow {
    id: string;
    workspace_id: string;
    user_id: string;
    name: string;
    template: AgentTemplate;
    instructions: string;
    model: string;
    database_id: string | null;
    max_steps: number;
    deadline_seconds: number;
    allow_rows: number;
    deleted_at: string | null;
}
interface RunRow {
    id: string;
    agent_id: string;
    workspace_id: string;
    user_id: string;
    conversation_id: string;
    goal: string;
    status: string;
    deadline_at: number;
    error_code: string | null;
    usage_json: string | null;
    created_at: string;
    finished_at: string | null;
}
const publicAgent = (a: AgentRow) => ({ id: a.id, name: a.name, template: a.template, instructions: a.instructions, model: a.model, databaseId: a.database_id, maxSteps: a.max_steps, deadlineSeconds: a.deadline_seconds, allowRows: a.allow_rows === 1 });
const publicRun = (r: RunRow) => ({ id: r.id, agentId: r.agent_id, conversationId: r.conversation_id, goal: r.goal, status: r.status, errorCode: r.error_code, usage: r.usage_json ? JSON.parse(r.usage_json) : null, createdAt: r.created_at, finishedAt: r.finished_at });
export async function agentRoute(request: Request, env: Env, user: string, requestId: string, databases?: DatabaseServices, services: AIServices = defaultAIServices, context?: ExecutionContext): Promise<Response | null> {
    const match = new URL(request.url).pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/(agents|agent-runs)(?:\/([^/]+))?(?:\/(run|cancel))?$/);
    if (!match)
        return null;
    const workspace = uuid(match[1]), access = await workspaceAccess(env.METADATA, workspace, user);
    const audit = async (action: string, outcome: string) => env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) VALUES (?,?,?,?,'workspace',?,?,?)").bind(crypto.randomUUID(), access.workspace.organization_id, user, `agent.${action}`, workspace, outcome, requestId).run();
    if (match[2] === 'agent-runs') {
        // A foreground crash never becomes a fabricated success or an automatic retry.
        await env.METADATA.prepare("UPDATE agent_runs SET status='interrupted',error_code='AGENT_INTERRUPTED',finished_at=datetime('now') WHERE workspace_id=? AND user_id=? AND status IN ('running','cancelling') AND deadline_at < ?").bind(workspace, user, Date.now() - 10000).run();
        if (!match[3] && request.method === 'GET') {
            const rows = await env.METADATA.prepare('SELECT * FROM agent_runs WHERE workspace_id=? AND user_id=? ORDER BY rowid DESC LIMIT 50').bind(workspace, user).all<RunRow>();
            return json({ data: rows.results.map(publicRun), requestId }, 200, requestId);
        }
        const run = await env.METADATA.prepare('SELECT * FROM agent_runs WHERE id=? AND workspace_id=? AND user_id=?').bind(uuid(match[3]), workspace, user).first<RunRow>();
        if (!run)
            throw notFound();
        if (request.method === 'POST' && match[4] === 'cancel') {
            await env.METADATA.prepare("UPDATE agent_runs SET status='cancelling' WHERE id=? AND status='running'").bind(run.id).run();
            await audit('cancel', 'requested');
            return json({ data: { cancellationRequested: true }, requestId }, 200, requestId);
        }
        if (request.method === 'GET' && !match[4]) {
            const steps = await env.METADATA.prepare('SELECT sequence,detail_json FROM agent_run_steps WHERE run_id=? ORDER BY sequence').bind(run.id).all<{
                sequence: number;
                detail_json: string;
            }>();
            const messages = await conversationMessages(env.METADATA, run.conversation_id);
            return json({ data: { run: publicRun(run), steps: steps.results.map(s => ({ sequence: s.sequence, ...JSON.parse(s.detail_json) })), messages }, requestId }, 200, requestId);
        }
        throw notFound();
    }
    if (!match[3] && request.method === 'GET') {
        const rows = await env.METADATA.prepare('SELECT * FROM agent_definitions WHERE workspace_id=? AND user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC').bind(workspace, user).all<AgentRow>();
        return json({ data: rows.results.map(publicAgent), templates: Object.entries(agentTemplates).map(([id, t]) => ({ id, name: t.name, goal: t.goal, tools: t.tools })), requestId }, 200, requestId);
    }
    const old = match[3] ? await env.METADATA.prepare('SELECT * FROM agent_definitions WHERE id=? AND workspace_id=? AND user_id=? AND deleted_at IS NULL').bind(uuid(match[3]), workspace, user).first<AgentRow>() : null;
    if (match[3] && !old)
        throw notFound();
    if (request.method !== 'POST')
        throw notFound();
    const value = await jsonBody(request);
    if (match[4] === 'run') {
        fields(value, ['goal']);
        if (!old || typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > 4000)
            throw badRequest('Enter an agent goal of 1–4000 characters.');
        const credential = await env.METADATA.prepare("SELECT credential_reference FROM ai_provider_credentials WHERE user_id=? AND status='active'").bind(user).first<{
            credential_reference: string;
        }>();
        if (!credential)
            throw new ApiError(409, 'AI_SETUP_REQUIRED', 'Configure your OpenRouter key in AI settings.');
        const key = await services.credentials(env).read(user, credential.credential_reference);
        if (old.database_id) {
            const source = await dataSource(env.METADATA, old.database_id, workspace, access.workspace.organization_id);
            if (source.state !== 'active')
                throw badRequest('Select an active database.');
        }
        const id = crypto.randomUUID(), conversationId = crypto.randomUUID(), source = old.database_id ? await dataSource(env.METADATA, old.database_id, workspace, access.workspace.organization_id) : null;
        await audit('run', 'requested');
        await env.METADATA.batch([
            env.METADATA.prepare('INSERT INTO ai_conversations(id,workspace_id,user_id,database_id,external_database_id,title,model,allow_rows) VALUES (?,?,?,?,?,?,?,?)').bind(conversationId, workspace, user, source?.kind === 'external' ? null : old.database_id, source?.kind === 'external' ? old.database_id : null, old.name, old.model, old.allow_rows),
            env.METADATA.prepare("INSERT INTO agent_runs(id,agent_id,workspace_id,user_id,conversation_id,goal,configuration_json,status,deadline_at) VALUES (?,?,?,?,?,?,?,'running',?)").bind(id, old.id, workspace, user, conversationId, value.goal.replaceAll(key, '[redacted]'), JSON.stringify(publicAgent(old)), Date.now() + old.deadline_seconds * 1000),
        ]);
        const abort = new AbortController(), signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(old.deadline_seconds * 1000)]);
        const check = async () => { if (signal.aborted)
            throw new ApiError(499, 'AI_CANCELLED', 'Agent execution cancelled or deadline reached.'); await workspaceAccess(env.METADATA, workspace, user); const run = await env.METADATA.prepare('SELECT status,deadline_at FROM agent_runs WHERE id=?').bind(id).first<{
            status: string;
            deadline_at: number;
        }>(); if (!run || run.status !== 'running') {
            abort.abort();
            throw new ApiError(499, 'AI_CANCELLED', 'Agent cancellation requested.');
        } if (Date.now() >= run.deadline_at) {
            abort.abort();
            throw new ApiError(408, 'AGENT_DEADLINE', 'Agent deadline reached.');
        } };
        const encoder = new TextEncoder();
        let cancelled = false, sequence = 0;
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
                const event = (type: string, data: unknown) => { if (cancelled)
                    return; try {
                    controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
                }
                catch {
                    cancelled = true;
                    abort.abort();
                } };
                event('status', { runId: id, status: 'running' });
                const step = async (detail: ExecutionStep) => { try {
                    await env.METADATA.prepare('INSERT INTO agent_run_steps(id,run_id,sequence,detail_json) VALUES (?,?,?,?)').bind(crypto.randomUUID(), id, ++sequence, JSON.stringify(detail)).run();
                    event('step', { sequence, ...detail });
                }
                catch {
                    throw new ApiError(503, 'AI_TRACE_UNAVAILABLE', 'Execution trace storage is unavailable.');
                } };
                const operation = (async () => {
                    let status = 'failed', code: string | null = null;
                    try {
                        const row = await conversationAccess(env.METADATA, workspace, user, conversationId);
                        const result = await runConversation(env, services.provider, databases ?? defaultDatabaseServices(env, request), row, key, value.goal as string, requestId, signal, text => event('delta', { text }), { maxSteps: old.max_steps, allowedTools: [...agentTemplates[old.template].tools], instructions: agentTemplates[old.template].goal + '\n' + old.instructions, check, onStep: step });
                        status = result.status;
                        const last = result.messages.filter(m => m.role === 'assistant').at(-1);
                        code = last?.errorCode ?? null;
                        await step({ kind: 'final', name: 'agent', status, elapsedMs: 0, ...(code ? { errorCode: code } : {}) });
                        await env.METADATA.prepare("UPDATE agent_runs SET status=?,error_code=?,usage_json=?,finished_at=datetime('now') WHERE id=? AND status IN ('running','cancelling')").bind(status, code, last?.usage ? JSON.stringify(last.usage) : null, id).run();
                        await audit('run', status);
                        event('complete', { runId: id, status, conversationId, messages: result.messages });
                    }
                    catch (error) {
                        code = error instanceof ApiError ? error.code : 'AGENT_UNAVAILABLE';
                        status = signal.aborted ? 'cancelled' : 'failed';
                        await env.METADATA.prepare("UPDATE agent_runs SET status=?,error_code=?,finished_at=datetime('now') WHERE id=? AND status IN ('running','cancelling')").bind(status, code, id).run();
                        event('error', { code, message: error instanceof ApiError ? error.publicMessage : 'Agent execution failed.' });
                    }
                    finally {
                        if (!cancelled)
                            controller.close();
                    }
                })();
                context?.waitUntil(operation);
                return operation;
            }, cancel() { cancelled = true; abort.abort(); } });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Request-Id': requestId } });
    }
    fields(value, ['action', 'name', 'template', 'instructions', 'model', 'databaseId', 'maxSteps', 'deadlineSeconds', 'allowRows']);
    if (value.action === 'delete') {
        if (!old)
            throw notFound();
        await env.METADATA.prepare("UPDATE agent_definitions SET deleted_at=datetime('now') WHERE id=?").bind(old.id).run();
        await audit('delete', 'success');
        return json({ data: { deleted: true }, requestId }, 200, requestId);
    }
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.template !== 'string' || !Object.hasOwn(agentTemplates, value.template) || typeof value.instructions !== 'string' || value.instructions.length > 2000 || !modelId(value.model) || !Number.isInteger(value.maxSteps) || Number(value.maxSteps) < 1 || Number(value.maxSteps) > 8 || !Number.isInteger(value.deadlineSeconds) || Number(value.deadlineSeconds) < 10 || Number(value.deadlineSeconds) > 120 || typeof value.allowRows !== 'boolean')
        throw badRequest('Invalid agent configuration. Steps: 1–8. Deadline: 10–120 seconds.');
    const database = value.databaseId ?? null;
    if (database !== null && (typeof database !== 'string' || !/^[a-f0-9]{32}$/.test(database)))
        throw badRequest('Invalid database.');
    if (database)
        await dataSource(env.METADATA, database as string, workspace, access.workspace.organization_id);
    const id = old?.id ?? crypto.randomUUID();
    await env.METADATA.prepare('INSERT INTO agent_definitions(id,workspace_id,user_id,name,template,instructions,model,database_id,max_steps,deadline_seconds,allow_rows) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,template=excluded.template,instructions=excluded.instructions,model=excluded.model,database_id=excluded.database_id,max_steps=excluded.max_steps,deadline_seconds=excluded.deadline_seconds,allow_rows=excluded.allow_rows,updated_at=datetime(\'now\')').bind(id, workspace, user, value.name.trim(), value.template, value.instructions, value.model, database, value.maxSteps, value.deadlineSeconds, value.allowRows ? 1 : 0).run();
    await audit(old ? 'edit' : 'create', 'success');
    return json({ data: { id, saved: true }, requestId }, old ? 200 : 201, requestId);
}
