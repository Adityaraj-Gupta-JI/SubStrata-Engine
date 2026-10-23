import { validateKey } from "./openrouter";
import { unavailable, notFound } from "../errors";
import { CredentialCipher } from "../credentials/cipher";
import type { VaultBucket } from "../neon/credential-vault";
export interface UserCredentialStore {
    put(userId: string, reference: string, key: string): Promise<void>;
    read(userId: string, reference: string): Promise<string>;
    revoke(userId: string, reference: string): Promise<void>;
}
// Same bucket port and encryption primitive as tenant credentials; separate keys,
// path namespace and authenticated user/provider/purpose metadata.
export class EncryptedAIKeys implements UserCredentialStore {
    private readonly cipher: CredentialCipher;
    constructor(private readonly bucket: VaultBucket, keyring: string, keyId: string) { this.cipher = new CredentialCipher(keyring, keyId); }
    private path(userId: string, ref: string) {
        if (!/^[a-f0-9-]{36}$/.test(userId) || !/^ai-openrouter\/[a-f0-9-]{36}$/.test(ref))
            throw unavailable();
        return `ai-credentials/${userId}/${ref}.json`;
    }
    private metadata(userId: string, ref: string) { this.path(userId, ref); return async (keyId: string) => new TextEncoder().encode(JSON.stringify(["ai-key-v1", userId, "openrouter", "api-key", ref, keyId])); }
    async put(userId: string, ref: string, key: string) {
        validateKey(key);
        try {
            const saved = await this.bucket.put(this.path(userId, ref), JSON.stringify(await this.cipher.encrypt(key, this.metadata(userId, ref))), { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" } });
            if (!saved)
                throw unavailable();
        }
        catch {
            throw unavailable();
        }
    }
    async read(userId: string, ref: string) {
        try {
            const object = await this.bucket.get(this.path(userId, ref));
            if (!object || object.size > 8192)
                throw unavailable();
            const key = await this.cipher.decrypt(await object.json(), this.metadata(userId, ref), 512);
            validateKey(key);
            return key;
        }
        catch {
            throw unavailable();
        }
    }
    async revoke(userId: string, ref: string) {
        try {
            const path = this.path(userId, ref), object = await this.bucket.get(path);
            if (!object)
                throw notFound();
            await this.cipher.decrypt(await object.json(), this.metadata(userId, ref), 512);
            if (!await this.bucket.put(path, JSON.stringify({ version: 1, revoked: true }), { onlyIf: { etagMatches: object.etag }, httpMetadata: { contentType: "application/json" } }))
                throw unavailable();
        }
        catch {
            throw unavailable();
        }
    }
    async rewrap(userId: string, ref: string) {
        try {
            const path = this.path(userId, ref), object = await this.bucket.get(path);
            if (!object || object.size > 8192)
                throw unavailable();
            const key = await this.cipher.decrypt(await object.json(), this.metadata(userId, ref), 512);
            if (!await this.bucket.put(path, JSON.stringify(await this.cipher.encrypt(key, this.metadata(userId, ref))), { onlyIf: { etagMatches: object.etag }, httpMetadata: { contentType: "application/json" } }))
                throw unavailable();
        }
        catch {
            throw unavailable();
        }
    }
}
export function aiKeyStore(env: Env): UserCredentialStore {
    if (!env.TENANT_CREDENTIALS || !env.AI_VAULT_KEYS || !env.AI_VAULT_KEY_ID)
        throw unavailable();
    return new EncryptedAIKeys(env.TENANT_CREDENTIALS, env.AI_VAULT_KEYS, env.AI_VAULT_KEY_ID);
}
