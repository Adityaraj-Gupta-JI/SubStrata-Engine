import { platformGet, platformPost } from "./platform";

export interface TenantDatabase {dialect?:"postgresql"|"mysql";kind?:"managed"|"external";schema?:string; id: string; workspaceId: string; name: string; state: string; retryAvailable: boolean; error: string | null }
export interface DatabaseList { data: TenantDatabase[]; capabilities: { canRead: boolean; canProvision: boolean; provisioningConfigured: boolean } }
export interface ResultGrid { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; elapsedMs: number }
export interface RowPreview extends ResultGrid { page: { limit: number; offset: number }; stableOrder: boolean; hasMore: boolean }
export interface ForeignKey { name:string; column:string; target_table:string; target_column:string }
export interface RelationMetadata { foreignKeys?:ForeignKey[]; primaryKey?:string[]; columns: { name: string; type: string; not_null: string;has_default?:string }[]; keys: { name: string; type: string; definition: string }[]; indexes: { name: string; definition: string }[] }
const root = (workspace: string) => `/workspaces/${encodeURIComponent(workspace)}/databases`;
const selected = (workspace: string, database: string) => `${root(workspace)}/${encodeURIComponent(database)}`;
export const databaseApi = {
  list: (workspace: string, token: string) => platformGet<DatabaseList>(root(workspace), token),
  provision: (workspace: string, token: string) => platformPost<{ data: TenantDatabase }>(root(workspace), token, {}),
  retry: (workspace: string, database: string, token: string) => platformPost<{ data: TenantDatabase }>(`${selected(workspace, database)}/retry`, token, {}),
  schemas: (workspace: string, database: string, token: string) => platformGet<{ data: { name: string }[] }>(`${selected(workspace, database)}/schemas`, token),
  tables: (workspace: string, database: string, schema: string, token: string) => platformGet<{ data: { name: string; kind: string }[] }>(`${selected(workspace, database)}/tables?${new URLSearchParams({ schema })}`, token),
  relation: (workspace: string, database: string, schema: string, table: string, token: string) => platformGet<{ data: RelationMetadata }>(`${selected(workspace, database)}/relation?${new URLSearchParams({ schema, table })}`, token),
  rows: (workspace: string, database: string, schema: string, table: string, offset: number, token: string) => platformGet<{ data: RowPreview }>(`${selected(workspace, database)}/rows?${new URLSearchParams({ schema, table, offset: String(offset), limit: "20" })}`, token),
  query: (workspace: string, database: string, sql: string, token: string) => platformPost<{ data: ResultGrid }>(`${selected(workspace, database)}/query`, token, { sql }),
};
