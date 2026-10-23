import { ApiError, notFound } from "../errors";
import { workspaceAccess } from "../metadata";
import type { Conversation, StoredMessage } from "./contracts";
export interface ConversationRow {
    id: string;
    workspace_id: string;
    user_id: string;
    database_id: string | null;
    title: string;
    model: string;
    busy_id: string | null;
    allow_rows: number;
    updated_at: string;
}
export const publicConversation = (row: ConversationRow): Conversation => ({ id: row.id, workspaceId: row.workspace_id, databaseId: row.database_id, title: row.title, model: row.model, busy: !!row.busy_id, updatedAt: row.updated_at });
export async function conversationAccess(db: D1Database, workspace: string, user: string, id: string) {
    await workspaceAccess(db, workspace, user);
    const row = await db.prepare("SELECT * FROM ai_conversations WHERE id=? AND workspace_id=? AND user_id=?").bind(id, workspace, user).first<ConversationRow>();
    if (!row)
        throw notFound();
    return row;
}
export async function conversationMessages(db: D1Database, id: string): Promise<StoredMessage[]> {
    const result = await db.prepare("SELECT * FROM (SELECT rowid AS seq,* FROM ai_messages WHERE conversation_id=? ORDER BY rowid DESC LIMIT 100) ORDER BY seq").bind(id).all<{
        id: string;
        role: "user" | "assistant";
        content: string;
        status: string;
        proposed_sql: string | null;
        usage_json: string | null;
        trace_json: string;
        error_code: string | null;
        created_at: string;
    }>();
    return result.results.map(row => ({ id: row.id, role: row.role, content: row.content, status: row.status, proposedSql: row.proposed_sql, usage: row.usage_json ? JSON.parse(row.usage_json) : null, trace: JSON.parse(row.trace_json), errorCode: row.error_code, createdAt: row.created_at }));
}
export async function claimConversation(db: D1Database, row: ConversationRow) {
    const claim = crypto.randomUUID();
    const result = await db.prepare("UPDATE ai_conversations SET busy_id=? WHERE id=? AND busy_id IS NULL").bind(claim, row.id).run();
    if (result.meta.changes !== 1)
        throw new ApiError(409, "AI_BUSY", "This conversation already has a running request.");
    return claim;
}
