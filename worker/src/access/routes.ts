import { ApiError, badRequest, forbidden, json, notFound } from '../errors';
import { requireRole, workspaceAccess, type Role } from '../metadata';
import { fields, jsonBody } from '../http';
import { uuid } from '../validation';
export async function membershipRoute(request: Request, env: Env, user: string, requestId: string): Promise<Response | null> {
    const match = new URL(request.url).pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/members(?:\/([^/]+))?$/);
    if (!match)
        return null;
    if (env.WORKSPACE_MEMBERSHIP_MODE !== undefined && env.WORKSPACE_MEMBERSHIP_MODE !== 'd1')
        throw new ApiError(503, 'MEMBERSHIP_RECONCILIATION_REQUIRED', 'Clerk organization synchronization is not configured. Membership access is disabled.');
    const workspace = uuid(match[1]), access = await workspaceAccess(env.METADATA, workspace, user), org = access.workspace.organization_id;
    if (request.method === 'GET' && !match[2]) {
        const rows = await env.METADATA.prepare("SELECT u.id,u.display_name,u.email,m.role AS organizationRole,CASE WHEN m.role IN ('owner','admin') THEN m.role ELSE wm.role END AS role,CASE WHEN m.role IN ('owner','admin') THEN 1 ELSE 0 END AS inherited,wm.id AS assignmentId FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN workspace_memberships wm ON wm.user_id=u.id AND wm.workspace_id=? WHERE m.organization_id=? AND m.status='active' AND u.status='active' AND (?=1 OR wm.id IS NOT NULL OR m.role IN ('owner','admin')) ORDER BY u.id").bind(workspace, org, ['owner', 'admin'].includes(access.role) ? 1 : 0).all();
        return json({ data: rows.results, canManage: ['owner', 'admin'].includes(access.role), role: access.role, authority: 'd1', clerkOrganizationSync: 'not-linked', invitations: { available: false, reason: 'Workspace invitations require an established Clerk organization mapping and reconciliation workflow.' }, requestId }, 200, requestId);
    }
    requireRole(access.role, ['owner', 'admin']);
    if (request.method !== 'POST')
        throw notFound();
    const value = await jsonBody(request);
    fields(value, ['userId', 'role', 'action']);
    const target = match[2] ? uuid(match[2]) : uuid(typeof value.userId === 'string' ? value.userId : '');
    const membership = await env.METADATA.prepare("SELECT role FROM memberships WHERE organization_id=? AND user_id=? AND status='active'").bind(org, target).first<{
        role: Role;
    }>();
    if (!membership)
        throw notFound();
    if (['owner', 'admin'].includes(membership.role))
        throw new ApiError(409, 'INHERITED_MEMBERSHIP', 'Organization owners/admins inherit workspace access. Manage that role at organization level.');
    const old = await env.METADATA.prepare('SELECT role FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(workspace, target).first<{
        role: Role;
    }>();
    const remove = value.action === 'remove';
    if (!remove && !['owner', 'admin', 'member', 'viewer'].includes(String(value.role)))
        throw badRequest('Choose a valid role.');
    if (access.role !== 'owner' && (old?.role === 'owner' || value.role === 'owner' || value.role === 'admin'))
        throw forbidden();
    const ownerGuard = "EXISTS(SELECT 1 FROM workspace_memberships wm JOIN memberships m ON m.user_id=wm.user_id AND m.organization_id=? AND m.status='active' JOIN users u ON u.id=m.user_id AND u.status='active' WHERE wm.workspace_id=? AND wm.role='owner' AND wm.user_id<>?) OR EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='active' WHERE m.organization_id=? AND m.status='active' AND m.role='owner' AND m.user_id<>?)";
    // Authorization is rechecked inside the mutation, not just before the batch.
    const actorGuard = (privileged: string) => `EXISTS(SELECT 1 FROM memberships am JOIN users au ON au.id=am.user_id JOIN organizations ao ON ao.id=am.organization_id LEFT JOIN workspace_memberships aw ON aw.user_id=am.user_id AND aw.workspace_id=? WHERE am.organization_id=? AND am.user_id=? AND am.status='active' AND au.status='active' AND ao.status='active' AND (am.role='owner' OR am.role='admin' AND NOT (${privileged}) OR am.role NOT IN ('owner','admin') AND (aw.role='owner' OR aw.role='admin' AND NOT (${privileged}))))`;
    const targetGuard = "EXISTS(SELECT 1 FROM memberships tm JOIN users tu ON tu.id=tm.user_id WHERE tm.organization_id=? AND tm.user_id=? AND tm.status='active' AND tu.status='active' AND tm.role NOT IN ('owner','admin'))";
    const parameters = [org, workspace, target, org, target], actor = [workspace, org, user], targetParameters = [org, target];
    let mutation: D1PreparedStatement;
    if (remove) {
        if (!old)
            throw notFound();
        mutation = env.METADATA.prepare(`DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND (role<>'owner' OR ${ownerGuard}) AND ${actorGuard("workspace_memberships.role='owner'")} AND ${targetGuard}`).bind(workspace, target, ...parameters, ...actor, ...targetParameters);
    }
    else if (old) {
        const privileged = ['owner', 'admin'].includes(String(value.role)) ? "1=1" : "workspace_memberships.role='owner'";
        mutation = env.METADATA.prepare(`UPDATE workspace_memberships SET role=? WHERE workspace_id=? AND user_id=? AND (role<>'owner' OR ?='owner' OR ${ownerGuard}) AND ${actorGuard(privileged)} AND ${targetGuard}`).bind(value.role, workspace, target, value.role, ...parameters, ...actor, ...targetParameters);
    }
    else
        mutation = env.METADATA.prepare(`INSERT INTO workspace_memberships(id,workspace_id,user_id,role) SELECT ?,?,?,? WHERE ${actorGuard(['owner', 'admin'].includes(String(value.role)) ? '1=1' : '1=0')} AND ${targetGuard}`).bind(crypto.randomUUID(), workspace, target, value.role, ...actor, ...targetParameters);
    const results = await env.METADATA.batch([mutation, env.METADATA.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id) SELECT ?,?,?,?,'workspace',?,'success',? WHERE changes()=1").bind(crypto.randomUUID(), org, user, remove ? 'member.remove' : 'member.role', workspace, requestId)]);
    if (results[0].meta.changes !== 1)
        throw new ApiError(409, 'LAST_WORKSPACE_OWNER', 'The last active workspace owner cannot be removed or demoted. Permissions may have changed; refresh before retrying.');
    return json({ data: { updated: true, authority: 'd1' }, requestId }, 200, requestId);
}
