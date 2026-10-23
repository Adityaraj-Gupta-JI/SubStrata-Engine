"use client";
import { useState } from 'react';
import type { RelationMetadata, RowPreview } from '@/lib/api/databases';
import { schemaSQL, recordSQL, columnTypes, type SchemaDraft } from '@/lib/sql-drafts';
import { ApprovedChange } from './ApprovedChange';
import { aiButton, aiInput, aiPanel, aiError } from './AIProviderState';
import type { useDatabaseWorkspace } from './DatabaseWorkspace';
type Workspace = ReturnType<typeof useDatabaseWorkspace>;
export function SchemaEditor({ workspace, schema, table = '', onCommitted }: {
    workspace: Workspace;
    schema: string;
    table?: string;
    onCommitted: () => void;
}) {
    const [draft, setDraft] = useState<SchemaDraft>({ action: table ? 'add-column' : 'create', schema, table, column: '', type: 'text', columns: 'id:integer:required\nname:text', name: '', targetTable: '', targetColumns: '', required: false }), [sql, setSQL] = useState(''), [error, setError] = useState('');
    const set = (key: keyof SchemaDraft, value: string | boolean) => { setDraft(d => ({ ...d, [key]: value })); setSQL(''); setError(''); };
    function preview() { try {
        setSQL(schemaSQL(draft));
        setError('');
    }
    catch (e) {
        setError(aiError(e));
    } }
    if (workspace.database?.dialect === 'mysql')
        return <p>MySQL schema editing is unavailable; this connection is read-only.</p>;
    return <details className={aiPanel}><summary>Schema editor · preview before applying</summary><label className="block">Operation<select className={aiInput} value={draft.action} onChange={e => set('action', e.target.value)}>{[['create', 'Create table'], ['add-column', 'Add column'], ['drop-column', 'Remove column'], ['type', 'Change supported type'], ['required', 'Change NOT NULL'], ['primary', 'Add primary key'], ['foreign', 'Add foreign key'], ['drop-key', 'Remove constraint'], ['index', 'Create index'], ['drop-table', 'Drop table']].map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></label><label className="block">Table<input className={aiInput} value={draft.table} onChange={e => set('table', e.target.value)}/></label>{['add-column', 'drop-column', 'type', 'required'].includes(draft.action) && <label className="block">Column<input className={aiInput} value={draft.column} onChange={e => set('column', e.target.value)}/></label>}{['add-column', 'type'].includes(draft.action) && <label className="block">Type<select className={aiInput} value={draft.type} onChange={e => set('type', e.target.value)}>{columnTypes.map(t => <option key={t}>{t}</option>)}</select></label>}{['add-column', 'required'].includes(draft.action) && <label className="flex gap-2"><input type="checkbox" checked={draft.required} onChange={e => set('required', e.target.checked)}/>NOT NULL</label>}{['create', 'primary', 'foreign', 'index'].includes(draft.action) && <label className="block">{draft.action === 'create' ? 'Columns, one name:type[:required] per line' : 'Columns, comma separated'}<textarea className={aiInput} rows={4} value={draft.columns} onChange={e => set('columns', e.target.value)}/></label>}{['primary', 'foreign', 'index', 'drop-key'].includes(draft.action) && <label className="block">Constraint / index name<input className={aiInput} value={draft.name} onChange={e => set('name', e.target.value)}/></label>}{draft.action === 'foreign' && <><label className="block">Referenced table in the same schema<input className={aiInput} value={draft.targetTable} onChange={e => set('targetTable', e.target.value)}/></label><label className="block">Referenced columns<input className={aiInput} value={draft.targetColumns} onChange={e => set('targetColumns', e.target.value)}/></label></>}<button type="button" className={aiButton} onClick={preview}>Generate SQL preview</button>{error && <p role="alert">{error}</p>}{sql && <><pre className="whitespace-pre-wrap break-words">{sql}</pre><ApprovedChange workspace={workspace} sql={sql} onCommitted={() => { setSQL(''); onCommitted(); }}/></>}<p className="text-xs text-[#8b9bb4]">One change at a time. Destructive changes require owner approval. No CASCADE, arbitrary defaults, identity sequences or user-defined types.</p></details>;
}
export function RecordEditor({ workspace, schema, table, metadata, preview, onCommitted }: {
    workspace: Workspace;
    schema: string;
    table: string;
    metadata: RelationMetadata;
    preview: RowPreview;
    onCommitted: () => void;
}) {
    const [operation, setOperation] = useState<'insert' | 'update' | 'delete'>('insert'), [selected, setSelected] = useState(-1), [values, setValues] = useState<Record<string, string | null>>(() => Object.fromEntries(metadata.columns.map(c => [c.name, '']))), [included, setIncluded] = useState<Record<string, boolean>>(() => Object.fromEntries(metadata.columns.map(c => [c.name, editable(c.type) && c.has_default !== 'true']))), [proposal, setProposal] = useState<{
        sql: string;
        parameters: (string | null)[];
    } | null>(null), [error, setError] = useState('');
    const pk = metadata.primaryKey ?? [], original = selected >= 0 ? preview.rows[selected] : null;
    function editable(type: string) { return !type.includes('[]') && /^(text|character varying|varchar|uuid|boolean|integer|bigint|smallint|numeric|decimal|real|double precision|date|timestamp|jsonb?)(?:\b|\()/i.test(type); }
    function choose(index: number, op: typeof operation) { setSelected(index); setOperation(op); setValues(Object.fromEntries(metadata.columns.map(c => [c.name, index >= 0 ? (preview.rows[index][c.name] === null ? null : String(preview.rows[index][c.name])) : '']))); setIncluded(Object.fromEntries(metadata.columns.map(c => [c.name, editable(c.type) && c.has_default !== 'true' && !(op !== 'insert' && pk.includes(c.name))]))); setProposal(null); setError(''); }
    function prepare() { try {
        const row = Object.fromEntries(Object.entries(values).filter(([name]) => included[name]));
        for (const c of metadata.columns) {
            const value = row[c.name];
            if (c.type.startsWith('json') && value != null)
                JSON.parse(value);
        }
        setProposal(recordSQL(schema, table, operation, row, pk, original));
        setError('');
    }
    catch (e) {
        setError(aiError(e));
    } }
    if (workspace.database?.dialect === 'mysql')
        return <p>MySQL record editing is unavailable; this connection is read-only.</p>;
    return <details className={aiPanel}><summary>Record editor · primary-key updates and deletes</summary><p>Record values remain local until submitted for a server preview. Page order is not a snapshot.</p><div className="flex flex-wrap gap-3"><button className={aiButton} type="button" onClick={() => choose(-1, 'insert')}>New record / clear unsaved changes</button><button className={aiButton} type="button" disabled={!pk.length || !original} onClick={() => choose(selected, 'update')}>Edit selected record</button><button className={aiButton} type="button" disabled={!pk.length || !original} onClick={() => choose(selected, 'delete')}>Delete selected record</button></div><label className="block">Record on this page<select className={aiInput} value={selected} onChange={e => choose(Number(e.target.value), 'update')}><option value={-1}>New record</option>{preview.rows.map((row, i) => <option key={i} value={i}>{pk.length ? pk.map(k => `${k}=${row[k]}`).join(', ') : `Row ${i + 1} (no primary key)`}</option>)}</select></label>{!pk.length && <p role="status">Editing and deletion require a primary key. Inserts remain available with authorized write access.</p>}<p>Operation: {operation}</p>{operation !== 'delete' && metadata.columns.map(c => <div className="space-y-1" key={c.name}><label className="flex gap-2"><input type="checkbox" checked={!!included[c.name]} disabled={!editable(c.type) || operation !== 'insert' && pk.includes(c.name)} onChange={e => { setIncluded(v => ({ ...v, [c.name]: e.target.checked })); setProposal(null); }}/>Include {c.name} · {c.type}{c.has_default === 'true' ? ' (default available)' : ''}</label>{included[c.name] && <><label className="sr-only" htmlFor={`record-${c.name}`}>Value for {c.name}</label>{c.type === 'boolean' ? <select id={`record-${c.name}`} className={aiInput} value={values[c.name] ?? ''} disabled={values[c.name] === null} onChange={e => { setValues(v => ({ ...v, [c.name]: e.target.value })); setProposal(null); }}><option value="">Choose boolean</option><option>true</option><option>false</option></select> : <input id={`record-${c.name}`} className={aiInput} type={c.type === 'date' ? 'date' : 'text'} inputMode={/int|numeric|decimal|real|double/.test(c.type) ? 'decimal' : 'text'} disabled={values[c.name] === null} value={values[c.name] ?? ''} onChange={e => { setValues(v => ({ ...v, [c.name]: e.target.value })); setProposal(null); }}/>}<label className="flex gap-2"><input type="checkbox" checked={values[c.name] === null} disabled={c.not_null === 'true'} onChange={e => { setValues(v => ({ ...v, [c.name]: e.target.checked ? null : '' })); setProposal(null); }}/>NULL</label></>}</div>)}<button type="button" className={aiButton} disabled={operation !== 'insert' && (!original || !pk.length)} onClick={prepare}>Generate record change preview</button>{error && <p role="alert">{error}</p>}{proposal && <><pre className="whitespace-pre-wrap break-words">{proposal.sql}</pre><ApprovedChange workspace={workspace} {...proposal} onCommitted={() => { choose(-1, 'insert'); onCommitted(); }}/></>}</details>;
}
