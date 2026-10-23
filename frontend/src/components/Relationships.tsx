"use client";
import {useEffect,useRef,useState} from 'react';
import {databaseApi,type RelationMetadata} from '@/lib/api/databases';
import {useDatabaseWorkspace} from './DatabaseWorkspace';
import {aiButton,aiError,aiPanel} from './AIProviderState';
const pageSize=12;
export function Relationships({workspace,schemas,onOpen}:{workspace:ReturnType<typeof useDatabaseWorkspace>;schemas:{name:string}[];onOpen:(schema:string,table:string)=>void}) {
  const [schema,setSchema]=useState(''),[page,setPage]=useState(0),[tables,setTables]=useState<string[]>([]),[relations,setRelations]=useState<Record<string,RelationMetadata>>({}),[selected,setSelected]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const generation=useRef(0);
  const {workspaceId,databaseId,token}=workspace;
  useEffect(()=>{let cancelled=false;const current=++generation.current;void(async()=>{
    if(!schema){setLoading(false);return;}
    setLoading(true);setError('');setRelations({});setSelected('');setTables([]);
    try{const auth=await token();const list=(await databaseApi.tables(workspaceId,databaseId,schema,auth)).data.map(t=>t.name);if(cancelled)return;setTables(list);
      // Sequential requests cap concurrent database connections. No row previews or scans.
      const loaded:Record<string,RelationMetadata>={};
      for(const table of list.slice(page*pageSize,(page+1)*pageSize)){if(cancelled||current!==generation.current)return;loaded[table]=(await databaseApi.relation(workspaceId,databaseId,schema,table,auth)).data;}
      if(!cancelled&&current===generation.current)setRelations(loaded);
    }catch(e){if(!cancelled)setError(aiError(e));}finally{if(!cancelled)setLoading(false);}
  })();return()=>{cancelled=true;};},[schema,page,workspaceId,databaseId,token]);
  const names=Object.keys(relations),edges=names.flatMap(name=>(relations[name].foreignKeys??[]).map(f=>({...f,source:name}))),height=Math.max(160,names.length*92);
  return <section className={aiPanel} aria-label="Schema relationships"><h2 className="font-bold">Schema relationships</h2><label>Schema filter<select className="ml-3 max-w-full rounded bg-[#131522] p-2" value={schema} onChange={e=>{setSchema(e.target.value);setPage(0);}}><option value="">Choose a schema</option>{schemas.map(s=><option key={s.name}>{s.name}</option>)}</select></label><p className="text-sm text-[#8b9bb4]">Metadata only · up to 12 tables per page. Relationships outside this page are listed below. Catalog limits may require narrowing a large schema.</p>{loading&&<p role="status">Loading authorized relationship metadata…</p>}{error&&<p role="alert">{error} <button className={aiButton} onClick={()=>{setSchema('');setPage(0);}}>Reset and retry</button></p>}
    {!!names.length&&<><div className="overflow-auto"><svg role="img" aria-label="Table relationship edges; equivalent links and columns below" viewBox={`0 0 700 ${height}`} className="min-w-[500px] w-full" style={{maxHeight:500}}>{edges.filter(e=>names.includes(e.target_table)).map((e,i)=>{const a=names.indexOf(e.source)*92+36,b=names.indexOf(e.target_table)*92+36;return <path key={i} d={`M 300 ${a} C 620 ${a},620 ${b},300 ${b}`} fill="none" stroke="#00f0ff"><title>{e.source}.{e.column} → {e.target_table}.{e.target_column}</title></path>;})}{names.map((name,i)=><g key={name} role="button" tabIndex={0} aria-label={`Select table ${name}`} onClick={()=>setSelected(name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelected(name);}}}><rect x="10" y={i*92+10} width="290" height="52" rx="8" fill={selected===name?'#432037':'#131522'} stroke="#8b9bb4"/><text x="25" y={i*92+42} fill="#e0e6ed">{name.length>30?name.slice(0,27)+'…':name}</text></g>)}</svg></div><div className="flex flex-wrap gap-2">{names.map(name=><button key={name} className={aiButton} aria-pressed={selected===name} onClick={()=>setSelected(name)}>{name}</button>)}</div>{selected&&<div><h3 className="font-bold">{schema}.{selected}</h3><ul>{relations[selected].columns.map(c=><li key={c.name}>{c.name} · {c.type}{relations[selected].primaryKey?.includes(c.name)?' · PK':''}{relations[selected].foreignKeys?.some(f=>f.column===c.name)?' · FK':''}</li>)}</ul><button className={aiButton} onClick={()=>onOpen(schema,selected)}>Inspect records and table details</button></div>}{edges.length?<ul className="space-y-2">{edges.map((e,i)=><li key={i}>{e.source}.{e.column} → <button className="underline" onClick={()=>onOpen(schema,e.target_table)}>{e.target_table}.{e.target_column}</button> ({e.name})</li>)}</ul>:<p>No foreign keys returned for these tables in the authorized schema.</p>}</>}
    {schema&&!loading&&!error&&!tables.length&&<p>No readable tables.</p>}{tables.length>pageSize&&<div className="flex items-center gap-3"><button className={aiButton} disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Previous tables</button><span>Page {page+1}</span><button className={aiButton} disabled={loading||(page+1)*pageSize>=tables.length} onClick={()=>setPage(p=>p+1)}>Next tables</button></div>}
  </section>;
}
