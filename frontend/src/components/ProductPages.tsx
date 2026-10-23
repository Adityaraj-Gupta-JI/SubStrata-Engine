"use client";
import Link from "next/link";
import { UserProfile } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { aiApi, type Activity, type Conversation } from "@/lib/api/ai";
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
    return <RouteShell title="Dashboard" description="Live workspace metadata and your recent activity. Unconfigured services remain explicitly unavailable."><div className={aiPanel}><DatabaseSelector workspace={workspace}/><div className="flex flex-wrap gap-3">{[["/databases", "Databases"], ["/explorer", "Explorer"], ["/sql-editor", "SQL editor"], ["/chat", "AI chat"]].map(([href, label]) => <Link key={href} href={href} className={aiButton}>{label}</Link>)}</div></div><div className="grid gap-4 lg:grid-cols-2"><section className={aiPanel}><h2 className="font-bold">Database status</h2>{workspace.list?.data.map(d => <div key={d.id} className="break-all"><strong>{d.name}</strong><p>{d.state}</p>{d.error && <p>{d.error}</p>}</div>)}{workspace.list && !workspace.list.data.length && <p>No database connected yet.</p>}{workspace.list && !workspace.list.capabilities.provisioningConfigured && <p className="text-sm text-[#8b9bb4]">Provisioning is unavailable until configured by the owner.</p>}</section><section className={aiPanel}><h2 className="font-bold">Recent AI conversations</h2>{!workspaceId ? <p>Select a workspace.</p> : !recent && !error ? <p role="status">Loading recent activity…</p> : null}{recent && !recent.conversations.length && <p>No conversations yet.</p>}{recent?.conversations.slice(0, 5).map(c => <p key={c.id}><Link className="underline" href="/chat">{c.title}</Link> · {c.busy ? "Running" : c.updatedAt}</p>)}{error && <p role="alert">{error}</p>}</section><section className={`${aiPanel} lg:col-span-2`}><h2 className="font-bold">Recent query and provisioning audits</h2><p className="text-xs text-[#8b9bb4]">Your latest workspace events. SQL text is not stored in audit records.</p>{recent?.activity.filter(a => a.action.startsWith("database.")).map(a => <p key={a.id} className="text-sm">{a.created_at} · {a.action} · {a.outcome}</p>)}{recent && !recent.activity.some(a => a.action.startsWith("database.")) && <p>No recorded database activity.</p>}</section></div></RouteShell>;
}
export function AccountWorkspace() { return <RouteShell title="Account" description="Manage your genuine Clerk account and active sessions."><div className="overflow-x-auto"><UserProfile routing="hash"/></div></RouteShell>; }
