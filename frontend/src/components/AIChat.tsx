"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { aiApi, type AIMessage, type Conversation } from "@/lib/api/ai";
import { RouteShell } from "./RouteShell";
import { DatabaseSelector, useDatabaseWorkspace } from "./DatabaseWorkspace";
import { aiButton, aiError, aiInput, aiPanel, ModelSelector, useAIProvider } from "./AIProviderState";
export function AIChatWorkspace() { const workspace = useDatabaseWorkspace(); return <RouteShell title="AI chat" description="User-owned conversations, authorized database tools and SQL proposals. Generated SQL is never executed automatically."><AIChat key={workspace.workspaceId} workspace={workspace}/></RouteShell>; }
function AIChat({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    const { workspaceId, token, setDatabaseId } = workspace;
    const provider = useAIProvider(), router = useRouter();
    const [conversations, setConversations] = useState<Conversation[]>([]), [current, setCurrent] = useState<Conversation | null>(null), [messages, setMessages] = useState<AIMessage[]>([]), [content, setContent] = useState(""), [model, setModel] = useState(""), [allowRows, setAllowRows] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [streamText, setStreamText] = useState("");
    const controller = useRef<AbortController | null>(null), alive = useRef(true), selection = useRef(0);
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
    const refresh = useCallback(async () => {
        if (!workspaceId)
            return;
        try {
            const result = await aiApi.list(workspaceId, await token());
            if (alive.current)
                setConversations(result.data);
        }
        catch (error) {
            if (alive.current)
                setError(aiError(error));
        }
    }, [workspaceId, token]);
    useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
    const open = useCallback(async (id: string) => {
        const generation = ++selection.current;
        setBusy(true);
        setError("");
        try {
            const result = await aiApi.get(workspaceId, id, await token());
            if (alive.current && selection.current === generation) {
                setCurrent(result.data.conversation);
                setMessages(result.data.messages);
                if (result.data.conversation.databaseId)
                    setDatabaseId(result.data.conversation.databaseId);
                window.history.replaceState(null,"",`#${new URLSearchParams({conversation:id})}`);
            }
        }
        catch (error) {
            if (alive.current && selection.current === generation) {
                setError(aiError(error));
                setCurrent(null);setMessages([]);
            }
        }
        finally {
            if (alive.current && selection.current === generation)
                setBusy(false);
        }
    }, [workspaceId, token, setDatabaseId]);
    useEffect(()=>{const restore=()=>{const id=new URLSearchParams(window.location.hash.slice(1)).get("conversation");if(id&&workspaceId)void open(id);};restore();window.addEventListener("hashchange",restore);return()=>window.removeEventListener("hashchange",restore);},[workspaceId,open]);
    function newConversation() { window.history.replaceState(null,"",window.location.pathname); setCurrent(null); setMessages([]); setNotice(""); setError(""); setContent(""); }
    async function send(event?: FormEvent) {
        event?.preventDefault();
        if (!content.trim() || busy)
            return;
        setBusy(true);
        setError("");
        setNotice("");
        setStreamText("");
        const request = content;
        controller.current = new AbortController();
        try {
            const auth = await token();
            let selected = current;
            if (!selected) {
                selected = (await aiApi.create(workspaceId, auth, { model: model || provider.state?.defaultModel || "", databaseId: workspace.database?.state === "active" ? workspace.database.id : null, title: request.slice(0, 90), allowRows })).data;
                if (!alive.current)
                    return;
                setCurrent(selected);
                window.history.replaceState(null,"",`#${new URLSearchParams({conversation:selected.id})}`);
            }
            const result = await aiApi.sendStream(workspaceId, selected.id, auth, request, text => { if (alive.current)
                setStreamText(value => (value + text).slice(0, 60000)); }, controller.current.signal);
            if (alive.current) {
                setMessages(result.messages);
                setContent("");
                setNotice(result.status === "completed" ? "OpenRouter response saved." : "Request did not complete; see the recorded error below.");
                await refresh();
            }
        }
        catch (error) {
            if (alive.current) {
                setError(aiError(error));
                setNotice("If you cancelled, refresh the conversation to check the server's final state before retrying.");
            }
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    }
    function sendSQL(sql: string) {
        if (!current?.databaseId)
            return;
        workspace.setSqlDraft({ workspaceId: workspaceId, databaseId: current.databaseId, sql, conversationId: current.id });
        workspace.setDatabaseId(current.databaseId);
        router.push("/sql-editor");
    }
    return <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]"><aside className={aiPanel}><button className={aiButton} disabled={busy} onClick={newConversation}>New conversation</button><button className={aiButton} disabled={busy || !workspaceId} onClick={() => void refresh()}>Refresh history</button><Link className={aiButton} href="/agents">Configure and launch an authorized agent</Link><nav aria-label="Conversations" className="space-y-2">{!conversations.length && <p className="text-sm text-[#8b9bb4]">No conversations in this workspace.</p>}{conversations.map(c => <button className={`${aiButton} w-full break-words text-left`} key={c.id} aria-current={current?.id === c.id ? "true" : undefined} disabled={busy} onClick={() => void open(c.id)}>{c.title}{c.busy ? " · Running" : ""}</button>)}</nav></aside>
    <div className="min-w-0 space-y-4"><div className={aiPanel}><DatabaseSelector workspace={workspace}/><ModelSelector models={provider.models} value={current?.model || model || provider.state?.defaultModel || ""} onChange={setModel} disabled={busy || !!current}/>{current ? <p className="text-sm">Conversation database: {current.databaseId ? workspace.list?.data.find(d => d.id === current.databaseId)?.name || "Unavailable" : "None"}. Start a new conversation to change its model or database.</p> : <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowRows} onChange={e => setAllowRows(e.target.checked)}/>Allow bounded row previews to be sent to OpenRouter</label>}
      {!provider.state?.configured && <p>Configure your key in <Link className="underline" href="/settings/ai">AI settings</Link>.</p>}{provider.state && !provider.state.storageConfigured && <p role="status">Secure AI storage is not configured.</p>}{(error || provider.error) && <p role="alert" className="text-[#ff8da8]">{error || provider.error}</p>}{notice && <p role="status">{notice}</p>}</div>
      {busy && <div role="status" className={aiPanel}><p className="animate-pulse text-sm text-[#00f0ff]">OpenRouter / authorized tools running…</p>{streamText && <pre className="whitespace-pre-wrap break-words text-sm">{streamText}</pre>}<p className="text-xs text-[#8b9bb4]">Streaming draft · Final status and usage appear when the turn is saved.</p></div>}<section aria-label="Conversation messages" aria-live="polite" className={aiPanel}>{!messages.length && <p className="text-[#8b9bb4]">Ask a question, inspect selected database metadata, or request a SQL proposal for human review. Only successful provider responses are labelled completed.</p>}{messages.map(message => <article key={message.id} className="space-y-3 border-b border-[#2a3047] pb-4"><h2 className="font-bold">{message.role === "user" ? "You" : "OpenRouter"} · {message.status}</h2><MessageContent content={message.content}/>{message.proposedSql && <div><p className="text-sm text-[#00f0ff]">SQL proposal · Not executed</p><pre className="overflow-auto whitespace-pre-wrap rounded bg-[#131522] p-3 text-sm">{message.proposedSql}</pre><button className={aiButton} onClick={() => sendSQL(message.proposedSql!)}>Review in SQL editor</button></div>}{message.trace.length > 0 && <details><summary>Tool activity ({message.trace.length})</summary><ul className="text-xs">{message.trace.map((t, i) => <li key={i}>{t.tool} · {t.status} · {t.elapsedMs} ms</li>)}</ul></details>}{message.usage && <p className="text-xs text-[#8b9bb4]">Usage: {message.usage.promptTokens} input + {message.usage.completionTokens} output = {message.usage.totalTokens} tokens</p>}{message.errorCode && <p className="text-xs text-[#ff8da8]">{message.errorCode}</p>}</article>)}</section>
      <form onSubmit={send} className={aiPanel}><label htmlFor="ai-message">Message</label><textarea id="ai-message" rows={4} maxLength={6000} className={aiInput} value={content} disabled={busy} onChange={e => setContent(e.target.value)}/><div className="flex flex-wrap gap-3"><button className={aiButton} disabled={busy || !workspaceId || !content.trim() || !provider.state?.configured || !provider.state.storageConfigured || !(current?.model || model || provider.state.defaultModel)}>{busy ? "Waiting for OpenRouter…" : "Send"}</button>{busy && <button type="button" className={aiButton} onClick={() => controller.current?.abort()}>Cancel request</button>}{current && <button type="button" className={aiButton} disabled={busy} onClick={() => void open(current.id)}>Reload conversation</button>}</div><p className="text-xs text-[#8b9bb4]">OpenRouter output streams when available. Cancellation is forwarded to the provider when the server receives the abort; usage may still be billed.</p></form>
    </div></div>;
}
function MessageContent({ content }: {
    content: string;
}) { return <div className="space-y-2 break-words">{content.split(/(```[\s\S]*?```)/g).map((part, i) => part.startsWith("```") ? <pre key={i} className="overflow-auto whitespace-pre-wrap rounded bg-[#131522] p-3 text-sm">{part.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")}</pre> : <p className="whitespace-pre-wrap text-sm" key={i}>{part}</p>)}</div>; }
