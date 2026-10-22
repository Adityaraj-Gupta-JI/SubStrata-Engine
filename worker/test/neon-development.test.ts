import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { developmentConfig, developmentServices, VaultRuntimeCredentials, type DevelopmentBindings } from "../src/neon/development";
import { EncryptedCredentialVault, type VaultBucket } from "../src/neon/credential-vault";
import { NeonApiProvider } from "../src/neon/provider";
import type { TenantMetadata } from "../src/neon/provisioning";
const settings = {projectId:"local-project",branchId:"br-local",host:"ep-local.region.aws.neon.tech",ownerRole:"admin_owner",controlDatabase:"neondb",approvedProjectId:"local-project",approvedBranchId:"br-local",allowBranchPublicRevocation:true,environment:"disposable-development"};
const ring=JSON.stringify({development:randomBytes(32).toString("hex")});
let runtime:Miniflare, db:D1Database, bucket:VaultBucket;
beforeAll(async()=>{
  runtime=new Miniflare({...convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('local');}}",compatibilityDate:"2026-10-22",d1Databases:["D1"],r2Buckets:["R2"]}),telemetry:{enabled:false}});
  db=await runtime.getD1Database("D1");
  const r2=await runtime.getR2Bucket("R2");
  bucket={get:async key=>{const object=await r2.get(key);return object?{size:object.size,etag:object.etag,json:()=>object.json()}:null;},put:(key,value,options)=>r2.put(key,value,options)};
},30000);
afterAll(async()=>{await runtime?.dispose();});
describe("development composition, real local R2 and mocked Neon API",()=>{
  it("requires exact disposable-project approval and a direct Neon endpoint",()=>{
    expect(developmentConfig(JSON.stringify(settings)).projectId).toBe(settings.projectId);
    for(const override of [{approvedBranchId:"other"},{allowBranchPublicRevocation:false},{environment:"production"},{host:"localhost"},{host:"ep-local-pooler.region.aws.neon.tech"}]){
      expect(()=>developmentConfig(JSON.stringify({...settings,...override}))).toThrow("Service unavailable.");
    }
  });
  it("fails closed without vault or keys, and does not grant provisioning to read-only configuration",()=>{
    const env:DevelopmentBindings={METADATA:db,NEON_DEVELOPMENT_CONFIG:JSON.stringify(settings)};
    expect(()=>developmentServices(env)).toThrow("Service unavailable.");
    const readonly=developmentServices({...env,TENANT_CREDENTIALS:bucket,NEON_VAULT_KEYS:ring,NEON_VAULT_KEY_ID:"development"});
    expect(readonly.provisioning).toBeUndefined();
    const configured=developmentServices({...env,TENANT_CREDENTIALS:bucket,NEON_VAULT_KEYS:ring,NEON_VAULT_KEY_ID:"development",NEON_PROVISIONING_APPROVAL:"local-project/br-local",NEON_API_KEY:"local-test-fixture",NEON_ADMIN_PASSWORD:"private-test-fixture"});
    expect(configured.provisioning?.durableSecrets).toBe(true);
    // Construction performs no HTTP, SQL or R2 mutation.
  });
  it("resolves only the pinned tenant runtime credential without admin secrets",async()=>{
    const vault=new EncryptedCredentialVault(bucket,"local-project/br-local",ring,"development",async reference=>({tenantId:reference.split("/")[1],workspaceId:"local",purpose:"postgres-runtime"}));
    const id="a".repeat(32);
    const secret=await vault.ensure(`neon-runtime/${id}`);
    const tenant:TenantMetadata={id,workspace_id:"local",organization_id:"local",project_id:settings.projectId,branch_id:settings.branchId,database_name:`ss_t_${id}`,runtime_role:`ss_r_${id}`,credential_reference:`neon-runtime/${id}`,state:"active",operation_ids:"[]",claim_id:null,retry_not_before:0,last_error:null};
    const resolver=new VaultRuntimeCredentials(settings,{read:reference=>vault.read(reference)});
    expect(await resolver.resolve(tenant)).toMatchObject({password:secret,user:tenant.runtime_role,host:settings.host});
    await expect(resolver.resolve({...tenant,branch_id:"foreign"})).rejects.toMatchObject({status:503});
    await vault.revoke(tenant.credential_reference);
    await expect(resolver.resolve(tenant)).rejects.toMatchObject({status:503});
  });
  it("verifies branch/project/host before provisioning (mocked provider responses)",async()=>{
    const config={...settings,apiKey:"local-test-fixture",approvedDisposableEnvironment:true};
    const response=(body:unknown)=>new Response(JSON.stringify(body));
    const provider=(overrides:object={})=>new NeonApiProvider(config,async url=>url.endsWith("/endpoints")?response({endpoints:[{host:settings.host,branch_id:settings.branchId,project_id:settings.projectId,type:"read_write",...overrides}]}):response({branch:{id:settings.branchId,project_id:settings.projectId,protected:false}}));
    await expect(provider().verifyEndpoint(settings.host)).resolves.toBeUndefined();
    for(const override of [{branch_id:"foreign"},{host:"ep-other.region.aws.neon.tech"},{type:"read_only"}]) await expect(provider(override).verifyEndpoint(settings.host)).rejects.toMatchObject({code:"RESOURCE_CONFLICT"});
  });
});
