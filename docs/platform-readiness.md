# Platform integration and hosting readiness

There are two applications: `frontend/` is the OpenNext Next.js Worker (`substrata-engine`, `ASSETS` binding); `worker/` is the API Worker (`substrata-api`, `METADATA` D1 binding). The legacy Python backend is separate. Its SQL execution and tenant inspection endpoints remain disabled.

## Local development

Use the original checkout with its own installed dependencies. Do not replace `node_modules` with junctions to another project; OpenNext tracing and patching can then resolve files outside the build root.

Keep secrets private in ignored files. No secret file is a deployment artifact.

`frontend/.env.local` names:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: same development Clerk application.
- `NEXT_PUBLIC_PLATFORM_API_URL`: `http://localhost:8787` for **development only**. Hosted builds require the real HTTPS API origin. Origins with credentials, paths, queries or fragments are rejected. Production rejects loopback origins.
- `NEXT_PUBLIC_CLERK_JWT_TEMPLATE`: optional explicit template name; omit to use the standard session token.
- `NEXT_PUBLIC_LEGACY_API_URL`: optional legacy chat service; unrelated to the platform API.

`worker/.dev.vars` names:

- `CLERK_SECRET_KEY`: development backend key for that same Clerk application.
- `CLERK_ISSUER`: exact issuer for that application.
- `FRONTEND_ORIGIN`: `http://localhost:3000` for local development. CORS permits that exact origin and never uses a wildcard.
- `CLERK_AUDIENCE`: optional under the existing policy. If configured, it must be satisfied; never remove it to bypass a failing integration. Omit the variable entirely when intentionally not using an audience; an empty value is invalid.

Standard Clerk session tokens may omit `aud`. An owner must configure the development Clerk instance to issue the expected audience. Customizing the standard session token retains its session claims; if a named JWT template is used instead, it must also provide a genuine session `sid`, the correct issuer and time claims. Set the optional frontend template name only for a template that satisfies this contract. The Worker still independently verifies all required claims.

From `worker/`, run `npm run migrate:local`, then `npm run dev`. Both commands use the disposable local `.wrangler/r3-local` state; no remote database is selected. From `frontend/`, run `npm run dev` on port 3000. Use `localhost` consistently in browser URLs and Clerk configuration. Metadata creation in the sidebar posts to the authenticated API; successful responses come from D1, and workspace creation remains restricted server-side to owners/admins.

## Test coverage

- `worker/test/auth-audience.test.ts`: real Clerk SDK cryptography with ephemeral local RSA keys; no Clerk service requests.
- `worker/test/d1-integration.test.ts`: real local D1 runtime, migration, user resolution, organization/workspace creation and two signed test identities. It verifies foreign tenant denial, viewer restrictions, assignments and absence of credential columns. Only test key retrieval is replaced; these are not live Clerk sessions.
- A live result requires an actual signed-in browser token to be accepted by the default API verification path and real local D1 metadata to be returned. Unit tests and a successful bundle alone do not establish that result.

## Hosting handoff — no deployment is performed here

Both active Wrangler configs disable `workers_dev`. The API config deliberately has **no cloud D1 ID** and specifies `remote: false` for local development. Do not deploy it as a cloud config: Wrangler may otherwise provision a resource when its ID is omitted.

`worker/wrangler.deploy.example.json` is an intentionally incomplete template. Its nulls represent missing owner values, not fabricated identifiers. Copy it to ignored `worker/wrangler.deploy.json` and supply real account/database identifiers and exact HTTPS frontend origin before any separately approved hosting operation. Select a domain/route or deliberately opt into a workers.dev address; none is invented here. Keep runtime secrets outside JSON. The template cannot be used unchanged.

Required owner configuration:

1. Cloudflare account ID, an existing D1 database ID/name, and desired frontend/API hostnames or routes.
2. API runtime secrets/variables: `CLERK_SECRET_KEY`, `CLERK_ISSUER`, exact `FRONTEND_ORIGIN`, and `CLERK_AUDIENCE` when required by policy.
3. Frontend build variables: development/staging-appropriate public Clerk key, HTTPS API origin, and optional JWT template name. Frontend runtime Clerk secret must match that application. Public build variables require a rebuild when changed.
4. An approved migration/backup plan for any cloud D1 database. Local migrations do not migrate cloud data.
5. Separate approval for provisioning, secret changes or deployment. None is authorized by this checkpoint.

The old Pages deployment is replaced with a `workflow_dispatch`-only packaging validation workflow. It has distinct frontend/API jobs, Node 24, read-only repository permissions, local D1 migration and Wrangler dry runs. It has no deployment credentials, push trigger, Pages command, remote migration, or deploy step. It has not been run on GitHub. Builds without owner-provided public configuration validate packaging only and must not be deployed.

OpenNext currently warns about Windows and experimental Node.js middleware support. The generated bundle needs development/staging integration testing before hosted acceptance.

## Local checkpoint result (2026-10-22)

The owner confirmed sign-in, organization/workspace creation and refresh through the browser on port 3000. The default Worker verifier on port 8787 returned successful session and metadata responses. Aggregate local D1 checks then showed one user, one organization, one workspace, one organization membership and two audit events. No token or secret values were inspected. This establishes the development Clerk-to-Worker-to-local-D1 path for one genuine identity; two-account live Clerk isolation was not exercised.

Windows validation passed: 12 frontend tests, frontend lint/typecheck, the Next.js production build, the OpenNext bundle, 50 Worker tests, Worker typecheck, the existing local migration, and both Wrangler dry-run packages. Two-identity tenant isolation and role restrictions were exercised against real disposable D1 with ephemeral locally signed tokens and the real Clerk SDK, separately from the genuine browser session.

Generated output remains local in `frontend/.next`, `frontend/.open-next`, `frontend/.wrangler/readiness`, `worker/dist`, and `worker/.wrangler/r3-local`. The current local frontend build uses development configuration and is not a hosted release artifact. Hosted runtime behavior, owner cloud identifiers, HTTPS origins and cloud migration remain unverified or pending; no cloud resource was provisioned and nothing was deployed.
