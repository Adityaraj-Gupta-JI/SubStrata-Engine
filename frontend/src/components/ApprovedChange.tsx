"use client";
import { useCallback, useEffect, useState } from 'react';
import { executionApi, type ChangePreview, type SqlValue, type WriteAccess, type Execution } from '@/lib/api/execution';
import { aiButton, aiError, aiInput, aiPanel } from './AIProviderState';
import type { useDatabaseWorkspace } from './DatabaseWorkspace';
type Workspace = ReturnType<typeof useDatabaseWorkspace>;
export function ApprovedChange({ workspace, sql, parameters = [], onCommitted }: {
    workspace: Workspace;
    sql: string;
    parameters?: SqlValue[];
    onCommitted?: () => void;
}) { return <ChangeBody key={JSON.stringify([workspace.workspaceId, workspace.databaseId, sql, parameters])} workspace={workspace} sql={sql} parameters={parameters} onCommitted={onCommitted}/>; }
function ChangeBody({ workspace, sql, parameters, onCommitted }: {
    workspace: Workspace;
    sql: string;
    parameters: SqlValue[];
    onCommitted?: () => void;
}) {
    const [preview, setPreview] = useState<ChangePreview | null>(null), [confirmation, setConfirmation] = useState(''), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    async function prepare() { setBusy(true); setError(''); setPreview(null); setAck(false); setConfirmation(''); try {
        setPreview((await executionApi.preview(workspace.workspaceId, workspace.databaseId, await workspace.token(), sql, parameters)).data);
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setBusy(false);
    } }
    async function apply() { if (!preview || !ack)
        return; setBusy(true); setError(''); const approval = preview; setPreview(null); try {
        const result = (await executionApi.execute(workspace.workspaceId, workspace.databaseId, await workspace.token(), approval, confirmation)).data;
        setNotice(`${result.status}: ${result.affectedRows} affected rows in ${result.elapsedMs} ms. Execution ${result.executionId}.`);
        onCommitted?.();
    }
    catch (e) {
        setError(aiError(e) + ' Approval cannot be replayed. Check history before obtaining a new preview.');
    }
    finally {
        setBusy(false);
    } }
    return <section className="space-y-3 border-t border-[#2a3047] pt-4"><button type="button" className={aiButton} disabled={busy || !sql.trim() || !workspace.databaseId || workspace.database?.dialect === 'mysql'} onClick={() => void prepare()}>{busy ? 'Processing…' : 'Preview authorized change'}</button><p className="text-xs text-[#8b9bb4]">No automatic execution. A preview grants no additional permissions. MySQL remains read-only.</p>{error && <p role="alert" className="text-[#ff8da8]">{error}</p>}{notice && <p role="status">{notice}</p>}{preview && <div role="dialog" aria-modal="false" aria-label="Confirm database change" className={aiPanel}><h3 className="font-bold">{preview.operation} · {preview.risk} · {preview.dialect}</h3><pre className="overflow-x-auto whitespace-pre-wrap break-words">{preview.sql}</pre><pre className="overflow-x-auto">Parameters: {JSON.stringify(preview.parameters)}</pre><p>Approval expires at {new Date(preview.expiresAt).toLocaleTimeString()}. Changes affecting more than 1000 rows are rolled back.</p><label className="flex gap-2"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>I reviewed the target, SQL and parameters and approve this change.</label><label className="block">Type {preview.confirmation}<input autoComplete="off" className={aiInput} value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label><button type="button" className={aiButton} disabled={busy || !ack || confirmation !== preview.confirmation} onClick={() => void apply()}>Confirm and execute once</button><button type="button" className={aiButton} disabled={busy} onClick={() => setPreview(null)}>Cancel preview</button></div>}</section>;
}
export function ExecutionSettings({ workspace }: {
    workspace: Workspace;
}) {
    const [access, setAccess] = useState<WriteAccess | null>(null), [history, setHistory] = useState<Execution[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState(''), [password, setPassword] = useState(''), [capability, setCapability] = useState('write'), [registration, setRegistration] = useState('');
    const { workspaceId, databaseId, token } = workspace;
    const dialect = workspace.database?.dialect;
    const refresh = useCallback(async () => { if (!databaseId || dialect === 'mysql')
        return; setBusy(true); setError(''); try {
        const auth = await token();
        setAccess((await executionApi.access(workspaceId, databaseId, auth)).data);
        setHistory((await executionApi.history(workspaceId, databaseId, auth)).data);
    }
    catch (e) {
        setError(aiError(e));
        setAccess(null);
    }
    finally {
        setBusy(false);
    } }, [workspaceId, databaseId, dialect, token]);
    useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
    async function toggle() { if (!access)
        return; setBusy(true); setError(''); try {
        await executionApi.enable(workspace.workspaceId, workspace.databaseId, await workspace.token(), !access.enabled, confirmation);
        setConfirmation('');
        await refresh();
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setBusy(false);
    } }
    async function register() { setBusy(true); setError(''); const secret = password; setPassword(''); try {
        await executionApi.register(workspaceId, databaseId, await token(), capability, secret, registration);
        setRegistration('');
        await refresh();
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setBusy(false);
    } }
    if (workspace.database?.dialect === 'mysql')
        return <p>MySQL · read-only. Write approvals are unavailable.</p>;
    return <details className={aiPanel}><summary>Write access and execution history · PostgreSQL</summary>{busy && <p role="status">Loading or verifying execution roles…</p>}{error && <p role="alert">{error}</p>}{access && <><p>Writes {access.enabled ? 'enabled' : 'disabled'} · Record writes: {access.canWrite ? 'permitted' : 'unavailable'} · Schema administration: {access.canAdmin ? 'permitted' : 'unavailable'}</p><p>{access.reason}</p>{access.canManage && <>{access.configured && <details className="space-y-3"><summary>Register a preapproved execution role · disables current write access</summary><p>Use a restricted role prepared by the database owner. Existing immutable references cannot be overwritten; rotation needs a new administrator-configured reference.</p><label className="block">Role purpose<select className={aiInput} value={capability} onChange={e => setCapability(e.target.value)}><option value="write">Record writer</option><option value="admin">Schema administrator</option></select></label><label className="block">Password<input className={aiInput} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}/></label><label className="block">Type REGISTER {access.databaseName}<input className={aiInput} value={registration} onChange={e => setRegistration(e.target.value)}/></label><button type="button" className={aiButton} disabled={busy || !password || registration !== `REGISTER ${access.databaseName}`} onClick={() => void register()}>Encrypt and verify role</button></details>}<label className="block">Type ENABLE {access.databaseName}<input className={aiInput} value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label><button type="button" className={aiButton} disabled={busy || !access.configured && !access.enabled || confirmation !== `ENABLE ${access.databaseName}`} onClick={() => void toggle()}>{access.enabled ? 'Disable write access' : 'Verify roles and enable write access'}</button></>}</>}<button type="button" className={aiButton} disabled={busy || !workspace.databaseId} onClick={() => void refresh()}>Refresh access and history</button>{!history.length && !busy && <p>No executions recorded for your account.</p>}{history.map(h => <p className="break-all text-sm" key={h.id}>{h.created_at} · {h.operation} · {h.risk} · {h.status} · {h.affected_rows ?? 'unknown'} rows{h.error_code ? ` · ${h.error_code}` : ''} · {h.id}</p>)}</details>;
}
