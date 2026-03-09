# Plan 5: Prompt Studio + Multi-Pack Generation

## Scope delivered
- Added a structured prompt composer that binds template intent, format target, Brand DNA guardrails, and curated references into a single prompt context.
- Upgraded generation payloads to include `promptContext` and `formatTarget` so output provenance is explainable and reusable by chat/document workflows.
- Added section-level actions:
  - `refine` for iterative tightening using instruction guidance.
  - `regenerate` for replacing one section only without resetting the full pack.
- Extended Prompt Studio UI into a two-pane workspace:
  - Left pane for template, format target, prompt direction, and quality signals.
  - Right pane for per-section cards (hooks, scripts, captions, CTAs, angle remixes) with local instructions and micro-actions.

## Logic implementation notes
- Generation composer now produces:
  - hooks, scripts (short/medium/long), captions, CTAs, angle remixes.
  - quality gate report (banned terms, tone mismatch, duplicates, length warnings).
- Refine endpoint now supports `mode`:
  - `refine` keeps current section and injects guided edits.
  - `regenerate` rebuilds only the targeted section using the same prompt context.

## Integration notes
- Chat bridge payload now forwards format target and objective from prompt context for better downstream reasoning in core chat.
- Document workspace remains downstream-compatible because section schemas were preserved.

## Tests
- Added `apps/backend/src/scripts/test-viral-studio-plan5.ts`.
- Coverage includes:
  - generation creation with prompt context + format target,
  - section refine revisioning,
  - section-only regeneration behavior,
  - quality report presence.
