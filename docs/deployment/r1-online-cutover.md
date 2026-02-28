# R1 Online Cutover Runbook

This runbook operationalizes the R1 reliability rollout for chat/runtime hardening.

## Scope
- Runtime WS cursor hardening (`afterSeq` support + fallback).
- Client-safe response sanitization for assistant output.
- Intake dual-write observability + admin diagnostics.
- Context-loaded run grounding fallback.

## Release Baseline
- Target commit: `e704b6f`
- Branch: `main`
- Migration present: `apps/backend/prisma/migrations/20260227233000_reliability_core_r1`

## 1) Pre-Deploy
1. Confirm latest commit is available:
   - `git log --oneline -n 1`
2. Validate local build gates:
   - `npm run build --workspace=apps/backend`
   - `npm run build --workspace=apps/client-portal`
3. Validate R1 regression suite:
   - `npm run test:runtime-reliability-r1 --workspace=apps/backend`

## 2) Deploy (Dual-Write Mode)
1. Set backend env:
   - `PORTAL_INTAKE_EVENT_STORE_MODE=dual`
   - Optional: `PORTAL_INTAKE_DB_FALLBACK_WARNING_MS=60000`
2. Keep runtime defaults unless explicitly tuning:
   - `CHAT_TOOL_TIMEOUT_MS=45000`
   - `CHAT_TOTAL_TOOL_TIMEOUT_MS=180000`
   - `CHAT_MAX_TOOL_LOOP_ITERATIONS=6`
   - `CHAT_TOOL_MAX_RETRIES=2`
3. Run migrations before traffic:
   - `npm run db:deploy --workspace=apps/backend`
4. Deploy backend and client portal from the same commit line.

## 3) Production Smoke Validation (Must Pass)
Run:

```bash
R1_BASE_URL=https://<backend-host> \
R1_ADMIN_EMAIL=<admin-email> \
R1_ADMIN_PASSWORD=<admin-password> \
R1_WORKSPACE_ID=<workspace-id> \
npm run test:r1-online-smoke --workspace=apps/backend
```

What this validates:
- Intake scan start returns `scanRunId` + `status=accepted`.
- SSE scan event stream can filter by `scanRunId`.
- Scan run details endpoint returns terminal status and counters.
- Runtime events endpoint accepts `afterSeq` cursor semantics.
- Assistant output hygiene blocks internal meta trace phrases.
- Admin diagnostics endpoint responds with counters + scan runs.

## 4) 48-Hour Dual-Write Monitoring
Run periodically (for example every 2-4 hours):

```bash
R1_BASE_URL=https://<backend-host> \
R1_ADMIN_EMAIL=<admin-email> \
R1_ADMIN_PASSWORD=<admin-password> \
R1_WORKSPACE_ID=<workspace-id> \
npm run report:r1-cutover --workspace=apps/backend
```

Default cutover thresholds:
- `dbWriteFailure <= 0`
- `dbReadFailure <= 0`
- `dbReadFallbackToMemory <= 0`
- `fallbackWarningsEmitted <= 0`

Override thresholds when needed:
- `R1_MAX_DB_WRITE_FAILURE`
- `R1_MAX_DB_READ_FAILURE`
- `R1_MAX_DB_FALLBACK_TO_MEMORY`
- `R1_MAX_FALLBACK_WARNINGS`

## 5) Cutover to DB-Only
1. Set env:
   - `PORTAL_INTAKE_EVENT_STORE_MODE=db`
2. Redeploy backend.
3. Re-run production smoke:
   - `npm run test:r1-online-smoke --workspace=apps/backend`
4. Continue monitoring for one release cycle.

## 6) Post-Cutover Cleanup Release
1. Remove in-memory fallback path from:
   - `apps/backend/src/services/portal/portal-intake-events.ts`
2. Keep diagnostics endpoint and counters.
3. Keep online smoke + cutover report scripts.

## 7) Troubleshooting
- If diagnostics show non-zero DB fallback counters in `dual` mode:
  1. Check DB connectivity and migration state.
  2. Confirm backend has `DATABASE_URL` and can write `portal_intake_scan_events`.
  3. Keep mode at `dual` until counters stabilize.
- If assistant responses leak internal boilerplate:
  1. Validate backend version includes `e704b6f`.
  2. Verify runtime writer path is using final sanitizer before persistence.
