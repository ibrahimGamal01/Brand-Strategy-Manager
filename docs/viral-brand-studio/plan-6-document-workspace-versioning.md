# Plan 6: Document Workspace, Versioning, and Export

## Scope delivered
- Added editable Studio Document workflows with:
  - inline title and section content editing,
  - section reorder controls,
  - explicit draft save and autosave every 10 seconds.
- Added version timeline operations:
  - publish version snapshots,
  - compare two versions (or current draft vs version),
  - promote a historical version as active content via immutable promoted snapshot.
- Kept export support in v1 for Markdown and JSON.

## Backend additions
- New document endpoints:
  - `PATCH /viral-studio/documents/:documentId` for draft updates + optional autosave marker.
  - `GET /viral-studio/documents/:documentId/compare?leftVersionId=&rightVersionId=`
  - `POST /viral-studio/documents/:documentId/versions/:versionId/promote`
- New service capabilities:
  - document section normalization/reordering,
  - version comparison summary with per-section previews,
  - promotion workflow that keeps snapshot immutability and traces `basedOnVersionId`.

## UI additions
- Document panel now includes:
  - editable document title,
  - per-section inline editor,
  - move up/down section actions,
  - autosave status indicator,
  - version compare controls and change summary,
  - promote version controls and timeline.

## Tests
- Added `apps/backend/src/scripts/test-viral-studio-plan6.ts`.
- Coverage includes update, reorder, publish version, compare, and promote/rollback behavior.
