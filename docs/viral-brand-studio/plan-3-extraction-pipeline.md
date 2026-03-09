# Plan 3: Competitor Extraction Pipeline

## Scope
- Implemented async ingestion lifecycle for Instagram, TikTok, and YouTube runs.
- Added run states `queued`, `running`, `partial`, `completed`, and `failed`.
- Added extraction retry flow for `partial` and `failed` runs.
- Added extraction presets with defaults:
  - `balanced`: `maxVideos=50`, `lookbackDays=180`, `sortBy=engagement`
  - `quick-scan`: `maxVideos=24`, `lookbackDays=90`
  - `deep-scan`: `maxVideos=80`, `lookbackDays=270`

## API
- Existing:
  - `POST /api/portal/workspaces/:workspaceId/viral-studio/ingestions`
  - `GET /api/portal/workspaces/:workspaceId/viral-studio/ingestions/:ingestionId`
  - `GET /api/portal/workspaces/:workspaceId/viral-studio/ingestions`
- Added:
  - `POST /api/portal/workspaces/:workspaceId/viral-studio/ingestions/:ingestionId/retry`

## UI Delivery
- Added "Extract Best Videos" modal with:
  - platform selector
  - source URL
  - preset selector
  - volume control
  - lookback control
- Added active-run progress timeline (found, downloaded, analyzed, ranked).
- Added extraction history list with:
  - run status
  - attempt number
  - quick actions (`View Results`, `Retry`)
- Added auto-refresh behavior messaging to reduce manual-refresh confusion.

## Notes
- v1 run execution is simulated but deterministic and produces realistic progression and outcomes.
- `partial` runs produce ranked references for immediate curation.
- `failed` runs surface errors and can be retried into new attempts.
