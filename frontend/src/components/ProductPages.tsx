"use client";
import Link from "next/link";
import { UserProfile } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { aiApi, type AIMessage, type Activity, type Conversation } from "@/lib/api/ai";
import { platformGet, type Workspace } from "@/lib/api/platform";
import { RouteShell } from "./RouteShell";
import { DatabaseSelector, useDatabaseWorkspace } from "./DatabaseWorkspace";
import { aiButton, aiError, aiPanel } from "./AIProviderState";
export function DashboardWorkspace() {
    const workspace = useDatabaseWorkspace();
    const { workspaceId, token } = workspace;
    const [recent, setRecent] = useState<{
        conversations: Conversation[];
        activity: Activity[];
    } | null>(null), [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            if (!workspaceId)
                return;
            setRecent(null);
            setError("");
            try {
                const auth = await token();
                const [conversations, activity] = await Promise.all([aiApi.list(workspaceId, auth), aiApi.activity(workspaceId, auth)]);
                if (!cancelled)
                    setRecent({ conversations: conversations.data, activity: activity.data });
            }
            catch (error) {
                if (!cancelled)
                    setError(aiError(error));
            }
        })();
        return () => { cancelled = true; };
    }, [workspaceId, token]);
    return <RouteShell title="Dashboard" description="Live workspace metadata and your recent activity. Unconfigured services remain explicitly unavailable."><div className={aiPanel}><DatabaseSelector workspace={workspace}/><div className="flex flex-wrap gap-3">{[["/databases", "Databases"], ["/explorer", "Explorer"], ["/sql-editor", "SQL editor"], ["/chat", "AI chat"]].map(([href, label]) => <Link key={href} href={href} className={aiButton}>{label}</Link>)}</div></div><div className="grid gap-4 lg:grid-cols-2"><section className={aiPanel}><h2 className="font-bold">Database status</h2>{workspace.list?.data.map(d => <div key={d.id} className="break-all"><strong>{d.name}</strong><p>{d.state}</p>{d.error && <p>{d.error}</p>}</div>)}{workspace.list && !workspace.list.data.length && <p>No managed database yet.</p>}{workspace.list && !workspace.list.capabilities.provisioningConfigured && <p className="text-sm text-[#8b9bb4]">Provisioning is unavailable until configured by the owner.</p>}</section><section className={aiPanel}><h2 className="font-bold">Recent AI conversations</h2>{!workspaceId ? <p>Select a workspace.</p> : !recent && !error ? <p role="status">Loading recent activity…</p> : null}{recent && !recent.conversations.length && <p>No conversations yet.</p>}{recent?.conversations.slice(0, 5).map(c => <p key={c.id}><Link className="underline" href="/chat">{c.title}</Link> · {c.busy ? "Running" : c.updatedAt}</p>)}{error && <p role="alert">{error}</p>}</section><section className={`${aiPanel} lg:col-span-2`}><h2 className="font-bold">Recent query and provisioning audits</h2><p className="text-xs text-[#8b9bb4]">Your latest workspace events. SQL text is not stored in audit records.</p>{recent?.activity.filter(a => a.action.startsWith("database.")).map(a => <p key={a.id} className="text-sm">{a.created_at} · {a.action} · {a.outcome}</p>)}{recent && !recent.activity.some(a => a.action.startsWith("database.")) && <p>No recorded database activity.</p>}</section></div></RouteShell>;
}
export function AccessWorkspace() {
    const workspace = useDatabaseWorkspace();
    const { workspaceId, token } = workspace;
    const [access, setAccess] = useState<{
        data: Workspace;
        role: string;
    } | null>(null), [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            setAccess(null);
            setError("");
            if (!workspaceId)
                return;
            try {
                const result = await platformGet<{
                    data: Workspace;
                    role: string;
                }>(`/workspaces/${workspaceId}`, await token());
                if (!cancelled)
                    setAccess(result);
            }
            catch (error) {
                if (!cancelled)
                    setError(aiError(error));
            }
        })();
        return () => { cancelled = true; };
    }, [workspaceId, token]);
    return <RouteShell title="Access settings" description="Permissions are resolved by the backend from verified membership, never browser-provided identity."><div className={aiPanel}>{!workspaceId && <p>Select a workspace in the sidebar.</p>}{error && <p role="alert">{error}</p>}{access && <><h2 className="font-bold">{access.data.name}</h2><p>Your effective workspace role: <strong>{access.role}</strong></p><p>{["owner", "admin"].includes(access.role) ? "You can request provisioning when configured." : "Provisioning requires an owner or admin."} Database access remains read-only.</p><p className="text-sm text-[#8b9bb4]">Member invitations and role changes are not available in this checkpoint. AI conversations and provider credentials are private to their owner.</p></>}</div></RouteShell>;
}
export function AccountWorkspace() { return <RouteShell title="Account" description="Manage your genuine Clerk account and active sessions."><div className="overflow-x-auto"><UserProfile routing="hash"/></div></RouteShell>; }
export function AgentRunsWorkspace() {
    const selection = useRef({ value: 0 });
    const workspace = useDatabaseWorkspace();
    const { workspaceId, token } = workspace;
    const [conversations, setConversations] = useState<Conversation[]>([]), [messages, setMessages] = useState<AIMessage[]>([]), [title, setTitle] = useState(""), [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false;
        const state = selection.current;
        void (async () => {
            setConversations([]);
            setMessages([]);
            setTitle("");
            setError("");
            if (!workspaceId)
                return;
            try {
                const result = await aiApi.list(workspaceId, await token());
                if (!cancelled)
                    setConversations(result.data);
            }
            catch (error) {
                if (!cancelled)
                    setError(aiError(error));
            }
        })();
        return () => { cancelled = true; state.value++; };
    }, [workspaceId, token]);
    async function open(c: Conversation) {
        setError("");
        try {
            const result = await aiApi.get(workspaceId, c.id, await token());
            setTitle(c.title);
            setMessages(result.data.messages.filter(m => m.role === "assistant"));
        }
        catch (error) {
            setError(aiError(error));
        }
    }
    return <RouteShell title="AI runs" description="Recorded conversation turns and bounded tool traces. Background autonomous jobs are not enabled."><div className={aiPanel}>{!workspaceId && <p>Select a workspace.</p>}{workspaceId && !conversations.length && <p>No recorded AI conversations. Start one in chat.</p>}<div className="flex flex-wrap gap-2">{conversations.map(c => <button key={c.id} className={aiButton} onClick={() => void open(c)}>{c.title}{c.busy ? " · Running" : ""}</button>)}</div>{error && <p role="alert">{error}</p>}{title && <h2 className="font-bold">{title}</h2>}{title && !messages.length && <p>No completed or failed assistant turns recorded yet.</p>}{messages.map(m => <article key={m.id} className="space-y-2 border-t border-[#2a3047] pt-3"><p>{m.createdAt} · {m.status}{m.errorCode ? ` · ${m.errorCode}` : ""}</p>{m.usage && <p>{m.usage.totalTokens} reported tokens</p>}<ul>{m.trace.map((t, i) => <li key={i}>{t.tool} · {t.status} · {t.elapsedMs} ms</li>)}</ul></article>)}</div></RouteShell>;
}
