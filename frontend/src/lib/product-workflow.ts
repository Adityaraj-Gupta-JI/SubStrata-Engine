// Nonsecret setup facts are derived from server state; no completion flags grant access.
export function setupSteps(workspaceId: string, database?: {state:string}) {
  return [
    {id:'workspace',title:'Create or select a workspace',href:'#workspace-select',done:!!workspaceId},
    {id:'database',title:'Connect a database',href:'/databases',done:!!database},
    {id:'ready',title:'Verify database readiness',href:'/databases',done:database?.state==='active'},
  ];
}
export function tableSelect(schema:string, table:string, dialect:'postgresql'|'mysql'='postgresql') {
  const q = dialect==='mysql'?'`':'"';
  const quote=(value:string)=>q+value.replaceAll(q,q+q)+q;
  return `SELECT * FROM ${quote(schema)}.${quote(table)} LIMIT 20`;
}
export function recordLink(route:'/chat'|'/agents', field:'conversation'|'run', id:string) {
  return `${route}#${new URLSearchParams({[field]:id})}`;
}
