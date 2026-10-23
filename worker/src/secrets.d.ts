// Secret and deployment-variable names are supplied outside source control.
// Bindings are generated from wrangler.jsonc. Keep the vault optional at the
// application boundary so absent/misconfigured bindings are checked at runtime.
interface Env extends Omit<WorkerBindings, "TENANT_CREDENTIALS"> {
  BYODB_ALLOWED_DESTINATIONS?: string;
  BYODB_VAULT_KEYS?: string;
  BYODB_VAULT_KEY_ID?: string;
  WORKSPACE_MEMBERSHIP_MODE?: string;
  AI_VAULT_KEYS?: string;
  AI_VAULT_KEY_ID?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_ISSUER?: string;
  CLERK_AUDIENCE?: string;
  FRONTEND_ORIGIN?: string;
  DATABASE_RUNTIME_MODE?: string;
  DATABASE_RUNTIME_CONFIG?: string;
  TENANT_CREDENTIALS?: WorkerBindings["TENANT_CREDENTIALS"];
  NEON_DEVELOPMENT_CONFIG?: string;
  NEON_PROVISIONING_APPROVAL?: string;
  NEON_API_KEY?: string;
  NEON_ADMIN_PASSWORD?: string;
  NEON_VAULT_KEYS?: string;
  NEON_VAULT_KEY_ID?: string;
}
