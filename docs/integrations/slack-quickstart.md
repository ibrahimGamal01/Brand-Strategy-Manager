# BAT Slack Integration v1 – Customer Quickstart (Global Managed App)

BAT runs one managed Slack app globally. Customers do not create Slack apps or set Slack environment variables.

## 1) Open Guided Setup

Go to:

`/app/integrations/slack/setup`

If platform setup is still in progress, BAT shows a friendly “platform not ready” status and what to do next.

## 2) Connect Slack

1. Click **Connect Slack**.
2. Approve BAT in your Slack workspace.
3. Return to BAT automatically.

## 3) Complete onboarding flow

1. **Sync users**.
2. For each channel:
   - **Link** to a BAT workspace.
   - **Assign owners**.
   - **Run full backfill**.
3. Save notification and ingestion settings.

## 4) Run Go Live checks

Open:

`/app/integrations/slack/verify`

Then validate:

1. Invite BAT to one channel in Slack.
2. Send a feedback/deadline-style message.
3. Confirm BAT notification center entry appears.
4. Confirm Slack owner delivery appears.
5. Approve a draft reply and verify thread posting.

## 5) Safety defaults

- Messages are retained until manually purged (no auto deletion).
- Draft replies are approval-only (no autonomous posting).
- Manual purge endpoints:
  - `POST /api/portal/slack/purge/channel`
  - `POST /api/portal/slack/purge/workspace`

## 6) Admin / Ops note

Platform admins can use the deployment runbook for one-time global setup:

- `docs/deployment/slack-production-cutover.md`
