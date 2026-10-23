import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(resolve(root,'worker/package.json'));
const ts=require('typescript');
const load=path=>{const parsed=ts.parseConfigFileTextToJson(path,readFileSync(resolve(root,path),'utf8'));if(parsed.error)throw new Error('Invalid staging configuration');return parsed.config;};
const frontend=load('frontend/wrangler.staging.jsonc'),api=load('worker/wrangler.staging.jsonc');
const failures=[];
if(frontend.name!=='substrata-v2-staging'||api.name!=='substrata-api-staging')failures.push('Unexpected staging Worker names');
if(frontend.routes?.length||api.routes?.length)failures.push('Staging must not claim existing routes');
if(api.d1_databases?.length!==1||api.d1_databases[0].binding!=='METADATA'||api.d1_databases[0].database_name!=='substrata-metadata-staging')failures.push('Unexpected staging D1 target');
if(api.r2_buckets?.length!==1||api.r2_buckets[0].binding!=='TENANT_CREDENTIALS'||api.r2_buckets[0].bucket_name!=='substrata-credentials-staging')failures.push('Unexpected staging R2 target');
if(api.vars?.WORKSPACE_MEMBERSHIP_MODE!=='d1'||api.vars?.CLERK_AUDIENCE!=='substrata-api-staging')failures.push('Required identity policy changed');
for(const name of ['DATABASE_EXECUTION_TARGETS','BYODB_ALLOWED_DESTINATIONS','MYSQL_ALLOWED_DESTINATIONS'])if(api.vars?.[name]!=='[]')failures.push(`${name} requires separate owner review`);
if(Object.keys(api.vars??{}).some(name=>/SECRET|PASSWORD|_KEYS$|_API_KEY$|NEON_|SQL_VAULT|BYODB_VAULT|MYSQL_VAULT|PROVISIONING_APPROVAL|DATABASE_RUNTIME/.test(name)))failures.push('Forbidden secret/enablement variable in staging vars');
const templateOnly=process.argv.includes('--template-only');
if(!templateOnly){
  if(JSON.stringify([frontend,api]).includes('REPLACE_WITH'))failures.push('Owner must resolve staging resource/origin/issuer placeholders');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(api.d1_databases?.[0]?.database_id??''))failures.push('Set the actual NEW staging D1 UUID');
  if(!/^[a-f0-9]{32}$/i.test(api.account_id??'')||api.account_id!==frontend.account_id)failures.push('Set the same approved Cloudflare account ID in both staging configs');
  for(const name of ['FRONTEND_ORIGIN','CLERK_ISSUER']){try{const url=new URL(api.vars[name]);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||api.vars[name]!==url.origin)throw new Error();}catch{failures.push(`${name} must be an exact HTTPS origin`);}}
  for(const dir of [root,resolve(root,'frontend')]){
    // Inspect filenames only. OpenNext copies dotenv contents into its Worker bundle.
    if(readdirSync(dir).some(name=>/^(?:\.env|\.dev\.vars)(?:\.|$)/.test(name)&&existsSync(resolve(dir,name))))failures.push('Use a clean staging build directory without .env or .dev.vars files');
  }
  const expectedApi=api.vars.FRONTEND_ORIGIN.replace('substrata-v2-staging.','substrata-api-staging.');
  if(process.env.NEXT_PUBLIC_PLATFORM_API_URL!==expectedApi)failures.push('Build API origin must match the isolated staging API');
  if(!/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY??''))failures.push('Set the staging public Clerk key in the build environment');
  if(process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE!==undefined)failures.push('Use the customized Clerk session token for staging; leave NEXT_PUBLIC_CLERK_JWT_TEMPLATE unset');
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(templateOnly?'Staging template isolation checks passed; NOT deployment approval.':'Staging configuration/build-input checks passed; cloud secrets/resources still require owner verification.');
