"use client";
import { useCallback, useEffect, useState } from 'react';
import { cp5Api, type WorkspaceMember } from '@/lib/api/cp5';
import { useDatabaseWorkspace } from './DatabaseWorkspace';
import { aiButton, aiError, aiPanel } from './AIProviderState';
import { RouteShell } from './RouteShell';
export function WorkspaceMembers() { const workspace = useDatabaseWorkspace(); return <RouteShell title="Workspace access" description="Manage workspace assignments for existing organization members. Authorization is enforced by the backend."><Members key={workspace.workspaceId} workspace={workspace}/></RouteShell>; }
function Members({ workspace }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
}) {
    const { workspaceId, token } = workspace;
    const [rows, setRows] = useState<WorkspaceMember[]>([]), [canManage, setCanManage] = useState(false), [role, setRole] = useState(''), [busy, setBusy] = useState(false), [loading,setLoading]=useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [invites, setInvites] = useState('');
    const refresh = useCallback(async () => { if (!workspaceId)
        return; setError('');setLoading(true); try {
        const result = await cp5Api.members(workspaceId, await token());
        setRows(result.data);
        setCanManage(result.canManage);
        setRole(result.role);
        setInvites(result.invitations.reason);
    }
    catch (error) {
        setError(aiError(error));setRows([]);setCanManage(false);
    }finally{setLoading(false);} }, [workspaceId, token]);
    useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
    async function change(user: string, value: string) { setBusy(true); setError(''); setNotice(''); try {
        await cp5Api.member(workspaceId, await token(), user, value === 'remove' ? { action: 'remove' } : { role: value });
        setNotice('Workspace membership updated and audited.');
        await refresh();
        await workspace.refresh();
    }
    catch (error) {
        setError(aiError(error));
    }
    finally {
        setBusy(false);
    } }
    return <section className={aiPanel}>{!workspaceId && <p>Select a workspace.</p>}{loading && <p role="status">Loading workspace members…</p>}{!loading&&workspaceId&&!rows.length&&!error&&<p>No members available.</p>}{error && <p role="alert" className="text-[#ff8da8]">{error}</p>}{notice && <p role="status">{notice}</p>}<p className="text-sm text-[#8b9bb4]">Clerk authenticates accounts; D1 is the current membership authority. Clerk organizations are not linked. Organization owners/admins inherit access and cannot be removed here.</p><button className={aiButton} disabled={!workspaceId || busy} onClick={() => void refresh()}>Refresh members</button><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Member</th><th className="p-2">Organization role</th><th className="p-2">Workspace access</th><th className="p-2">Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-[#2a3047]"><td className="break-all p-2">{row.display_name || row.email || row.id}</td><td className="p-2">{row.organizationRole}</td><td className="p-2">{row.role ?? 'Not assigned'}{row.inherited ? ' (inherited)' : ''}</td><td className="p-2"><select aria-label={`Workspace role for ${row.display_name || row.id}`} className="rounded bg-[#131522] p-2" value={row.role ?? ''} disabled={!canManage || busy || !!row.inherited || role !== 'owner' && row.role === 'owner'} onChange={e => void change(row.id, e.target.value)}><option value="" disabled>Assign role</option>{['owner', 'admin', 'member', 'viewer'].map(value => <option key={value} value={value} disabled={role !== 'owner' && ['owner', 'admin'].includes(value)}>{value}</option>)}{row.assignmentId && !row.inherited && <option value="remove">Remove workspace access</option>}</select></td></tr>)}</tbody></table></div>{invites && <p role="status" className="text-sm">Invitations unavailable: {invites}</p>}</section>;
}
