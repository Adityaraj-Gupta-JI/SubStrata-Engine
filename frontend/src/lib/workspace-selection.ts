export interface WorkspaceSelection { organizationId: string; workspaceId: string; databaseId: string }
type SelectionStorage = Pick<Storage, "getItem" | "setItem">;
export function browserSelectionStorage(): SelectionStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function key(userId: string): string { return `substrata.workspace-selection.v1:${userId}`; }
export function readWorkspaceSelection(storage: SelectionStorage | null, userId: string): Partial<WorkspaceSelection> {
  try {
    if (!storage) return {};
    const value = JSON.parse(storage.getItem(key(userId)) ?? "null");
    if (!value || typeof value !== "object" || !uuid.test(value.organizationId) || !uuid.test(value.workspaceId) ||
        (value.databaseId !== "" && !/^[a-f0-9]{32}$/.test(value.databaseId))) return {};
    return { organizationId: value.organizationId, workspaceId: value.workspaceId, databaseId: value.databaseId };
  } catch { return {}; }
}
export function saveWorkspaceSelection(storage: SelectionStorage | null, userId: string, selection: WorkspaceSelection): void {
  if (!storage || !userId || !uuid.test(selection.organizationId) || !uuid.test(selection.workspaceId) || (selection.databaseId !== "" && !/^[a-f0-9]{32}$/.test(selection.databaseId))) return;
  // Nonsecret UI identifiers only; never a token, password or authorization grant.
  try { storage.setItem(key(userId), JSON.stringify({ organizationId: selection.organizationId, workspaceId: selection.workspaceId, databaseId: selection.databaseId })); }
  catch { /* Storage denial must not block the workspace. */ }
}
