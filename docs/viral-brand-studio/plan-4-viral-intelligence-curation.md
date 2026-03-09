# Plan 4: Viral Intelligence and Reference Curation

## Scope
- Added explainable ranking payload on every reference asset.
- Kept composite scoring formula aligned to v1 contract weights:
  - engagement-rate 35%
  - recency 20%
  - hook-strength 20%
  - retention-proxy 15%
  - caption clarity 10%
- Exposed shortlist steering actions (`pin`, `exclude`, `must-use`, `clear`) in the curation board.

## Explainability Payload
- `normalizedMetrics` now includes per-factor percentages.
- `explainability` now includes:
  - `formulaVersion`
  - weighted contribution breakdown by factor
  - top driver list
  - user-readable "why ranked high" bullets

## UI Delivery
- Reference board now supports:
  - grid/list switch
  - filter chips (all, prioritized, must-use, pinned, excluded)
  - platform chips (all/instagram/tiktok/youtube)
  - rank badges and shortlist state visibility
- Added expandable analysis drawer for the selected reference:
  - weighted contribution bars
  - explainability bullets
  - transcript context

## Outcome
- References are no longer black-box scored.
- Users can justify why any reference ranked high directly from visible rationale and factor contributions.
