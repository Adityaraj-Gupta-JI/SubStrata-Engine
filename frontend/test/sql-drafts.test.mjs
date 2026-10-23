import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schemaSQL,recordSQL,sqlIdentifier} from '../src/lib/sql-drafts.ts';
const draft={action:'create',schema:'tenant_data',table:'items',column:'name',type:'text',columns:'id:integer:required\nname:text',name:'items_key',targetTable:'parent',targetColumns:'id',required:false};
test('schema editor generates previews without any execution side effects',()=>{
 assert.equal(schemaSQL(draft),'CREATE TABLE "tenant_data"."items" ("id" integer NOT NULL, "name" text)');
 for(const action of ['add-column','drop-column','type','required','primary','foreign','drop-key','index','drop-table'])assert.ok(schemaSQL({...draft,action,columns:'id'}));
 assert.throws(()=>schemaSQL({...draft,columns:'id:serial'}));
 assert.throws(()=>sqlIdentifier('items; DROP DATABASE other'));
});
test('record drafts bind values separately and use the original complete primary key',()=>{
 const row={id:'9007199254740993',name:'before'};
 const updated=recordSQL('tenant_data','items','update',{name:"O'Reilly",id:'999'},['id'],row);
 assert.equal(updated.sql,'UPDATE "tenant_data"."items" SET "name"=$1 WHERE "id"=$2');
 assert.deepEqual(updated.parameters,["O'Reilly",'9007199254740993']);
 const removed=recordSQL('tenant_data','items','delete',{},['id'],row);
 assert.equal(removed.sql,'DELETE FROM "tenant_data"."items" WHERE "id"=$1');
 assert.deepEqual(removed.parameters,['9007199254740993']);
});
test('record edits and deletes fail without a complete primary key',()=>{
 for(const keys of [[],['missing']])assert.throws(()=>recordSQL('tenant_data','items','delete',{},keys,{id:'1'}));
 assert.throws(()=>recordSQL('tenant_data','items','update',{},['id'],{id:'1'}));
 assert.throws(()=>recordSQL('tenant_data','items','delete',{},['id'],{id:null}));
});
test('insert drafts preserve nulls and do not interpolate values',()=>{
 const result=recordSQL('tenant_data','items','insert',{id:'1',name:null},[],null);
 assert.equal(result.sql,'INSERT INTO "tenant_data"."items" ("id", "name") VALUES ($1, $2)');
 assert.deepEqual(result.parameters,['1',null]);
});
