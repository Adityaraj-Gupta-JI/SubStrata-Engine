"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { cp5Api, type Agent, type AgentRun, type AgentStep, type AgentTemplate } from '@/lib/api/cp5';
import type { AIMessage } from '@/lib/api/ai';
import { aiButton, aiError, aiInput, aiPanel, ModelSelector, useAIProvider } from './AIProviderState';
import { DatabaseSelector, useDatabaseWorkspace } from './DatabaseWorkspace';
export function AgentsWorkspace() { const workspace = useDatabaseWorkspace(); return <AgentsBody key={workspace.workspaceId} workspace={workspace}/>; }
function AgentsBody({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    const provider = useAIProvider(), { workspaceId, token } = workspace;
    const [agents, setAgents] = useState<Agent[]>([]), [templates, setTemplates] = useState<AgentTemplate[]>([]), [runs, setRuns] = useState<AgentRun[]>([]), [selected, setSelected] = useState(''), [name, setName] = useState(''), [template, setTemplate] = useState('schema-analyst'), [instructions, setInstructions] = useState(''), [model, setModel] = useState(''), [maxSteps, setMaxSteps] = useState(3), [deadline, setDeadline] = useState(60), [allowRows, setAllowRows] = useState(false), [goal, setGoal] = useState(''), [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [steps, setSteps] = useState<AgentStep[]>([]), [messages, setMessages] = useState<AIMessage[]>([]), [delta, setDelta] = useState(''), [runId, setRunId] = useState('');
    const controller = useRef<AbortController | null>(null), activeRun = useRef('');
    useEffect(() => () => controller.current?.abort(), []);
    const refresh = useCallback(async () => { if (!workspaceId) {
        setLoading(false);
        return;
    } try {
        const auth = await token(), [definitions, history] = await Promise.all([cp5Api.agents(workspaceId, auth), cp5Api.runs(workspaceId, auth)]);
        setAgents(definitions.data);
        setTemplates(definitions.templates);
        setRuns(history.data);
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setLoading(false);
    } }, [workspaceId, token]);
    useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
    function edit(agent?: Agent) { setSelected(agent?.id ?? ''); setName(agent?.name ?? ''); setTemplate(agent?.template ?? templates[0]?.id ?? 'schema-analyst'); setInstructions(agent?.instructions ?? ''); setModel(agent?.model ?? provider.state?.defaultModel ?? ''); workspace.setDatabaseId(agent?.databaseId ?? ''); setMaxSteps(agent?.maxSteps ?? 3); setDeadline(agent?.deadlineSeconds ?? 60); setAllowRows(agent?.allowRows ?? false); setError(''); setNotice(''); }
    async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try {
        const result = await cp5Api.saveAgent(workspaceId, await token(), { name, template, instructions, model, databaseId: workspace.databaseId || null, maxSteps, deadlineSeconds: deadline, allowRows }, selected || undefined);
        setSelected(result.data.id);
        await refresh();
        setNotice('Agent configuration saved. Run uses this saved configuration.');
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setBusy(false);
    } }
    async function remove() { if (!selected)
        return; setBusy(true); setError(''); try {
        await cp5Api.deleteAgent(workspaceId, await token(), selected);
        edit();
        await refresh();
        setNotice('Agent deleted. Existing execution history is retained.');
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setBusy(false);
    } }
    async function inspect(id: string) { setBusy(true); setError(''); try {
        const result = (await cp5Api.run(workspaceId, await token(), id)).data;
        setRunId(id);
        activeRun.current = id;
        setSteps(result.steps);
        setMessages(result.messages);
        setDelta('');
        setNotice(`Persisted status: ${result.run.status}${result.run.errorCode ? ` (${result.run.errorCode})` : ''}`);
        setGoal(result.run.goal);
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setBusy(false);
    } }
    async function run(e: FormEvent) { e.preventDefault(); if (!selected || running)
        return; setRunning(true); setError(''); setNotice('Starting foreground execution…'); setMessages([]); setSteps([]); setDelta(''); setRunId(''); activeRun.current = ''; const abort = new AbortController(); controller.current = abort; try {
        const result = await cp5Api.runAgent(workspaceId, await token(), selected, goal, text => setDelta(value => value + text), abort.signal, (type, data) => { if (!data || typeof data !== 'object')
            return; if (type === 'status' && 'runId' in data && typeof data.runId === 'string') {
            activeRun.current = data.runId;
            setRunId(data.runId);
            setNotice('Running… Keep this page open.');
        } if (type === 'step')
            setSteps(value => [...value, data as AgentStep]); });
        setMessages(result.messages);
        setDelta('');
        setNotice(`Execution ${result.status}.`);
    }
    catch (e) {
        setError(abort.signal.aborted ? 'Execution stream stopped. Refresh persisted status to confirm cancellation.' : aiError(e));
    }
    finally {
        controller.current = null;
        setRunning(false);
        await refresh();
    } }
    async function cancel() { if (!activeRun.current)
        return; setError(''); try {
        await cp5Api.cancel(workspaceId, await token(), activeRun.current);
        controller.current?.abort();
        setNotice('Cancellation requested. Refresh persisted status to confirm termination.');
        await refresh();
    }
    catch (e) {
        setError(aiError(e));
    } }
    const saved = agents.find(a => a.id === selected);
    return <div className="space-y-6"><header><h1 className="text-2xl font-bold">Agents</h1><p className="text-[#8b9bb4]">Foreground workflows using your workspace permissions. Read-only tools; no autonomous writes or DDL.</p></header>{!workspaceId && <p>Select a workspace in the sidebar.</p>}{loading && <p role="status">Loading agents…</p>}{(error || provider.error) && <p role="alert" className="text-[#ff8da8]">{error || provider.error}</p>}{notice && <p role="status">{notice}</p>}
 <section className={aiPanel}><h2 className="font-bold">Agent configuration</h2><label className="block">Saved agent<select className={aiInput} value={selected} disabled={busy || running} onChange={e => edit(agents.find(a => a.id === e.target.value))}><option value="">New agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><form onSubmit={e => void save(e)} className="space-y-3"><fieldset disabled={busy || running || !workspaceId} className="space-y-3"><label className="block">Name<input className={aiInput} maxLength={100} required value={name} onChange={e => setName(e.target.value)}/></label><label className="block">Template<select className={aiInput} value={template} onChange={e => setTemplate(e.target.value)}>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><p className="text-sm">{templates.find(t => t.id === template)?.goal}</p><ModelSelector models={provider.models} value={model} onChange={setModel}/>{!provider.state?.configured && <p>Configure OpenRouter in AI settings before running an agent.</p>}<DatabaseSelector workspace={workspace}/><label className="block">Additional instructions<textarea className={aiInput} value={instructions} maxLength={2000} onChange={e => setInstructions(e.target.value)}/></label><div className="flex flex-wrap gap-4"><label>Maximum model steps (1–8)<input className={aiInput} type="number" min={1} max={8} required value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))}/></label><label>Deadline in seconds (10–120)<input className={aiInput} type="number" min={10} max={120} required value={deadline} onChange={e => setDeadline(Number(e.target.value))}/></label></div><label className="flex gap-2"><input type="checkbox" checked={allowRows} onChange={e => setAllowRows(e.target.checked)}/>Allow bounded permitted row previews to be sent to OpenRouter</label><button className={aiButton} disabled={!model}>{busy ? 'Saving…' : 'Save configuration'}</button><button className={aiButton} type="button" disabled={!selected} onClick={() => void remove()}>Delete agent</button></fieldset></form></section>
 <section className={aiPanel}><h2 className="font-bold">Run saved agent</h2>{saved && <p>Saved: {saved.name} · {saved.maxSteps} model steps · {saved.deadlineSeconds}s · Database {workspace.list?.data.find(d => d.id === saved.databaseId)?.name ?? (saved.databaseId ? 'Unavailable' : 'None')}</p>}<form className="space-y-3" onSubmit={e => void run(e)}><label className="block">Goal<textarea className={aiInput} required maxLength={4000} value={goal} disabled={running} onChange={e => setGoal(e.target.value)}/></label><div className="flex gap-3"><button className={aiButton} disabled={busy || running || !selected || !provider.state?.configured}>Run / retry as new execution</button><button type="button" className={aiButton} disabled={!runId} onClick={() => void cancel()}>Request cancellation</button></div></form>{delta && <pre aria-live="polite" className="whitespace-pre-wrap break-words">{delta}</pre>}{messages.map(m => <article key={m.id}><h3 className="font-bold">{m.role} · {m.status}</h3><p className="whitespace-pre-wrap break-words">{m.content}</p>{m.usage && <p>{m.usage.totalTokens} tokens</p>}{m.proposedSql && <p>Read-only SQL proposal. Review it in Chat or SQL before execution.</p>}</article>)}<h3 className="font-bold">Step trace</h3>{!steps.length && <p>No execution steps loaded.</p>}<ol className="space-y-2">{steps.map(s => <li key={s.sequence}>{s.sequence}. {s.kind} · {s.name} · {s.status} · {s.elapsedMs}ms{s.usage ? ` · ${s.usage.totalTokens} tokens` : ''}{s.errorCode ? ` · ${s.errorCode}` : ''}</li>)}</ol></section>
 <section className={aiPanel}><h2 className="font-bold">Execution history</h2><button className={aiButton} disabled={running || busy} onClick={() => void refresh()}>Refresh persisted status</button>{!runs.length && <p>No executions yet.</p>}{runs.map(r => <div className="flex flex-wrap items-center gap-3 border-t border-[#2a3047] pt-2" key={r.id}><p className="break-all">{r.goal} · {r.status} · {r.createdAt}{r.errorCode ? ` · ${r.errorCode}` : ''}</p><button className={aiButton} disabled={running || busy} onClick={() => void inspect(r.id)}>View trace / recover goal</button></div>)}</section></div>;
}
