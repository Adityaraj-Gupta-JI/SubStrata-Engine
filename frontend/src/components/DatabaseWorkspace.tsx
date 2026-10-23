"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { databaseApi, type DatabaseList, type ResultGrid } from "@/lib/api/databases";
import { platformToken } from "@/lib/api/platform";

export interface SqlDraft {workspaceId:string;databaseId:string;sql:string;conversationId:string}
export const WorkspaceSelectionContext = createContext<{ workspaceId: string; databaseId: string; setDatabaseId: (id: string) => void; sqlDraft:SqlDraft|null;setSqlDraft:(draft:SqlDraft|null)=>void } | null>(null);
export function useDatabaseWorkspace() {
  const selection = useContext(WorkspaceSelectionContext);
  if (!selection) throw new Error("Workspace selection is unavailable.");
  const { getToken } = useAuth();
  const [list, setList] = useState<DatabaseList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef({ value: 0 });
  const currentWorkspace = useRef(selection.workspaceId);
  useEffect(() => { currentWorkspace.current = selection.workspaceId; }, [selection.workspaceId]);
  const token = useCallback(() => platformToken(getToken), [getToken]);
  const refresh = useCallback(async () => {
    if (currentWorkspace.current !== selection.workspaceId) return;
    const current = ++generation.current.value;
    if (!selection.workspaceId) { setList(null); setLoading(false); setError(""); return; }
    setLoading(true); setError(""); setList(null);
    try {
      const result = await databaseApi.list(selection.workspaceId, await token());
      if (generation.current.value === current) setList(result);
    } catch (failure) { if (generation.current.value === current) setError(failure instanceof Error ? failure.message : "Databases unavailable."); }
    finally { if (generation.current.value === current) setLoading(false); }
  }, [selection.workspaceId, token]);
  useEffect(() => { const state = generation.current; void Promise.resolve().then(refresh); return () => { state.value++; }; }, [refresh]);
  const database = list?.data.find(row => row.id === selection.databaseId);
  const setDatabaseId = (id: string) => { if (currentWorkspace.current === selection.workspaceId) selection.setDatabaseId(id); };
  return { ...selection, setDatabaseId, list, database, error, loading, refresh, token };
}
export function DatabaseSelector({ workspace }: { workspace: ReturnType<typeof useDatabaseWorkspace> }) {
  return <div className="space-y-2">
    <label htmlFor="database-selector" className="block text-sm">Database</label>
    <select id="database-selector" className="w-full rounded border border-[#2a3047] bg-[#131522] p-2" value={workspace.databaseId} disabled={workspace.loading || !workspace.list?.data.length} onChange={event => workspace.setDatabaseId(event.target.value)}>
      <option value="">Select a database</option>
      {workspace.list?.data.map(database => <option key={database.id} value={database.id}>{database.name} — {database.kind==='external'?'External PostgreSQL':'Managed Neon'} — {database.state}</option>)}
    </select>
    {!workspace.workspaceId && <p role="status">Select a workspace in the sidebar.</p>}
    {workspace.loading && <p role="status">Loading databases…</p>}
    {workspace.error && <p role="alert" className="text-[#ff8da8]">{workspace.error}</p>}
    {workspace.list && !workspace.list.data.length && <p>No tenant database has been provisioned for this workspace.</p>}
  </div>;
}
export function ResultTable({ result }: { result: ResultGrid }) {
  return <div className="space-y-2">
    <p className="text-sm text-[#8b9bb4]">{result.rows.length} rows · {result.elapsedMs} ms{result.truncated ? " · Result limit reached" : ""}. Cells are returned as text to preserve numeric precision.</p>
    {!result.rows.length ? <p role="status">No rows returned.</p> : <div className="overflow-x-auto rounded border border-[#2a3047]"><table className="w-full text-left text-sm"><thead><tr>{result.columns.map(column => <th key={column} className="border-b border-[#2a3047] p-2">{column}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map(column => <td key={column} className="max-w-xs whitespace-pre-wrap break-words border-b border-[#2a3047] p-2">{row[column] === null ? <span className="text-[#8b9bb4]">NULL</span> : String(row[column])}</td>)}</tr>)}</tbody></table></div>}
  </div>;
}
