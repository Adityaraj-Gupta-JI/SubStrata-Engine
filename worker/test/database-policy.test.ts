import { describe, expect, it } from "vitest";
import { approvedSelect, quoteIdentifier } from "../src/database/sql-policy";

describe("PostgreSQL AST read policy", () => {
  it.each(["SELECT * FROM tenant_data.items", "SELECT id, name FROM tenant_data.items WHERE id > $1 ORDER BY id LIMIT 20", "SELECT count(*) AS total FROM tenant_data.items", "SELECT name FROM tenant_data.items WHERE name = 'DELETE; -- is data'"])("accepts supported reads: %s", sql => {
    expect(approvedSelect(sql, [1]).sql).toMatch(/^SELECT/);
  });
  it.each([
    "INSERT INTO tenant_data.items VALUES (1)", "UPDATE tenant_data.items SET id=2", "DELETE FROM tenant_data.items", "DROP TABLE tenant_data.items",
    "SELECT * FROM tenant_data.items; DELETE FROM tenant_data.items", "SELECT * INTO tenant_data.copy FROM tenant_data.items", "SELECT * FROM tenant_data.items FOR UPDATE",
    "WITH removed AS (DELETE FROM tenant_data.items RETURNING *) SELECT * FROM removed", "SELECT pg_sleep(10) FROM tenant_data.items", "SELECT nextval('seq') FROM tenant_data.items",
    "COPY tenant_data.items TO STDOUT", "CREATE EXTENSION dblink", "SET ROLE postgres", "SELECT * FROM pg_catalog.pg_roles", "SELECT * FROM items",
    "SELECT * FROM tenant_data.items UNION SELECT * FROM tenant_data.secret", "SELECT (SELECT 1) FROM tenant_data.items", "SELECT id::regclass FROM tenant_data.items",
    "SELECT * FROM tenant_data.items JOIN tenant_data.other ON true", "SELECT count(*) OVER () FROM tenant_data.items", "SELECT * FROM tenant_data.items LIMIT 999999",
    "SELECT * FROM tenant_data.items WHERE id=$2", "SELECT lo_export(1,'/tmp/file') FROM tenant_data.items",
  ])("rejects unsupported or unsafe SQL: %s", sql => {
    expect(() => approvedSelect(sql, [1])).toThrow();
  });
  it("bounds input and parameter values and quotes identifiers", () => {
    expect(() => approvedSelect("x".repeat(8193))).toThrow();
    expect(() => approvedSelect("SELECT * FROM tenant_data.items", [{ injected: true }])).toThrow();
    expect(quoteIdentifier('odd"name')).toBe('"odd""name"');
    expect(() => quoteIdentifier("bad\0name")).toThrow();
  });
});
