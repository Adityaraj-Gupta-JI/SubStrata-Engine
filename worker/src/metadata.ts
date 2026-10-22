import { forbidden, notFound } from "./errors";

export type Role = "owner" | "admin" | "member" | "viewer";
export interface UserRow { id: string; clerk_user_id: string; status: string }
export interface OrganizationRow { id: string; slug: string; name: string; status: string; created_at: string }
export interface WorkspaceRow { id: string; organization_id: string; slug: string; name: string; created_at: string }
export interface ConnectionRow { id: string; organization_id: string; workspace_id: string; engine: string; display_name: string; connection_type: string; status: string }
interface MembershipRow { role: Role; status: string }

export async function resolveUser(db: D1Database, clerkUserId: string): Promise<UserRow> {
  const existing = await db.prepare("SELECT id, clerk_user_id, status FROM users WHERE clerk_user_id = ?").bind(clerkUserId).first<UserRow>();
  if (existing) {
    if (existing.status !== "active") throw forbidden();
    return existing;
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO users (id, clerk_user_id) VALUES (?, ?) ON CONFLICT(clerk_user_id) DO NOTHING").bind(id, clerkUserId).run();
  const user = await db.prepare("SELECT id, clerk_user_id, status FROM users WHERE clerk_user_id = ?").bind(clerkUserId).first<UserRow>();
  if (!user || user.status !== "active") throw forbidden();
  return user;
}

export async function organizationRole(db: D1Database, organizationId: string, userId: string): Promise<Role> {
  const membership = await db.prepare(
    "SELECT m.role, m.status FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.organization_id = ? AND m.user_id = ? AND o.status = 'active'"
  ).bind(organizationId, userId).first<MembershipRow>();
  if (!membership || membership.status !== "active") throw notFound();
  return membership.role;
}

export function requireRole(role: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(role)) throw forbidden();
}

export async function workspaceAccess(db: D1Database, workspaceId: string, userId: string): Promise<{ workspace: WorkspaceRow; role: Role }> {
  const workspace = await db.prepare(
    "SELECT w.id, w.organization_id, w.slug, w.name, w.created_at FROM workspaces w JOIN organizations o ON o.id = w.organization_id WHERE w.id = ? AND o.status = 'active'"
  ).bind(workspaceId).first<WorkspaceRow>();
  if (!workspace) throw notFound();
  const role = await organizationRole(db, workspace.organization_id, userId);
  if (role === "owner" || role === "admin") return { workspace, role };
  const assignment = await db.prepare(
    "SELECT wm.role FROM workspace_memberships wm WHERE wm.workspace_id = ? AND wm.user_id = ?"
  ).bind(workspaceId, userId).first<{ role: Role }>();
  if (!assignment) throw notFound();
  return { workspace, role: assignment.role };
}

export async function listOrganizations(db: D1Database, userId: string, limit: number, offset: number): Promise<OrganizationRow[]> {
  const result = await db.prepare(
    "SELECT o.id, o.slug, o.name, o.status, o.created_at FROM organizations o JOIN memberships m ON m.organization_id = o.id WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active' ORDER BY o.created_at DESC, o.id LIMIT ? OFFSET ?"
  ).bind(userId, limit, offset).all<OrganizationRow>();
  return result.results;
}

export async function getOrganization(db: D1Database, organizationId: string, userId: string): Promise<OrganizationRow> {
  await organizationRole(db, organizationId, userId);
  const row = await db.prepare(
    "SELECT id, slug, name, status, created_at FROM organizations WHERE id = ? AND status = 'active'"
  ).bind(organizationId).first<OrganizationRow>();
  if (!row) throw notFound();
  return row;
}

export async function createOrganization(db: D1Database, userId: string, name: string, slug: string, requestId: string): Promise<OrganizationRow> {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO organizations (id, slug, name, created_by) VALUES (?, ?, ?, ?)").bind(id, slug, name, userId),
    db.prepare("INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, 'owner')").bind(crypto.randomUUID(), id, userId),
    db.prepare("INSERT INTO audit_events (id, organization_id, actor_user_id, action, resource_type, resource_id, outcome, request_id) VALUES (?, ?, ?, 'create', 'organization', ?, 'success', ?)").bind(crypto.randomUUID(), id, userId, id, requestId),
  ]);
  const row = await db.prepare("SELECT id, slug, name, status, created_at FROM organizations WHERE id = ?").bind(id).first<OrganizationRow>();
  if (!row) throw new Error("Created organization missing");
  return row;
}

export async function listWorkspaces(db: D1Database, organizationId: string, userId: string, limit: number, offset: number): Promise<WorkspaceRow[]> {
  const role = await organizationRole(db, organizationId, userId);
  const sql = role === "owner" || role === "admin"
    ? "SELECT id, organization_id, slug, name, created_at FROM workspaces WHERE organization_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?"
    : "SELECT w.id, w.organization_id, w.slug, w.name, w.created_at FROM workspaces w JOIN workspace_memberships wm ON wm.workspace_id = w.id WHERE w.organization_id = ? AND wm.user_id = ? ORDER BY w.created_at DESC, w.id LIMIT ? OFFSET ?";
  const statement = db.prepare(sql);
  const result = role === "owner" || role === "admin"
    ? await statement.bind(organizationId, limit, offset).all<WorkspaceRow>()
    : await statement.bind(organizationId, userId, limit, offset).all<WorkspaceRow>();
  return result.results;
}

export async function createWorkspace(db: D1Database, organizationId: string, userId: string, name: string, slug: string, requestId: string): Promise<WorkspaceRow> {
  requireRole(await organizationRole(db, organizationId, userId), ["owner", "admin"]);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO workspaces (id, organization_id, slug, name, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, organizationId, slug, name, userId),
    db.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'owner')").bind(crypto.randomUUID(), id, userId),
    db.prepare("INSERT INTO audit_events (id, organization_id, actor_user_id, action, resource_type, resource_id, outcome, request_id) VALUES (?, ?, ?, 'create', 'workspace', ?, 'success', ?)").bind(crypto.randomUUID(), organizationId, userId, id, requestId),
  ]);
  const row = await db.prepare("SELECT id, organization_id, slug, name, created_at FROM workspaces WHERE id = ? AND organization_id = ?").bind(id, organizationId).first<WorkspaceRow>();
  if (!row) throw new Error("Created workspace missing");
  return row;
}

export async function listConnections(db: D1Database, workspaceId: string, userId: string, limit: number, offset: number): Promise<ConnectionRow[]> {
  const { workspace } = await workspaceAccess(db, workspaceId, userId);
  const result = await db.prepare(
    "SELECT id, organization_id, workspace_id, engine, display_name, connection_type, status FROM connections WHERE workspace_id = ? AND organization_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?"
  ).bind(workspaceId, workspace.organization_id, limit, offset).all<ConnectionRow>();
  return result.results;
}

export async function connectionAccess(db: D1Database, connectionId: string, workspaceId: string, userId: string): Promise<ConnectionRow> {
  const { workspace } = await workspaceAccess(db, workspaceId, userId);
  const row = await db.prepare(
    "SELECT id, organization_id, workspace_id, engine, display_name, connection_type, status FROM connections WHERE id = ? AND workspace_id = ? AND organization_id = ?"
  ).bind(connectionId, workspaceId, workspace.organization_id).first<ConnectionRow>();
  if (!row) throw notFound();
  return row;
}
