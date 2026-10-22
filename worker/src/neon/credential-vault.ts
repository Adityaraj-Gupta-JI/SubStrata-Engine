import { ProvisioningError } from "./contracts";

export interface VaultBucket {
  get(key: string): Promise<{ size: number; etag: string; json(): Promise<unknown> } | null>;
  put(key: string, value: string, options: { onlyIf: { etagDoesNotMatch?: string; etagMatches?: string }; httpMetadata: { contentType: string } }): Promise<{ etag: string } | null>;
}
export type CredentialBinding = (reference: string) => Promise<{ tenantId: string; workspaceId: string; purpose: "postgres-runtime" }>;
interface Envelope { version: 1; keyId: string; iv: string; ciphertext: string }
const unavailable = () => new ProvisioningError("MISSING_CREDENTIALS");
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
function bytes(value: string, length?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/.test(value) || (length && value.length !== length * 2)) throw unavailable();
  return Uint8Array.from(value.match(/../g)!, part => parseInt(part, 16));
}

// Ciphertext only in R2. Encryption keys are supplied as Worker secrets, never
// stored in this bucket or D1. No public credential/rotation/deletion endpoint.
export class EncryptedCredentialVault {
  private readonly keys: Readonly<Record<string, string>>;
  constructor(private readonly bucket: VaultBucket, private readonly scope: string, keyRing: string, private readonly keyId: string, private readonly binding: CredentialBinding) {
    try {
      if (!/^[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}$/.test(scope) || !/^[a-zA-Z0-9_-]{1,40}$/.test(keyId)) throw unavailable();
      const parsed: unknown = JSON.parse(keyRing);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length > 5) throw unavailable();
      const entries = Object.entries(parsed);
      if (!entries.length || entries.some(([id, value]) => !/^[a-zA-Z0-9_-]{1,40}$/.test(id) || typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) throw unavailable();
      this.keys = Object.freeze(Object.fromEntries(entries));
      if (!Object.hasOwn(this.keys, keyId)) throw unavailable();
    } catch { throw unavailable(); }
  }
  private path(reference: string): string {
    if (!/^neon-runtime\/[a-f0-9]{32}$/.test(reference)) throw unavailable();
    return `credentials/${this.scope}/${reference}.json`;
  }
  private async aad(reference: string, keyId: string): Promise<Uint8Array<ArrayBuffer>> {
    const context = await this.binding(reference);
    if (reference !== `neon-runtime/${context.tenantId}` || !/^[a-zA-Z0-9_-]{1,100}$/.test(context.workspaceId) || context.purpose !== "postgres-runtime") throw unavailable();
    return new TextEncoder().encode(JSON.stringify(["substrata-v1", this.scope, reference, keyId, context.tenantId, context.workspaceId, context.purpose]));
  }
  private async key(keyId: string): Promise<CryptoKey> {
    if (!Object.hasOwn(this.keys, keyId)) throw unavailable();
    const raw = bytes(this.keys[keyId], 32);
    try { return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]); }
    finally { raw.fill(0); }
  }
  private async encrypt(reference: string, password: string): Promise<Envelope> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: await this.aad(reference, this.keyId), tagLength: 128 }, await this.key(this.keyId), new TextEncoder().encode(password));
    return { version: 1, keyId: this.keyId, iv: hex(iv), ciphertext: hex(new Uint8Array(ciphertext)) };
  }
  private async decrypt(reference: string, value: unknown): Promise<string> {
    if (!value || typeof value !== "object") throw unavailable();
    const envelope = value as Partial<Envelope>;
    if (envelope.version !== 1 || typeof envelope.keyId !== "string" || typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string") throw unavailable();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(envelope.iv, 12), additionalData: await this.aad(reference, envelope.keyId), tagLength: 128 }, await this.key(envelope.keyId), bytes(envelope.ciphertext, 80));
    const password = new TextDecoder().decode(plain);
    if (!/^[a-f0-9]{64}$/.test(password)) throw unavailable();
    return password;
  }
  async read(reference: string): Promise<string> {
    try {
      const object = await this.bucket.get(this.path(reference));
      if (!object || object.size > 4096) throw unavailable();
      return await this.decrypt(reference, await object.json());
    } catch { throw unavailable(); }
  }
  async ensure(reference: string): Promise<string> {
    try {
      const path = this.path(reference);
      const existing = await this.bucket.get(path);
      if (existing) {
        if (existing.size > 4096) throw unavailable();
        return await this.decrypt(reference, await existing.json());
      }
      const password = hex(crypto.getRandomValues(new Uint8Array(32)));
      await this.bucket.put(path, JSON.stringify(await this.encrypt(reference, password)), { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" } });
      // A concurrent winner is authoritative. Never return an unpersisted loser.
      return await this.read(reference);
    } catch { throw unavailable(); }
  }
  async rewrap(reference: string): Promise<void> {
    try {
      const path = this.path(reference);
      const existing = await this.bucket.get(path);
      if (!existing || existing.size > 4096) throw unavailable();
      const password = await this.decrypt(reference, await existing.json());
      const saved = await this.bucket.put(path, JSON.stringify(await this.encrypt(reference, password)), { onlyIf: { etagMatches: existing.etag }, httpMetadata: { contentType: "application/json" } });
      if (!saved) throw unavailable();
    } catch { throw unavailable(); }
  }
  async revoke(reference: string): Promise<void> {
    try {
      const path = this.path(reference);
      const existing = await this.bucket.get(path);
      if (!existing || existing.size > 4096) throw unavailable();
      // Maintenance must authenticate the same tenant/workspace context as reads
      // and rewrapping before replacing an object with a tombstone.
      await this.decrypt(reference, await existing.json());
      const saved = await this.bucket.put(path, JSON.stringify({ version: 1, revoked: true }), { onlyIf: { etagMatches: existing.etag }, httpMetadata: { contentType: "application/json" } });
      if (!saved) throw unavailable();
      // Tombstones deliberately fail decryption and prevent ensure() regeneration.
    } catch { throw unavailable(); }
  }
}
