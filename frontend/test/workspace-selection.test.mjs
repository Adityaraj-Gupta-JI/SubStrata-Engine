import { test } from "node:test";
import assert from "node:assert/strict";
import { readWorkspaceSelection, saveWorkspaceSelection } from "../src/lib/workspace-selection.ts";

const selected = { organizationId:"11111111-1111-4111-8111-111111111111",workspaceId:"22222222-2222-4222-8222-222222222222",databaseId:"a".repeat(32) };
test("preserves nonsecret selections per authenticated user for refresh", () => {
  const values = new Map();
  const storage = { getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value) };
  saveWorkspaceSelection(storage,"user-a",{...selected,token:"must-not-persist"});
  assert.deepEqual(readWorkspaceSelection(storage,"user-a"),selected);
  assert.deepEqual(readWorkspaceSelection(storage,"user-b"),{});
  assert.equal([...values.values()].join("").includes("must-not-persist"),false);
});
test("ignores malformed IDs and tolerates unavailable storage", () => {
  const broken={getItem(){throw new Error("denied");},setItem(){throw new Error("denied");}};
  assert.deepEqual(readWorkspaceSelection(broken,"user-a"),{});
  assert.doesNotThrow(()=>saveWorkspaceSelection(broken,"user-a",selected));
  assert.deepEqual(readWorkspaceSelection({getItem:()=>JSON.stringify({...selected,workspaceId:"forged"}),setItem(){}},"user-a"),{});
});
