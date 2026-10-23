import { CredentialCipher } from "../credentials/cipher";
import { unavailable } from "../errors";
import type { VaultBucket } from "../neon/credential-vault";
export interface CredentialScope {
    organizationId: string;
    workspaceId: string;
    connectionId: string;
}
export class ExternalCredentialStore {
    private cipher: CredentialCipher;
    constructor(private bucket: VaultBucket, keys: string, keyId: string) { this.cipher = new CredentialCipher(keys, keyId); }
    private path(scope: CredentialScope, ref: string) { if (!/^[a-f0-9]{32}$/.test(scope.connectionId) || !/^byodb-postgresql\/[a-f0-9-]{36}$/.test(ref))
        throw unavailable(); return `external-credentials/${scope.connectionId}/${ref}.json`; }
    private aad(scope: CredentialScope, ref: string) { return async (keyId: string) => new TextEncoder().encode(JSON.stringify(['byodb-v1', scope.organizationId, scope.workspaceId, scope.connectionId, 'postgresql', 'runtime-password', ref, keyId])); }
    async put(scope: CredentialScope, ref: string, password: string) { try {
        if (!password || password.length > 512 || password.includes('\0'))
            throw unavailable();
        if (!await this.bucket.put(this.path(scope, ref), JSON.stringify(await this.cipher.encrypt(password, this.aad(scope, ref))), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } }))
            throw unavailable();
    }
    catch {
        throw unavailable();
    } }
    async read(scope: CredentialScope, ref: string) { try {
        const object = await this.bucket.get(this.path(scope, ref));
        if (!object || object.size > 8192)
            throw unavailable();
        const password = await this.cipher.decrypt(await object.json(), this.aad(scope, ref), 2048);
        if (!password || password.length > 512 || password.includes('\0'))
            throw unavailable();
        return password;
    }
    catch {
        throw unavailable();
    } }
    async revoke(scope: CredentialScope, ref: string) { try {
        const object = await this.bucket.get(this.path(scope, ref));
        if (!object)
            throw unavailable();
        const content = await object.json() as {
            revoked?: boolean;
        };
        if (content?.revoked === true)
            return;
        await this.read(scope, ref);
        if (!await this.bucket.put(this.path(scope, ref), JSON.stringify({ version: 1, revoked: true }), { onlyIf: { etagMatches: object.etag }, httpMetadata: { contentType: 'application/json' } }))
            throw unavailable();
    }
    catch {
        throw unavailable();
    } }
}
export function externalStore(env: Env) { if (!env.TENANT_CREDENTIALS || !env.BYODB_VAULT_KEYS || !env.BYODB_VAULT_KEY_ID)
    throw unavailable(); return new ExternalCredentialStore(env.TENANT_CREDENTIALS, env.BYODB_VAULT_KEYS, env.BYODB_VAULT_KEY_ID); }
