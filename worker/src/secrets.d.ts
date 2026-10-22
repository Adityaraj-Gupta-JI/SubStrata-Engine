// Secret and deployment-variable names are supplied outside source control.
// METADATA is generated from wrangler.jsonc in worker-configuration.d.ts.
interface Env {
  CLERK_SECRET_KEY?: string;
  CLERK_ISSUER?: string;
  CLERK_AUDIENCE?: string;
  FRONTEND_ORIGIN?: string;
  DATABASE_RUNTIME_MODE?: string;
  DATABASE_RUNTIME_CONFIG?: string;
}
