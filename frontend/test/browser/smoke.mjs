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
