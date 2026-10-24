# CP8B local stabilization

## Result and defect register

Partial product acceptance. No cloud provisioning, live writes, deployment or remote Git operations were performed.

| Route / action | Expected / actual | Root cause | Severity / status |
|---|---|---|---|
| /onboarding: Create or select a workspace on mobile | Open workspace controls / hash changed but controls remained hidden | Next Link history update did not trigger the shell hashchange listener | P1: fixed with explicit context action; repeated open/close browser smoke passed |
| /login using a frontend bound to 127.0.0.1 while visiting localhost | Clerk login / self-proxy socket errors | Test launch origin mismatch | Harness issue: use supported npm run dev on localhost; no authentication change |
| Real Worker to self-signed disposable PostgreSQL | Trusted TLS query / controlled 503 | workerd lacked fixture CA trust | Harness issue: pass public fixture CA via NODE_EXTRA_CA_CERTS before Wrangler; certificate verification stays enabled |
| /settings/ai, /chat, /agents | Real provider journeys / AI vault keyring absent | Owner configuration unavailable | Live acceptance deferred to owner by request; no invented responses |
| /databases connection forms | Validate approved provider destination / unavailable state | No approved local external destination or managed provisioning setup | Correct setup-required state; no allowlist bypass |

## Actual browser coverage

Genuine Clerk login supplied privately by owner. Login and registration forms rendered; registration was not submitted. Anonymous protected-route denial and authenticated rendering passed for /onboarding, /dashboard, /databases, /explorer, /sql, /sql-editor, /chat, /agents, /settings/ai, /settings/access, /settings/account.

Created a disposable organization and workspace through actual forms; selection survived navigation/refresh. Actual local D1 mutations and authenticated Worker requests succeeded. Membership owner inheritance was inspected, but membership grants were not exercised. A synthetic unloginable member fixture was removed.

With disposable local TLS PostgreSQL (not live Neon): selected database, loaded schemas/tables/FK metadata, previewed real rows, paginated forward/back, restored selection after refresh, handed SQL to editor without autoexecution, explicitly executed SELECT, preserved bigint precision, rejected DELETE through read-only gateway and recovered with SELECT. Write preview reported disabled and provided no execution action. No application writes were enabled.

Reusable real-browser automation: frontend/test/browser/smoke.mjs. In the Codex browser runner, import that file and call anonymousSmoke(anonymousTab), routeSmoke(signedInTab), onboardingSmoke(signedInTab), databaseReadSmoke(signedInTab), browserErrors(signedInTab). Database smoke requires the disposable fixture. Tests do not inject Clerk sessions. Browser console check returned no unexpected errors; only expected Clerk development warning was excluded. Failed API behavior was observed through actual Wrangler status logs and visible alerts, not a complete HAR capture.

## Disposable browser database procedure

Use only an owner-created disposable organization slug cp8b-smoke-20261024 and workspace slug cp8b-local in local D1. Set SUBSTRATA_LOCAL_POSTGRES=1 and SUBSTRATA_BROWSER_WORKSPACE_ID to that workspace UUID. Run from worker:

```powershell
npm test -- test/database-gateway.integration.test.ts --testNamePattern 'serves schemas' --hookTimeout 4000000 --testTimeout 30000
```

This opt-in fixture holds for at most one hour; the selected-test result (1 pass, 10 skipped) is not full-suite validation. It creates random database/role identifiers and copies local Clerk configuration privately into ignored .wrangler/cp8b-browser/runtime.env with generated restricted database credentials. Never display or commit that file. Launch Wrangler with NODE_EXTRA_CA_CERTS pointing to the public .wrangler/cp8b-browser/ca.crt and --env-file .wrangler/cp8b-browser/runtime.env. Stop that API before creating .wrangler/cp8b-browser/stop. The fixture removes its exact metadata row, private runtime file, CA and owned Docker resources. Cleanup failures remain test failures. The browser fixture used here completed cleanup successfully; normal local API configuration contains no fixture credentials.

## Validation

- Frontend npm run lint: passed.
- Frontend npm run typecheck -- --incremental false: passed.
- Frontend npm test: 23 passed.
- Worker npm run typecheck: passed.
- Worker full npm test -- --no-file-parallelism --testTimeout 30000 with local PostgreSQL and native disposable MySQL enabled: 212 passed, 16 files.
- After cleanup hardening, Worker typecheck and focused database integration: 11 passed. A transient syntax error introduced while editing the test cleanup was corrected before this successful rerun.
- Frontend npm run build:worker -- --config wrangler.staging.jsonc: passed, including next build --webpack and OpenNext bundle.
- Frontend staging Wrangler deploy --dry-run: passed, no upload/deployment.
- Worker npm run build -- --env-file types.env.example and staging Wrangler deploy --dry-run: passed.
- Local D1 migrations apply using isolated .wrangler/cp8b-validation: all eight passed.
- node scripts/check-staging.mjs --template-only: passed; CP8A staging files unchanged.
- Legacy Python suite: first invocation from repository root failed import app; corrected backend working-directory invocation stalled in its mocked chat test and was interrupted. No legacy pass claimed; legacy source unchanged.
- git diff --check: passed before commit review.

Worker tests use mocked Clerk identities except dedicated real-SDK RSA verification tests. PostgreSQL/MySQL fixtures use real local engines. OpenRouter fixtures are mocked; no genuine provider acceptance was performed. Windows OpenNext compatibility and experimental Node middleware warnings remain.

## Remaining acceptance and owner configuration

Owner explicitly elected to test OpenRouter and agents independently. For that later local test, privately configure persistent AI_VAULT_KEYS and matching AI_VAULT_KEY_ID in worker/.dev.vars and keep a recovery copy; enter the OpenRouter key through AI settings. Never send keys in chat. Live Neon provisioning and BYODB acceptance require their existing approved provider configuration and explicit approval; neither was enabled here. Logout journey and authorized membership mutations remain unverified unless recorded separately below.

The pre-existing frontend/next-env.d.ts modification is preserved and excluded from the commit. frontend/frontend/ was absent at the initial inspection and was not deleted or recreated. Next dev generated frontend/AGENTS.md during testing; it is excluded from the product commit.
