# CP5: agents, external databases and workspace access

## Implemented routes and behavior

- `/agents` and `/agent-runs`: user-private definitions, three fixed templates, saved model/database/instructions, 1–8 model calls, 10–120 second deadlines, maximum 24 tool invocations (including schema context), streamed model text and step events, persisted trace/usage/status, explicit cancellation, soft deletion, and retry as a new run. No background scheduling. A terminated foreground run becomes `interrupted` when history is next read after its deadline plus ten seconds. Cancellation from another tab is checked before and after model/tool calls; an in-flight provider call can take up to its existing 25 second transport timeout. Closing the stream aborts the foreground request. PostgreSQL work is separately bounded by a three second statement timeout. No autonomous SQL execution, writes or DDL.
- `/databases`: create/test/list/rename/rotate/disconnect external PostgreSQL connections. Owners/admins manage connections; assigned readers use the shared gateway. No external database or role is created, deleted or modified by connection management. Disconnect disables D1 metadata before credential cleanup. In-flight reads already authorized may finish within their timeout.
- `/explorer`, `/sql`, `/chat` and agents use the same server-selected managed or external source and schema. SQL remains one approved read-only SELECT, bounded to 100 rows and existing response budgets. AI previews require separate row-context consent and are limited to five rows. AI proposals still require manual review/execution.
- `/settings/access` and `/settings/access-control`: list members, assign existing active organization members, change roles and remove assignments. D1 is the established membership authority; Clerk authenticates identities. There is no Clerk organization mapping or invitation support. Organization owners/admins inherit workspace access and cannot be changed here. Workspace admins cannot grant owner/admin or change owners. Mutations recheck actor/target authorization atomically; last-owner conditions and audit entries are in the same D1 transaction. Readers cannot list unassigned candidates.

## BYODB owner configuration (not enabled automatically)

1. Apply additive migrations `0004_external_databases.sql` and `0005_agent_workflows.sql` to the selected **local** D1 database before starting the updated API. Existing local data is preserved. Hosted migration requires a separately approved rollout.
2. Keep the existing server-side `TENANT_CREDENTIALS` R2 binding. Set Worker-only `BYODB_VAULT_KEYS` to a JSON keyring of key IDs to independently generated 64-character lowercase hexadecimal AES-256 keys, and `BYODB_VAULT_KEY_ID` to an entry in that ring. These keys must be separate from `NEON_VAULT_KEYS` and `AI_VAULT_KEYS`. Never use `NEXT_PUBLIC_` variables, D1, source files or logs for keys.
3. Set Worker-only `BYODB_ALLOWED_DESTINATIONS` to a JSON array with the following nonsecret shape. Replace placeholders with administrator-verified values; this example is deliberately unusable:

```json
[{"id":"customer-dev","hostname":"db.example.com","address":"PUBLIC_IPV4_REPLACE_ME","port":5432,"databases":["customer_dev"],"roles":["substrata_reader"],"schemas":["app"]}]
```

Only public canonical IPv4 pins on port 5432 are accepted. Private, link-local, loopback, reserved and noncanonical addresses are rejected. The API accepts the endpoint ID, database, role and schema from these allowlists, never arbitrary hosts, URLs, TLS options or connection strings. Network connections use the IP without DNS; TLS validates the configured hostname with a trusted certificate. A hostname check alone is not used to prevent rebinding. The whole approved destination has a fingerprint in D1; changed pins/allowlists invalidate existing resolution until an owner validates and saves fresh credentials. Provider IP changes therefore require administrator review. IPv6, private endpoints, custom CAs, pools/proxies with unverified TLS, and arbitrary ports are intentionally unavailable.
4. Supply an existing restricted PostgreSQL role and password through the authenticated connection form. It must not be superuser, CREATEDB, CREATEROLE, replication, BYPASSRLS or a member of another role. It must not have CREATE or table write privileges in the approved schema. Connections containing non-core extensions, foreign servers or user-defined functions are rejected. The administrator must review views/RLS before approving a schema: a permitted view can intentionally expose other data. Unlike managed tenant isolation, external validation allows the ordinary INHERIT attribute, PUBLIC temporary-database privileges and CONNECT to other databases. The gateway itself never selects those databases or accepts their schema names. This is a constrained read adapter, not proof of cluster-wide role isolation.
5. Keep `WORKSPACE_MEMBERSHIP_MODE` absent or set to `d1`. Any other value disables protected API access. Do not point Clerk organizations at this system without implementing and validating a membership reconciliation workflow; invitations remain unavailable.
6. OpenRouter uses the existing AI settings and encrypted AI store. No new provider keys or cloud resources are provisioned by CP5.

### Credential lifecycle

Each immutable R2 object uses the existing Web Crypto AES-256-GCM v1 envelope, a fresh random 96-bit nonce, and authenticated org/workspace/connection/engine/runtime-password/reference/key-ID metadata. D1 contains opaque references and nonsecret connection metadata; it never contains a password. Provisioning and BYODB keys/purposes are separate. Missing policy, R2, key configuration, objects, wrong scope, tampering, stale pin or unsafe role fails closed. Driver errors are sanitized.

Runtime password rotation first validates the new password, writes a new encrypted object, then compare-and-swaps the D1 revision/reference. A competing change rejects the operation and tombstones the unused new object. A successful rotation tombstones the previous object. If cleanup fails, the API returns `CREDENTIAL_CLEANUP_REQUIRED` and records that condition without leaking credentials; the new reference remains authoritative. Do not retry blindly: refresh metadata and have an administrator reconcile encrypted object references. A process crash between object creation and D1 commit can leave an encrypted orphan; no automatic bucket sweep or external credential revocation occurs. Owner maintenance must compare D1 references before tombstoning orphan objects. Disconnect is idempotent and retries tombstone cleanup; it never revokes a PostgreSQL role or password at the external provider.

Wrapping-key rotation: add a new independent key to `BYODB_VAULT_KEYS`, make its ID active, retain old keys for reads, and rotate/revalidate each connection to a new immutable reference under the active key. Confirm D1 references and cleanup before removing old keys. Removing a key early makes affected connections unavailable. PostgreSQL password revocation must be performed by the external database owner; encrypted-object tombstones do not revoke a password outside SubStrata.

## MySQL foundation

`MySQLReadAdapter` defines connection testing, schema/table/column discovery and bounded previews. `UnavailableMySQLAdapter` returns a controlled 501. No MySQL driver is installed or connectivity claimed. Remaining work: validate a Workers-compatible transport, IP pinning plus hostname-verified TLS, authentication, per-request authorization and role checks, read-only transactions/SQL dialect policy, result/time budgets and real disposable MySQL integration tests. PostgreSQL remains independent.

## Validation boundaries

- New API tests use real disposable local D1/R2 encryption and persistence; Clerk identity, OpenRouter and the connection-validation function are mocked and explicitly labelled.
- The Docker gateway integration exercises real disposable PostgreSQL with TLS, actual restricted roles, encrypted external credentials, custom-schema discovery and rows, write/DDL rejection and unsafe-role rejection. Only the test client factory maps the asserted public-pin configuration to the owned loopback TLS fixture. It does not connect to the example public IP or prove hosted Workers/provider compatibility.
- Existing real Clerk RSA verification tests cover signature, issuer, audience, expiration and activation. Legacy SQL containment remains separate and disabled.
- Frontend unit tests and packaging checks do not constitute browser acceptance with a genuine Clerk/OpenRouter session. No cloud resource creation, provider query, deployment or production test is part of this checkpoint.

## Commands executed for CP5

All commands were local; dependencies were reused without installation.

| Working directory | Command | Result |
| --- | --- | --- |
| worker | `npm run typecheck` | Passed |
| worker | `$env:SUBSTRATA_LOCAL_POSTGRES='1'; npm test -- --no-file-parallelism` | 193 passed across 14 files, including real TLS PostgreSQL; mocked identities/providers explicitly labelled |
| worker | `npm test -- --no-file-parallelism test/cp5-workspace.test.ts test/ai-workspace.test.ts` | 32 passed after final trace-persistence fix |
| worker | `npm run build -- --env-file types.env.example` | API Worker bundle and Wrangler dry run passed |
| worker | `npx --no-install wrangler d1 migrations apply METADATA --local --persist-to .wrangler/cp5-validation --env-file types.env.example` | All five migrations passed in disposable storage |
| worker | `npx --no-install wrangler d1 migrations apply METADATA --local --persist-to .wrangler/r3-local --env-file types.env.example` | Additive migrations 0004/0005 passed; existing local data retained |
| frontend | `npm test` | 16 passed, including authenticated agent SSE progress and interrupted-stream handling |
| frontend | `npm run lint` | Passed with no warnings after loading-state fixes |
| frontend | `npm run typecheck -- --incremental false` | Passed |
| frontend | `npm run build` | Next.js production build passed |
| frontend | `npm run build:worker` | OpenNext bundle passed, also rerunning the production build |
| frontend | `npx --no-install wrangler deploy --dry-run --outdir .wrangler/cp5-readiness` | Frontend bundle dry run passed |
| backend | `..\venv\Scripts\python.exe -m unittest discover -s tests -v` | 5 containment tests passed; no database/provider connections |
| root | `git diff --check` and reviewed-file credential pattern scan | Passed; no credential literals found |

The first sandboxed Miniflare run was blocked from opening loopback sockets; tests were rerun with local execution permission. The global Python runtime lacked FastAPI; the existing project virtual environment was used. A sandboxed legacy test run stalled and was interrupted, then passed outside the sandbox with mocked providers/database access. An initial AI context regression and test-fixture injection issue were fixed, followed by the passing full suite. No failing tests were bypassed.

Generated output stays ignored in `worker/dist`, `worker/.wrangler`, `frontend/.next`, `frontend/.open-next` and `frontend/.wrangler`. The original `frontend/next-env.d.ts` bytes are restored after builds. The unrelated 31 untracked `frontend/frontend/` files remain preserved.

Remaining packaging warnings: OpenNext reports incomplete Windows compatibility and experimental Node middleware support; Node test tooling reports experimental TypeScript transformation/SQLite warnings. Packaging success is not hosted runtime acceptance.
