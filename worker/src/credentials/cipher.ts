import { unavailable } from "../errors";
export interface EncryptionEnvelope {
    version: 1;
    keyId: string;
    iv: string;
    ciphertext: string;
}
const hex = (data: Uint8Array) => Array.from(data, n => n.toString(16).padStart(2, "0")).join("");
function bytes(value: string): Uint8Array<ArrayBuffer> {
    if (!/^(?:[a-f0-9]{2})+$/.test(value))
        throw unavailable();
    return Uint8Array.from(value.match(/../g)!, n => parseInt(n, 16));
}
export type AuthenticatedMetadata = (keyId: string) => Promise<Uint8Array<ArrayBuffer>>;
// Shared Web Crypto primitive. Callers bind ownership/purpose and enforce payload policy.
export class CredentialCipher {
    private readonly keys: Readonly<Record<string, string>>;
    constructor(keyring: string, private readonly active: string) {
        try {
            const parsed: unknown = JSON.parse(keyring);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                throw unavailable();
            const entries = Object.entries(parsed);
            if (!entries.length || entries.length > 5 || entries.some(([id, key]) => !/^[-\w]{1,40}$/.test(id) || typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)))
                throw unavailable();
            this.keys = Object.freeze(Object.fromEntries(entries));
            if (!Object.hasOwn(this.keys, active))
                throw unavailable();
        }
        catch {
            throw unavailable();
        }
    }
    private async key(id: string) {
        if (!Object.hasOwn(this.keys, id))
            throw unavailable();
        const raw = bytes(this.keys[id]);
        try {
            return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
        }
        finally {
            raw.fill(0);
        }
    }
    async encrypt(value: string, metadata: AuthenticatedMetadata): Promise<EncryptionEnvelope> {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const result = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: await metadata(this.active), tagLength: 128 }, await this.key(this.active), new TextEncoder().encode(value));
        return { version: 1, keyId: this.active, iv: hex(iv), ciphertext: hex(new Uint8Array(result)) };
    }
    async decrypt(value: unknown, metadata: AuthenticatedMetadata, maxBytes = 2048): Promise<string> {
        try {
            if (!value || typeof value !== "object")
                throw unavailable();
            const e = value as Partial<EncryptionEnvelope>;
            if (e.version !== 1 || typeof e.keyId !== "string" || typeof e.iv !== "string" || e.iv.length !== 24 || typeof e.ciphertext !== "string" || e.ciphertext.length > maxBytes * 2 + 32)
                throw unavailable();
            const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(e.iv), additionalData: await metadata(e.keyId), tagLength: 128 }, await this.key(e.keyId), bytes(e.ciphertext));
            return new TextDecoder("utf-8", { fatal: true }).decode(plain);
        }
        catch {
            throw unavailable();
        }
    }
}
