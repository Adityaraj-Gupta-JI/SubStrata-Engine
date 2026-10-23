import { badRequest } from '../errors';
// MySQL-specific, intentionally small tokenizer and SELECT grammar. No PostgreSQL AST.
export function mysqlSelect(sql: unknown, database: string) {
    if (typeof sql !== 'string' || sql.length > 8192)
        throw badRequest('Enter a supported MySQL SELECT.');
    const tokens: string[] = [];
    let offset = 0;
    const pattern = /\s+|`[A-Za-z_][A-Za-z0-9_]{0,62}`|'(?:[^'\\]|'')*'|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<>|!=|<=|>=|[*,.=<>]/y;
    while (offset < sql.length) {
        pattern.lastIndex = offset;
        const m = pattern.exec(sql);
        if (!m)
            throw badRequest('Unsupported MySQL syntax. Comments, functions, parameters, multiple statements and escapes are unavailable.');
        offset = pattern.lastIndex;
        if (m[0].trim())
            tokens.push(m[0]);
    }
    let at = 0;
    const take = () => tokens[at++], is = (v: string) => tokens[at]?.toUpperCase() === v, need = (v: string) => { if (!is(v))
        throw badRequest('Unsupported MySQL SELECT structure.'); at++; };
    const id = () => { const value = take(); if (!value || !/^`?[A-Za-z_][A-Za-z0-9_]{0,62}`?$/.test(value))
        throw badRequest('Invalid MySQL identifier.'); return value.replaceAll('`', ''); };
    const quoted = (v: string) => '`' + v + '`';
    need('SELECT');
    const columns: string[] = [];
    if (is('*')) {
        take();
        columns.push('*');
    }
    else {
        columns.push(quoted(id()));
        while (is(',')) {
            take();
            columns.push(quoted(id()));
            if (columns.length > 50)
                throw badRequest('Too many columns.');
        }
    }
    need('FROM');
    if (id() !== database)
        throw badRequest('Only the approved MySQL database is available.');
    need('.');
    const table = id();
    let canonical = `SELECT ${columns.join(',')} FROM ${quoted(database)}.${quoted(table)}`;
    if (is('WHERE')) {
        take();
        const conditions: string[] = [];
        do {
            if (conditions.length)
                need('AND');
            const column = id(), operator = take();
            if (!['=', '!=', '<>', '<', '>', '<=', '>='].includes(operator))
                throw badRequest('Unsupported MySQL comparison.');
            const literal = take();
            if (!literal || !(/^(?:\d+(?:\.\d+)?|'(?:[^'\\]|'')*'|NULL|TRUE|FALSE)$/i.test(literal)))
                throw badRequest('Use literal filter values.');
            conditions.push(`${quoted(column)} ${operator} ${literal}`);
            if (conditions.length > 20)
                throw badRequest('Too many filters.');
        } while (is('AND'));
        canonical += ' WHERE ' + conditions.join(' AND ');
    }
    if (is('ORDER')) {
        take();
        need('BY');
        canonical += ' ORDER BY ' + quoted(id());
        if (is('ASC') || is('DESC'))
            canonical += ' ' + take().toUpperCase();
    }
    if (is('LIMIT')) {
        take();
        const limit = take();
        if (!/^\d+$/.test(limit) || Number(limit) > 10000)
            throw badRequest('Invalid MySQL limit.');
        canonical += ' LIMIT ' + limit;
        if (is('OFFSET')) {
            take();
            const offset = take();
            if (!/^\d+$/.test(offset) || Number(offset) > 10000)
                throw badRequest('Invalid MySQL offset.');
            canonical += ' OFFSET ' + offset;
        }
    }
    if (at !== tokens.length)
        throw badRequest('Unsupported MySQL SELECT suffix.');
    const selectedColumns=columns[0]==='*'?null:columns.map(c=>c.slice(1,-1));if(selectedColumns&&new Set(selectedColumns).size!==selectedColumns.length)throw badRequest('Duplicate columns are unsupported.');return {sql:canonical,table,selectedColumns};
}
