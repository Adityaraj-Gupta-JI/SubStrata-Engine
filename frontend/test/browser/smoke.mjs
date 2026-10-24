import assert from 'node:assert/strict';

// Real-browser checks for the Codex browser runner (tab.playwright uses real locators).
// No test identity, API interception, stored cookies or credential values are supplied.
export const protectedRoutes=['/onboarding','/dashboard','/databases','/explorer','/sql','/sql-editor','/chat','/agents','/settings/ai','/settings/access','/settings/account'];
const base='http://localhost:3000';
export async function anonymousSmoke(tab){
  const results=[];
  for(const route of protectedRoutes){
    await tab.goto(base+route);
    await tab.playwright.getByRole('heading',{name:'Sign in to SubStrata Engine',exact:true}).waitFor({state:'visible',timeoutMs:15000});
    assert.equal(new URL(await tab.url()).pathname,'/login',`Anonymous access to ${route}`);
    results.push({route,result:'protected: login required'});
  }
  return results;
}
export async function routeSmoke(tab){
  const results=[];
  for(const route of protectedRoutes){
    await tab.goto(base+route);
    await tab.playwright.locator('#workspace-select').waitFor({state:'attached',timeoutMs:15000});
    assert.equal(new URL(await tab.url()).pathname,route,`Unexpected navigation from ${route}`);
    const main=tab.playwright.locator('#main-content');
    assert.ok((await main.innerText()).trim().length>0,`Empty ${route}`);
    assert.ok(!/Application error:|Internal Server Error|Hydration failed/.test(await main.innerText()),`Runtime failure on ${route}`);
    results.push({route,result:'authenticated page rendered'});
  }
  return results;
}
export async function browserErrors(tab){
  const logs=await tab.dev.logs({levels:['error','warn'],limit:200});
  return logs.filter(entry=>!entry.message.includes('Clerk has been loaded with development keys')).map(entry=>({
    level:entry.level,
    message:entry.message.replace(/(?:sk-or-v1-|sk_test_|sk_live_)[A-Za-z0-9_-]+/g,'[key redacted]').replace(/eyJ[A-Za-z0-9_.-]+/g,'[token redacted]').replace(/https?:\/\/[^\s)]+/g,value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return '[URL redacted]';}}),
  }));
}
// Only run while test/browser/fixture-worker.ts is the local API entry point.
// These checks are mocked-provider acceptance, never real OpenRouter acceptance.
export async function fixtureChatSmoke(tab){
  await tab.goto(base+'/chat');
  await tab.playwright.locator('#ai-model option[value="cp8c/alternate"]').waitFor({state:'attached',timeoutMs:30000});
  await tab.playwright.getByRole('button',{name:'New conversation',exact:true}).click();
  await tab.playwright.locator('#ai-model').selectOption('cp8c/alternate');
  assert.equal(await tab.playwright.getByRole('button',{name:'Send',exact:true}).isEnabled(),false,'Empty message must not submit');
  await tab.playwright.locator('#ai-message').fill('CP8C fixture:error');
  await tab.playwright.getByRole('button',{name:'Send',exact:true}).click();
  await tab.playwright.getByRole('heading',{name:'OpenRouter · failed',exact:true}).waitFor({state:'visible',timeoutMs:30000});
  await tab.playwright.locator('#ai-message').fill('CP8C recover from fixture error');
  await tab.playwright.getByRole('button',{name:'Send',exact:true}).click();
  await tab.playwright.getByRole('heading',{name:'OpenRouter · completed',exact:true}).waitFor({state:'visible',timeoutMs:30000});
  const conversation=new URL(await tab.url()).hash;
  await tab.reload();
  await tab.playwright.getByRole('heading',{name:'OpenRouter · completed',exact:true}).waitFor({state:'visible',timeoutMs:30000});
  assert.equal(new URL(await tab.url()).hash,conversation,'Conversation selection lost on refresh');
  await tab.playwright.locator('#ai-model option[value="cp8c/alternate"]').waitFor({state:'attached',timeoutMs:30000});
  assert.equal(await tab.playwright.locator('#ai-model').evaluate(e=>e.value),'cp8c/alternate');
  return {provider:'MOCKED',journey:'model switching → empty denial → provider error → recovery → conversation refresh',result:'passed'};
}
export async function fixtureAgentTerminalSmoke(tab){
  await tab.goto(base+'/agents');
  await tab.playwright.getByLabel('Saved agent',{exact:false}).locator('option').filter({hasText:'CP8C fixture data explorer'}).waitFor({state:'attached',timeoutMs:30000});
  await tab.playwright.getByLabel('Saved agent',{exact:false}).selectOption({label:'CP8C fixture data explorer'});
  // Terminal-state checks do not depend on the separate PostgreSQL fixture lifetime.
  await tab.playwright.locator('#database-selector').selectOption('');
  await tab.playwright.getByRole('button',{name:'Save configuration',exact:true}).click();
  await tab.playwright.getByText('Agent configuration saved. Run uses this saved configuration.',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  await tab.playwright.getByLabel('Goal',{exact:false}).fill('CP8C fixture:loop regression');
  await tab.playwright.getByRole('button',{name:'Run / retry as new execution',exact:true}).click();
  await tab.playwright.getByText('Execution failed.',{exact:true}).waitFor({state:'visible',timeoutMs:30000});
  assert.equal(await tab.playwright.getByRole('button',{name:'Request cancellation',exact:true}).isEnabled(),false,'Terminal run offered cancellation');
  const goal=`CP8C fixture:wait cancellation regression ${Date.now()}`;
  await tab.playwright.getByLabel('Goal',{exact:false}).fill(goal);
  await tab.playwright.getByRole('button',{name:'Run / retry as new execution',exact:true}).click();
  await tab.playwright.getByText('Running… Keep this page open.',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  const run=new URL(await tab.url()).hash;
  assert.match(run,/^#run=[a-f0-9-]{36}$/,'Run identity must be persisted before completion');
  assert.equal(await tab.playwright.getByRole('link',{name:'Open original conversation and review SQL proposals',exact:true}).count(),0,'Previous conversation leaked into new execution');
  await tab.playwright.getByRole('button',{name:'Request cancellation',exact:true}).click();
  const cancelled=tab.playwright.getByText(new RegExp(`${goal}\\s*·\\s*cancelled`));
  for(let attempt=0;attempt<25;attempt++){
    await tab.playwright.getByRole('button',{name:'Refresh persisted status',exact:true}).click();
    try{await cancelled.waitFor({state:'visible',timeoutMs:1000});break;}catch{if(attempt===24)throw new Error('Cancellation did not persist within the bounded recovery window');}
  }
  await tab.reload();
  for(let attempt=0;attempt<25;attempt++){
    try{await tab.playwright.getByText('Persisted status: cancelled',{exact:false}).waitFor({state:'visible',timeoutMs:1000});break;}catch{if(attempt===24)throw new Error('Cancelled run did not restore after refresh');}
  }
  assert.equal(new URL(await tab.url()).hash,run,'Refresh restored the wrong run');
  return {provider:'MOCKED',journey:'step bound → cancellation → correct refresh recovery',result:'passed'};
}
// Both tabs use the genuine signed-in browser and normal API. No provider
// completion is requested: a soft-deleted definition must fail before execution.
export async function failedAgentStartSmoke(tab, staleTab, model){
  const originalURL=await tab.url(), name=`Browser failed-start recovery ${Date.now()}`;
  await tab.playwright.getByLabel('Saved agent',{exact:false}).selectOption('');
  await tab.playwright.getByLabel('Name',{exact:true}).fill(name);
  await tab.playwright.locator('#ai-model').selectOption(model);
  await tab.playwright.getByRole('button',{name:'Save configuration',exact:true}).click();
  await tab.playwright.getByText('Agent configuration saved. Run uses this saved configuration.',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  await staleTab.goto(originalURL);
  // A hash-only navigation restores a run but does not remount the definitions list.
  await staleTab.reload();
  for(let attempt=0;attempt<5;attempt++){
    try{await staleTab.playwright.getByLabel('Saved agent',{exact:false}).locator('option').filter({hasText:name}).waitFor({state:'attached',timeoutMs:3000});break;}
    catch{if(attempt===4)throw new Error('Saved test definition did not load in the second tab');}
  }
  await staleTab.playwright.getByLabel('Saved agent',{exact:false}).selectOption({label:name});
  await staleTab.playwright.getByLabel('Goal',{exact:false}).fill('Deleted configuration must not start.');
  await tab.playwright.getByRole('button',{name:'Delete agent',exact:true}).click();
  await tab.playwright.getByText('Agent deleted. Existing execution history is retained.',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  await staleTab.playwright.getByRole('button',{name:'Run / retry as new execution',exact:true}).click();
  await staleTab.playwright.getByRole('alert').filter({hasText:'Resource not found.'}).waitFor({state:'visible',timeoutMs:15000});
  assert.equal(new URL(await staleTab.url()).hash,'','Failed start retained a previous run identity');
  assert.equal(await staleTab.playwright.getByText('Starting foreground execution…',{exact:true}).count(),0,'Failed start retained a running notice');
  assert.equal(await staleTab.playwright.getByRole('button',{name:'Request cancellation',exact:true}).isEnabled(),false);
  return {journey:'stale deleted definition → controlled failure → no old run identity or running notice',result:'passed',providerCalls:0};
}
export async function onboardingSmoke(tab){
  await tab.goto(base+'/onboarding');
  await tab.playwright.getByRole('button',{name:'Create or select a workspace',exact:true}).click();
  assert.ok(await tab.playwright.locator('#workspace-select').isVisible(),'Setup CTA left workspace navigation hidden');
  await tab.playwright.getByRole('button',{name:'Close',exact:true}).click();
  await tab.playwright.getByRole('button',{name:'Create or select a workspace',exact:true}).click();
  assert.ok(await tab.playwright.locator('#workspace-select').isVisible(),'Repeated setup CTA failed');
  return {route:'/onboarding',result:'workspace navigation opens repeatedly'};
}
export async function databaseReadSmoke(tab){
  await tab.goto(base+'/databases');
  await tab.playwright.locator('#database-selector option').filter({hasText:'ss_t_'}).waitFor({state:'attached',timeoutMs:15000});
  const labels=await tab.playwright.locator('#database-selector option').allTextContents({timeoutMs:5000});
  await tab.playwright.locator('#database-selector').selectOption({label:labels.find(s=>s.includes('ss_t_'))});
  await tab.playwright.getByRole('link',{name:'Explore schema',exact:true}).click();
  await tab.playwright.getByRole('button',{name:'tenant_data',exact:true}).click();
  await tab.playwright.getByRole('button',{name:'items (table)',exact:true}).click();
  await tab.playwright.getByText('item-1',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  await tab.playwright.getByRole('button',{name:'Next',exact:true}).click();
  await tab.playwright.getByText('item-21',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  await tab.reload();
  await tab.playwright.getByText('item-1',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  await tab.playwright.getByLabel('Schema filter',{exact:false}).selectOption('tenant_data');
  await tab.playwright.getByRole('button',{name:'items',exact:true}).click();
  assert.ok(await tab.playwright.getByText('department_id · integer · FK',{exact:false}).isVisible(),'Missing actual FK metadata');
  await tab.playwright.getByRole('link',{name:'Open in SQL editor',exact:true}).click();
  assert.equal(await tab.playwright.locator('#readonly-sql').evaluate(e=>e.value),'SELECT * FROM "tenant_data"."items" LIMIT 20');
  assert.equal(await tab.playwright.getByText('item-1',{exact:true}).count(),0,'Query executed during navigation');
  await tab.playwright.getByRole('button',{name:'Run SELECT',exact:true}).click();
  await tab.playwright.getByText('item-1',{exact:true}).waitFor({state:'visible',timeoutMs:15000});
  assert.ok(await tab.playwright.getByText('9007199254740993',{exact:true}).first().isVisible(),'Numeric precision lost');
  await tab.playwright.locator('#readonly-sql').fill('DELETE FROM tenant_data.items');
  await tab.playwright.getByRole('button',{name:'Preview authorized change',exact:true}).click();
  await tab.playwright.getByText('Write access is disabled.',{exact:false}).waitFor({state:'visible',timeoutMs:10000});
  assert.equal(await tab.playwright.getByRole('button',{name:'Confirm and execute once',exact:true}).count(),0);
  return {journey:'database → schema → records/pagination/refresh → FK → SQL → actual SELECT',result:'passed; writes stayed disabled'};
}
