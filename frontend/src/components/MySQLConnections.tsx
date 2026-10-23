"use client";
import { useCallback, useEffect, useState } from 'react';
import { platformGet, platformPost } from '@/lib/api/platform';
import { aiButton, aiInput, aiPanel, aiError } from './AIProviderState';
import type { useDatabaseWorkspace } from './DatabaseWorkspace';
interface Connection {
    id: string;
    name: string;
    state: string;
    revision: number;
    database: string;
    destinationId: string;
    username: string;
}
interface Destination {
    id: string;
    hostname: string;
    databases: string[];
    roles: string[];
}
export function MySQLConnections({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) { return <Body key={workspace.workspaceId} workspace={workspace}/>; }
function Body({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    const [rows, setRows] = useState<Connection[]>([]), [destinations, setDestinations] = useState<Destination[]>([]), [canManage, setCanManage] = useState(false), [name, setName] = useState(''), [destination, setDestination] = useState(''), [database, setDatabase] = useState(''), [role, setRole] = useState(''), [password, setPassword] = useState(''), [current, setCurrent] = useState<Connection | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const { workspaceId, token } = workspace;
    const root = `/workspaces/${workspace.workspaceId}/mysql-connections`;
    const refresh = useCallback(async () => { if (!workspaceId)
        return; setLoading(true); setError(''); try {
        const auth = await token(), result = await platformGet<{
            data: Connection[];
            canManage: boolean;
        }>(root, auth);
        setRows(result.data);
        setCanManage(result.canManage);
        if (result.canManage) {
            try {
                setDestinations((await platformGet<{
                    data: Destination[];
                }>(root + '/destinations', auth)).data);
            }
            catch {
                setDestinations([]);
                setError('No approved MySQL destination policy is configured. Ask the administrator to configure a pinned public endpoint and encrypted credential storage.');
            }
        }
    }
    catch (e) {
        setError(aiError(e));
        setRows([]);
        setCanManage(false);
    }
    finally {
        setLoading(false);
    } }, [root, workspaceId, token]);
    useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
    function edit(row: Connection | null) { setCurrent(row); setName(row?.name ?? ''); setDestination(row?.destinationId ?? ''); setDatabase(row?.database ?? ''); setRole(row?.username ?? ''); setPassword(''); setError(''); setNotice(''); }
    async function submit(action: 'save' | 'test' | 'disconnect') { setBusy(true); setError(''); setNotice(''); const secret = password; setPassword(''); try {
        const result = await platformPost<{
            data: {
                validated?: boolean;
                disconnected?: boolean;
            };
        }>(root + (current ? '/' + current.id : ''), await workspace.token(), { action, name, destinationId: destination, database, username: role, ...(secret ? { password: secret } : {}), ...(current ? { revision: current.revision } : {}) });
        edit(null);
        setNotice(result.data.disconnected ? 'Disconnected in SubStrata; the external database and role were not modified.' : action === 'test' ? 'Actual TLS, authentication and read-only grants validation passed.' : 'Validated MySQL connection and encrypted credentials saved.');
        await refresh();
        await workspace.refresh();
    }
    catch (e) {
        setError(aiError(e));
    }
    finally {
        setBusy(false);
    } }
    const allowed = destinations.find(d => d.id === destination);
    return <section className={aiPanel}><h2 className="font-bold">External MySQL · read-only</h2><p className="text-sm text-[#8b9bb4]">MySQL 8+, hostname-verified TLS over an administrator-approved public IP pin, and an exclusive SELECT grant for the approved database are required. PostgreSQL write approvals do not apply.</p>{loading && <p role="status">Loading MySQL connections…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{!rows.length && !loading && <p>No MySQL connections.</p>}{rows.map(row => <article key={row.id} className="space-y-2 border-t border-[#2a3047] pt-3"><p>{row.name} · {row.database} · {row.state}</p><button className={aiButton} type="button" disabled={row.state !== 'active'} onClick={() => workspace.setDatabaseId(row.id)}>Select for Explorer, SQL and AI</button>{canManage && row.state === 'active' && <button className={aiButton} type="button" disabled={busy} onClick={() => edit(row)}>Manage / rotate credentials</button>}</article>)}{canManage && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit('save'); }}><label className="block">Name<input className={aiInput} value={name} maxLength={100} required onChange={e => setName(e.target.value)}/></label><label className="block">Approved MySQL endpoint<select className={aiInput} required value={destination} onChange={e => { setDestination(e.target.value); setDatabase(''); setRole(''); }}><option value="">Choose endpoint</option>{destinations.map(d => <option key={d.id} value={d.id}>{d.hostname}</option>)}</select></label><label className="block">Database<select className={aiInput} required value={database} onChange={e => setDatabase(e.target.value)}><option value="">Choose database</option>{allowed?.databases.map(d => <option key={d}>{d}</option>)}</select></label><label className="block">Restricted role<select className={aiInput} required value={role} onChange={e => setRole(e.target.value)}><option value="">Choose role</option>{allowed?.roles.map(r => <option key={r}>{r}</option>)}</select></label><label className="block">{current ? 'New password' : 'Password'}<input className={aiInput} type="password" autoComplete="new-password" value={password} maxLength={512} onChange={e => setPassword(e.target.value)}/></label><div className="flex flex-wrap gap-3"><button className={aiButton} disabled={busy || !password || !allowed}>{busy ? 'Validating…' : current ? 'Validate and rotate' : 'Validate and save'}</button><button className={aiButton} type="button" disabled={busy || !password || !allowed} onClick={() => void submit('test')}>Test supplied credentials</button>{current && <button className={aiButton} type="button" disabled={busy} onClick={() => void submit('disconnect')}>Disconnect</button>}<button className={aiButton} type="button" disabled={busy} onClick={() => edit(null)}>Clear / new</button></div></form>}</section>;
}
