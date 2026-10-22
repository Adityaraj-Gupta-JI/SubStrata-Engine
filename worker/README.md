# SubStrata platform API (local foundation)

This package is the Cloudflare Worker API for platform metadata. It does not execute SQL, provision PostgreSQL, connect customer databases, or run AI providers.

## Local setup

Install dependencies in `worker/` and configure a **local/disposable** D1 database binding named `METADATA`. Replace the placeholder `database_id` in `wrangler.jsonc` only when configuring an actual environment. Never commit credentials or production database identifiers. Apply migrations locally with `npm run migrate:local`; do not use `--remote` for checkpoint validation.

Required Worker bindings and secrets (names only):

- `METADATA`: D1 binding
- `CLERK_SECRET_KEY`: Clerk backend secret
- `CLERK_ISSUER`: exact trusted Clerk session-token issuer
- `FRONTEND_ORIGIN`: exact permitted frontend origin and Clerk authorized party
- `CLERK_AUDIENCE`: optional expected token audience

Frontend configuration (names only): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_PLATFORM_API_URL`, and, only for legacy chat, `NEXT_PUBLIC_LEGACY_API_URL`. Configure Clerk redirect URLs for `/login` and `/register` in the application's Clerk settings. The platform API requires a Clerk session token in the `Authorization: Bearer` header. A Clerk application is not configured in this repository; live token verification requires a configured application and a separate integration test.

Run `npm run typecheck`, `npm test`, and `npm run build` in this package. `build` performs a Wrangler dry run and writes only local `dist/` output; it does not publish a Worker. The current migration was validated against a disposable local D1 database as well as SQLite constraint tests.

## Migration recovery

D1 migrations are forward only. Back up a target database before an environment migration. If a migration fails, inspect the migration history and schema, fix the migration in a **new** numbered file, and apply that file to a disposable copy before retrying the target. For an already applied incompatible change, restore from the environment's backup or create a forward repair migration; do not edit a migration that has been applied to a shared environment. No production migration is part of this checkpoint.
