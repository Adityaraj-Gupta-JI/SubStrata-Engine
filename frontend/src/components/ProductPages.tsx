"use client";
import Link from "next/link";
import { UserProfile } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { aiApi, type Activity, type Conversation } from "@/lib/api/ai";
import {cp5Api,type AgentRun} from "@/lib/api/cp5";
import {recordLink} from "@/lib/product-workflow";
import { RouteShell } from "./RouteShell";
import { DatabaseSelector, useDatabaseWorkspace } from "./DatabaseWorkspace";
import { aiButton, aiError, aiPanel } from "./AIProviderState";
export function DashboardWorkspace() {
    const workspace = useDatabaseWorkspace();
    const { workspaceId, token } = workspace;
    const [revision,setRevision]=useState(0);
    const [recent, setRecent] = useState<{
        conversations: Conversation[];
        activity: Activity[];
        runs: AgentRun[];
    } | null>(null), [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            setRecent(null);
            setError("");
            if (!workspaceId) return;
            try {
                const auth = await token();
                const results = await Promise.allSettled([aiApi.list(workspaceId, auth), aiApi.activity(workspaceId, auth),cp5Api.runs(workspaceId,auth)]);
                if (!cancelled) {
                    setRecent({ conversations: results[0].status==='fulfilled'?results[0].value.data:[], activity: results[1].status==='fulfilled'?results[1].value.data:[],runs:results[2].status==='fulfilled'?results[2].value.data:[] });
                    setError(results.flatMap((r,i)=>r.status==='rejected'?[`${['Conversations','Database activity','Agent runs'][i]} unavailable: ${aiError(r.reason)}`]:[]).join(' · '));
                }
            }
            catch (error) {
                if (!cancelled)
                    setError(aiError(error));
            }
        })();
        return () => { cancelled = true; };
    }, [workspaceId, token,revision]);
    return <RouteShell title="Dashboard" description="Live workspace metadata and your recent activity. Unconfigured services remain explicitly unavailable."><div className={aiPanel}><DatabaseSelector workspace={workspace}/>{workspaceId&&<p className="break-all text-xs">Workspace: {workspaceId}</p>}<div className="flex flex-wrap gap-3">{[["/onboarding", "Get started"], ["/databases", "Databases"], ["/explorer", "Explorer"], ["/sql-editor", "SQL editor"], ["/chat", "AI chat"], ["/agents", "Agents"]].map(([href, label]) => <Link key={href} href={href} className={aiButton}>{label}</Link>)}<button className={aiButton} disabled={!workspaceId||workspace.loading} onClick={()=>{setRevision(r=>r+1);void workspace.refresh();}}>Refresh overview</button></div></div>{error&&<p role="alert">{error}</p>}<div className="grid gap-4 lg:grid-cols-2"><section className={aiPanel}><h2 className="font-bold">Database status</h2>{workspace.list?.data.map(d => <div key={d.id} className="break-all"><strong>{d.name}</strong><p>{d.kind==="external"?"External":"Managed"} · {d.dialect??"postgresql"} · {d.state}</p><Link className="underline" href={d.state==="active"?"/explorer":"/databases"} onClick={()=>workspace.setDatabaseId(d.id)}>{d.state==="active"?"Explore database":"Review setup"}</Link>{d.error && <p>{d.error}</p>}</div>)}{workspace.list && !workspace.list.data.length && <p>No database connected yet. Resume setup using Get started.</p>}{workspace.list && !workspace.list.capabilities.provisioningConfigured && <p className="text-sm text-[#8b9bb4]">Provisioning is unavailable until configured by the owner.</p>}</section><section className={aiPanel}><h2 className="font-bold">Recent AI conversations</h2>{!workspaceId ? <p>Select a workspace.</p> : !recent && !error ? <p role="status">Loading recent activity…</p> : null}{recent && !error.includes("Conversations unavailable") && !recent.conversations.length && <p>No conversations yet.</p>}{recent?.conversations.slice(0, 5).map(c => <p key={c.id}><Link className="underline" href={recordLink("/chat","conversation",c.id)}>{c.title}</Link> · {c.busy ? "Running" : c.updatedAt}</p>)}</section><section className={aiPanel}><h2 className="font-bold">Agent executions</h2>{recent&&!error.includes("Agent runs unavailable")&&!recent.runs.length&&<p>No executions yet.</p>}{recent?.runs.slice(0,5).map(r=><p key={r.id}><Link className="underline" href={recordLink("/agents","run",r.id)}>{r.goal}</Link> · {r.status}{r.usage?` · ${r.usage.totalTokens} tokens`:""}</p>)}</section><section className={aiPanel}><h2 className="font-bold">Recent query and provisioning audits</h2><p className="text-xs text-[#8b9bb4]">Your latest workspace events. SQL text is not stored in audit records.</p>{recent?.activity.filter(a => (a.resource_type==="database"||a.action.startsWith("sql."))).map(a => <p key={a.id} className="text-sm">{a.created_at} · {a.action} · {a.outcome}</p>)}{recent && !error.includes("Database activity unavailable") && !recent.activity.some(a => (a.resource_type==="database"||a.action.startsWith("sql."))) && <p>No recorded database activity.</p>}</section></div></RouteShell>;
}
export function AccountWorkspace() { return <RouteShell title="Account" description="Manage your genuine Clerk account and active sessions."><div className="overflow-x-auto"><UserProfile routing="hash"/></div></RouteShell>; }
