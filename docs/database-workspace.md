# CP2 database workspace

## Delivered boundary

The existing Clerk → API Worker → D1 authorization remains authoritative. `GET /api/v1/workspaces/:workspace/databases` lists the workspace's managed database and read/provision capabilities. No client connection string, role, project, branch or credential reference is accepted. The workspace and database must match the same D1 organization before credentials are resolved.

This MVP retains the PoC's **one database per workspace** mapping. Database names and runtime roles are generated internally. All active workspace roles have read permission; effective owner/admin roles may request provisioning and retry. Viewer access still requires explicit workspace assignment under the existing membership rules.

The frontend now uses the real API on `/databases`, `/explorer`, `/sql`, and the preserved `/sql-editor` route. Existing dashboard, chat, agents and settings are retained. Workspace/database selection is held in memory in the shared layout. Switching workspace clears the database selection. No provider success or sample rows are fabricated.

## API

Paths below are relative to `/api/v1/workspaces/:workspace/databases`:

| Method/path | Behavior |
| --- | --- |
| GET `/` | Sanitized list and capabilities. |
| POST `/` | Owner/admin provisioning request. Returns 503 unless secure provisioning dependencies are explicitly installed. |
| GET `/:database` | Sanitized provisioning status. |
| POST `/:database/retry` | Owner/admin retry of a failed, unclaimed, non-quarantined request. |
| GET `/:database/schemas` | Readable tenant schemas (MVP: `tenant_data`). |
| GET `/:database/tables?schema=tenant_data` | Tables, partitioned tables, views and materialized views. |
| GET `/:database/relation?schema=tenant_data&table=...` | Columns/types/nullability, primary/foreign keys, indexes. |
| GET `/:database/rows?schema=tenant_data&table=...&limit=20&offset=0` | Bounded read-only preview. Primary-key ordering when available; offset pagination is not a snapshot. |
| POST `/:database/query` | JSON `{ "sql": "...", "parameters": [] }`; single supported SELECT. |

Database IDs are internal 32-hex IDs, not PostgreSQL database names. System schemas are not exposed. Catalog result sets over 100 entries fail with a controlled metadata-limit error rather than silently appearing complete. `/api/v1/execute-sql` remains disabled (501); the legacy Python SQL and tenant inspection endpoints remain disabled (503).

## Read-only security model

`database/sql-policy.ts` uses pinned `pgsql-ast-parser@12.0.2` and an AST allowlist, then executes **canonical serializer output**. Supported SQL has one FROM relation explicitly in `tenant_data`, basic column/literal/parameter expressions, comparisons, arithmetic, Boolean filters, ordering, bounded LIMIT/OFFSET and count/min/max/sum/avg. Unsupported constructs fail closed: writes, DDL, COPY, CTEs, joins, unions, nested SELECTs, casts, locks, administrative/functions outside the aggregate allowlist, multiple statements and system catalogs. This intentionally supports a subset of PostgreSQL.

The runtime role policy is tightened from the original PoC's DML role to **SELECT only**. Existing table/sequence grants and default grants are revoked before granting SELECT. It owns no database/schema, has no role memberships or elevated attributes, cannot connect to foreign databases, cannot create schema objects, and has no sequence usage or write grants. Existing PoC roles must be explicitly reconciled by an approved administrator; active D1 metadata alone does not silently upgrade roles.

`PgReadTransport` uses pinned `pg@8.23.1`, verified TLS (`rejectUnauthorized: true`), private credentials, a 3-second connect timeout, a 3-second statement timeout, a bounded client query deadline, lock/idle transaction timeouts and `BEGIN READ ONLY`. It closes the client on every path and does not log SQL, parameters, credentials or driver errors. A role/catalog preflight rejects writable/elevated roles, inherited memberships, foreign CONNECT access, nonstandard extensions/foreign servers and non-system user functions. Unsafe configuration returns a generic unavailable response.

Limits: SQL 8 KiB, request body 16 KiB, 20 scalar parameters, 100 result rows, 8,192 characters per JSON row, 60,000 bytes of cell JSON and 64 KiB for the final read response. Cells are text (NULL remains null) to preserve bigint/decimal precision. Large rows/results are marked truncated; oversized combined metadata is rejected. Schema identifiers are checked and quoted; catalog values are parameterized. Successful and denied authorized reads generate D1 audit events with action/outcome/resource/request IDs, **never SQL text or credentials**. Audit persistence failure prevents a successful response.

## Private local runtime configuration

No environment file was opened or edited by this sprint. In an ignored local secret source such as `worker/.dev.vars`, the owner may configure these **names**:

- `DATABASE_RUNTIME_MODE`: `local`.
- `DATABASE_RUNTIME_CONFIG`: a JSON array of private credential entries. Each entry has `reference`, `projectId`, `branchId`, `database`, `user`, `host`, numeric `port`, `password`, and optional trusted PEM `ca`.

The entry's reference/project/branch/database/user must exactly match authorized D1 metadata. Passwords and credential-bearing connection strings never enter D1 or browser responses. Use a correctly configured SELECT-only disposable database, SCRAM and a trusted TLS certificate. Never put this JSON in public Next.js variables, command arguments, Wrangler `vars`, logs or commits. Do not disable TLS verification for a self-signed local server; supply its CA.

The default resolver is limited to local-mode loopback API requests. Hosted requests fail closed. There is no plaintext D1 fallback. These variables are not currently populated by this sprint, so ordinary development UI shows genuine D1 metadata but cannot query a database until the owner supplies the private runtime setup. Test fixtures create and remove their own temporary databases and do not persist browser demo data.

## Provisioning is intentionally gated

The authenticated endpoints reuse `TenantProvisioner` with the existing D1 idempotency/claim/reconciliation logic. The default application does **not** instantiate a Neon API client or admin SQL transport. It exposes `provisioningConfigured: false`, and the frontend explains why creation is unavailable.

Enablement requires explicit owner-approved development project/branch identifiers, private API/admin credentials, a durable atomic external credential store, and an independently wired privileged connection factory. `DatabaseServices.provisioning` is an internal composition point requiring a durable-secret capability; it is never set by client input. The HTTP lifecycle adapter is tested with a mocked provider and roles. No Neon request, resource creation, paid resource, deletion or deployment occurred.

The Neon-specific limits and conditional feasibility remain in `adr-neon-database-per-tenant.md`. A real Neon + Clerk + Worker runtime + vault acceptance test is still required. PostgreSQL tests here run under Node with real TLS; successful Worker bundling is not evidence of deployed Worker-to-Neon connectivity.

## Validation and local resources

From `worker/` in Windows PowerShell:

```powershell
$env:SUBSTRATA_LOCAL_POSTGRES='1'
npm test
npm run typecheck
npm run build
npm run migrate:local
```

The opt-in tests need the existing local Docker named-pipe context, cached `postgres:16-alpine`, and `openssl` on PATH (or `SUBSTRATA_OPENSSL` pointing to its executable). No image is downloaded. The gateway test creates a fresh TLS/SCRAM cluster bound to an ephemeral **127.0.0.1-only** port, separate from the original isolation test's network-disabled cluster. Tests use only their own generated credentials. Containers are label/identity checked before removal; generated certificate directories are checked to remain under `worker/.wrangler/gateway-certificates` before removal. Local test identities simulate Clerk authentication; existing signature/audience regressions separately use the real Clerk SDK with ephemeral RSA keys.

Gateway integration tests exercise actual frontend service functions against the handler, real local D1 and real TLS PostgreSQL: metadata, previews, parameterized reads, numeric precision, response limits, transaction read-only state, write/DDL/injection/multi-statement rejection, cross-workspace denial, viewer restrictions, missing tokens, untrusted TLS, invalid credentials, statement timeouts, audit events and sanitized responses. Provisioning idempotency/failure/concurrency/retry is covered by existing lifecycle tests and the mocked HTTP provisioning test. No live Neon or new browser sign-in acceptance is claimed.

From `frontend/`: `npm test`, `npm run lint`, `npm run typecheck -- --incremental false`, `npm run build`, `npm run build:worker`, and `npm exec --offline -- wrangler deploy --dry-run --outdir .wrangler/readiness`. The build uses the existing original Windows checkout. OpenNext retains its Windows and experimental middleware warnings. Public production API configuration must use an owner-provided HTTPS origin; local build artifacts are not deployment approval.

## Sprint verification record

All 136 Worker tests passed with local PostgreSQL enabled, including eight gateway integration tests. Worker typecheck and dry-run packaging passed. Both D1 migrations passed in a fresh `.wrangler/cp2-foundation-check` database; the additive second migration also passed against the existing local `.wrangler/r3-local` metadata without removing its records.

All 12 frontend tests, lint (no warnings/errors), typecheck, the standalone Next.js production build, the final OpenNext rebuild (which reruns Next.js build) and frontend Wrangler dry-run packaging passed. Local unauthenticated requests to `/databases`, `/explorer`, `/sql` and `/sql-editor` returned 307 to `/login`; the running API returned health 200 and a protected database request 401. No new authenticated browser/Neon end-to-end acceptance was performed. No test containers or generated certificates remain from the integration fixtures.

## Encrypted credential integration

See [Neon development integration](neon-development-integration.md) for the encrypted R2 vault, tenant/workspace binding, server-only credential separation, exact future owner configuration, rotation and revocation limitations. Cloud provisioning remains disabled pending owner setup and subsequent live validation.
