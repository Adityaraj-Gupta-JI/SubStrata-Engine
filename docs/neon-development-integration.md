# Encrypted Neon development integration

## Current boundary

Local integration only. No bucket, cloud secrets, or Neon resources were created/accessed. Provisioning is not enabled. Future approved target: project `lively-mountain-93536009`, branch `br-round-shadow-b8h07enf`; these IDs have not been checked against an authenticated account. Latest owner instructions require local implementation only.

Existing authenticated database routes compose the provider, SQL role manager, PostgreSQL transport and encrypted vault only when explicitly configured. Owner/admin authorization remains server-side. Query transport receives only a runtime reader, never provisioning credentials. Frontend workspace selections persist only nonsecret IDs per Clerk user in sessionStorage and are revalidated against authorized API lists.

## Storage and binding

Private R2 binding: **TENANT_CREDENTIALS**. Each version 1 envelope contains key ID, fresh random 96-bit nonce and AES-256-GCM ciphertext with 128-bit authentication tag. Web Crypto imports nonextractable 256-bit keys; every encryption/rewrap generates a fresh nonce. Key material is supplied only through Worker secrets, outside D1/R2/frontend.

Authenticated additional data binds version, project/branch, opaque reference, key ID, tenant ID, workspace ID and `postgres-runtime` purpose. Production binding lookup uses D1 and the pinned project/branch. Changing a workspace or moving ciphertext fails authentication. D1 contains only opaque credential references and nonsecret metadata. A reference is not authorization: Clerk validation and workspace access checks remain mandatory.

R2 conditional create returns the persisted concurrent winner, never an unpersisted losing password. Persistence precedes database creation. Existing database reconciliation requires the existing credential object and cannot silently regenerate it. Missing bindings/keys/context/objects, tampering and storage outages fail closed with controlled unavailable responses. No credentials, provider responses, connection strings or SQL text are added to public responses or audit records. Existing lifecycle claims, sanitized failures, retries and quarantine remain enforced.

No automatic cloud cleanup runs. Failed operations can leave encrypted orphan objects; retain them for reconciliation. Check lifecycle claims and provider state before any separately approved cleanup; a timeout does not establish that an object is unused. Revocation uses conditional tombstones to prevent regeneration. API audits contain action/resource IDs and outcome only, and failed audit writes prevent successful API responses. Maintenance methods have no public endpoint; future maintenance tooling must audit nonsecret operation IDs/outcomes.

## Owner setup steps — future, not executed

1. Separately approve/create a private development R2 bucket. Record its actual name. Disable public access and restrict operator access. No bucket or resource ID is invented here. Bind only the API Worker, never frontend/client code.
2. Add `r2_buckets` with binding **TENANT_CREDENTIALS** and real `bucket_name` to approved API Worker configuration. The deployment example is intentionally incomplete; do not deploy it unchanged. The local configuration now declares TENANT_CREDENTIALS with remote: false and no cloud bucket name; hosted configuration remains incomplete. R2 bindings have Worker-level read/write access; the query transport receives a narrower read-only interface. Separating provisioning into another Worker can further restrict infrastructure privileges later.
3. Generate 32 random key bytes privately using a secure generator. Set Worker secret **NEON_VAULT_KEYS** to JSON mapping a nonsecret key ID to its 64 lowercase hexadecimal key bytes. Set nonsecret **NEON_VAULT_KEY_ID** to the active ID. Never put the keyring in Wrangler vars, D1, R2, source or `NEXT_PUBLIC_*`. Keep a protected recovery copy: losing all wrapping keys makes stored credentials inaccessible.
4. Separately supply server-only Worker secrets **NEON_API_KEY** and **NEON_ADMIN_PASSWORD**, scoped to development where supported. They never enter the runtime resolver or act as query fallback. For local Wrangler, the owner may configure ignored `.dev.vars` privately. Do not use `wrangler secret put` during preparation: it immediately deploys a new version. Hosted secret uploads, including version-only staging, require separate approval. No secret upload ran here. Never paste secrets into chat.
5. Configure nonsecret **NEON_DEVELOPMENT_CONFIG** JSON with `projectId`, `branchId`, `host` (verified direct non-pooler Neon endpoint), `ownerRole`, `controlDatabase`, `approvedProjectId`, `approvedBranchId`, `allowBranchPublicRevocation: true`, `environment: "disposable-development"`. Approved IDs must exactly match. Endpoint and role names must come from the authenticated account; none were guessed here.
6. Leave **NEON_PROVISIONING_APPROVAL unset**. Future enablement requires exact `projectId/branchId`, valid vault/configuration and API/admin secrets, plus renewed review to resume live testing. Missing approval gives no provisioning capability. Never put these settings or credentials in frontend configuration.
7. Before mutation, verify the project/branch/read-write endpoint against authenticated provider responses and confirm the dedicated environment and PUBLIC CONNECT revocation approval. The adapter checks project/branch/host and rejects protected/foreign branches and endpoints. No project, branch, endpoint or deletion creation API is exposed. Preserve administrator access. Real Neon response/extension/privilege compatibility still requires live verification; never bypass failed checks.
8. Future live acceptance: two authorized workspaces, genuine Clerk development sessions, separate restricted databases/roles, own-database reads, cross-database denial, SELECT/schema/table/rows, rejected writes/DDL/multi-statements, audit events and refresh. Local fixtures do not establish live Neon or browser acceptance.

## Rotation and revocation

Wrapping-key rotation: add new ID/key to the Worker secret keyring, retain old keys, set active ID, then invoke server-only maintenance `rewrap(reference)`. It preserves the PostgreSQL password and conditionally replaces ciphertext using a fresh nonce. Conflicting writes fail; reread before retry. Inventory and verify all objects before removing an old key. Up to five key IDs are supported; no public rotation endpoint exists.

PostgreSQL password rotation is separate and not automated here. Coordinate D1 deactivation, approved administrator NOLOGIN/session termination, password replacement and durable encrypted persistence before activation. Do not blindly regenerate missing credentials. A vault tombstone blocks new API resolutions but does not revoke a password known elsewhere or terminate existing database sessions. Complete revocation requires metadata gating and separately approved administrative PostgreSQL actions. No live revocations ran.

## Validation scope

Worker: 149 tests passed, including real local Miniflare D1/R2, real TLS PostgreSQL in disposable Docker, cryptographic Clerk SDK tests with ephemeral keys, and explicitly mocked provider/route-auth fixtures. Covers concurrency, tampering, moved references, changed workspace, wrong/missing keys, missing objects, outages, fresh nonces, rotation and tombstones, restricted roles and cross-tenant denial. Frontend: 14 tests, lint and typecheck passed. Worker typecheck/build, Next production build, OpenNext bundle and both Wrangler dry runs passed. Both D1 migrations applied to disposable local storage. No live Neon or new authenticated browser acceptance ran.

OpenNext warns about Windows compatibility and experimental Node.js middleware support. Cloud R2 permissions and live provider compatibility remain integration gates.

References: [R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).


Commands executed (Windows, existing lockfiles/dependencies):

- `worker`: `npm run typecheck`; `$env:SUBSTRATA_LOCAL_POSTGRES='1'; npm test`; `npm run build` (Wrangler dry run).
- `worker`: `npx --no-install wrangler d1 migrations apply METADATA --local --persist-to .wrangler/cp2-live-check` (both migrations passed after retrying outside the sandbox, which initially blocked runtime/log access).
- `frontend`: `npm test`; `npm run lint`; `npm run typecheck -- --incremental false`; `npm run build`; `npm run build:worker`; `npx --no-install wrangler deploy --dry-run --outdir .wrangler/cp2-live-dry-run`.
- Repository: `git diff --check` and staged whitespace/leakage review. Existing modified `frontend/next-env.d.ts` was restored byte-for-byte after builds and excluded; untracked `frontend/frontend/` was preserved.

Generated output is ignored: Worker `dist`, local `.wrangler` data, frontend `.next`, `.open-next` and packaging output. None belongs in the commit. No dependencies were installed and no remote Git or deployment operation occurred.

Final review added provisioning/retry attempt and outcome audits. The initial attempt audit is required before provider/vault mutation; audit storage failures return controlled 503 and the test verifies the provider is not called. A regression initially identified a generic 500, which was corrected. One parallel Docker isolation run hit the existing five-second test timeout; the final complete run used `npm test -- --no-file-parallelism` without changing timeouts or skipping tests: all 149 passed. Final Worker typecheck and dry-run build passed after this change. Frontend checks remain unchanged and passing.


Current configuration checklist and gated two-tenant procedure: [CP2-LIVE readiness](neon-live-readiness.md). The latest readiness correction also authenticates tenant/workspace context before vault revocation writes a tombstone.
