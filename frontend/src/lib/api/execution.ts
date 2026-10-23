import { platformGet, platformPost } from './platform';
export type SqlValue = string | number | boolean | null;
export interface ChangePreview {
    sql: string;
    parameters: SqlValue[];
    operation: string;
    risk: string;
    capability: string;
    confirmation: string;
    approvalToken: string;
    expiresAt: number;
    dialect: string;
}
export interface WriteAccess {
    dialect: string;
    databaseName: string;
    enabled: boolean;
    canWrite: boolean;
    canAdmin: boolean;
    canManage: boolean;
    configured: boolean;
    reason: string;
}
export interface Execution {
    id: string;
    operation: string;
    risk: string;
    status: string;
    affected_rows: number | null;
    error_code: string | null;
    created_at: string;
}
const root = (w: string, d: string) => `/workspaces/${encodeURIComponent(w)}/databases/${encodeURIComponent(d)}`;
export const executionApi = {
    access: (w: string, d: string, t: string) => platformGet<{
        data: WriteAccess;
    }>(`${root(w, d)}/write-access`, t),
    register: (w: string, d: string, t: string, capability: string, password: string, confirmation: string) => platformPost(`${root(w, d)}/write-access`, t, { action: 'register', capability, password, confirmation }),
    enable: (w: string, d: string, t: string, enabled: boolean, confirmation: string) => platformPost(`${root(w, d)}/write-access`, t, { enabled, confirmation }),
    preview: (w: string, d: string, t: string, sql: string, parameters: SqlValue[] = []) => platformPost<{
        data: ChangePreview;
    }>(`${root(w, d)}/change-preview`, t, { sql, parameters }),
    execute: (w: string, d: string, t: string, preview: ChangePreview, confirmation: string) => platformPost<{
        data: {
            executionId: string;
            status: string;
            affectedRows: number;
            elapsedMs: number;
        };
    }>(`${root(w, d)}/change-execute`, t, { sql: preview.sql, parameters: preview.parameters, approvalToken: preview.approvalToken, confirmation }),
    history: (w: string, d: string, t: string) => platformGet<{
        data: Execution[];
    }>(`${root(w, d)}/change-history`, t),
};
