# Slack Production Cutover (BAT v1)

This is the exact go-live order for deploying BAT Slack as one global managed app.

## 0) Inputs You Need

- Public backend URL (HTTPS), example: `https://api.yourdomain.com`
- Public portal URL (HTTPS), example: `https://portal.yourdomain.com`
- BAT platform Slack admin access
- Production database access (for migrations)

## 0.5) Preview-First Gate (Required)

Before production cutover, deploy and test a client-portal preview:

```bash
vercel --cwd /Users/ibrahimgamal/Downloads/ali/upwork/brand-strategy-manager/apps/client-portal --yes
```

Then run the full guided setup flow in preview:

1. Open `/app/integrations/slack/setup`
2. Connect Slack and sync users
3. Link one channel, assign owners, run backfill
4. Open `/app/integrations/slack/verify` and complete the end-to-end checklist

Proceed to production only after preview checks pass.

## 1) One-time global platform environment setup (BAT admins)

Set these on backend:

```env
BACKEND_PUBLIC_ORIGIN="https://api.yourdomain.com"
CLIENT_PORTAL_ORIGIN="https://portal.yourdomain.com"

SLACK_CLIENT_ID=""
SLACK_CLIENT_SECRET=""
SLACK_SIGNING_SECRET=""
SLACK_STATE_SECRET=""
SLACK_TOKEN_ENCRYPTION_KEY="<32-byte-random-or-64-hex>"

SLACK_APP_NAME="BAT"
SLACK_BOT_DISPLAY_NAME="BAT"

# optional if using push script:
SLACK_APP_ID=""
SLACK_ADMIN_USER_TOKEN=""

INTEGRATION_SCHEDULER_INTERVAL_MS=15000
```

Notes:
- `SLACK_TOKEN_ENCRYPTION_KEY` protects tokens at rest (AES-256-GCM).
- Keep `SLACK_STATE_SECRET` and signing secret private.
- No auto deletion is enabled in v1.
- This setup is done once for BAT globally, not per customer.

## 2) Run Backend Readiness Gate

```bash
npm run check:slack-integration --workspace=apps/backend
```

Must pass before going live.

## 3) Apply DB Migration

```bash
cd apps/backend
npx prisma migrate deploy
npx prisma generate
cd ../..
```

## 4) Create or update BAT global Slack app (admin-only)

### Option A (recommended): From BAT UI (admin account)
1. Open `https://portal.yourdomain.com/app/integrations/slack/advanced`.
2. In **Slack App Manifest**, click **Copy** or **Download YAML**.
3. Click **Open Slack App Setup**.
4. In Slack admin dashboard:
   - Click **Create New App**.
   - Choose **From an app manifest**.
   - Select target workspace.
   - Paste BAT manifest.
   - Click **Create**.

### Option B: CLI push (admin automation)

Create or update manifest directly via Slack API:

```bash
SLACK_ADMIN_USER_TOKEN=xoxp-... \
npm run slack:manifest:push --workspace=apps/backend
```

If `SLACK_APP_ID` is set, script updates existing app; otherwise it creates a new app.

## 5) Slack dashboard final checks + distribution

After app exists:

1. **Basic Information** → verify app created.
2. **OAuth & Permissions**:
   - Confirm redirect URL: `https://api.yourdomain.com/api/slack/oauth/callback`
   - Confirm scopes include:
     - `channels:read`, `channels:history`
     - `groups:read`, `groups:history`
     - `chat:write`
     - `users:read`, `users:read.email`
     - `commands`
3. **Event Subscriptions**:
   - Enable events.
   - Request URL: `https://api.yourdomain.com/api/slack/events`
   - Bot events:
     - `message.channels`
     - `message.groups`
     - `message.im`
     - `message.mpim`
4. **Interactivity & Shortcuts**:
   - Enable interactivity.
   - Request URL: `https://api.yourdomain.com/api/slack/interactive`
5. **Slash Commands**:
   - `/bat`
   - Request URL: `https://api.yourdomain.com/api/slack/commands`
6. **Install App**:
   - Click **Install to Workspace**
   - Approve permissions
7. **Manage Distribution**:
   - Start with private distribution link.
   - Share this link in BAT onboarding and support handoff.

## 6) Customer onboarding handoff (repeatable, no env setup)

In `https://portal.yourdomain.com/app/integrations/slack`:

1. Open **Guided Setup**.
2. Click **Connect Slack** (OAuth).
3. Choose team.
4. Click **Sync Slack Users** (once).
5. For each channel:
   - Choose workspace
   - **Link Channel**
   - Add owners via picker (**Add me** or synced users)
   - **Save Owners**
   - **Run Full Backfill**
6. Save integration settings:
   - notification mode
   - DM/MPIM ingestion toggles
   - default notify channel

## 7) Production Smoke Test (must pass)

1. In Slack channel:
   - Invite bot (`/invite @BAT`).
   - Run `/bat link <workspace-id>`.
2. Verify:
   - Channel shows linked in BAT UI.
   - Backfill state moves to `RUNNING` then `DONE`.
3. Send a message with deadline or explicit feedback request.
4. Verify:
   - Attention item created.
   - Notification in BAT notification center.
   - Slack owner receives action buttons.
5. Click **Approve & Send** or **Edit + Send**.
6. Verify bot posts in correct thread.

## 8) Health and Ops Checks

- `GET https://api.yourdomain.com/api/health`
  - confirm `integrations.slack.enabled=true`
  - confirm scheduler running + queue depth visible
- BAT portal endpoint:
  - `GET /api/portal/slack/preflight` shows no missing env.

## 9) If Something Fails

- OAuth failure:
  - verify redirect URL and client ID/secret.
- Event URL not verified:
  - verify Slack signing secret and that routes are mounted before JSON body parser.
- No owner notifications:
  - sync users, ensure owner mappings exist, ensure owner is workspace member.
- Need data cleanup:
  - use manual purge endpoints:
    - `POST /api/portal/slack/purge/channel`
    - `POST /api/portal/slack/purge/workspace`

---

Cutover done when:
- OAuth install succeeds
- Channel link + full backfill completes
- Attention + notification + approval reply flow works end-to-end
- Health checks are green
