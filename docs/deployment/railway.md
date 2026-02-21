# Railway Deployment (Backend + Frontend)

This repo is a monorepo with two services:
- Backend API in `apps/backend`
- Frontend Next.js app in `apps/frontend`

The safest Railway setup is two services (one per app) plus a managed Postgres instance.

## 1. Create Services

### Backend service
1. Create a new Railway project.
2. Add a service from this repo.
3. Set the Dockerfile path to `apps/backend/Dockerfile`.
4. Set health check to `/api/health`.
5. Add a persistent volume (recommended) mounted to `/app/apps/backend/storage`.

### Frontend service
1. Add another service from the same repo.
2. Set the Dockerfile path to `apps/frontend/Dockerfile`.

## 2. Environment Variables

### Backend (required)
- `NODE_ENV=production`
- `PORT` (Railway sets this automatically)
- `DATABASE_URL` (from Railway Postgres)
- `OPENAI_API_KEY`
- `AI_FALLBACK_MODE=off`
- `APIFY_API_TOKEN`
- `APIFY_MEDIA_DOWNLOADER_TOKEN`

### Backend (optional)
- `BACKEND_PORT` (not needed if `PORT` is set)
- `RESEARCH_CONTINUITY_POLL_MS` (default is 60000)

### Frontend (required)
- `NODE_ENV=production`
- `NEXT_PUBLIC_API_ORIGIN` (set to the backend public URL, e.g. `https://<backend>.up.railway.app`)

## 3. Database Migration

Run migrations once after the database is created:

```bash
npm run db:deploy --workspace=apps/backend
```

If you prefer, use `npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma` in a Railway shell.

## 4. Verify Deployment

Backend:
- `GET /api/health` should return `status: ok` and `schemaReady: true`.

Frontend:
- `/` should load the workspace UI.
- API calls should resolve via `NEXT_PUBLIC_API_ORIGIN`.

## Notes
- The backend uses Puppeteer and Python-based scrapers; the backend Dockerfile installs runtime dependencies for these.
- If you change the backend storage path, update the Railway volume mount accordingly.
- The backend image keeps dev dependencies so `prisma` CLI is available for `db:deploy`. You can prune later and move migrations to CI if desired.
