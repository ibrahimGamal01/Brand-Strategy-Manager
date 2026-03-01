# Portal Rollout Runbook

## Scope
This runbook covers production guardrails for the website-first onboarding flow:
`signup -> verify-email-code -> login -> intake with pre-enrichment`.

## Pre-Deployment Checks
1. Run backend checks:
```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:portal-auth-runtime-e2e --workspace=apps/backend
npm run check:portal-rollout --workspace=apps/backend
```
2. Run portal checks:
```bash
npm run lint --workspace=apps/client-portal
npm run build --workspace=apps/client-portal
npm run test:portal-ui-auth-flow:online --workspace=apps/backend
```
3. Confirm required runtime keys are present:
- `PORTAL_EMAIL_VERIFY_CODE`
- `PORTAL_SIGNUP_SCAN_MODE`
- `PORTAL_SIGNUP_DDG_ENABLED`

## Production Smoke Verification
1. Signup with a new email and website.
2. Confirm redirect to `/verify-email-code`.
3. Verify with code `00000`.
4. Login and confirm `/app` access.
5. Confirm intake opens with pre-enrichment feed/history.

## Fast Rollback (No Code Change)
Use environment toggles first:
1. Disable DDG enrichment if it causes instability:
```bash
PORTAL_SIGNUP_DDG_ENABLED=false
```
2. Reduce crawl load to quick mode:
```bash
PORTAL_SIGNUP_SCAN_MODE=quick
```
3. Keep verification flow enabled (do not remove):
```bash
PORTAL_EMAIL_VERIFY_CODE=00000
```

## Recovery Verification After Env Rollback
Run:
```bash
npm run check:portal-rollout --workspace=apps/backend
npm run test:portal-ui-auth-flow:online --workspace=apps/backend
```
Then validate the same production smoke flow manually.

## Structured Log Events To Watch
Auth:
- `PORTAL_SIGNUP_REQUESTED`
- `PORTAL_SIGNUP_CREATED`
- `PORTAL_VERIFY_CODE_SUCCEEDED`
- `PORTAL_VERIFY_CODE_FAILED`
- `PORTAL_LOGIN_BLOCKED_UNVERIFIED`
- `PORTAL_RESEND_VERIFICATION_REQUESTED`

Enrichment:
- `PORTAL_ENRICHMENT_STARTED`
- `PORTAL_ENRICHMENT_SCAN_QUEUED`
- `PORTAL_ENRICHMENT_DDG_COMPLETED`
- `PORTAL_ENRICHMENT_WARNING`
- `PORTAL_ENRICHMENT_DONE`

Each log line is JSON with:
- `event`
- `workspaceId`
- `emailHash` (never raw email)
- `status`
- `durationMs`
- `errorCode` (when available)
- `timestamp`
