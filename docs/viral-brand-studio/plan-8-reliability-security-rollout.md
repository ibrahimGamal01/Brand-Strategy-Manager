# Plan 8: Reliability, Security, and Rollout

## Scope Completed

- Added per-workspace throttling on:
  - `POST /viral-studio/ingestions` (12 / 10 minutes)
  - `POST /viral-studio/generations` (20 / 10 minutes)
  - `POST /viral-studio/generations/:generationId/refine` (40 / 10 minutes)
- Added ingestion retry backoff strategy in route handling:
  - retries on attempt 1 are immediate
  - retries after attempt 2+ are delayed with progressive backoff windows
  - backoff failures return `429 INGESTION_RETRY_BACKOFF_ACTIVE`
- Enforced URL allowlist validation by platform:
  - Instagram: `instagram.com`
  - TikTok: `tiktok.com`
  - YouTube: `youtube.com`, `youtu.be`
- Hardened request sanitization for text payloads:
  - strips unsafe control characters
  - length clamps for IDs, arrays, section content, and free-text fields
- Added runtime telemetry endpoint:
  - `GET /viral-studio/telemetry`
  - includes funnel counts, error classes, stage latency averages, and recent runtime events
- Wired telemetry into the client portal “System Contract” panel:
  - runtime funnel
  - latency cards
  - error class list
  - recent runtime events

## Validation

- Added backend regression script:
  - `apps/backend/src/scripts/test-viral-studio-plan8.ts`
- Script verifies:
  - allowlist URL rejection
  - per-workspace rate limits
  - retry backoff enforcement
  - telemetry endpoint shape and counters

## Operational Notes

- Failures now degrade gracefully with explicit error classes and retry guidance.
- Telemetry provides stage-level observability for diagnosis without log diving.
- The rollout can be gated at workspace level using existing portal auth + workspace routing controls.
