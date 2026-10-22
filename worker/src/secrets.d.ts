// Secret and deployment-variable names are supplied outside source control.
// METADATA is generated from wrangler.jsonc in worker-configuration.d.ts.
interface Env {
  CLERK_SECRET_KEY?: string;
  CLERK_ISSUER?: string;
  CLERK_AUDIENCE?: string;
  FRONTEND_ORIGIN?: string;
  DATABASE_RUNTIME_MODE?: string;
  DATABASE_RUNTIME_CONFIG?: string;
  TENANT_CREDENTIALS?: R2Bucket;
  NEON_DEVELOPMENT_CONFIG?: string;
  NEON_PROVISIONING_APPROVAL?: string;
  NEON_API_KEY?: string;
  NEON_ADMIN_PASSWORD?: string;
  NEON_VAULT_KEYS?: string;
  NEON_VAULT_KEY_ID?: string;
}
