import { CredentialCipher } from "../credentials/cipher";
import { ProvisioningError } from "./contracts";

export interface VaultBucket {
  get(key: string): Promise<{ size: number; etag: string; json(): Promise<unknown> } | null>;
  put(key: string, value: string, options: { onlyIf: { etagDoesNotMatch?: string; etagMatches?: string }; httpMetadata: { contentType: string } }): Promise<{ etag: string } | null>;
}
export type CredentialBinding = (reference: string) => Promise<{ tenantId: string; workspaceId: string; purpose: "postgres-runtime" }>;
interface Envelope { version: 1; keyId: string; iv: string; ciphertext: string }
const unavailable = () => new ProvisioningError("MISSING_CREDENTIALS");
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
// Ciphertext only in R2. Encryption keys are supplied as Worker secrets, never
// stored in this bucket or D1. No public credential/rotation/deletion endpoint.
export class EncryptedCredentialVault {
  private readonly cipher: CredentialCipher;
  constructor(private readonly bucket: VaultBucket, private readonly scope: string, keyRing: string, private readonly keyId: string, private readonly binding: CredentialBinding) {
    try {
      if (!/^[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}$/.test(scope) || !/^[a-zA-Z0-9_-]{1,40}$/.test(keyId)) throw unavailable();
      this.cipher = new CredentialCipher(keyRing, keyId);
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
  private async encrypt(reference: string, password: string): Promise<Envelope> {
    return this.cipher.encrypt(password, keyId => this.aad(reference,keyId));
  }
  private async decrypt(reference: string, value: unknown): Promise<string> {
    const password=await this.cipher.decrypt(value,keyId=>this.aad(reference,keyId),64);
    if(!/^[a-f0-9]{64}$/.test(password))throw unavailable();
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
