import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { randomBytes } from "node:crypto";
import { EncryptedCredentialVault, type VaultBucket } from "../src/neon/credential-vault";
let runtime: Miniflare;
let bucket: Awaited<ReturnType<Miniflare["getR2Bucket"]>>;
const ring = JSON.stringify({ current: randomBytes(32).toString("hex"), previous: randomBytes(32).toString("hex") });
const scope = "local-project/br-local";
const ref = (digit: string) => `neon-runtime/${digit.repeat(32)}`;
const path = (reference: string) => `credentials/${scope}/${reference}.json`;
const port: VaultBucket = {
  get: async key => { const object=await bucket.get(key); return object ? {size:object.size,etag:object.etag,json:()=>object.json()} : null; },
  put: (key,value,options)=>bucket.put(key,value,options),
};
const binding = async (reference: string) => ({tenantId:reference.split("/")[1],workspaceId:"workspace-a",purpose:"postgres-runtime" as const});
const vault = () => new EncryptedCredentialVault(port, scope, ring, "current",binding);
beforeAll(async () => {
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules:true,script:"export default { fetch() { return new Response('local'); } };",compatibilityDate:"2026-10-22",r2Buckets:["VAULT"] }),telemetry:{enabled:false} });
  bucket = await runtime.getR2Bucket("VAULT");
},30000);
afterAll(async()=>{await runtime?.dispose();});
describe("encrypted credentials in real disposable local R2 (no cloud)",()=>{
  it("stores ciphertext and resolves a stable secret from a new instance",async()=>{
    const secret = await vault().ensure(ref("a"));
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(await vault().read(ref("a"))).toBe(secret);
    const stored=await (await bucket.get(path(ref("a"))))!.text();
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("password");
  });
  it("atomically reconciles concurrent create requests",async()=>{
    const secrets=await Promise.all(Array.from({length:8},()=>vault().ensure(ref("b"))));
    expect(new Set(secrets).size).toBe(1);
  });
  it("rejects tampering, key loss and ciphertext moved to a different reference",async()=>{
    await vault().ensure(ref("c"));
    const object=await (await bucket.get(path(ref("c"))))!.json() as {ciphertext:string};
    await bucket.put(path(ref("d")),JSON.stringify(object));
    await expect(vault().read(ref("d"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    await bucket.put(path(ref("c")),JSON.stringify({...object,ciphertext:"00".repeat(80)}));
    await expect(vault().read(ref("c"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    await expect(new EncryptedCredentialVault(port,scope,JSON.stringify({current:randomBytes(32).toString("hex")}),"current",binding).read(ref("a"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
  });
  it("rewraps with a new key without rotating the PostgreSQL password",async()=>{
    const old=new EncryptedCredentialVault(port,scope,ring,"previous",binding);
    const secret=await old.ensure(ref("e"));
    await vault().rewrap(ref("e"));
    expect(await (await bucket.get(path(ref("e"))))!.json()).toMatchObject({keyId:"current"});
    expect(await vault().read(ref("e"))).toBe(secret);
    const currentOnly=JSON.stringify({current:JSON.parse(ring).current});
    expect(await new EncryptedCredentialVault(port,scope,currentOnly,"current",binding).read(ref("e"))).toBe(secret);
  });
  it("binds workspace to ciphertext and uses fresh nonces",async()=>{
    const secret=await vault().read(ref("a"));
    const before=await (await bucket.get(path(ref("a"))))!.json() as {iv:string};
    await vault().rewrap(ref("a"));
    const after=await (await bucket.get(path(ref("a"))))!.json() as {iv:string};
    expect(after.iv).not.toBe(before.iv);
    expect(after.iv).toHaveLength(24);
    const foreign=new EncryptedCredentialVault(port,scope,ring,"current",async reference=>({...await binding(reference),workspaceId:"workspace-b"}));
    await expect(foreign.read(ref("a"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    await expect(foreign.rewrap(ref("a"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    await expect(foreign.revoke(ref("a"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    const wrongTenant=new EncryptedCredentialVault(port,scope,ring,"current",async reference=>({...await binding(reference),tenantId:"b".repeat(32)}));
    await expect(wrongTenant.read(ref("a"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    await expect(wrongTenant.revoke(ref("a"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    expect(await vault().read(ref("a"))).toBe(secret);
  });
  it("reconciles a persisted create after the store response is lost",async()=>{
    const interrupted=new EncryptedCredentialVault({get:port.get,put:async(key,value,options)=>{
      await port.put(key,value,options);
      throw new Error("PRIVATE_STORE_DETAIL");
    }},scope,ring,"current",binding);
    await expect(interrupted.ensure(ref("2"))).rejects.toMatchObject({message:"Tenant provisioning is unavailable."});
    const persisted=await vault().read(ref("2"));
    expect(await vault().ensure(ref("2"))).toBe(persisted);
  });
  it("revocation fails closed and never regenerates a replacement credential",async()=>{
    await vault().ensure(ref("f"));
    await vault().revoke(ref("f"));
    await expect(vault().read(ref("f"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    await expect(vault().ensure(ref("f"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
  });
  it("fails safely on missing credentials, invalid references and store outages",async()=>{
    expect(()=>new EncryptedCredentialVault(port,scope,"{}","current",binding)).toThrow("Tenant provisioning is unavailable.");
    await expect(vault().ensure("../invalid")).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    await expect(vault().read(ref("0"))).rejects.toMatchObject({code:"MISSING_CREDENTIALS"});
    const offline = new EncryptedCredentialVault({get:async()=>{throw new Error("PRIVATE_SENTINEL");},put:port.put},scope,ring,"current",binding);
    await expect(offline.ensure(ref("1"))).rejects.toMatchObject({message:"Tenant provisioning is unavailable."});
  });
});
