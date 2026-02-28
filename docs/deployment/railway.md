# Railway Deployment (Backend + Client Portal)

This repo is a monorepo with:
- Backend API in `apps/backend`
- Client portal Next.js app in `apps/client-portal`
- Legacy frontend in `apps/frontend` (optional / compatibility only)

Recommended production split:
1. Backend on Railway.
2. Client portal on Vercel (or Railway if preferred).
3. Railway Postgres for backend state.

## 1. Create Services

### Backend service
1. Create a new Railway project.
2. Add a service from this repo.
3. Set the Dockerfile path to `apps/backend/Dockerfile`.
4. Set health check to `/api/health`.
5. Add a persistent volume (recommended) mounted to `/app/apps/backend/storage` (or set `STORAGE_ROOT` and mount there).

### Client portal service (if hosting on Railway)
1. Add another service from the same repo.
2. Use a Next.js build setup targeting `apps/client-portal`.
3. Set `NEXT_PUBLIC_API_ORIGIN` to backend public URL.

## 2. Environment Variables

### Backend (required)
- `NODE_ENV=production`
- `PORT` (Railway sets this automatically)
- `DATABASE_URL` (from Railway Postgres)
- `OPENAI_API_KEY`
- `AI_FALLBACK_MODE=off`
- `APIFY_API_TOKEN`
- `APIFY_MEDIA_DOWNLOADER_TOKEN`
- `PORTAL_INTAKE_EVENT_STORE_MODE=dual` (for R1 rollout window; switch to `db` after cutover)
- `RUNTIME_WS_SIGNING_SECRET` (required for runtime WS token handshake)
- `RUNTIME_EVIDENCE_LEDGER_ENABLED=true`
- `RUNTIME_CONTINUATION_CALLS_V2=true`
- `RUNTIME_LEDGER_BUILDER_ROLLOUT=25` (ramp to 100 after validation)

### Backend (optional)
- `BACKEND_PORT` (not needed if `PORT` is set)
- `RESEARCH_CONTINUITY_POLL_MS` (default is 60000)
- `STORAGE_ROOT` (if using a custom mount path for persistent storage)
- `PORTAL_INTAKE_DB_FALLBACK_WARNING_MS` (default: `60000`)
- `CHAT_TOOL_TIMEOUT_MS` (default: `45000`)
- `CHAT_TOTAL_TOOL_TIMEOUT_MS` (default: `180000`)
- `CHAT_MAX_TOOL_LOOP_ITERATIONS` (default: `6`)
- `CHAT_TOOL_MAX_RETRIES` (default: `2`)

### Client portal (required)
- `NODE_ENV=production`
- `NEXT_PUBLIC_API_ORIGIN` (set to the backend public URL, e.g. `https://<backend>.up.railway.app`)

## 3. Database Migration

For Railway pre-deploy command, use this direct script command:

```bash
bash /app/apps/backend/scripts/railway-predeploy.sh
```

Why this command:
- It runs normal `prisma migrate deploy`.
- If Railway DB is fresh and hits the known legacy baseline migration failure (`20260211113000_competitor_orchestrator_v2`), it performs a one-time safe bootstrap (`migrate resolve` + `db push` + mark existing migrations as applied) and then re-checks migration state.
- For all other migration failures, it exits with error (no silent masking).

Alternative:
- `npm run db:deploy:railway --workspace=apps/backend`

If logs do not show `Running Prisma migrate deploy (schema: ...)`, Railway is not executing the wrapper script yet.

## 4. Verify Deployment

Backend:
- `GET /api/health` should return `status: ok` and `schemaReady: true`.

Client portal:
- `/` should load the workspace UI.
- API calls should resolve via `NEXT_PUBLIC_API_ORIGIN`.

R1 rollout and cutover verification:
- Follow `docs/deployment/r1-online-cutover.md`.

## Notes
- The backend uses Puppeteer and Python-based scrapers; the backend Dockerfile installs runtime dependencies for these.
- If you change the backend storage path, update the Railway volume mount accordingly.
- The backend image keeps dev dependencies so `prisma` CLI is available for `db:deploy`. You can prune later and move migrations to CI if desired.
