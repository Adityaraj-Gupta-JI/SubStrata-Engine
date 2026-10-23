"use client";
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { cp5Api, type Destination, type ExternalConnection } from '@/lib/api/cp5';
import { aiButton, aiError, aiInput, aiPanel } from './AIProviderState';
import type { useDatabaseWorkspace } from './DatabaseWorkspace';
export function ExternalConnections({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    return <ExternalConnectionsBody key={workspace.workspaceId} workspace={workspace}/>;
}
function ExternalConnectionsBody({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    const { workspaceId, token } = workspace;
    const [rows, setRows] = useState<ExternalConnection[]>([]), [allowed, setAllowed] = useState(false), [destinations, setDestinations] = useState<Destination[]>([]), [current, setCurrent] = useState<ExternalConnection | null>(null), [name, setName] = useState(''), [endpoint, setEndpoint] = useState(''), [database, setDatabase] = useState(''), [role, setRole] = useState(''), [schema, setSchema] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [loading,setLoading]=useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const refresh = useCallback(async () => { if (!workspaceId)
        return; setError('');setLoading(true); try {
        const auth = await token(), result = await cp5Api.connections(workspaceId, auth);
        setRows(result.data);
        setAllowed(result.canManage);
        if (result.canManage) {
            try {
                setDestinations((await cp5Api.destinations(workspaceId, auth)).data);
            }
            catch {
                setDestinations([]);
                setError('No safe outbound destination policy is configured. Ask the administrator to approve a pinned public PostgreSQL endpoint.');
            }
        }
    }
    catch (error) {
        setError(aiError(error));setRows([]);setAllowed(false);
    }finally{setLoading(false);} }, [workspaceId, token]);
    useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
    function edit(row: ExternalConnection | null) { setCurrent(row); setName(row?.name ?? ''); setEndpoint(row?.destinationId ?? ''); setDatabase(row?.databaseName ?? ''); setRole(row?.username ?? ''); setSchema(row?.schema ?? ''); setPassword(''); setNotice(''); setError(''); }
    async function action(type: 'save' | 'rotate' | 'test' | 'disconnect' | 'rename', event?: FormEvent) { event?.preventDefault(); setBusy(true); setError(''); setNotice(''); const secret = password; setPassword(''); try {
        const result = await cp5Api.connection(workspaceId, await token(), { action: type, name, destinationId: endpoint, database, username: role, schema, ...(secret ? { password: secret } : {}), ...(current ? { revision: current.revision } : {}) }, current?.id);
        setNotice(result.data.disconnected ? 'Disconnected in SubStrata. No external database or role was deleted.' : type === 'rename' ? 'Connection name saved.' : result.data.saved ? 'Connection validated and saved.' : result.data.validated ? 'The actual read-only connection test succeeded.' : 'Metadata saved.');
        await refresh();
        await workspace.refresh();
        setCurrent(null);
    }
    catch (error) {
        setError(aiError(error));
    }
    finally {
        setBusy(false);
    } }
    const destination = destinations.find(d => d.id === endpoint);
    return <section className={aiPanel}><h2 className="text-lg font-bold">External PostgreSQL (BYODB)</h2><p className="text-sm text-[#8b9bb4]">Only administrator-approved, IP-pinned destinations are available. TLS and restricted read-only privileges are required. Credentials are encrypted and never returned.</p>{!workspaceId && <p>Select a workspace.</p>}{loading&&<p role="status">Loading external connections…</p>}{!loading&&workspaceId&&!rows.length&&!error&&<p>No external connections yet.</p>}{error && <p role="alert" className="text-[#ff8da8]">{error}</p>}{notice && <p role="status">{notice}</p>}<button className={aiButton} disabled={busy || !workspaceId} onClick={() => void refresh()}>Refresh connections</button>
 {rows.map(row => <article className="space-y-2 border-t border-[#2a3047] pt-3" key={row.id}><h3 className="break-all font-bold">{row.name} · External PostgreSQL</h3><p>{row.state} · Schema: {row.schema} · Last check: {row.checkedAt ?? 'Not checked'}</p>{row.error && <p role="alert">{row.error}</p>}<div className="flex gap-3"><button className={aiButton} disabled={row.state !== 'active'} onClick={() => workspace.setDatabaseId(row.id)}>Select for Explorer, SQL and AI</button>{allowed && row.state !== 'disconnected' && <button className={aiButton} disabled={busy} onClick={() => edit(row)}>Manage</button>}</div></article>)}
 {allowed && <form onSubmit={e => void action(current ? 'rotate' : 'save', e)} className="space-y-3 border-t border-[#2a3047] pt-4"><h3 className="font-bold">{current ? 'Manage connection' : 'New external connection'}</h3><label className="block">Display name<input className={aiInput} maxLength={100} required value={name} onChange={e => setName(e.target.value)}/></label><label className="block">Approved destination<select className={aiInput} value={endpoint} required disabled={busy || !!current} onChange={e => { setEndpoint(e.target.value); setDatabase(''); setRole(''); setSchema(''); }}><option value="">Select approved endpoint</option>{destinations.map(d => <option value={d.id} key={d.id}>{d.hostname}</option>)}</select></label>
 {(['Database', 'Role', 'Schema'] as const).map((label, i) => <label className="block" key={label}>{label}<select className={aiInput} value={[database, role, schema][i]} required disabled={busy || !!current} onChange={e => [setDatabase, setRole, setSchema][i](e.target.value)}><option value="">Select {label.toLowerCase()}</option>{(destination ? [destination.databases, destination.roles, destination.schemas][i] : []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
 <label className="block">{current ? 'New password for credential rotation' : 'Database password'}<input className={aiInput} type="password" autoComplete="new-password" value={password} maxLength={512} onChange={e => setPassword(e.target.value)} disabled={busy}/></label><div className="flex flex-wrap gap-3"><button className={aiButton} disabled={busy || !password || !destination}>{busy ? 'Checking…' : current ? 'Validate and rotate encrypted credentials' : 'Validate and save encrypted connection'}</button><button type="button" className={aiButton} disabled={busy || (!current && !password)} onClick={() => void action('test')}>Test connection</button>{current && <><button type="button" className={aiButton} disabled={busy} onClick={() => void action('rename')}>Save name</button><button type="button" className={aiButton} disabled={busy} onClick={() => void action('disconnect')}>Disconnect</button></>}<button type="button" className={aiButton} disabled={busy} onClick={() => edit(null)}>Clear / new connection</button></div></form>}
 </section>;
}
