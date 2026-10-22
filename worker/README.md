# SubStrata platform API (local foundation)

This package is the Cloudflare Worker API for platform metadata and the authorized read-only PostgreSQL gateway. It does not enable writes, automatically provision Neon resources, or run AI providers. Provisioning remains gated on approved provider configuration and durable external secrets. See [database workspace setup and limits](../docs/database-workspace.md).

## Local setup

Install dependencies in `worker/`. The `METADATA` binding is local by default and has no fabricated cloud database ID. Apply migrations with `npm run migrate:local`, then start `npm run dev`; both use `.wrangler/r3-local`. Do not use `--remote` for checkpoint validation. Hosting requires real owner-provided identifiers through a separate configuration; see `../docs/platform-readiness.md` and the intentionally incomplete `wrangler.deploy.example.json` template.

Required Worker bindings and secrets (names only):

- `METADATA`: D1 binding
- `CLERK_SECRET_KEY`: Clerk backend secret
- `CLERK_ISSUER`: exact trusted Clerk session-token issuer
- `FRONTEND_ORIGIN`: exact permitted frontend origin and Clerk authorized party
- `CLERK_AUDIENCE`: optional expected token audience

### Audience policy

`CLERK_AUDIENCE` remains optional in every environment; no environment-specific requirement is currently declared. Unset (`undefined`) means no audience restriction. When set, it is one exact, case-sensitive audience identifier, with no whitespace or control characters. Empty, null, non-string, whitespace-containing, or control-containing configuration fails closed with a generic 503. No comma-separated or JSON allowlist is parsed: a configured string is always treated as a single literal identifier.

After Clerk signature verification and the issuer, expiry, activation, and session checks succeed, a configured audience must match the verified token's string `aud`, or occur in a nonempty array of nonempty strings. Missing, null, empty, mixed-type, and mismatched claims return a generic 401. Identity is returned only after these checks. The Worker independently enforces this rule because the installed Clerk SDK does not enforce missing and array-valued audiences reliably.

`test/auth-audience.test.ts` uses the installed Clerk SDK with ephemeral local RSA keys and no Clerk network calls. These regression tests do not replace a live Clerk-to-Worker integration test.

Frontend configuration (names only): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_PLATFORM_API_URL`, optional `NEXT_PUBLIC_CLERK_JWT_TEMPLATE`, and, only for legacy chat, `NEXT_PUBLIC_LEGACY_API_URL`. Configure Clerk redirect URLs for `/login` and `/register` in the application's Clerk settings. The platform API requires a Clerk session token in the `Authorization: Bearer` header. Live verification requires owner-provided development Clerk configuration and a separate integration test.

Run `npm run typecheck`, `npm test`, and `npm run build` in this package. `build` performs a Wrangler dry run and writes only local `dist/` output; it does not publish a Worker. The current migration was validated against a disposable local D1 database as well as SQLite constraint tests.

## Migration recovery

D1 migrations are forward only. Back up a target database before an environment migration. If a migration fails, inspect the migration history and schema, fix the migration in a **new** numbered file, and apply that file to a disposable copy before retrying the target. For an already applied incompatible change, restore from the environment's backup or create a forward repair migration; do not edit a migration that has been applied to a shared environment. No production migration is part of this checkpoint.
