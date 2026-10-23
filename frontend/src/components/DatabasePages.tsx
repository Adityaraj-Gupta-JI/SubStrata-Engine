"use client";
import {Relationships} from "./Relationships";
import {tableSelect} from "@/lib/product-workflow";
import {SchemaEditor,RecordEditor} from "./DatabaseEditors";
import {ApprovedChange,ExecutionSettings} from "./ApprovedChange";
import {MySQLConnections} from "./MySQLConnections";
import {ExternalConnections} from "./ExternalConnections";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { databaseApi, type RelationMetadata, type ResultGrid, type RowPreview } from "@/lib/api/databases";
import { DatabaseSelector, ResultTable, useDatabaseWorkspace } from "./DatabaseWorkspace";
import { SQLAssistance } from "./SQLAssistance";
import { RouteShell } from "./RouteShell";
const panel = "space-y-4 rounded-xl border border-[#2a3047] bg-[#0d0e17] p-5";
const button = "rounded border border-[#2a3047] px-3 py-2 text-sm hover:bg-[#1a1e30] disabled:cursor-not-allowed disabled:opacity-50";
const message = (error: unknown) => error instanceof Error ? error.message : "Database request failed.";
export function DatabasesWorkspace() {
    const workspace = useDatabaseWorkspace();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function provision(retry?: string) {
        setBusy(true);
        setError("");
        try {
            const token = await workspace.token();
            const result = retry ? await databaseApi.retry(workspace.workspaceId, retry, token) : await databaseApi.provision(workspace.workspaceId, token);
            workspace.setDatabaseId(result.data.id);
            await workspace.refresh();
        }
        catch (failure) {
            setError(message(failure));
        }
        finally {
            setBusy(false);
        }
    }
    const allowed = workspace.list?.capabilities.canProvision && workspace.list.capabilities.provisioningConfigured;
    return <RouteShell title="Databases" description="Tenant database metadata comes from the authorized platform API.">

    <div className={panel}>

      <DatabaseSelector workspace={workspace}/><ExecutionSettings key={workspace.databaseId} workspace={workspace}/>

      <div className="flex flex-wrap gap-3"><button className={button} disabled={!allowed || busy || !!workspace.list?.data.some(d=>d.kind!=="external")} onClick={() => void provision()}>{busy ? "Requesting…" : "Create database"}</button><button className={button} disabled={!workspace.workspaceId || workspace.loading || busy} onClick={() => void workspace.refresh()}>Refresh status</button></div>

      {workspace.list && !workspace.list.capabilities.provisioningConfigured && <p role="status" className="text-sm text-[#8b9bb4]">Provisioning is not configured. A managed provider and durable external credential storage are required.</p>}

      {workspace.list && !workspace.list.capabilities.canProvision && <p className="text-sm">Only workspace owners and admins can provision or retry.</p>}

      {error && <p role="alert" className="text-[#ff8da8]">{error}</p>}

      {workspace.list?.data.map(database => <article key={database.id} className="space-y-2 border-t border-[#2a3047] pt-4"><h2 className="break-all font-bold">{database.name}</h2><p>Status: {database.state}</p>{database.error && <p role="status">{database.error}</p>}<div className="flex flex-wrap gap-3"><button className={button} onClick={() => workspace.setDatabaseId(database.id)}>Select database</button>{database.retryAvailable && <button className={button} disabled={!allowed || busy} onClick={() => void provision(database.id)}>Retry provisioning</button>}{database.state === "active" && <><Link className={button} href="/explorer" onClick={() => workspace.setDatabaseId(database.id)}>Explore schema</Link><Link className={button} href="/sql" onClick={() => workspace.setDatabaseId(database.id)}>Read-only SQL</Link></>}</div></article>)}

    </div>

  <ExternalConnections workspace={workspace}/><MySQLConnections workspace={workspace}/></RouteShell>;
}
export function ExplorerWorkspace() {
    const workspace = useDatabaseWorkspace();
    return <RouteShell title="Explorer" description="Inspect authorized tenant schemas, relation metadata and bounded row previews.">

    <div className={panel}><DatabaseSelector workspace={workspace}/></div>

    {workspace.database?.state === "active" && <ExplorerDatabase key={`${workspace.workspaceId}:${workspace.databaseId}`} workspace={workspace}/>}

    {workspace.database && workspace.database.state !== "active" && <p role="status">The selected database is not ready.</p>}

  </RouteShell>;
}
function ExplorerDatabase({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    const [schemas, setSchemas] = useState<{
        name: string;
    }[]>([]);
    const [schema, setSchema] = useState("");
    const [tables, setTables] = useState<{
        name: string;
        kind: string;
    }[]>([]);
    const [table, setTable] = useState("");
    const [metadata, setMetadata] = useState<RelationMetadata | null>(null);
    const [preview, setPreview] = useState<RowPreview | null>(null);
    const [error, setError] = useState("");
    const [notice,setNotice]=useState("");
    const [loading, setLoading] = useState(true);
    const generation = useRef({ value: 0 });
    const { workspaceId, databaseId, token } = workspace;
    useEffect(() => {
        let cancelled = false;
        const state = generation.current;
        void (async () => {
            try {
                const result = await databaseApi.schemas(workspaceId, databaseId, await token());
                if (!cancelled) {
                    setSchemas(result.data);
                    const target=new URLSearchParams(window.location.hash.slice(1)),savedSchema=target.get("schema"),savedTable=target.get("table");
                    if(savedSchema&&result.data.some(s=>s.name===savedSchema)){
                        const auth=await token(),listed=await databaseApi.tables(workspaceId,databaseId,savedSchema,auth);
                        if(cancelled)return;setSchema(savedSchema);setTables(listed.data);
                        if(savedTable&&listed.data.some(t=>t.name===savedTable)){
                            const [relation,rows]=await Promise.all([databaseApi.relation(workspaceId,databaseId,savedSchema,savedTable,auth),databaseApi.rows(workspaceId,databaseId,savedSchema,savedTable,0,auth)]);
                            if(cancelled)return;setTable(savedTable);setMetadata(relation.data);setPreview(rows.data);
                        }
                    }
                }
            }
            catch (failure) {
                if (!cancelled)
                    setError(message(failure));
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();
        return () => { cancelled = true; state.value++; };
    }, [workspaceId, databaseId, token]);
    async function openSchema(name: string, selectedTable?: string) {
        const current = ++generation.current.value;
        setSchema(name);
        window.history.replaceState(null,"",`#${new URLSearchParams({schema:name})}`);
        setTables([]);
        setTable("");
        setPreview(null);
        setMetadata(null);
        setError("");
        setLoading(true);
        try {
            const result = await databaseApi.tables(workspace.workspaceId, workspace.databaseId, name, await workspace.token());
            if (current === generation.current.value)
                setTables(result.data);
            if (current === generation.current.value && selectedTable && result.data.some(t=>t.name===selectedTable)) await openTable(selectedTable,0,name);
        }
        catch (failure) {
            if (current === generation.current.value)
                setError(message(failure));
        }
        finally {
            if (current === generation.current.value)
                setLoading(false);
        }
    }
    async function openTable(name: string, offset = 0, selectedSchema = schema) {
        const current = ++generation.current.value;
        setTable(name);
        window.history.replaceState(null,"",`#${new URLSearchParams({schema:selectedSchema,table:name})}`);
        setPreview(null);
        setMetadata(null);
        setError("");
        setLoading(true);
        try {
            const token = await workspace.token();
            const [relation, rows] = await Promise.all([databaseApi.relation(workspace.workspaceId, workspace.databaseId, selectedSchema, name, token), databaseApi.rows(workspace.workspaceId, workspace.databaseId, selectedSchema, name, offset, token)]);
            if (current === generation.current.value) {
                setMetadata(relation.data);
                setPreview(rows.data);
            }
        }
        catch (failure) {
            if (current === generation.current.value)
                setError(message(failure));
        }
        finally {
            if (current === generation.current.value)
                setLoading(false);
        }
    }
    return <div className="space-y-4"><Relationships workspace={workspace} schemas={schemas} onOpen={(s,t)=>void openSchema(s,t)}/><div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">

    <nav aria-label="Database schema tree" className={panel}><h2 className="font-bold">Schemas</h2>{!schemas.length && !error && !loading && <p role="status">No readable schemas returned.</p>}{schemas.map(item => <div key={item.name}><button className={button} aria-expanded={schema === item.name} onClick={() => void openSchema(item.name)}>{item.name}</button>{schema === item.name && <ul className="mt-2 space-y-2 pl-3">{tables.map(item => <li key={item.name}><button className={`${button} break-all text-left`} aria-current={table === item.name ? "true" : undefined} onClick={() => void openTable(item.name)}>{item.name} <span className="text-[#8b9bb4]">({item.kind})</span></button></li>)}{!loading && !tables.length && <li>No readable tables or views.</li>}</ul>}</div>)}</nav>

    <div className={`${panel} min-w-0`}>{notice&&<p role="status">{notice}</p>}{schema&&<SchemaEditor key={`${schema}:${table}`} workspace={workspace} schema={schema} table={table} onCommitted={()=>{setNotice("Schema change committed. Refreshing the schema tree.");void openSchema(schema);}}/>}{loading && <p role="status">Loading relation…</p>}{error && <p role="alert" className="text-[#ff8da8]">{error}</p>}{!table && <p>Select a schema and table or view.</p>}{metadata && <><h2 className="break-all text-lg font-bold">{schema}.{table}</h2><Link className={button} href="/sql-editor" onClick={()=>{workspace.setSqlDraft({workspaceId,databaseId,sql:tableSelect(schema,table,workspace.database?.dialect),conversationId:"",source:"explorer"});}}>Open in SQL editor</Link><h3 className="font-bold">Columns</h3><ul className="space-y-1 text-sm">{metadata.columns.map(column => <li key={column.name}>{column.name} · {column.type}{column.not_null === "true" ? " · NOT NULL" : ""}</li>)}</ul><details><summary>Keys and indexes</summary><ul className="space-y-2 break-words pt-2 text-sm">{[...metadata.keys, ...metadata.indexes].map(item => <li key={item.name}><strong>{item.name}</strong>: {item.definition}</li>)}</ul></details></>}{preview && <><h3 className="font-bold">Paginated records</h3>{metadata&&<RecordEditor key={`${schema}:${table}:${preview.page.offset}`} workspace={workspace} schema={schema} table={table} metadata={metadata} preview={preview} onCommitted={()=>{setNotice("Record change committed. Refreshing the page.");void openTable(table,preview.page.offset);}}/>}<ResultTable result={preview}/>{!preview.stableOrder && <p className="text-sm text-[#8b9bb4]">No primary key: page order may change. Offset pages are not snapshots.</p>}<div className="flex gap-3"><button className={button} disabled={loading || preview.page.offset === 0} onClick={() => void openTable(table, Math.max(0, preview.page.offset - 20))}>Previous</button><span className="py-2 text-sm">Offset {preview.page.offset}</span><button className={button} disabled={loading || !preview.hasMore || preview.page.offset >= 10000} onClick={() => void openTable(table, preview.page.offset + 20)}>Next</button></div></>}</div>

  </div></div>;
}
export function SqlWorkspace() {
    const workspace = useDatabaseWorkspace();
    return <RouteShell title="SQL editor" description="Run bounded SELECT queries or preview explicitly approved PostgreSQL changes. MySQL remains read-only.">

    <div className={panel}><DatabaseSelector workspace={workspace}/></div><ExecutionSettings key={workspace.databaseId} workspace={workspace}/>

    <SqlDatabase key={`${workspace.workspaceId}:${workspace.databaseId}`} workspace={workspace}/>

  </RouteShell>;
}
function SqlDatabase({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    const draft = workspace.sqlDraft?.workspaceId === workspace.workspaceId && workspace.sqlDraft.databaseId === workspace.databaseId ? workspace.sqlDraft : null;
    const [sql, setSql] = useState(draft?.sql ?? "");
    const [generated, setGenerated] = useState(!!draft && draft.source!=="explorer");
    const [executed, setExecuted] = useState(false);
    const [result, setResult] = useState<ResultGrid | null>(null);
    const [error, setError] = useState("");
    const [running, setRunning] = useState(false);
    const active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    async function execute() {
        setRunning(true);
        setError("");
        setResult(null);
        try {
            const response = await databaseApi.query(workspace.workspaceId, workspace.databaseId, sql, await workspace.token());
            if (active.current) {
                setResult(response.data);
                setExecuted(true);
            }
        }
        catch (failure) {
            if (active.current)
                setError(message(failure));
        }
        finally {
            if (active.current)
                setRunning(false);
        }
    }
    return <div className={panel}>{generated && <p role="status" className="text-[#00f0ff]">{executed ? "AI-generated SQL · Executed through the read-only gateway." : "AI-generated draft · Not executed. Review and edit before executing."}</p>}<p className="text-sm text-[#8b9bb4]">Single SELECT over the selected database’s approved schema. Basic filters, ordering, limits and count/min/max/sum/avg are supported. Maximum 100 rows, bounded result size and a 3-second statement timeout. MySQL supports a narrower dialect-specific subset without aggregate functions.</p><label htmlFor="readonly-sql" className="block font-bold">SQL · {workspace.database?.dialect??"postgresql"}</label><textarea id="readonly-sql" rows={8} maxLength={8192} className="w-full rounded border border-[#2a3047] bg-[#131522] p-3 font-mono text-sm" placeholder={`SELECT * FROM ${workspace.database?.schema??"tenant_data"}.your_table LIMIT 20`} value={sql} onChange={event => { setSql(event.target.value); workspace.setSqlDraft({workspaceId:workspace.workspaceId,databaseId:workspace.databaseId,sql:event.target.value,conversationId:draft?.conversationId??"",source:generated?"ai":"explorer"}); setExecuted(false); setResult(null); }} spellCheck={false}/><button className={button} disabled={running || !sql.trim() || workspace.database?.state !== "active"} onClick={() => void execute()}>{running ? "Executing…" : "Run SELECT"}</button>{!workspace.database && <p role="status">Select an active database to execute.</p>}{running && <p role="status">Running bounded read-only query…</p>}{error && <p role="alert" className="text-[#ff8da8]">{error}</p>}{result && <ResultTable result={result}/>}<ApprovedChange workspace={workspace} sql={sql} onCommitted={()=>{setGenerated(false);setExecuted(false);}}/><SQLAssistance workspace={workspace} onDraft={value => { setSql(value); workspace.setSqlDraft({workspaceId:workspace.workspaceId,databaseId:workspace.databaseId,sql:value,conversationId:"",source:"ai"}); setGenerated(true); setExecuted(false); setResult(null); }}/></div>;
}
