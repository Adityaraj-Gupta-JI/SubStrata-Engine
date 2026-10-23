import type { DataSource } from '../database/sources';
import { approvedSelect } from '../database/sql-policy';
import { changeSQL } from '../execution/policy';
import { mysqlSelect } from '../mysql/policy';
export function sqlProposal(source: DataSource, sql: string) {
    if (source.dialect === 'mysql')
        return { sql: mysqlSelect(sql, source.database_name).sql, dialect: 'mysql', risk: 'read', executed: false, requiresManualExecution: true };
    try {
        return { sql: approvedSelect(sql, [], source.schema_name ?? 'tenant_data').sql, dialect: 'postgresql', risk: 'read', executed: false, requiresManualExecution: true };
    }
    catch {
        const change = changeSQL(sql, [], source.schema_name ?? 'tenant_data');
        return { sql: change.sql, dialect: 'postgresql', risk: change.elevated ? 'elevated' : change.capability, executed: false, requiresManualExecution: true, requiresApproval: true };
    }
}
