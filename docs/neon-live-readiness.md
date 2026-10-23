# CP8A staging authentication correction

For the first isolated staging deployment, use [the staging release procedure](staging-release.md). Customize the normal Clerk session token with the staging audience and leave `NEXT_PUBLIC_CLERK_JWT_TEMPLATE` unset. Current Clerk documentation does not support session-bound `sid` in custom JWT templates; older template setup advice below is superseded for staging. Keep all existing issuer/signature/audience/session checks.

# CP2-LIVE owner readiness checklist

All steps below are preparation. Provisioning stays disabled; no cloud creation, secret upload, deployment, or live database mutation is authorized by this checklist.

## Actual configuration

- `worker/wrangler.jsonc` is the default **local** configuration. `npm run dev` runs `wrangler dev --local --persist-to .wrangler/r3-local`. `METADATA` and `TENANT_CREDENTIALS` have `remote: false`. R2 has no cloud bucket name: it is local simulation, not a hosted durable bucket. Never deploy this local config; omitted resource identifiers can cause Wrangler automatic provisioning during deployment.
- `worker/wrangler.deploy.example.json` is an **incomplete template**, not a hosted development configuration. Its account ID, D1 name/ID, R2 bucket name and variables are null. No named `development` environment or configured hosted development Worker exists. Do not assume `--env development` is available. R2/D1 bindings must be explicitly specified in each future named environment; they are not inherited.
- `npm run types` uses the intentionally empty `worker/types.env.example` input so binding generation does not load private `.dev.vars`/`.env` files. `WorkerBindings` is generated; the application `Env` permits absent R2 only so the service can reject missing bindings at runtime.

## Owner checklist

### Neon (existing disposable environment)

1. In the authenticated Neon account, verify project **lively-mountain-93536009** and branch **br-round-shadow-b8h07enf** exist and are dedicated to this test. They have not yet been verified by this agent. Keep the dedicated-empty-branch confirmation and approval to revoke PUBLIC CONNECT; preserve administrator access. Do not modify other branches.
2. Record the actual direct, non-pooler read-write endpoint hostname, existing administrator/owner role, and control database. Do not supply a connection string to the API. Confirm the administrator role can execute the existing restricted-role policy. The code rejects unexpected extensions/privileges; stop and investigate incompatibilities rather than weaken the policy.
3. Privately configure the project-scoped Neon API credential (where supported) as **NEON_API_KEY** and the selected owner role's PostgreSQL password as **NEON_ADMIN_PASSWORD**. No API-created tenant roles: runtime roles are SQL-created with restricted attributes. Do not paste credentials into chat.
4. Set nonsecret **NEON_DEVELOPMENT_CONFIG** to JSON with this shape, replacing only the explicitly marked owner-verified fields:

```json
{
  "projectId": "lively-mountain-93536009",
  "branchId": "br-round-shadow-b8h07enf",
  "host": "<OWNER_VERIFIED_DIRECT_NEON_HOST>",
  "ownerRole": "<OWNER_VERIFIED_ADMIN_ROLE>",
  "controlDatabase": "<OWNER_VERIFIED_DATABASE>",
  "approvedProjectId": "lively-mountain-93536009",
  "approvedBranchId": "br-round-shadow-b8h07enf",
  "allowBranchPublicRevocation": true,
  "environment": "disposable-development"
}
```

5. **Leave NEON_PROVISIONING_APPROVAL unset.** Only after a separate go-ahead to enable testing would its exact value be `lively-mountain-93536009/br-round-shadow-b8h07enf`. An approval string is not a substitute for checking authenticated account/project/branch/endpoint responses before mutation.

### R2 and Worker secrets

1. For local checks, no cloud bucket is required: the local binding is now declared. Retain local `.wrangler/r3-local` encrypted objects and the corresponding private wrapping keys; do not clean them up while they refer to live databases.
2. For **hosted R2 acceptance**, first obtain approval for a private development bucket and provide its actual name/account/jurisdiction if applicable. No bucket exists or was created by this work. Disable public access and restrict operator permissions. No frontend R2 binding or R2 access keys are needed.
3. In a future owner-configured hosted-development API config, set `r2_buckets` to binding **TENANT_CREDENTIALS** with that real `bucket_name`; use `remote: false` for local simulation. This flag controls local development access, not hosted bucket access. Real R2 remote-binding tests require separate approval and explicit targeting. Do not add `remote: true` casually.
4. Privately generate 32 cryptographically random key bytes. Secret **NEON_VAULT_KEYS** is a JSON object mapping a nonsecret key ID (for example, `dev-v1`) to 64 lowercase hexadecimal key characters. Nonsecret **NEON_VAULT_KEY_ID** selects that exact ID. Do not store this keyring in vars, D1, R2, source, frontend files or shell history. Preserve a protected recovery copy.
5. Local secrets belong in the owner-managed, ignored **worker/.dev.vars**. Required secret names for live provisioning are **CLERK_SECRET_KEY**, **NEON_VAULT_KEYS**, **NEON_API_KEY**, **NEON_ADMIN_PASSWORD**. Nonsecret names are **CLERK_ISSUER**, applicable **CLERK_AUDIENCE**, **FRONTEND_ORIGIN**, **NEON_VAULT_KEY_ID**, **NEON_DEVELOPMENT_CONFIG**. Leave provisioning approval absent. Missing/invalid vault configuration yields unavailable responses.
6. For future hosted setup, resolve the dedicated development Worker name, Cloudflare account, existing D1 **METADATA** name/ID and real R2 bucket first. Bind METADATA with migrations `0001_metadata.sql` and `0002_neon_poc.sql`. Applying remote migrations, creating resources and uploading secrets require separate approval. Never use the production Worker/config.
7. **Do not run `wrangler secret put` during preparation:** it immediately deploys a new Worker version. After separate approval, a version-only secret workflow can stage changes without deployment, but it is still a remote write and is not executed here. The local `.dev.vars` file is not uploaded automatically.

### Frontend and Clerk

- API: **FRONTEND_ORIGIN=http://localhost:3000** for the existing local frontend; **CLERK_ISSUER** must match the Clerk development app. Preserve strict **CLERK_AUDIENCE** policy.
- In owner-managed **frontend/.env.local**, keep matching development **NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY** / server-only **CLERK_SECRET_KEY**, and set **NEXT_PUBLIC_PLATFORM_API_URL=http://localhost:8787**. If audience policy requires a custom token, set **NEXT_PUBLIC_CLERK_JWT_TEMPLATE** to a configured template that emits the matching `aud` and session `sid`. Never relax audience checks to make the test work.
- Never add NEON/Vault credentials to frontend variables. Genuine Clerk browser acceptance requires the owner's sign-in; tests cannot establish it.

## Safe two-tenant test procedure (after separate enablement approval)

1. Read-only preflight: verify authenticated Neon project/branch/read-write endpoint, dedicated environment confirmation, effective administrator permissions, correct D1/R2 bindings and available keyring. Record only nonsecret IDs/flags. Do not mutate on an unverified or mismatched target.
2. Start the API locally and frontend at the configured loopback origins; use the same persistent local D1/R2 directory throughout. A test against local R2 must be labelled local R2, not live cloud R2 acceptance.
3. Using genuine Clerk development identities, create/select test organization/workspace A and a separate organization/workspace B. Obtain real workspace IDs through the UI/API; do not invent IDs or accept a client-supplied user ID.
4. After explicit approval to enable, configure the exact approval value privately and restart the API. Owner/admin requests `POST /api/v1/workspaces/{workspace}/databases`; poll `GET` on the collection/item and retry only when the server permits it. Repeat the request to prove idempotence. Expected generated names are `ss_t_<D1 tenant ID>` and `ss_r_<D1 tenant ID>`; record actual names only after creation. Never handcraft tenant identities or credentials.
5. Verify both own-database connections using runtime roles, and both cross-database attempts fail. Check NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS, no role memberships, SELECT-only tenant schema/table privileges, no foreign CONNECT, no unauthorized extension/foreign server/security-definer route. Run both actual connection denials and privilege catalog checks. Preserve administrator access.
6. With separately approved test-fixture writes, seed a small known table in each newly created tenant database via the private provisioning/admin channel only. Runtime/UI execution remains read-only. Browse actual schemas/tables/rows and execute a bounded SELECT through the UI. Verify each result belongs to its workspace. Never add public seed/write/admin SQL endpoints.
7. Reject writes, DDL, multi-statements, missing/forged/expired/wrong-audience tokens, foreign organization/workspace/database requests and viewer provisioning. Compare fixture rows afterward to confirm rejected statements did not execute. Verify sanitized request/outcome audit records, including retries/failures; no SQL, passwords, tokens or provider payloads.
8. Verify encrypted object contents and D1 reference-only metadata privately without printing plaintext or keys. Exercise wrapping-key rewrap on the disposable credential, keeping the old key until all reads succeed. Vault revocation must fail context authentication for a foreign tenant/workspace and block subsequent API credential resolution after valid revocation. Full PostgreSQL revocation (NOLOGIN/terminate sessions) requires separate explicit approval; a tombstone alone is not database-session revocation.
9. Browser acceptance: refresh each workspace, reselect database, inspect rows, run SELECT, and check permission/unavailable states. Record genuine browser results separately from mocked auth/SDK tests. Stop on isolation/privilege/quarantine failures; do not bypass them or blindly retry.
10. Disable provisioning after the test by removing approval and restarting. Retain encrypted objects and metadata for reconciliation. Do not delete databases, roles, bucket, project, branch or objects without explicit cleanup approval.

## Immediate versus infrastructure-dependent checks

- Immediate: binding/type-generation checks; full Worker suite with disposable local R2/D1/TLS PostgreSQL; real Clerk SDK verification with ephemeral keys; frontend tests/lint/typecheck; local packaging dry run. No cloud credentials required.
- Requires owner configuration/approval: authenticated Neon preflight; actual Neon role/provisioning/two-tenant isolation; real bucket permissions and cloud R2 reads/writes; hosted D1/Worker integration; genuine Clerk browser acceptance with populated tenant databases.
- Existing frontend routes and API contracts are already wired. No frontend rewrite or additional public credential/admin endpoint is needed. Remaining work is environment setup and the above integration gates.

References: [Wrangler R2 configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#r2-buckets), [Worker secrets and deployment behavior](https://developers.cloudflare.com/workers/configuration/secrets/).

## Readiness validation record (2026-10-23)

- `worker`: `npm run types`; `npm run typecheck`; `$env:SUBSTRATA_LOCAL_POSTGRES='1'; npm test -- --no-file-parallelism`: **149 passed**, including disposable local D1/R2/TLS PostgreSQL and cryptographic SDK checks. Provider and route-identity fixtures remain mocked where labelled.
- After the revocation context correction: `npm run typecheck`; `npx --no-install vitest run test/credential-vault.test.ts test/neon-development.test.ts`: **12 passed**; `npm run types -- --check`: up to date; `npm run build -- --env-file types.env.example`: dry run passed and listed both METADATA and TENANT_CREDENTIALS. No cloud access/resources were needed.
- `frontend`: `npm test`: **14 passed**; `npm run lint`: passed; `npm run typecheck -- --incremental false`: passed. No frontend source changed; production/OpenNext builds were not repeated in this readiness pass (passed at baseline commit).
- `git diff --check`: passed. Private files remain ignored. No secrets were printed; no remote Git operations, cloud resource creation, provisioning enablement or deployment occurred. Readiness changes remain uncommitted. Existing modified frontend/next-env.d.ts and untracked frontend/frontend/ are preserved.
