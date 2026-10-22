# ADR: Neon database-per-tenant PoC

Date: 2026-10-22. Baseline: `f97c9d0`, local branch `dev/substrata-v2`.

## Decision and evidence

**Conditional feasibility: suitable for a bounded tenant shard, subject to a live security test.** Retain Clerk, the authorization Worker and D1 metadata. Place each managed tenant in its own logical PostgreSQL database on an explicitly selected Neon development branch. This PoC maps one managed tenant database to one workspace. The old organization-level `database_tenants` table is unchanged; product approval is needed before making the workspace mapping permanent.

Official documentation checked:

| Topic | Finding and source |
| --- | --- |
| Multiple databases | Supported, up to 500 databases per branch; branching copies databases. [Manage databases](https://neon.com/docs/manage/databases). |
| Roles | Branch-scoped, up to 500 roles per branch. API/Console/CLI roles receive `neon_superuser`; SQL-created roles do not automatically receive that membership. Use SQL for runtime roles. [Manage roles](https://neon.com/docs/manage/roles). |
| Database lifecycle | API POST creates a database with `name` and `owner_name`; DELETE exists but is deliberately not implemented here. [Create](https://neon.com/docs/reference/api/branches/create-project-branch-database), [delete](https://neon.com/docs/reference/api/branches/delete-project-branch-database), [OpenAPI](https://neon.com/api_spec/release/v2.json). |
| Operations | Database POST currently returns `DatabaseResponse`; do not invent an asynchronous operation ID. When operations are present, poll until finished/skipped; failure/error/cancellation blocks activation. [Operation details](https://neon.com/docs/reference/api/operations/get-project-operation). |
| Retries | A lost mutation response is ambiguous. Read/reconcile before retrying POST. Safe transient statuses include 423 and 503; 429 needs backoff. [API error contract](https://api-docs.neon.tech/reference/createprojectbranchdatabase). |
| API limits | Documented 700 requests/minute with bursts up to 40/second per route/account; these are provider limits, not a provisioning throughput guarantee. [Rate limiting](https://api-docs.neon.tech/reference/api-rate-limiting). |
| Worker connections | Neon serverless driver and Hyperdrive are supported approaches. Hyperdrive uses a native PostgreSQL driver instead of the serverless driver. No live transport is selected or installed in this checkpoint. [Cloudflare Neon integration](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/), [Neon driver](https://neon.com/docs/serverless/serverless-driver). |
| Grants | Direct grants, memberships and PUBLIC privileges are additive. A per-role REVOKE alone cannot cancel PUBLIC CONNECT. [PostgreSQL REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html). |

Existing/default/system databases and roles consume capacity. Do not advertise 500 usable tenants per branch. Plan-specific compute/storage/connection quotas, pricing, cold-start latency and throughput remain unverified. Database separation shares branch compute, catalog visibility and operational blast radius; it is not physical isolation. Branch cloning and recovery need a cross-tenant data/credential policy.

## Isolation contract

- A privileged administrator owns databases and schema objects. Tenant roles own neither databases nor schemas, receive no memberships, and have NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION and NOBYPASSRLS.
- Create runtime roles through SQL with NOLOGIN. Grant only CONNECT to their own database, schema USAGE, table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT. Future grants apply only to objects created by the pinned owner. Runtime DDL is intentionally unavailable.
- In a **dedicated disposable environment only**, revoke PUBLIC database privileges across all connectable non-template databases. Preserve explicitly granted access for other tenant roles. Revoke public-schema and function defaults. Validate effective CONNECT/CREATE/TEMPORARY rights for every database, not merely intended SQL statements.
- Inspect role attributes/memberships and a managed-role marker before reconciliation. Reject unmanaged collisions instead of adopting or downgrading arbitrary existing roles.
- Reject unreviewed extensions (PoC allowlist: only plpgsql), foreign servers and non-system SECURITY DEFINER routines. This conservative rule may reject Neon-installed system extensions; inspect before approving any exception. Never silently relax it.
- Enable login only after catalog checks. Prove own-database authentication and foreign-database SQLSTATE 42501 using the same runtime credential. Network errors are not proof of denial. Failed validation disables login; failed quarantine requires operator recovery.
- Only mark D1 active after verification. Never deliver credentials through the public API. No SQL execution, provisioning, deletion, or credential endpoint is added.

## Local implementation boundary

`worker/src/neon/contracts.ts` defines explicit development approval, pinned identifiers and private SQL/credential ports. `provider.ts` implements a pinned-origin REST client, create/reconcile and operation reads with bounded responses, request timeouts, controlled errors and Retry-After scheduling. It never creates projects/branches/roles through the API and never retries mutations internally.

`restricted-roles.ts` implements the restricted SQL policy through an injected administrator connection factory. Its transaction must use one TLS connection, discard results, and never log statements/parameters. Passwords come from an atomic external credential store as 64 hexadecimal characters; plaintext never enters D1. There is **no concrete PostgreSQL transport or durable credential-store implementation** yet, so this cannot provision a live tenant without further integration.

`provisioning.ts` enforces existing workspace membership and effective owner/admin authorization. It generates names server-side and uses D1 uniqueness plus an atomic claim to serialize requests across Worker instances. State is pending → database_pending → role_pending → validating → active, or failed. Duplicate calls reuse the same database, role and credential reference. Provider operation IDs and retry deadlines are durable. Reconciliation rereads provider state after partial failure.

Claims do not expire automatically: a crashed privileged operation cannot safely be replaced while its outcome is unknown. An operator must establish that the previous executor stopped, reconcile remote state, and explicitly recover its claim. No automatic claim-stealing or deletion is implemented. QUARANTINE_REQUIRED also blocks automatic retries. D1 and Neon cannot commit atomically; failed activation may leave an orphan resource requiring manual reconciliation. Membership revocation during a remote call cannot cancel already-started provider work.

Migration `0002_neon_poc.sql` adds workspace/organization composite foreign keys, unique provider mappings, provisioning states, operation IDs and a deterministic credential reference. No password, API key or connection string column is added. Existing metadata and frontend behavior are unchanged. New modules are intentionally absent from the public Worker entry point and its bundle.

## Live acceptance gate — not run

The owner has no Neon project yet and explicitly selected local-only validation. No Neon API or Neon PostgreSQL connection was attempted. Real local PostgreSQL was tested separately, as described below. A dedicated development project/branch and renewed explicit approval are required before any remote action. Do not apply PUBLIC revocations to an existing customer branch.

Required next setup:

1. Owner selects/creates a disposable project and branch under an approved spending limit; supply their nonsecret IDs and confirm no production/customer data.
2. Agree on a private secret source for the project-scoped Neon API key and TLS administrator connection. Do not paste secrets into chat, source, D1 or command arguments.
3. Implement the pinned PostgreSQL connection factory and durable atomic credential store, including connection closure, timeout/cancellation, no sensitive logging and private credential rotation/recovery.
4. Create exactly two disposable databases/roles, verify own reads/writes using fixed test fixtures, and test both cross-connections. Check attributes and attempt fixed privilege escalation operations under rollback where supported. Test extensions/function/foreign-server bypasses and confirm denied connections are authorization errors.
5. Exercise partial failures, retries, crash recovery, cleanup planning and Worker runtime connections with the chosen driver. No deletion should happen without explicit scope approval.

## Validation distinction

- REST provider tests mock fetch. SQL policy tests mock PostgreSQL sessions. They validate request/privilege policy and fail-closed behavior, **not actual Neon or PostgreSQL enforcement**.
- Lifecycle tests use real disposable Miniflare D1 with both migrations and two internal test identities. Neon REST and SQL ports are mocked. They cover duplicate/concurrent provisioning, retry/reconciliation, role and isolation failure, workspace authorization, metadata constraints and quarantine recovery.
- Existing Clerk audience/signature and D1 membership regression tests remain part of the Worker suite. Real Clerk integration from the previous checkpoint does not constitute Neon integration.
- `neon-postgres.integration.test.ts` is an opt-in real PostgreSQL 16 test using the already-cached Docker image. It creates a unique empty cluster with no network, host ports, mounts, or image pull, uses SCRAM loopback authentication and ephemeral passwords, then removes only its own labelled container. It executes the actual role SQL, tests both own-database DML and foreign connection denial, rejects incorrect passwords and privilege escalation, and reconciles without credential rotation. The psql test adapter recognizes explicit startup CONNECT-denial diagnostics because libpq does not expose startup SQLSTATE; a production driver must preserve the actual server error code.
- These local PostgreSQL checks do not reproduce Neon's proxy, `neon_superuser`, installed extensions, quotas, or Worker transport. Effective privileges are checked at provisioning time; continuous drift monitoring, query quotas and runtime statement/connection limits are future work.

## Reproduce local validation (Windows PowerShell, from worker/)

```powershell
npm run typecheck
$env:SUBSTRATA_LOCAL_POSTGRES='1'
npm test
Remove-Item Env:SUBSTRATA_LOCAL_POSTGRES
$env:WRANGLER_SEND_METRICS='false'
npm run build
npm exec --offline -- wrangler d1 migrations apply METADATA --local --persist-to .wrangler/cp2-neon-poc
git diff --check
```

The Docker test requires a local Windows named-pipe context and cached `postgres:16-alpine`; it never downloads an image. Without the opt-in variable, the three real PostgreSQL tests are explicitly skipped. D1 migration validation uses a new checkpoint-specific directory and does not modify the previous Clerk integration database. No frontend or existing authentication code is changed.

Final local results: all 100 tests in seven files passed with the PostgreSQL opt-in enabled; typecheck and Worker dry-run build passed. Both migrations applied successfully to the fresh checkpoint directory. All labelled test containers were removed. No Neon resources, dependencies, secrets, public routes or commits were created. The original frontend changes remain outside this checkpoint.
