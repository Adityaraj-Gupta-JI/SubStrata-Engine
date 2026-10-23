import { ApiError, badRequest, unavailable } from "../errors";
import { databaseRoute, type DatabaseServices } from "../database/gateway";
import { approvedSelect } from "../database/sql-policy";
import type { ToolDefinition, Trace } from "./contracts";
const descriptions: Record<string, string> = { list_databases: "List databases in the current authorized workspace.", list_schemas: "List schemas in the selected database.", list_tables: "List tables in the selected schema.", describe_table: "Read column, key and index metadata.", preview_table: "Preview at most five rows, only with explicit row-context permission.", propose_sql: "Propose one read-only SELECT for manual review. Does not execute SQL." };
export const toolDefinitions: ToolDefinition[] = Object.entries(descriptions).map(([name, description]) => ({ type: "function", function: { name, description, parameters: { type: "object", properties: name === "propose_sql" ? { sql: { type: "string" } } : ["describe_table", "preview_table"].includes(name) ? { table: { type: "string" } } : {}, required: name === "propose_sql" ? ["sql"] : ["describe_table", "preview_table"].includes(name) ? ["table"] : [], additionalProperties: false } } }));
export interface ToolScope {
    workspaceId: string;
    databaseId: string | null;
    userId: string;
    allowRows: boolean;
}
export class AuthorizedAITools {
    readonly trace: Trace[] = [];
    proposal: string | null = null;
    private count = 0;
    constructor(private readonly env: Env, private readonly services: DatabaseServices, private readonly scope: ToolScope, private readonly requestId: string) { }
    async database(action: string, table?: string): Promise<unknown> {
        const suffix = action === "list_databases" ? "" : `/${this.scope.databaseId}/${({ list_schemas: "schemas", list_tables: "tables", describe_table: "relation", preview_table: "rows" } as Record<string, string>)[action]}`;
        if (action !== "list_databases" && !this.scope.databaseId)
            throw new ApiError(409, "AI_DATABASE_REQUIRED", "Select an active database for schema tools.");
        const params = new URLSearchParams({ schema: "tenant_data", limit: "5", offset: "0", ...(table ? { table } : {}) });
        const response = await databaseRoute(new Request(`https://internal.invalid/api/v1/workspaces/${this.scope.workspaceId}/databases${suffix}?${params}`), this.env, this.scope.userId, this.requestId, this.services);
        if (!response || !response.ok)
            throw unavailable();
        const body = await response.json() as {
            data: unknown;
        };
        return body.data;
    }
    async execute(name: string, raw: string): Promise<unknown> {
        const start = Date.now();
        let status: Trace["status"] = "success";
        try {
            if (++this.count > 6)
                throw new ApiError(429, "AI_TOOL_LIMIT", "Tool limit reached.");
            if (!Object.hasOwn(descriptions, name))
                throw badRequest("Tool is not permitted.");
            if (raw.length > 16000)
                throw badRequest("Tool arguments are too large.");
            let args: unknown;
            try {
                args = JSON.parse(raw);
            }
            catch {
                throw badRequest("Invalid tool arguments.");
            }
            if (!args || typeof args !== "object" || Array.isArray(args))
                throw badRequest("Invalid tool arguments.");
            const value = args as Record<string, unknown>, required = name === "propose_sql" ? "sql" : ["describe_table", "preview_table"].includes(name) ? "table" : null;
            if (Object.keys(value).some(k => k !== required) || (required && typeof value[required] !== "string"))
                throw badRequest("Invalid tool arguments.");
            if (name === "propose_sql") {
                if (!this.scope.databaseId)
                    throw badRequest("Select a database before proposing SQL.");
                const sql = value.sql as string;
                if (sql.length > 12000)
                    throw badRequest("SQL proposal is too large.");
                this.proposal = approvedSelect(sql, []).sql;
                return { sql: this.proposal, executed: false, requiresManualExecution: true };
            }
            if (name === "preview_table" && !this.scope.allowRows)
                throw new ApiError(403, "AI_ROWS_NOT_ALLOWED", "Row context was not approved for this conversation.");
            if (required && (value[required] as string).length > 63)
                throw badRequest("Invalid table name.");
            return await this.database(name, required ? value[required] as string : undefined);
        }
        catch (error) {
            status = error instanceof ApiError && error.status === 503 ? "unavailable" : "denied";
            throw error;
        }
        finally {
            this.trace.push({ tool: Object.hasOwn(descriptions, name) ? name : "unknown", status, elapsedMs: Date.now() - start });
        }
    }
    async context(): Promise<string> {
        if (!this.scope.databaseId)
            return "No database selected. Database tools requiring a selection are unavailable.";
        try {
            const tables = await this.execute("list_tables", "{}") as {
                name: string;
            }[];
            const metadata = [];
            for (const table of tables.slice(0, 3))
                metadata.push({ table: table.name, description: await this.execute("describe_table", JSON.stringify({ table: table.name })) });
            return JSON.stringify({ schema: "tenant_data", tables, metadata }).slice(0, 14000);
        }
        catch {
            return "Database schema is unavailable. Do not invent tables or claim database access succeeded.";
        }
    }
}
