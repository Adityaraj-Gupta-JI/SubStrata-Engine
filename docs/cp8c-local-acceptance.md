# CP8C local acceptance — 24 October 2026

## Verdict

**NO-GO for complete live-provider MVP acceptance.** The owner explicitly kept genuine OpenRouter testing blocked. Local deterministic AI/agent journeys passed. No live provisioning, application database writes, deployment or remote Git operations occurred.

## OpenRouter input reported by the owner

The password field was disabled because the real API reported `storageConfigured: false`. Its normal configuration had no `AI_VAULT_KEYS` or `AI_VAULT_KEY_ID`; the local `TENANT_CREDENTIALS` binding already exists. This was a security prerequisite, not a broken input event handler.

The settings page now explains the lock beside the field, links the explanation through `aria-describedby`, and offers **Refresh secure storage setup**. Validation and saving remain disabled without secure storage. Privately configure a persistent JSON keyring mapping a key ID to a securely random 64-character lowercase hexadecimal AES key in `worker/.dev.vars`, set `AI_VAULT_KEY_ID` to that same ID, retain a private recovery copy, restart the normal API, then refresh setup. These are encryption settings, separate from the OpenRouter provider key. Do not put them in frontend variables or chat. No owner secret file was edited.

## Verified defects repaired

| Defect | Reproduction and repair |
|---|---|
| Membership change persisted but returned 409 / last-owner error | Actual browser viewer assignment persisted and was audited. Permission-version triggers increase D1 `meta.changes`; checking it against 1 incorrectly rejected success. Guarded mutations now use `RETURNING user_id` to check only the target row. Atomic actor/target guards, audit batch and last-owner checks remain intact. |
| Cancellation control active for completed agents | Browser showed Request cancellation enabled after completion. It is now enabled only for a running execution or a recoverable persisted running run. |
| Cancelled run refreshed to the previous run | Run URL was updated only on successful stream completion. It now records the server-issued run ID immediately. Previous conversation links are cleared when starting a new run. Browser cancellation/refresh regression passed. |
| Model-save action stayed enabled after key revocation | Reproduced after revoking the dummy credential. Saving the default model now requires configured encrypted storage and an active provider credential. |

## Genuine browser versus fixture coverage

All browser requests used the existing genuine Clerk session and normal authorization. No cookies/tokens were exported, injected or mocked. The owner was signed out through Clerk; all 11 protected routes then redirected to login.

Authenticated route rendering passed for `/onboarding`, `/dashboard`, `/databases`, `/explorer`, `/sql`, `/sql-editor`, `/chat`, `/agents`, `/settings/ai`, `/settings/access`, `/settings/account`. Login rendered during denial checks; registration navigation was exercised without account creation. This route sweep is not a claim that every provider-dependent action completed.

The **test-only** entry `worker/test/browser/fixture-worker.ts` was launched explicitly, never referenced by normal build/deployment configuration. It retains real Clerk verification, D1, encrypted R2 and database services; only the AI provider is deterministic. It accepts a public dummy fixture string, returns models/messages labeled MOCKED PROVIDER, and makes no OpenRouter calls. Its entry refuses non-loopback/non-HTTP requests. It used an ephemeral encryption key in an ignored temporary runtime file, not an owner-configured persistent vault.

Passed with that fixture:

- BYOK input editing, validate-only, encrypted save, empty field after refresh, model discovery/default selection, replacement and revocation.
- Chat through the actual SSE frontend/backend contract, model switching, empty-message disablement, provider error, retry/recovery, saved conversations and refresh restoration.
- Authorized PostgreSQL schema context, SQL proposal, editable editor handoff without automatic execution, explicit SELECT returning actual disposable PostgreSQL rows (`item-1`, `item-2`). This was local PostgreSQL, not live Neon.
- All three saved agent templates: Schema Analyst, Query Assistant, Data Explorer. Actual schema/tool traces and multi-model-step history were displayed. Bounded loop rejection, cancellation, terminal control states, timeout stopping, history and exact run restoration were exercised. Wall-clock timeout currently reports cancelled / `AI_CANCELLED`; persisted-deadline regression also covers `AGENT_DEADLINE`.
- Actual owner-authorized role assignment, role change, refresh persistence and removal for an unloginable synthetic member in the disposable workspace. Unauthorized changes and concurrent last-owner protection were separately tested with mocked identities against real local D1.
- Reusable `fixtureChatSmoke` and `fixtureAgentTerminalSmoke`, authenticated route sweep and post-logout `anonymousSmoke` passed. Final console check had no unexpected errors after filtering the Clerk development warning. Expected negative tests and the reproduced pre-fix 409 are not counted as unexplained failures.

Not genuine OpenRouter acceptance: key validity, real model catalog/billing, provider latency/stream cancellation and live SQL generation remain blocked. Browser chat cancellation was not separately accepted; agent cancellation passed. Agent tool row-preview consent and adversarial permission cases are regression-tested with fixtures, not a second live Clerk account. No live writes were enabled.

## Test fixture lifecycle

Use the existing CP8B disposable database procedure only in the named disposable local workspace. The fixture Worker may be selected explicitly with `npm run dev -- test/browser/fixture-worker.ts --env-file .wrangler/cp8b-browser/runtime.env`, with the fixture CA in `NODE_EXTRA_CA_CERTS`. The fixture runtime must include a fresh ephemeral AI keyring for this test mode. Never enter a real OpenRouter key into this provider fixture. Normal `npm run dev` uses the real provider and original private configuration.

The one-hour database fixture expired during the long session. Its database/container and private runtime/CA were removed, but metadata deletion initially failed because AI conversations referenced the disposable database. Cleanup now accounts for dependent conversations/runs bound to that exact random owned database. This failed fixture teardown is recorded, not counted as a passing full suite. Its test records and the synthetic member were subsequently removed explicitly from local D1, and the dummy credential was revoked. Original owner configuration and unrelated data were preserved. Local encrypted fixture objects may remain as unreadable ciphertext/tombstones; no persistent owner AI encryption key was created.

## Commands and actual results

| Command | Result |
|---|---|
| Frontend `npm run lint` | Passed |
| Frontend `npm run typecheck -- --incremental false` | Passed |
| Frontend `npm test` | 23 passed |
| Worker `npm run typecheck` | Passed |
| Worker `npm test -- --no-file-parallelism --testTimeout 30000` | 213 passed, 16 files; real disposable local PostgreSQL and native MySQL enabled |
| Worker focused AI/provider/agent suite before changes | 44 passed; mocked provider/identity explicitly labeled |
| Membership regression with permission-version migration before repair | 3 failures reproduced; after repair full suite above passed, including new assignment regression |
| Frontend `npm run build:worker -- --config wrangler.staging.jsonc` | Passed, including Next production build and OpenNext bundle |
| Frontend `npx --no-install wrangler deploy --config wrangler.staging.jsonc --dry-run --outdir .wrangler/cp8c-readiness` | Passed; no deployment |
| Worker `npm run build -- --env-file types.env.example` | Passed |
| Worker `npx --no-install wrangler deploy --config wrangler.staging.jsonc --dry-run --outdir .wrangler/cp8c-staging --env-file types.env.example` | Passed; no deployment |
| Worker `npx --no-install wrangler d1 migrations apply METADATA --local --persist-to .wrangler/cp8c-validation --env-file types.env.example` | All 8 passed |
| Legacy `venv/Scripts/python.exe -m unittest discover -s tests -v` from backend, wrapped in 45-second subprocess timeout | 5 passed outside sandbox in 0.224 seconds; earlier sandbox run timed out creating Python's Windows event-loop socket pair, before tests |
| `node scripts/check-staging.mjs --template-only` | Passed; existing staging configuration untouched |
| Immediate-stop browser PostgreSQL fixture lifecycle after cleanup hardening | 1 selected test passed, 10 intentionally skipped; setup and teardown completed, private runtime/CA removed |
| Reviewed-change credential pattern scan and `git diff --check` | Passed; heuristic scan, not a guarantee against every credential format |

Windows OpenNext and experimental Node middleware warnings remain. SQL approval, strict Clerk audience, encrypted credential binding and cross-tenant regressions are included in the Worker suite. No production credentials or databases were accessed. `frontend/next-env.d.ts` is restored byte-for-byte to its pre-checkpoint modification and excluded from commits; generated Next `AGENTS.md` was removed after stopping dev. Servers are stopped.
