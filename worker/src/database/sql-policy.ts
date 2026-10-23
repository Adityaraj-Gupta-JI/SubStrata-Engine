import { parse, toSql, type Expr, type SelectFromStatement } from "pgsql-ast-parser";
import { badRequest } from "../errors";

export const ROW_LIMIT = 100;
export const RESULT_BYTES = 60000;
export const CELL_ROW_CHARS = 8192;
export function quoteIdentifier(value: string): string {
  if (!value || value.includes("\0") || new TextEncoder().encode(value).length > 63) throw badRequest("Invalid database identifier.");
  return `"${value.replaceAll('"', '""')}"`;
}
export function approvedSelect(sql: unknown, parameters: unknown = [], allowedSchema="tenant_data"): { sql: string; parameters: (string | number | boolean | null)[] } {
  if (typeof sql !== "string" || sql.length > 8192 || !sql.trim() || !Array.isArray(parameters) || parameters.length > 20 ||
      parameters.some(value => !(value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 2048)))) {
    throw badRequest("Invalid query or parameters.");
  }
  const reject = () => { throw badRequest("Only supported single SELECT queries over tenant_data are allowed."); };
  let statements;
  try { statements = parse(sql); } catch { return reject(); }
  if (statements.length !== 1 || statements[0].type !== "select") return reject();
  const select: SelectFromStatement = statements[0];
  // Explicit AST shape checks: deny new/unsupported features rather than silently
  // accepting parser additions (CTEs, INTO, locks, unions, joins, subqueries, casts).
  if (Object.keys(select).some(key => !["type", "columns", "from", "where", "orderBy", "limit"].includes(key)) || select.from?.length !== 1 || !select.columns?.length || select.columns.length > 50) return reject();
  const from = select.from[0];
  if (from.type !== "table" || from.join || Object.keys(from).some(key => !["type", "name"].includes(key)) || from.name.schema !== allowedSchema) return reject();
  quoteIdentifier(from.name.name);
  const expression = (expr: Expr, depth = 0): void => {
    if (depth > 12) return reject();
    if (expr.type === "ref") {
      if (Object.keys(expr).some(key => !["type", "name", "table"].includes(key))) return reject();
      if (expr.table && (expr.table.schema || expr.table.name !== (from.name.alias ?? from.name.name))) return reject();
      if (expr.name !== "*") quoteIdentifier(expr.name);
    } else if (["integer", "numeric", "string", "boolean", "null"].includes(expr.type)) {
      if (Object.keys(expr).some(key => !["type", "value"].includes(key))) return reject();
    } else if (expr.type === "parameter") {
      const position = Number(expr.name.slice(1));
      if (!Number.isInteger(position) || position < 1 || position > parameters.length) return reject();
    } else if (expr.type === "binary") {
      if (!["=", "!=", "<>", "<", ">", "<=", ">=", "AND", "OR", "+", "-", "*", "/", "%", "LIKE", "NOT LIKE", "ILIKE", "NOT ILIKE"].includes(expr.op)) return reject();
      expression(expr.left, depth + 1); expression(expr.right, depth + 1);
    } else if (expr.type === "unary") {
      if (!["NOT", "+", "-", "IS NULL", "IS NOT NULL"].includes(expr.op)) return reject();
      expression(expr.operand, depth + 1);
    } else if (expr.type === "call") {
      if (Object.keys(expr).some(key => !["type", "function", "args"].includes(key)) || expr.function.schema ||
          !["count", "min", "max", "sum", "avg"].includes(expr.function.name) || expr.args.length !== 1) return reject();
      expression(expr.args[0], depth + 1);
    } else return reject();
  };
  for (const column of select.columns) {
    if (Object.keys(column).some(key => !["expr", "alias"].includes(key))) return reject();
    expression(column.expr);
  }
  if (select.where) expression(select.where);
  for (const order of select.orderBy ?? []) {
    if (Object.keys(order).some(key => !["by", "order", "nulls"].includes(key))) return reject();
    expression(order.by);
  }
  if (select.limit) {
    if (Object.keys(select.limit).some(key => !["limit", "offset"].includes(key))) return reject();
    for (const value of [select.limit.limit, select.limit.offset]) if (value && (value.type !== "integer" || value.value < 0 || value.value > 10000)) return reject();
  }
  // Execute canonical SQL produced by the parser, never the original input.
  return { sql: toSql.statement(select), parameters };
}
