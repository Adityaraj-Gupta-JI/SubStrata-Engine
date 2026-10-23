import { ApiError } from "../errors";
export interface MySQLReadAdapter {
    test(): Promise<void>;
    schemas(): Promise<unknown>;
    tables(schema: string): Promise<unknown>;
    columns(schema: string, table: string): Promise<unknown>;
    preview(schema: string, table: string): Promise<unknown>;
}
// No mysql driver is installed or validated on this Worker target. Never report
// mocked transport behavior as supported MySQL connectivity.
export class UnavailableMySQLAdapter implements MySQLReadAdapter {
    private unavailable(): never { throw new ApiError(501, 'MYSQL_UNAVAILABLE', 'MySQL transport, TLS pinning and read-only authorization have not been validated in this runtime.'); }
    async test() { return this.unavailable(); }
    async schemas() { return this.unavailable(); }
    async tables(_schema: string) { return this.unavailable(); }
    async columns(_schema: string, _table: string) { return this.unavailable(); }
    async preview(_schema: string, _table: string) { return this.unavailable(); }
}
