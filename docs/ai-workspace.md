# CP3/CP4 database and AI workspace

## Product routes

- `/dashboard`: authorized database states, own recent conversations, query/provisioning audit metadata and quick navigation.
- `/databases`, `/explorer`, `/sql`, `/sql-editor`: existing real gateway-backed metadata/reads; SQL editor also accepts editable AI drafts. Generation and execution have distinct controls/status.
- `/chat` (also `/ai-chat`): conversation history/new conversation, model choice, real provider SSE output, cancellation, tool traces, SQL review handoff and reported token usage.
- `/agents` (also `/agent-runs`): recorded assistant turns and tool activity. No background autonomous scheduler is claimed.
- `/settings/ai`: validate/save/replace/revoke OpenRouter keys, model discovery and persisted default model.
- `/settings/access` (also `/settings/access-control`): actual effective workspace role. Invitations/role editing are explicitly unavailable.
- `/settings/account`: actual Clerk UserProfile account/session management.

Organization/workspace/database selections retain the existing per-Clerk-user sessionStorage behavior and authorized API revalidation. SQL drafts use shared layout memory only; refresh does not persist query text. No provider credential is persisted in the browser. The unused direct-browser OpenRouter helper was removed; the old EAV demo source remains isolated from active product routes.

## Local use

The additive `0003_ai_workspace.sql` migration adds user-owned credential references, private conversations and message/usage/trace records. It has been applied locally to existing `.wrangler/r3-local` without deleting its metadata, and validated in separate disposable D1.

The existing local **TENANT_CREDENTIALS** R2 binding supports encrypted AI credentials without Neon/cloud setup. To enable BYOK privately, the owner supplies **AI_VAULT_KEYS** (JSON key-ID to 64 lowercase hexadecimal characters representing 32 secure random bytes) and **AI_VAULT_KEY_ID** (the active ID) through ignored `worker/.dev.vars`. These are separate from NEON provisioning credentials and the NEON wrapping keyring. Never put key material in vars, D1, source or frontend environment variables. Retain matching keys and encrypted local R2 objects together. No cloud resource or secret was configured by this sprint.

Start the existing API `npm run dev` in `worker/` and frontend `npm run dev` in `frontend/`. Existing Clerk development configuration, matching audience/template policy and `NEXT_PUBLIC_PLATFORM_API_URL` remain required. Sign in, select a workspace, open AI settings, submit a user-owned OpenRouter key, choose a default model, then open chat. Saving validates using the provider's authenticated GET `/key`; it incurs no completion call. Explicit live-provider approval is required before this agent submits any real credential or paid completion. The owner may exercise the UI using their own account; do not send keys in chat.

Missing/invalid secure storage fails closed; settings show an administrator setup state rather than a successful save. AI chat can operate without a database selected. With an active selected database, bounded actual schema metadata is sent to the chosen provider. Row previews are separately opt-in per conversation and default off. Only metadata is sent automatically, never arbitrary SQL execution. A conversation's model, database and row permission are immutable; start another conversation to change them.

## Backend contracts and boundaries

- `/api/v1/ai/providers/openrouter` GET returns configuration/default model metadata only. POST actions: `validate`, `save`, `preferences`, `revoke`.
- `/api/v1/ai/models` GET lists provider model metadata using the current user's key.
- `/api/v1/workspaces/:workspace/ai/conversations` GET/POST lists or creates own conversations.
- `/conversations/:id` GET loads private authorized history; `/conversations/:id/messages` POST runs a bounded turn (`content`, optional `stream: true`). JSON and SSE share orchestration/persistence/security policy.
- `/api/v1/workspaces/:workspace/ai/activity` GET returns the current user's recent workspace audit metadata, not SQL text.

Clerk signature/issuer/expiration/audience verification happens before AI routing. Identity comes exclusively from the verified principal. Conversations require active workspace membership and matching owner/workspace on every load; even an organization owner cannot load another user's private conversation. Database IDs supplied during creation must belong to the authorized workspace and be active. Credential APIs are user-scoped and accept no client-provided identity or reference.

Modular services: OpenRouter HTTP adapter, model registry, conversation manager, context builder/tool registry with permission policy, shared credential cipher and user vault. The fixed provider origin and paths do not accept user URLs. API/provider errors are normalized; no raw response bodies, auth headers or credentials are logged/returned. Key echoes are redacted, including across SSE frame boundaries. Cancellation/25-second provider deadlines, bounded HTTP bodies, capped tool arguments and AST validation apply to generated SQL too.

Tools: `list_databases`, `list_schemas`, `list_tables`, `describe_table`, `preview_table`, `propose_sql`. Every database tool calls the existing server-side authorized gateway for the pinned workspace/database. Tools cannot choose tenants/users or invoke writes/admin SQL. The context builder reads at most three table descriptions. A turn permits at most six tool executions including context construction, at most three model calls and 1,600 output tokens per call. Unsupported/extra arguments, tool names and row previews without consent are denied. Schema/user/row strings are untrusted data, never authorization. Model input has a conservative character budget based on advertised context length; provider token limits may still reject a request.

`propose_sql` and fenced SQL extraction run the existing strict SELECT AST policy and produce a draft only. No model tool can call the query action. Sending a draft to the editor never executes it; the user must click the read-only execution button, which uses the same gateway as manual SQL. Table/schema context and SQL text are not written to audit records. Conversation content and optional provider usage are stored in D1 behind user/workspace checks; do not submit secrets in messages. Usage is provider-reported and may be absent or incomplete on failed/cancelled calls.

## Credential lifecycle

The shared AES-256-GCM primitive preserves the existing Neon envelope format and binds AI envelopes to user, provider, purpose, reference and key ID. AI credentials use an independent path namespace and fresh reference per replacement. D1 never stores plaintext provider keys. Conditional R2 create prevents overwriting a reference; decryption and maintenance authenticate ownership metadata. Saving a replacement validates before switching D1's active reference. If D1 fails after R2 persistence, an encrypted orphan may remain for reconciliation, never an unencrypted fallback.

Revocation marks D1 revoked first, so new resolutions fail even if R2 is unavailable, then tombstones the encrypted object. In-flight provider requests may already have consumed the key; revoking SubStrata access does not revoke the upstream OpenRouter key or refund tokens. Use the provider's own controls if a key may have been exposed. Old encrypted replacement objects are retained and cannot be reached through credential APIs. No automatic destructive cleanup runs; inspect active references and obtain approval before deleting orphans.

For wrapping-key rotation retain old key IDs, add a new key to AI_VAULT_KEYS, select it as active, and use the server-only `EncryptedAIKeys.rewrap(userId,reference)` with conditional writes. Inventory and verify all active references before removing old keys. No public key-export, maintenance, arbitrary SQL or deletion API is added. Rotation operations still need authorized operational tooling; the application does not silently rotate keys or create resources.

## Reliability and remaining limits

One D1 claim per conversation prevents duplicate concurrent provider turns. Claims are released on normal success/error/cancellation; request disconnects are propagated to the provider and Worker ExecutionContext retains turn cleanup where available. A hard process/runtime crash can leave a claim requiring an operator-reviewed recovery; no unsafe automatic claim stealing is implemented. Messages are bounded to 6,000 characters, histories to 100 returned messages and 50 recent conversations. Start a new conversation at the turn/history budget. Streamed draft text is explicitly temporary until final persisted completion; failures cannot become fabricated completed responses.

No real OpenRouter request, new genuine Clerk browser acceptance, live Neon provisioning, cloud R2 configuration or deployment was performed. Automated provider responses and identity/SQL fixtures are labelled mocks. Real local R2/D1 and existing real TLS PostgreSQL/Clerk cryptographic regressions are separate evidence. Background agents, membership editing, provider billing dashboards and Gemini expansion remain outside this implementation. OpenNext retains its Windows and experimental middleware warnings.

Official contracts: [OpenRouter key validation](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key), [models](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [chat API and streaming](https://openrouter.ai/docs/api_reference/overview), [tool calling](https://openrouter.ai/docs/guides/features/tool-calling).

## Completed validation (2026-10-23)

- Worker `npm run typecheck`: passed. `SUBSTRATA_LOCAL_POSTGRES=1` with `npm test -- --no-file-parallelism`: **173 tests passed, 13 files**, no skipped tests. Includes the real Clerk SDK cryptographic/audience regressions, real disposable TLS PostgreSQL isolation/gateway tests, real local R2/D1, mocked OpenRouter HTTP/SSE and actual frontend AI/SQL client contracts. The split-frame key redaction test verifies emitted provider deltas never expose the key.
- Worker `npm run build -- --env-file types.env.example`: dry run passed (797.65 KiB / 131.10 KiB gzip).
- All three D1 migrations passed in `.wrangler/cp34-validation`; additive `0003_ai_workspace.sql` passed against existing `.wrangler/r3-local` without deleting metadata.
- Frontend `npm test`: **14 passed**; `npm run lint`: passed without warnings/errors; `npm run typecheck -- --incremental false`: passed.
- Frontend `npm run build` and `npm run build:worker`: passed; OpenNext emitted `.open-next/worker.js`. Frontend `npx --no-install wrangler deploy --dry-run --outdir .wrangler/cp34-readiness`: passed (8943.81 KiB / 1840.93 KiB gzip). These are packaging checks, not deployment/live acceptance.
- Source whitespace and staged credential/generated-file checks passed before commits. Original `frontend/next-env.d.ts` bytes were restored after builds; untracked `frontend/frontend/` was preserved. No dependency installation, remote Git operation, cloud creation or deployment occurred.

No live OpenRouter call or new authenticated browser acceptance is claimed. Live use requires the owner to privately configure the AI wrapping keys and submit their own provider key; this agent has not read private env files or supplied any fallback key. Test-only fixtures are never served as application responses.
