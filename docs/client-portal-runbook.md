# Client Portal Runbook (Client-Facing Platform)

## Ports
- `apps/backend`: `http://localhost:3001`
- `apps/client-portal`: `http://localhost:3000`

`client-portal` proxies `/api/*` and `/storage/*` to backend using `NEXT_PUBLIC_API_ORIGIN` (defaults to `http://localhost:3001`).

## Required Setup
1. Install dependencies at repo root:
   - `npm install`
2. Ensure backend env exists:
   - `apps/backend/.env`
3. Apply database migrations:
   - `npm run db:deploy --workspace=apps/backend`
   - `npm run db:generate --workspace=apps/backend`

## Email Configuration
Portal auth supports two modes:

1. Real emails (Resend):
   - `RESEND_API_KEY=...`
   - `PORTAL_EMAIL_FROM=...`
   - `PORTAL_BASE_URL=http://localhost:3000`

2. Console fallback (no provider configured):
   - emails are logged on backend
   - verification endpoints return `debugVerificationToken` in non-production

## Run Locally
1. Start backend:
   - `npm run dev:backend`
2. Start client portal:
   - `npm run dev:client-portal`
3. Open:
   - `http://localhost:3000/signup`
   - `http://localhost:3000/login`

## Verification / Test Commands
Backend + runtime checks:
- `npm run test:chat-runtime-engine --workspace=apps/backend`

API workflow e2e (signup/login/verify/logout + workspace intro intake + runtime):
- against backend directly:
  - `npm run test:portal-auth-runtime-e2e --workspace=apps/backend`
- through client portal proxy path:
  - `PORTAL_E2E_BASE_URL=http://localhost:3000 npm run test:portal-auth-runtime-e2e --workspace=apps/backend`

Browser UI flow e2e (real form submission):
- `npm run test:client-portal-ui-auth-flow --workspace=apps/backend`

Runtime workflow e2e (queue/reorder/interrupt/fork/pin):
- `npm run test:portal-runtime-workflow-e2e --workspace=apps/backend`
- `PORTAL_E2E_BASE_URL=http://localhost:3000 npm run test:portal-runtime-workflow-e2e --workspace=apps/backend`

Build checks:
- `npm run build --workspace=apps/backend`
- `npm run lint --workspace=apps/backend`
- `npm run lint --workspace=apps/client-portal`
- `npm run build --workspace=apps/client-portal`

R1 reliability checks:
- `npm run test:runtime-reliability-r1 --workspace=apps/backend`

Online smoke + cutover checks (against deployed backend):
- `R1_BASE_URL=https://<backend-host> R1_ADMIN_EMAIL=<admin-email> R1_ADMIN_PASSWORD=<admin-password> R1_WORKSPACE_ID=<workspace-id> npm run test:r1-online-smoke --workspace=apps/backend`
- `R1_BASE_URL=https://<backend-host> R1_ADMIN_EMAIL=<admin-email> R1_ADMIN_PASSWORD=<admin-password> R1_WORKSPACE_ID=<workspace-id> npm run report:r1-cutover --workspace=apps/backend`

## Payment Status
Billing/payment pages remain intentionally deferred for future work.

## Runtime Safety Notes
- If a `send` message arrives while a run is already active, backend now auto-queues it (safe default) instead of starting a conflicting run.
- Approval cards in the UI are now scoped to currently `WAITING_USER` runs only, preventing stale historical decisions from lingering.
- New workspace-scoped intake endpoints:
  - `GET /api/portal/workspaces/:workspaceId/intake`
  - `POST /api/portal/workspaces/:workspaceId/intake/suggest`
  - `POST /api/portal/workspaces/:workspaceId/intake`
  - `GET /api/portal/workspaces/:workspaceId/intake/websites/scan-runs/:scanRunId`
- New admin diagnostics endpoint:
  - `GET /api/portal/admin/intake/scan-runs?workspaceId=<id>&limit=<n>`
- Client portal chat route now gates on intro intake completion before loading smart chat runtime.
