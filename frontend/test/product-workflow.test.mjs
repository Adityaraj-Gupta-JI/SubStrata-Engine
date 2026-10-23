import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupSteps,tableSelect,recordLink} from '../src/lib/product-workflow.ts';
import {readWorkspaceSelection,saveWorkspaceSelection} from '../src/lib/workspace-selection.ts';
test('onboarding resumes from selection but readiness follows current authorized state',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const selection={organizationId:'11111111-1111-4111-8111-111111111111',workspaceId:'22222222-2222-4222-8222-222222222222',databaseId:'a'.repeat(32)};
  saveWorkspaceSelection(storage,'user-a',selection);
  const restored=readWorkspaceSelection(storage,'user-a');
  assert.deepEqual(setupSteps(restored.workspaceId,{state:'active'}).map(s=>s.done),[true,true,true]);
  assert.deepEqual(setupSteps(restored.workspaceId,{state:'failed'}).map(s=>s.done),[true,true,false]);
  assert.deepEqual(setupSteps(restored.workspaceId).map(s=>s.done),[true,false,false]);
  assert.deepEqual(setupSteps(readWorkspaceSelection(storage,'user-b').workspaceId??'').map(s=>s.done),[false,false,false]);
});
test('explorer handoff creates an editable bounded dialect-specific query without executing',()=>{
  assert.equal(tableSelect('tenant_data','items'),'SELECT * FROM "tenant_data"."items" LIMIT 20');
  assert.equal(tableSelect('customer','order','mysql'),'SELECT * FROM `customer`.`order` LIMIT 20');
  assert.equal(tableSelect('a"b','x"y'),'SELECT * FROM "a""b"."x""y" LIMIT 20');
});
test('dashboard deep links preserve the exact record identity without putting it in a request body',()=>{
  for(const [route,field] of [['/chat','conversation'],['/agents','run']]){
    const href=recordLink(route,field,'id &other=value');
    const url=new URL(href,'http://localhost');
    assert.equal(url.pathname,route);assert.equal(url.search,'');
    assert.equal(new URLSearchParams(url.hash.slice(1)).get(field),'id &other=value');
  }
});
