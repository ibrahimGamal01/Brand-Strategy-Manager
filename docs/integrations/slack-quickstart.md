# BAT Slack Integration v1 – Quickstart (Plug-and-Use)

This guide gets Slack connected with minimal manual setup.

## 1) Environment

Copy `.env.example` and set Slack keys:

- `BACKEND_PUBLIC_ORIGIN`
- `CLIENT_PORTAL_ORIGIN`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_STATE_SECRET`
- `SLACK_TOKEN_ENCRYPTION_KEY`

Then validate:

```bash
npm run check:slack-integration --workspace=apps/backend
npm run slack:manifest --workspace=apps/backend > /tmp/bat-slack-manifest.yaml
```

Optional automated push (requires Slack user token with `apps.manifest:write`):

```bash
SLACK_ADMIN_USER_TOKEN=xoxp-... \
npm run slack:manifest:push --workspace=apps/backend
```

## 2) Database + backend boot

Apply schema and start services:

```bash
cd apps/backend
npx prisma migrate deploy
npx prisma generate
cd ../..
npm run dev:backend
npm run dev:client-portal
```

## 3) Slack app configuration

Use callback URL:

`<BACKEND_PUBLIC_ORIGIN>/api/slack/oauth/callback`

Use bot scopes:

- `channels:read`, `channels:history`
- `groups:read`, `groups:history`
- `chat:write`
- `users:read`, `users:read.email`
- `commands`

Request URLs:

- Events: `<BACKEND_PUBLIC_ORIGIN>/api/slack/events`
- Slash commands: `<BACKEND_PUBLIC_ORIGIN>/api/slack/commands` (`/bat`)
- Interactivity: `<BACKEND_PUBLIC_ORIGIN>/api/slack/interactive`

Tip: the manifest is available in the BAT UI (`/app/integrations/slack`) and API (`GET /api/portal/slack/manifest`).

## 4) Portal setup flow (recommended)

Open:

`/app/integrations/slack`

Then:

1. Click **Connect Slack**.
2. Select team and click **Sync Slack Users** once.
3. For each channel:
   - pick workspace and click **Link Channel**
   - add owners (from synced users / Add me) and click **Save Owners**
   - click **Run Full Backfill**

## 5) Runtime usage

- Slack retrieval tools are available only when `sourceScope.slackIntel=true`.
- In chat composer, keep **Slack intelligence** enabled when Slack context is needed.

## 6) Safety defaults

- Reply mode is approval-only (no autonomous posting).
- No automatic retention deletion is enabled.
- Manual purge exists:
  - `POST /api/portal/slack/purge/channel`
  - `POST /api/portal/slack/purge/workspace`

## 7) Health + checks

- Health: `GET /api/health` (includes Slack/scheduler/queue status)
- Portal preflight: `GET /api/portal/slack/preflight`
- Runtime regression: `npm run test:chat-runtime-engine --workspace=apps/backend`

For production go-live sequence, use:

- `docs/deployment/slack-production-cutover.md`
