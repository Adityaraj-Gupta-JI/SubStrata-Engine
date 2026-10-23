import { parse, toSql } from 'pgsql-ast-parser';
import { createHash } from 'node:crypto';
import { badRequest } from '../errors';
export type Parameter = string | number | boolean | null;
type Node = Record<string, unknown>;
const node = (v: unknown): Node => { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw badRequest('Unsupported SQL structure.'); return v as Node; };
const keys = (v: Node, list: string[]) => { if (Object.keys(v).some(k => !list.includes(k)))
    throw badRequest('Unsupported SQL feature.'); };
export const identifier = (v: unknown) => { if (typeof v !== 'string' || !/^[_a-zA-Z][_a-zA-Z0-9]{0,62}$/.test(v) || /^pg_/i.test(v))
    throw badRequest('Use a supported database identifier.'); return v; };
export function parameters(value: unknown): Parameter[] { if (!Array.isArray(value) || value.length > 100 || value.some(v => !(v === null || typeof v === 'boolean' || typeof v === 'string' && v.length <= 2048 || typeof v === 'number' && Number.isFinite(v))))
    throw badRequest('Invalid SQL parameters.'); return value; }
export interface Change {
    sql: string;
    parameters: Parameter[];
    operation: string;
    table: string;
    capability: 'write' | 'admin';
    elevated: boolean;
    digest: string;
    dialect: 'postgresql';
}
export function changeSQL(sql: unknown, values: unknown = [], schema = 'tenant_data'): Change {
    if (typeof sql !== 'string' || sql.length > 8192 || !sql.trim())
        throw badRequest('Enter one supported SQL statement.');
    const params = parameters(values);
    let parsed;
    try {
        parsed = parse(sql);
    }
    catch {
        throw badRequest('SQL could not be parsed.');
    }
    if (parsed.length !== 1)
        throw badRequest('Exactly one statement is required.');
    const ast = node(parsed[0]);
    let table = '', elevated = false;
    let capability: 'write' | 'admin' = 'write';
    const relation = (value: unknown) => { const q = node(value); keys(q, ['schema', 'name']); if (q.schema !== schema)
        throw badRequest('Only the approved schema is available.'); return identifier(q.name); };
    const name = (value: unknown) => { const n = node(value); keys(n, ['name']); return identifier(n.name); };
    const expr = (value: unknown, refs = false, depth = 0): void => { if (depth > 10)
        throw badRequest('Expression too complex.'); const e = node(value); if (['integer', 'numeric', 'string', 'boolean', 'null'].includes(String(e.type))) {
        keys(e, ['type', 'value']);
        return;
    } if (e.type === 'parameter') {
        keys(e, ['type', 'name']);
        if (typeof e.name !== 'string' || !/^\$[1-9]\d*$/.test(e.name) || Number(e.name.slice(1)) > params.length)
            throw badRequest('Missing parameter.');
        return;
    } if (refs && e.type === 'ref') {
        keys(e, ['type', 'name']);
        identifier(e.name);
        return;
    } if (refs && e.type === 'binary') {
        keys(e, ['type', 'op', 'left', 'right']);
        if (!['=', '!=', '<>', '<', '>', '<=', '>=', 'AND', 'OR'].includes(String(e.op)))
            throw badRequest('Unsupported expression operator.');
        expr(e.left, true, depth + 1);
        expr(e.right, true, depth + 1);
        return;
    } throw badRequest('Functions, subqueries, casts and unsupported expressions are unavailable.'); };
    const dataType = (value: unknown) => { const t = node(value); keys(t, ['name', 'config']); if (!['text', 'boolean', 'smallint', 'integer', 'int', 'bigint', 'numeric', 'real', 'double precision', 'uuid', 'date', 'timestamp', 'timestamptz', 'jsonb', 'varchar'].includes(String(t.name).toLowerCase()))
        throw badRequest('Unsupported column type.'); if (t.config !== undefined && (!Array.isArray(t.config) || t.config.length > 2 || t.config.some(x => !Number.isInteger(x) || x < 0 || x > 1000)))
        throw badRequest('Unsupported type configuration.'); };
    const constraint = (value: unknown): void => { const c = node(value); if (c.constraintName)
        name(c.constraintName); if (['primary key', 'unique'].includes(String(c.type))) {
        keys(c, ['type', 'constraintName', 'columns']);
        if (c.columns) {
            if (!Array.isArray(c.columns) || !c.columns.length)
                throw badRequest('Columns required.');
            c.columns.forEach(name);
        }
        return;
    } if (['not null', 'null'].includes(String(c.type))) {
        keys(c, ['type', 'constraintName']);
        return;
    } if (c.type === 'default') {
        keys(c, ['type', 'constraintName', 'default']);
        expr(c.default);
        return;
    } if (c.type === 'foreign key') {
        keys(c, ['type', 'constraintName', 'localColumns', 'foreignTable', 'foreignColumns']);
        relation(c.foreignTable);
        if (!Array.isArray(c.foreignColumns) || !c.foreignColumns.length)
            throw badRequest('Foreign columns required.');
        c.foreignColumns.forEach(name);
        if (c.localColumns) {
            if (!Array.isArray(c.localColumns) || c.localColumns.length !== c.foreignColumns.length)
                throw badRequest('Invalid foreign key.');
            c.localColumns.forEach(name);
        }
        return;
    } throw badRequest('Unsupported constraint.'); };
    const column = (value: unknown) => { const c = node(value); keys(c, ['kind', 'name', 'dataType', 'constraints']); if (c.kind !== 'column')
        throw badRequest('Only explicit column definitions are supported.'); name(c.name); dataType(c.dataType); if (c.constraints) {
        if (!Array.isArray(c.constraints))
            throw badRequest('Invalid constraints.');
        c.constraints.forEach(constraint);
    } };
    switch (ast.type) {
        case 'insert':
            keys(ast, ['type', 'into', 'insert', 'columns']);
            table = relation(ast.into);
            if (!Array.isArray(ast.columns) || !ast.columns.length || ast.columns.length > 50)
                throw badRequest('Specify insert columns.');
            ast.columns.forEach(name);
            {
                const insert = node(ast.insert);
                keys(insert, ['type', 'values']);
                if (insert.type !== 'values' || !Array.isArray(insert.values) || !insert.values.length || insert.values.length > 100)
                    throw badRequest('Insert 1–100 explicit rows.');
                for (const row of insert.values) {
                    if (!Array.isArray(row) || row.length !== ast.columns.length)
                        throw badRequest('Column count mismatch.');
                    row.forEach(v => expr(v));
                }
            }
            break;
        case 'update':
            elevated = true;
            keys(ast, ['type', 'table', 'sets', 'where']);
            table = relation(ast.table);
            if (!Array.isArray(ast.sets) || !ast.sets.length || ast.sets.length > 50)
                throw badRequest('Set 1–50 columns.');
            for (const value of ast.sets) {
                const set = node(value);
                keys(set, ['column', 'value']);
                name(set.column);
                expr(set.value);
            }
            if (ast.where)
                expr(ast.where, true);
            else
                elevated = true;
            break;
        case 'delete':
            elevated = true;
            keys(ast, ['type', 'from', 'where']);
            table = relation(ast.from);
            if (ast.where)
                expr(ast.where, true);
            else
                elevated = true;
            break;
        case 'create table':
            keys(ast, ['type', 'name', 'columns', 'constraints']);
            table = relation(ast.name);
            capability = 'admin';
            if (!Array.isArray(ast.columns) || !ast.columns.length || ast.columns.length > 50)
                throw badRequest('Create 1–50 columns.');
            ast.columns.forEach(column);
            if (ast.constraints) {
                if (!Array.isArray(ast.constraints))
                    throw badRequest('Invalid constraints.');
                ast.constraints.forEach(constraint);
            }
            break;
        case 'alter table':
            keys(ast, ['type', 'table', 'changes']);
            table = relation(ast.table);
            capability = 'admin';
            if (!Array.isArray(ast.changes) || ast.changes.length !== 1)
                throw badRequest('Apply one schema alteration at a time.');
            {
                const change = node(ast.changes[0]);
                switch (change.type) {
                    case 'add column':
                        keys(change, ['type', 'column']);
                        column(change.column);
                        break;
                    case 'drop column':
                        keys(change, ['type', 'column']);
                        name(change.column);
                        elevated = true;
                        break;
                    case 'add constraint':
                        keys(change, ['type', 'constraint']);
                        constraint(change.constraint);
                        break;
                    case 'drop constraint':
                        keys(change, ['type', 'constraint']);
                        name(change.constraint);
                        elevated = true;
                        break;
                    case 'alter column':
                        keys(change, ['type', 'column', 'alter']);
                        name(change.column);
                        {
                            const alter = node(change.alter);
                            if (alter.type === 'set type') {
                                keys(alter, ['type', 'dataType']);
                                dataType(alter.dataType);
                                elevated = true;
                            }
                            else if (['set not null', 'drop not null', 'drop default'].includes(String(alter.type))) {
                                keys(alter, ['type']);
                                elevated = true;
                            }
                            else if (alter.type === 'set default') {
                                keys(alter, ['type', 'default']);
                                expr(alter.default);
                            }
                            else
                                throw badRequest('Unsupported column alteration.');
                        }
                        break;
                    default: throw badRequest('Unsupported table alteration.');
                }
            }
            break;
        case 'drop table':
            keys(ast, ['type', 'names']);
            if (!Array.isArray(ast.names) || ast.names.length !== 1)
                throw badRequest('Drop one table at a time.');
            table = relation(ast.names[0]);
            capability = 'admin';
            elevated = true;
            break;
        case 'create index':
            keys(ast, ['type', 'indexName', 'table', 'expressions', 'unique']);
            table = relation(ast.table);
            name(ast.indexName);
            capability = 'admin';
            if (!Array.isArray(ast.expressions) || !ast.expressions.length || ast.expressions.length > 8)
                throw badRequest('Index 1–8 columns.');
            for (const value of ast.expressions) {
                const item = node(value);
                keys(item, ['expression']);
                const e = node(item.expression);
                if (e.type !== 'ref')
                    throw badRequest('Only column indexes are supported.');
                expr(e, true);
            }
            break;
        default: throw badRequest('Unsupported change. Use the read-only gateway for SELECT.');
    }
    const canonical = toSql.statement(parsed[0]);
    return { sql: canonical, parameters: params, operation: String(ast.type), table, capability, elevated, digest: hash(JSON.stringify([canonical, params])), dialect: 'postgresql' };
}
export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
