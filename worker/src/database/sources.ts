import { notFound } from "../errors";
import type { TenantMetadata } from "../neon/provisioning";
export type DataSource = TenantMetadata & {
    kind?: "managed" | "external";
    schema_name?: string;
    display_name?: string;destination_digest?:string;
};
const external = "id,workspace_id,organization_id,'external' AS project_id,destination_id AS branch_id,database_name,runtime_role,credential_reference,state,'[]' AS operation_ids,NULL AS claim_id,0 AS retry_not_before,last_error,'external' AS kind,schema_name,name AS display_name,destination_digest";
export async function dataSource(db: D1Database, id: string, workspace: string, organization: string): Promise<DataSource> {
    const managed = await db.prepare("SELECT * FROM managed_tenant_databases WHERE id=? AND workspace_id=? AND organization_id=?").bind(id, workspace, organization).first<DataSource>();
    if (managed)
        return managed;
    const row = await db.prepare(`SELECT ${external} FROM external_databases WHERE id=? AND workspace_id=? AND organization_id=?`).bind(id, workspace, organization).first<DataSource>();
    if(row)return row;
 const mysql=await db.prepare("SELECT id,workspace_id,organization_id,'external' AS project_id,destination_id AS branch_id,database_name,runtime_role,credential_reference,state,'[]' AS operation_ids,NULL AS claim_id,0 AS retry_not_before,'external' AS kind,database_name AS schema_name,name AS display_name,'mysql' AS dialect FROM mysql_databases WHERE id=? AND workspace_id=? AND organization_id=?").bind(id,workspace,organization).first<DataSource>();if(!mysql)throw notFound();return mysql;
}
export async function dataSources(db: D1Database, workspace: string, organization: string) {
    const [managed, byodb] = await Promise.all([db.prepare("SELECT * FROM managed_tenant_databases WHERE workspace_id=? AND organization_id=?").bind(workspace, organization).all<DataSource>(), db.prepare(`SELECT ${external} FROM external_databases WHERE workspace_id=? AND organization_id=? ORDER BY created_at DESC`).bind(workspace, organization).all<DataSource>()]);
    const mysql=await db.prepare("SELECT id,workspace_id,organization_id,'external' AS project_id,destination_id AS branch_id,database_name,runtime_role,credential_reference,state,'[]' AS operation_ids,NULL AS claim_id,0 AS retry_not_before,'external' AS kind,database_name AS schema_name,name AS display_name,'mysql' AS dialect FROM mysql_databases WHERE workspace_id=? AND organization_id=?").bind(workspace,organization).all<DataSource>();return [...managed.results,...byodb.results,...mysql.results];
}
