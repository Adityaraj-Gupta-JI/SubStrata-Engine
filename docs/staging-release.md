# CP8A — isolated staging release preparation

Prepared 2026-10-24. Local preparation only. No cloud resource, deployment, secret upload or remote Git operation was performed.

## Decision and boundaries

- **Branch push: GO after reviewing the preparation commit.** No credible live credential was identified in the bounded tracked/history scan. This is a heuristic review, not proof that no secret ever existed. No push was executed or authorized by this checkpoint.
- **Staging deployment: NO-GO now.** Account, D1 UUID, workers.dev subdomain, Clerk issuer/public key/runtime secrets and a clean release build must be supplied and verified by the owner. The committed templates intentionally contain `REPLACE_WITH` sentinels.
- After those gates, a limited auth/workspace/AI staging deployment is feasible using two independent Workers. Full managed database acceptance remains blocked by owner-verified Neon configuration and separately approved integration/provisioning. Provisioning/writes remain off.
- Existing default configs still name `substrata-engine` and `substrata-api`. **Do not use the default deploy scripts for staging.** Always specify `--config wrangler.staging.jsonc`. No old Worker/routes, D1 or R2 resources are reused. Separate config files avoid named-environment inheritance ambiguity. Compatibility date stays at the already tested `2026-10-22`; no runtime upgrade/redesign is included.

## Exact resources and inventory

| Resource | Staging name / binding | Owner action |
|---|---|---|
| Frontend Worker | `substrata-v2-staging`; `ASSETS` | New Worker target; OpenNext `.open-next/worker.js` and `.open-next/assets` |
| API Worker | `substrata-api-staging` | New Worker target; `worker/src/index.ts` |
| D1 | **new** `substrata-metadata-staging`; `METADATA` | Create separately; copy its actual UUID into API staging config; apply migrations 0001–0008 |
| R2 | **new private** `substrata-credentials-staging`; `TENANT_CREDENTIALS` | Create separately; public access/custom public domains disabled; bind only API Worker |
| Account | `account_id` in both staging configs | Same owner-verified Cloudflare account ID; no account ID was guessed |
| Staging origins | `https://substrata-v2-staging.<your-subdomain>.workers.dev`, `https://substrata-api-staging.<your-subdomain>.workers.dev` | Confirm names are unused; API `FRONTEND_ORIGIN` is the exact frontend HTTPS origin, without trailing slash |
| Clerk | Separate staging Clerk application | No production user/session sharing. Controlled internal development testing may use its development instance. For durable external staging, follow Clerk's separate-app/domain guidance and provision its production instance/domain separately |
| Neon (already documented, not account-verified) | project `lively-mountain-93536009`; branch `br-round-shadow-b8h07enf` | Verify in authenticated Console; no project/branch/database creation or modification performed here |
| OpenRouter | User-owned BYOK, encrypted in API R2 | No global `OPENROUTER_API_KEY` binding exists or is required; key entered privately in AI settings |

Dependencies verified from lockfiles: Node 24.13.0 locally; frontend Next 16.4.2, React 19.2.8, Clerk Next 7.9.19 (its backend 3.26.1), OpenNext Cloudflare 1.20.6, Wrangler 4.151.3. API Clerk backend 2.33.8, pg 8.23.1, mysql2 3.24.6, pgsql-ast-parser 12.0.2, Wrangler 4.151.3. Use existing lockfiles and `npm ci`; no speculative upgrades. Python/FastAPI is legacy and is not deployed by either Worker. No Hyperdrive, Durable Object, frontend R2 or queue binding is required by the current configuration.

### Frontend inputs

| Name | Location | Required policy |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Build process, public | Correct staging app instance; baked into client assets; rebuild after changing |
| `NEXT_PUBLIC_PLATFORM_API_URL` | Build process, public | Exact isolated HTTPS API origin, no `/api/v1`, query, credentials or trailing slash |
| `NEXT_PUBLIC_CLERK_JWT_TEMPLATE` | Existing optional code path | **Leave absent for this staging release.** Use the normal customized session token instead |
| `CLERK_SECRET_KEY` | Frontend Worker **secret** | Same staging Clerk instance as publishable key; do not put in build dotenv files |
| `NEXT_PUBLIC_LEGACY_API_URL` | Legacy/demo-only optional code | Leave absent; no Python/legacy API deployed |
| `NODE_ENV` | Next/toolchain | Production build/runtime, not a custom staging secret |
| `NEXT_TELEMETRY_DISABLED`, `WRANGLER_SEND_METRICS` | Tool process | `1`, `false` for manual checks; not application credentials |

### API inputs — names verified against `worker/src/secrets.d.ts` and call sites

| Names | Type / requirement |
|---|---|
| `CLERK_SECRET_KEY` | Required API Worker secret; same staging Clerk app/instance as frontend |
| `CLERK_ISSUER` | Required exact HTTPS issuer, owner-verified; never infer from a different instance |
| `CLERK_AUDIENCE` | Staging value **`substrata-api-staging`**; required by this release policy; signature-verified `aud` must match |
| `FRONTEND_ORIGIN` | Required exact staging frontend origin; CORS and Clerk authorized-party policy |
| `WORKSPACE_MEMBERSHIP_MODE` | `d1`; membership/roles remain server-authoritative |
| `AI_VAULT_KEYS` / `AI_VAULT_KEY_ID` | Secret JSON keyring / nonsecret active ID (`staging-v1`); required for encrypted AI BYOK persistence |
| `NEON_DEVELOPMENT_CONFIG`, `NEON_VAULT_KEYS`, `NEON_VAULT_KEY_ID` | Optional managed-reader integration: nonsecret endpoint/approved IDs JSON, secret independent keyring, nonsecret active ID; omit initially |
| `NEON_API_KEY`, `NEON_ADMIN_PASSWORD`, `NEON_PROVISIONING_APPROVAL` | Privileged provisioning secrets / approval setting; **omit all initially**. Separate owner approval and authenticated target verification required before enabling |
| `BYODB_ALLOWED_DESTINATIONS`, `BYODB_VAULT_KEYS`, `BYODB_VAULT_KEY_ID` | Approved pinned PostgreSQL destination JSON, secret independent keyring, active ID. Empty allowlist initially; connections unavailable until separately configured |
| `MYSQL_ALLOWED_DESTINATIONS`, `MYSQL_VAULT_KEYS`, `MYSQL_VAULT_KEY_ID` | MySQL equivalent, independent keyring; empty allowlist initially; read-only even when configured |
| `DATABASE_EXECUTION_TARGETS`, `SQL_VAULT_KEYS`, `SQL_VAULT_KEY_ID` | Privileged write/admin role mapping and independent encrypted keyring; targets `[]`, keys absent initially; no write enablement |
| `DATABASE_RUNTIME_MODE`, `DATABASE_RUNTIME_CONFIG` | Local-fixture-only credential resolver. **Never configure on staging**; resolver also rejects non-loopback requests |

All wrapping keyrings map a nonsecret ID to 32 cryptographically random bytes represented by 64 lowercase hex characters. Generate privately and retain protected recovery copies; use distinct keys for staging and each credential purpose. D1 stores opaque references, not key material/passwords. R2 stores authenticated encrypted envelopes. Rotation retains old keys until all objects have been verified/re-wrapped; revocation does not itself terminate external database sessions. Never send keys through chat, command arguments, audit events or frontend vars.

## Owner dashboard setup (future actions, not performed)

1. **Cloudflare:** open the intended account; copy its Account ID. Confirm the two proposed Worker names are unused and are not aliases/routes for the previous deployment. Record the account's workers.dev subdomain. Do not attach an existing production route/custom domain. Review plan/CPU/startup quotas; dry runs do not establish hosted execution budgets.
2. **D1:** Workers & Pages → D1 → Create database → `substrata-metadata-staging`. Record the UUID. Do not select `substrata-metadata` from an old deployment. Do not run remote migrations until the name/UUID/account have been checked together.
3. **R2:** R2 Object Storage → Create bucket → `substrata-credentials-staging`. Disable public development URL/public domains. Restrict account/operator access. R2 bindings are Worker-scoped read/write; bind this bucket only to the API. No bucket access keys are required for the binding.
4. Fill `account_id` in both staging configs, API `database_id`, `FRONTEND_ORIGIN` and `CLERK_ISSUER`. Do not remove the explicit D1 ID or bucket name: current Wrangler can automatically provision missing-ID resources during deployment. Do not copy old resource IDs or old encryption keys.
5. **Clerk:** select a separate staging application and the intended instance. Copy its public key and issuer from that instance; privately prepare the same instance's secret for both Workers. Configure `/login`, `/register` and fallback `/dashboard` paths, and the actual staging application URL/allowed origins where applicable. Under **Sessions → Customize session token → Claims**, merge `{"aud":"substrata-api-staging"}` and save. Preserve Clerk's default `sub`, `sid`, `iss`, `exp` and `nbf`; do not fabricate a session ID. Leave `NEXT_PUBLIC_CLERK_JWT_TEMPLATE` unset. Sign out/in or refresh the session after claim changes. Current Clerk docs explicitly say custom JWT templates cannot include session-bound `sid`; earlier repository advice to add `sid` to a JWT template is superseded by this procedure. Never remove the API's `sid` or audience checks to accommodate a misconfigured token.
6. Privately prepare **two external, access-restricted JSON secret files outside the clean release directory**. Frontend file contains only `CLERK_SECRET_KEY`. API file contains `CLERK_SECRET_KEY` and `AI_VAULT_KEYS`. No values appear in this guide. A future deploy can upload secrets atomically alongside code with `--secrets-file`. Uploading/changing secrets through the dashboard or `wrangler secret put` can deploy a version; it is not a read-only setup check. Do not perform it during CP8A. After deployment, verify secret *names* and D1/R2 binding identities in each new Worker's Settings.
7. **Neon:** sign in; select project settings to check exact project ID `lively-mountain-93536009`; Branches → exact `br-round-shadow-b8h07enf`. Confirm dedicated disposable ownership/no production data, branch protection, databases/roles, and Connect → direct non-pooler read-write endpoint. Do not create/delete/revoke anything. Repository ID consistency is verified; authenticated ownership/existence/endpoint compatibility are not. Keep the integration/provisioning config absent until reviewed. Future managed config fields are `projectId`, `branchId`, `host`, `ownerRole`, `controlDatabase`, `approvedProjectId`, `approvedBranchId`, `allowBranchPublicRevocation: true`, `environment: "disposable-development"`; use the existing gated Neon readiness procedure after separate approval.
8. **OpenRouter:** privately obtain a staging/test BYOK key, set an appropriate provider budget, then use `/settings/ai` after staging authentication/R2 vault acceptance. No OpenRouter account key belongs in frontend environment variables or D1. No provider call was made here.

## Clean release build and manual commands — NOT executed

OpenNext 1.20.6 `compileEnvFiles`/`extractProjectEnvVars` serializes project and monorepo `.env*` contents into generated server output. This is server-side output, not evidence of a browser key leak, but it can carry unintended development credentials into a deployment. **Do not deploy this checkout's existing `.open-next`, `.next` or `.wrangler` output.** Build from a new local Git archive with no dotenv files, supply only public build inputs, and deliver private runtime keys exclusively as Worker secrets. The preflight only inspects filenames, not private env contents.

After the owner approves resource creation/deployment and performs the dashboard steps, use a new local build directory. Commands below do not push or contact a Git remote. `npm ci` downloads lockfile dependencies; the deployment/migration commands are intentionally owner-only future cloud mutations.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'D:\1Projects\DBMS_projects\SubStrata_Engine\github_main\substrat-engine'
$stageDir = Join-Path $env:TEMP ('substrata-stage-' + [guid]::NewGuid())
$stageZip = $stageDir + '.zip'
git -C $repo archive --format=zip --output=$stageZip dev/substrata-v2
if ($LASTEXITCODE -ne 0) { throw 'Local archive failed' }
Expand-Archive -LiteralPath $stageZip -DestinationPath $stageDir
Set-Location $stageDir
Push-Location worker
npm ci
if ($LASTEXITCODE -ne 0) { throw 'API dependency installation failed' }
Pop-Location
Push-Location frontend
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' }
Pop-Location

$accountId = Read-Host 'Approved Cloudflare account ID (nonsecret)'
$d1Id = Read-Host 'NEW substrata-metadata-staging UUID (nonsecret)'
$subdomain = Read-Host 'Your workers.dev account subdomain (nonsecret)'
$issuer = Read-Host 'Exact staging Clerk HTTPS issuer (nonsecret)'
foreach ($file in @('frontend/wrangler.staging.jsonc','worker/wrangler.staging.jsonc')) {
  $text = [IO.File]::ReadAllText((Join-Path $stageDir $file))
  $text = $text.Replace('REPLACE_WITH_CLOUDFLARE_ACCOUNT_ID',$accountId).Replace('REPLACE_WITH_STAGING_D1_ID',$d1Id).Replace('REPLACE_WITH_WORKERS_SUBDOMAIN',$subdomain).Replace('https://REPLACE_WITH_STAGING_CLERK_ISSUER.invalid',$issuer)
  [IO.File]::WriteAllText((Join-Path $stageDir $file),$text)
}
$env:NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = Read-Host 'Staging Clerk publishable key (public)'
$env:NEXT_PUBLIC_PLATFORM_API_URL = "https://substrata-api-staging.$subdomain.workers.dev"
Remove-Item Env:NEXT_PUBLIC_CLERK_JWT_TEMPLATE -ErrorAction SilentlyContinue
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:WRANGLER_SEND_METRICS = 'false'
node scripts/check-staging.mjs
if ($LASTEXITCODE -ne 0) { throw 'Resolve staging preflight failures before continuing' }
```

Verify account selection with `npx --no-install wrangler whoami` inside `worker` if needed (owner-only authenticated read); stop on any mismatch with `account_id`. Authenticate locally if necessary; do not paste API tokens into commands. Check both external secret-file paths are outside `$stageDir` and contain only the names described above. Then:

```powershell
# Run from the clean release directory, after preflight has passed.
$apiSecretFile = Read-Host 'Absolute protected API secrets JSON path (outside release directory)'
$frontendSecretFile = Read-Host 'Absolute protected frontend secrets JSON path (outside release directory)'
Push-Location worker
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'API typecheck failed' }
npx --no-install wrangler deploy --config wrangler.staging.jsonc --dry-run --outdir .wrangler/staging-release --env-file types.env.example
if ($LASTEXITCODE -ne 0) { throw 'API packaging failed' }
# FUTURE REMOTE MUTATION: only the verified NEW staging D1 database.
npx --no-install wrangler d1 migrations apply METADATA --config wrangler.staging.jsonc --remote --env-file types.env.example
if ($LASTEXITCODE -ne 0) { throw 'Staging migration failed' }
# FUTURE DEPLOYMENT: only substrata-api-staging, not the default Worker.
npx --no-install wrangler deploy --config wrangler.staging.jsonc --env-file types.env.example --secrets-file $apiSecretFile
if ($LASTEXITCODE -ne 0) { throw 'API staging deploy failed' }
Pop-Location
Push-Location frontend
npm run build:worker -- --config wrangler.staging.jsonc
if ($LASTEXITCODE -ne 0) { throw 'Clean Next/OpenNext build failed' }
npx --no-install wrangler deploy --config wrangler.staging.jsonc --dry-run --outdir .wrangler/staging-release --env-file ../worker/types.env.example
if ($LASTEXITCODE -ne 0) { throw 'Frontend packaging failed' }
# FUTURE DEPLOYMENT: only substrata-v2-staging.
npx --no-install wrangler deploy --config wrangler.staging.jsonc --env-file ../worker/types.env.example --secrets-file $frontendSecretFile
if ($LASTEXITCODE -ne 0) { throw 'Frontend staging deploy failed' }
Pop-Location
```

Do not use `npm run deploy:worker`, omit `--config`, add existing routes, upload old local output or pass a secret in `--var`. No rollback of Worker code restores D1/R2/database state; this plan changes only new resources. If acceptance fails, restrict/disable only the two staging Workers and preserve staging data for diagnosis; do not touch the previous deployment or Neon branch.

## Focused security review

| Severity | Finding / evidence | Required action |
|---|---|---|
| Critical | None confirmed in the checked scope | No claim of a full penetration test |
| High — deployment blocker | OpenNext copies dotenv values to generated server bundles; old local output is not a staging release artifact | Clean archive build; Worker secrets; preflight blocks dotenv filenames |
| High — deployment blocker | Staging cloud IDs/origins/secrets and authenticated Neon target remain unverified; custom JWT templates cannot satisfy `sid` policy | Fill verified IDs, configure standard session `aud`, genuine browser acceptance; keep provisioning off |
| Medium | Legacy Python connection fallback contains a generic local credential-shaped URL; two historical tests contain deliberate dummy credential URLs | Not evidence of live credential leakage. Legacy Python is excluded from deployment; never reuse that default password. No history rewrite or unrelated legacy change |
| Medium | Node middleware in this OpenNext adapter is experimental; Windows packaging alone does not prove hosted Clerk handshake/streaming/network behavior | Staging browser/runtime gate; do not redesign or weaken Clerk |
| Medium | Public signup/resource use and hosted CPU/startup quotas are not bounded by a new abuse-control layer in this sprint | Restrict staging to designated test users in Clerk, monitor request/cost budgets; don't make production availability claims |

Authentication: `auth.ts/verifySession` checks SDK signature then exact issuer, expiry/activation, subject/session and strict configured audience; frontend layout requires Clerk auth. Authorization: D1 `workspaceAccess`, memberships and database scope; cross-tenant denial regressions passed. SQL: single-statement parser, atomic single-use digest/user/database/permission-bound approvals, elevated confirmation, explicit database opt-in; targets empty in staging. Secret storage: AES-GCM/R2 purpose/tenant/workspace bindings and D1 opaque references; no plaintext credential path added. CORS: exact `FRONTEND_ORIGIN`, invalid-origin preflights denied; CORS is not authorization. SSRF: server-only destination allowlists, public IP pins/TLS hostname checks; both lists empty. AI: fixed OpenRouter endpoint, authorized bounded tools, proposal-only writes, no automatic generated SQL execution. Legacy unrestricted execution stays disabled. No new security-control defect requiring an application rewrite was confirmed.

## Credential scan scope

Scanned all 327 unique reachable blobs across 34 commits on `dev/substrata-v2` before this preparation commit, including the current tracked tree. Patterns: provider/cloud keys, JWTs, private-key headers and credential-bearing DB URLs. Three URL matches were classified without displaying values: two intentional provider/provisioning test fixtures and `backend/app/database/connection.py`'s generic localhost fallback. No tracked `.env`/`.dev.vars`/private key files; no credible live credential found. Private working environment files were not opened. This does not scan unrelated branches, reflogs/unreachable objects, Cloudflare history or external systems and is not an entropy/DLP guarantee.

## Minimal real-browser acceptance — owner gate after deployment

1. On staging URL, anonymous `/dashboard` redirects to `/login`; no protected content. API protected endpoint without/with invalid bearer token returns 401. Health alone is public.
2. Register/sign in as designated staging users; refresh `/dashboard`, `/login`, chat and agents without handshake loops. Authenticated API requests work with matching session `aud`, issuer and origin. Never copy a token/cookie into a report.
3. Create organization/workspace, navigate and refresh; selection persists. A second unrelated user cannot list/access the first workspace/database/history; removing a fixture membership denies subsequent access.
4. Confirm managed provisioning, BYODB and writes show controlled setup-required states while disabled. No synthetic connected database or query success. Stop if any creates a remote database automatically.
5. Privately save test OpenRouter BYOK; choose model, chat/stream/cancel, reload saved conversation, review SQL proposal in editor without execution, launch an authorized agent and reopen persisted trace. Confirm API responses/audits contain no credentials and R2 objects are ciphertext.
6. Only after separate Neon approval: verify two disposable tenant databases/roles, actual schema/rows/SELECT, cross-tenant denial and audits; AI proposal never auto-executes. Write preview/approval testing requires separate explicit write opt-in approval. No production/unapproved external database testing.
7. Check mobile navigation/forms, keyboard selection, graph empty/error states, stale-session recovery and new Worker logs without secret values. Verify previous deployment is unchanged.

## Actual local validation

Executed on Windows using the installed lockfile dependencies:

- Worker `npm run typecheck`; `npm test -- --no-file-parallelism --testTimeout 30000` with both local database flags enabled: **212 tests, 16 files passed, no skips**. Real owned disposable PostgreSQL/MySQL TLS fixtures and local D1/R2; Clerk/OpenRouter journey identity/provider behavior is mocked. Real SDK RSA signature/claim regressions are separate.
- Worker `npx --no-install wrangler deploy --config wrangler.staging.jsonc --dry-run --outdir .wrangler/cp8a-bundle --env-file types.env.example`: passed, API upload 2277.31 KiB / gzip 561.50 KiB. No upload performed.
- Worker `npx --no-install wrangler d1 migrations apply METADATA --config wrangler.staging.jsonc --local --persist-to .wrangler/cp8a-validation --env-file types.env.example`: all eight migrations passed on disposable local D1. No remote migrations.
- Frontend `npm test` **23 passed**; `npm run lint` and `npm run typecheck -- --incremental false` passed. `npm run build:worker -- --config wrangler.staging.jsonc` passed, including Next production build and OpenNext bundle. Frontend staging Wrangler dry run passed: 9015.78 KiB / gzip 1855.30 KiB. Existing private dotenv files were consumed by the toolchain, not inspected/displayed by this audit; this local packaging artifact is explicitly **NOT approved for deployment**. A clean public-input release build is still a gate.
- Legacy `..\venv\Scripts\python.exe -m unittest discover -s tests -v`: **5 passed**.
- `node --check scripts/check-staging.mjs` passed; template-isolation mode passed. Full preflight rejected unresolved owner configuration/private environment filenames as expected. `git diff --check` and staged credential/exclusion review passed before commit.
- Existing `frontend/next-env.d.ts` edits were restored byte-for-byte and excluded from the release commit. `frontend/frontend/` was absent when checked; no cleanup targeted it.
- OpenNext Windows and experimental Node middleware warnings remain; no runtime compatibility flag, dependency or authentication policy was weakened. No genuine cloud/browser acceptance was run.

Template isolation validation is distinct from full preflight: `node scripts/check-staging.mjs --template-only` passes; the default check **must fail** until owner placeholders and clean build/public inputs are resolved. Dry runs validate bundling only; they do not prove account resources, Clerk/Neon acceptance, remote secret configuration or staging readiness.

Sources checked: [Wrangler configuration/automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/), [secret uploads alongside code](https://developers.cloudflare.com/workers/configuration/secrets/), [Clerk separate staging apps](https://clerk.com/docs/guides/development/managing-environments), [Clerk session claim customization](https://clerk.com/docs/guides/sessions/customize-session-tokens), [JWT template session limitations](https://clerk.com/docs/guides/sessions/jwt-templates), [Neon branch Console](https://neon.com/docs/manage/branches), [Worker quotas](https://developers.cloudflare.com/workers/platform/limits/). OpenNext environment-copy behavior and command flags were verified directly in installed 1.20.6/4.151.3 source/help; server packaging support is not hosted runtime certification.
