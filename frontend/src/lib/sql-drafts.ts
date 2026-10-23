export const columnTypes = ['text', 'integer', 'bigint', 'numeric', 'boolean', 'uuid', 'date', 'timestamp', 'timestamptz', 'jsonb', 'varchar'] as const;
export function sqlIdentifier(value: string) { if (!/^[_a-zA-Z][_a-zA-Z0-9]{0,62}$/.test(value))
    throw new Error('Use letters, numbers and underscores in identifiers.'); return '"' + value + '"'; }
export function columnList(value: string) { const names = value.split(',').map(v => v.trim()).filter(Boolean); if (!names.length || names.length > 8)
    throw new Error('Enter 1–8 column names.'); return names.map(sqlIdentifier).join(', '); }
export interface SchemaDraft {
    action: string;
    schema: string;
    table: string;
    column: string;
    type: string;
    columns: string;
    name: string;
    targetTable: string;
    targetColumns: string;
    required: boolean;
}
export function schemaSQL(d: SchemaDraft) {
    const target = sqlIdentifier(d.schema) + '.' + sqlIdentifier(d.table), column = () => sqlIdentifier(d.column);
    if (!columnTypes.includes(d.type as typeof columnTypes[number]))
        throw new Error('Unsupported column type.');
    switch (d.action) {
        case 'create': {
            const columns = d.columns.split('\n').map(l => l.trim()).filter(Boolean);
            if (!columns.length || columns.length > 50)
                throw new Error('Enter 1–50 columns, one name:type per line.');
            const definitions = columns.map(line => { const [name, type, required, ...rest] = line.split(':').map(v => v.trim()); if (!columnTypes.includes(type as typeof columnTypes[number]) || rest.length || required && required !== 'required')
                throw new Error('Use name:type or name:type:required.'); return sqlIdentifier(name) + ' ' + type + (required ? ' NOT NULL' : ''); });
            return `CREATE TABLE ${target} (${definitions.join(', ')})`;
        }
        case 'add-column': return `ALTER TABLE ${target} ADD COLUMN ${column()} ${d.type}${d.required ? ' NOT NULL' : ''}`;
        case 'drop-column': return `ALTER TABLE ${target} DROP COLUMN ${column()}`;
        case 'type': return `ALTER TABLE ${target} ALTER COLUMN ${column()} TYPE ${d.type}`;
        case 'required': return `ALTER TABLE ${target} ALTER COLUMN ${column()} ${d.required ? 'SET' : 'DROP'} NOT NULL`;
        case 'primary': return `ALTER TABLE ${target} ADD CONSTRAINT ${sqlIdentifier(d.name)} PRIMARY KEY (${columnList(d.columns)})`;
        case 'foreign': return `ALTER TABLE ${target} ADD CONSTRAINT ${sqlIdentifier(d.name)} FOREIGN KEY (${columnList(d.columns)}) REFERENCES ${sqlIdentifier(d.schema)}.${sqlIdentifier(d.targetTable)} (${columnList(d.targetColumns)})`;
        case 'drop-key': return `ALTER TABLE ${target} DROP CONSTRAINT ${sqlIdentifier(d.name)}`;
        case 'index': return `CREATE INDEX ${sqlIdentifier(d.name)} ON ${target} (${columnList(d.columns)})`;
        case 'drop-table': return `DROP TABLE ${target}`;
        default: throw new Error('Choose a supported schema operation.');
    }
}
export function recordSQL(schema: string, table: string, operation: 'insert' | 'update' | 'delete', values: Record<string, string | null>, primaryKey: string[], original: Record<string, unknown> | null) {
    const target = sqlIdentifier(schema) + '.' + sqlIdentifier(table), parameters: (string | null)[] = [];
    const bind = (value: string | null) => { parameters.push(value); return '$' + parameters.length; };
    if (operation === 'insert') {
        const names = Object.keys(values);
        if (!names.length)
            throw new Error('Include at least one column.');
        return { sql: `INSERT INTO ${target} (${names.map(sqlIdentifier).join(', ')}) VALUES (${names.map(n => bind(values[n])).join(', ')})`, parameters };
    }
    if (!primaryKey.length || !original || primaryKey.some(k => original[k] === null || original[k] === undefined))
        throw new Error('A complete primary key is required to edit or delete a record.');
    const sets = Object.keys(values).filter(k => !primaryKey.includes(k));
    if (operation === 'update' && !sets.length)
        throw new Error('Include at least one non-key column.');
    const set = operation === 'update' ? ' SET ' + sets.map(k => `${sqlIdentifier(k)}=${bind(values[k])}`).join(', ') : '';
    const where = primaryKey.map(k => `${sqlIdentifier(k)}=${bind(String(original[k]))}`).join(' AND ');
    return { sql: `${operation === 'update' ? 'UPDATE' : 'DELETE FROM'} ${target}${set} WHERE ${where}`, parameters };
}
