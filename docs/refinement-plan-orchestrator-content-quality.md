# Production Refinement Spec: Intake -> Competitors -> Media Quality -> Docs/Calendar

## 1) Production-Ready Definition
This pipeline is production-ready only when all are true:
- No automatic scrape starts without at least one confirmed client channel.
- Competitor intake links (social + website) are parsed with deterministic normalization and no silent drops.
- AI analysis runs only on assets that pass explicit readiness thresholds.
- Strategy sections cannot be marked final if grounding-critical validation fails.
- Calendar slots reference only validated post IDs from approved sources.
- Every stage emits machine-readable diagnostics and reason codes.

## 2) Hard Quality Targets (SLOs)
These are release gates, not soft goals.
- Intake channel confirmation success: >= 98% of new jobs have at least one confirmed channel before first scrape.
- Competitor normalization coverage: >= 95% of valid intake links become typed competitor seeds.
- Unsupported-input leakage: <= 1% of unsupported competitor inputs reach scrape queue.
- Media readiness pass rate: >= 85% of analyzed assets pass readiness (post-launch shadow mode).
- Strategy grounding pass rate: >= 90% first-pass, >= 98% after one repair cycle.
- Calendar evidence integrity: 100% slots reference valid post IDs from the same job.

## 2.1) Current-User Reference Baseline (Mandatory Before Any Packet)
Enhancements must start from real current-user flows, not synthetic assumptions.

### Baseline Artifacts
- JSON baseline export:
  - `docs/baselines/current-user-baseline.json`
- Human-readable baseline summary:
  - `docs/baselines/current-user-baseline.md`

### Baseline Export Command
- `npm run baseline:current-users --workspace=apps/backend`
- optional raw output (no anonymization): append `-- --raw`

### Baseline Cohorts to Use as Reference
- Top reference jobs (highest completeness score).
- Median reference jobs (closest to median completeness score).
- Bottom reference jobs (lowest completeness score).

### Flow Fields Captured Per Job
- Intake: input handles count, confirmed channels, account platforms.
- Discovery: discovered/candidate competitor distributions by state/status.
- Scrape/Data: social profile/post volume, snapshot volume, media download ratio.
- AI/Strategy: analysis counts by type, document topic coverage.
- Calendar: run count, completion count, total slot volume.
- Events: total orchestration event volume per job.

### Rule
For each implementation packet:
1. Capture baseline from current users.
2. Implement packet.
3. Re-capture baseline.
4. Compare cohort metrics and blocker distributions.
5. Reject packet if target SLO trend degrades.

## 2.2) Current Baseline Snapshot (from Existing Users in This Environment)
Source:
- `docs/baselines/current-user-baseline.json`
- `docs/baselines/current-user-baseline.md`

Observed now:
- Active sample: 2 clients, 2 research jobs.
- Job statuses: `COMPLETE` (1), `DISCOVERING_COMPETITORS` (1).
- Current baseline score improved to `95/100` average (median `95`).
- Both active jobs now have full strategy document coverage (`9/9` final topics).
- Competitor funnels are populated with large shortlist pools (`scrapeReady` counts: `30` and `45`).
- Calendar generation is now present on the active ELUUMIS flow (`43` total slots across runs); Ummah still has `0` calendar runs.
- Remaining quality gap is no longer docs coverage; it is competitor readiness concentration (many candidates/snapshots, low READY conversion on older flows).

Implications for enhancement priority:
1. Keep competitor readiness/scoring and queue precision as top priority (highest residual production risk).
2. Keep strategy grounding hard-blocks in place to preserve zero-hallucination final docs.
3. Keep calendar evidence gating tied to readiness-qualified cohorts and validated post IDs.

## 3) Pipeline Contract (State Machine)
Use explicit status transitions and block promotion on failed gates.

### 3.1 States
1. `INTAKE_NORMALIZED`
2. `CLIENT_CHANNELS_CONFIRMED`
3. `COMPETITORS_NORMALIZED`
4. `COMPETITORS_SCRAPE_READY`
5. `SNAPSHOTS_CAPTURED`
6. `MEDIA_ANALYSIS_READY`
7. `AI_ANALYZED`
8. `DOCS_GROUNDED`
9. `CALENDAR_GROUNDED`

### 3.2 Transition Rules
- `INTAKE_NORMALIZED -> CLIENT_CHANNELS_CONFIRMED`
  - pass: at least one of `handles.instagram`, `handles.tiktok`, `handles.youtube`, `handles.twitter` is confirmed.
  - fail: block orchestration start with reason `NO_CONFIRMED_CLIENT_CHANNEL`.
- `COMPETITORS_NORMALIZED -> COMPETITORS_SCRAPE_READY`
  - pass: competitor has supported social platform and not blocked by policy.
  - website-only rows remain analyzable intelligence rows, not scrape-queued.
- `SNAPSHOTS_CAPTURED -> MEDIA_ANALYSIS_READY`
  - pass: readiness score >= threshold (see Section 6).
- `AI_ANALYZED -> DOCS_GROUNDED`
  - pass: no critical grounding issues.
- `DOCS_GROUNDED -> CALENDAR_GROUNDED`
  - pass: all slot references valid and source-qualified.

## 4) Intake and Channel Confirmation (Deep Spec)

### 4.1 Required Backend Payload Changes
Extend response from `POST /api/clients/suggest-intake-completion`:
```json
{
  "success": true,
  "suggested": {},
  "suggestedHandles": {"instagram": "...", "tiktok": "..."},
  "suggestedHandleValidation": {
    "instagram": {"handle": "...", "isLikelyClient": true, "confidence": 0.86, "reason": "..."},
    "tiktok": {"handle": "...", "isLikelyClient": false, "confidence": 0.41, "reason": "..."}
  },
  "confirmationRequired": true,
  "confirmationReasons": ["MISSING_PRIMARY_CHANNEL", "LOW_CONFIDENCE_SUGGESTION"]
}
```

### 4.2 Frontend Confirmation Rules
- `confirmationRequired=true` blocks final "start BAT Brain" until user confirms or edits handles.
- display confidence buckets:
  - `>= 0.75`: "likely your account"
  - `0.45-0.74`: "please confirm"
  - `< 0.45`: "unreliable suggestion"
- never auto-overwrite user-entered values.

### 4.3 Files
- `apps/backend/src/services/intake/suggest-intake-completion.ts`
- `apps/frontend/src/app/clients/new/page.tsx`
- `apps/frontend/src/app/clients/new/_components/social-handles-fields.tsx`

## 5) Competitor Normalization and Seeding (Deep Spec)

### 5.1 Typed Parsing
Replace simple parser with typed parser output:
```ts
type ParsedCompetitorInput =
  | { inputType: "instagram" | "tiktok" | "youtube" | "x" | "linkedin" | "facebook"; handle: string; normalizedKey: string; sourceUrl: string }
  | { inputType: "website"; domain: string; normalizedKey: string; sourceUrl: string };
```

### 5.2 Deterministic Normalization
- social key: `platform:normalizedHandle`
- website key: `website:normalizedDomain`
- URL -> platform parser must not infer unsupported routes as handles.

### 5.3 Seeding Rules
- seed all parsed rows with source `client_inspiration`.
- website rows:
  - state: `SHORTLISTED` (intelligence),
  - `scrapeEligible=false` until resolved to supported social surface.

### 5.4 Scrape Queue Rule
A competitor enters scrape queue only if:
- platform in `{instagram,tiktok}`,
- state in `{TOP_PICK,APPROVED,SHORTLISTED}`,
- availability not in `{PROFILE_UNAVAILABLE,INVALID_HANDLE}` unless explicit operator override.

### 5.5 Files
- `apps/backend/src/services/intake/brain-intake-utils.ts`
- `apps/backend/src/services/discovery/seed-intake-competitors.ts`
- `apps/backend/src/services/discovery/competitor-resolver.ts`
- `apps/backend/src/services/discovery/competitor-orchestrator-v2.ts`
- `apps/backend/src/routes/research-jobs.ts`

## 6) Downloader and Analysis Readiness Gate (Deep Spec)

### 6.1 Readiness Score Formula
Compute at snapshot scope, then derive asset eligibility.

```text
score =
  post_count_score (0..30) +
  media_coverage_score (0..30) +
  metrics_completeness_score (0..25) +
  uniqueness_score (0..10) +
  freshness_score (0..5)
```

Where:
- `post_count_score = min(posts_scraped / 12, 1) * 30`
- `media_coverage_score = (posts_with_media / posts_scraped) * 30`
- `metrics_completeness_score = (posts_with_likes_or_views / posts_scraped) * 25`
- `uniqueness_score = (unique_caption_ratio) * 10`
- `freshness_score = 5 if median_post_age_days <= 45 else 0`

### 6.2 Status Thresholds
- `READY`: score >= 70 and `posts_scraped >= 6`
- `DEGRADED`: 50-69
- `BLOCKED`: < 50 or critical failure (`posts_scraped == 0`, `media_coverage < 0.2`)

### 6.3 AI Analysis Eligibility
`runAiAnalysisForJob` must include only assets from snapshots with `readinessStatus=READY`.
Optional flag:
- `allowDegraded=false` default.

### 6.4 Retry/Throttle
Re-queue download attempts only if:
- snapshot last queued > 60m, and
- failure bucket below max threshold, or cooldown expired.

### 6.5 Files
- New: `apps/backend/src/services/orchestration/content-readiness.ts`
- `apps/backend/src/services/orchestration/run-job-media-analysis.ts`
- `apps/backend/src/services/orchestration/media-completeness.ts`
- `apps/backend/src/services/media/downloader.ts`

## 7) Competitors Workspace Restructure (Deep Spec)

### 7.1 UI Sections
- `Client Inputs`
- `Discovered Candidates`
- `Scrape Queue`
- `Scraped + Ready`
- `Blocked` (with reason codes)

### 7.2 Required Row Fields
- `sourceType` (`client_inspiration|orchestrated|manual`)
- `scrapeEligible`
- `readinessStatus`
- `blockerReasonCode`
- `lastStateTransitionAt`

### 7.3 Operator Actions
- `approve`, `reject`, `forceMaterialize`, `queueScrape`, `recheckAvailability`
- all actions log state transition events.

### 7.4 Files
- `apps/frontend/src/app/research/[id]/components/competitor/CompetitorOrchestrationPanel.tsx`
- `apps/frontend/src/app/research/[id]/components/CompetitorsSection.tsx`
- `apps/frontend/src/lib/api-client.ts`
- `apps/backend/src/routes/research-jobs.ts`

## 8) Strategy Anti-Hallucination Controls (Deep Spec)

### 8.1 Persistence Rule
Do not persist as final when grounding fails.
- Save as draft/debug artifact with full validation report.
- API status:
  - `COMPLETE`: final and grounded
  - `PARTIAL`: generated but not grounded
  - `FAILED`: generation failure

### 8.2 Grounding-Critical Checks
- every referenced competitor handle must exist in job scope.
- every numeric metric claim must map to known DB evidence.
- unsupported projections require source citation.
- placeholder/disclaimer language remains critical fail.

### 8.3 Fact Checker Expansion
Add claim extractors for:
- engagement rate ranges
- follower deltas
- posting frequency intervals
- comparative ratios (`x vs y`)

### 8.4 Files
- `apps/backend/src/routes/ai-strategy.ts`
- `apps/backend/src/services/ai/generators/index.ts`
- `apps/backend/src/services/ai/generators/document-validator.ts`
- `apps/backend/src/services/ai/validation/fact-checker.ts`

## 9) Calendar Generation and Prompt Grounding (Deep Spec)

### 9.1 Duration Control
Extend calendar generation endpoint with duration:
```json
{"durationDays": 7|14|30|90, "weekStart": "YYYY-MM-DD", "timezone": "IANA"}
```

### 9.2 Evidence Filter
Context builder uses only:
- client posts from readiness `READY` snapshots,
- competitor posts from approved + readiness `READY` competitors.

### 9.3 Slot Validation Enhancements
For each slot:
- at least one valid inspiration post OR explicit `BLOCKED` status.
- no unknown post IDs.
- no cross-job references.

### 9.4 Prompt Provenance
Prompt payload must include explicit evidence block:
```text
Evidence:
- postId: ...
- handle: ...
- platform: ...
- metrics: likes/comments/views/ER
```
Prompt remains editable, but save diff vs generated baseline.

### 9.5 Files
- `apps/backend/src/routes/content-calendar.ts`
- `apps/backend/src/services/calendar/content-calendar-context.ts`
- `apps/backend/src/services/calendar/content-calendar-processor.ts`
- `apps/backend/src/services/calendar/content-calendar-generator.ts`
- `apps/backend/src/services/calendar/build-creative-prompt.ts`
- `apps/frontend/src/app/research/[id]/components/calendar/ContentCalendarWorkspace.tsx`

## 10) Data Model Changes (Migration Spec)

### 10.1 Add Snapshot Readiness Fields
- `ClientProfileSnapshot`
  - `readinessScore Float?`
  - `readinessStatus String?` (`READY|DEGRADED|BLOCKED`)
  - `readinessReasons Json?`
  - `lastReadinessAt DateTime?`
- `CompetitorProfileSnapshot`
  - same fields as above

### 10.2 Competitor Input Metadata
- `CompetitorCandidateProfile`
  - `inputType String?`
  - `scrapeEligible Boolean @default(false)`
  - `blockerReasonCode String?`

### 10.3 Strategy Lifecycle
Add separate document run table or at minimum:
- `AiAnalysis` metadata field:
  - `documentStatus FINAL|DRAFT`
  - `groundingReport Json?`

### 10.4 Indexes
- readiness query indexes:
  - `(researchJobId, readinessStatus, scrapedAt DESC)` on both snapshot tables.
- competitor queue index:
  - `(researchJobId, scrapeEligible, state, availabilityStatus)`.

## 11) Observability and Ops

### 11.1 Mandatory Event Codes
- `intake.confirmation.required`
- `competitor.normalization.completed`
- `competitor.scrape.blocked`
- `snapshot.readiness.scored`
- `media.analysis.skipped_not_ready`
- `document.grounding.failed`
- `calendar.slot.blocked_missing_evidence`

### 11.2 Dashboards
- readiness funnel by job
- blocked reasons distribution
- grounding failure categories
- calendar evidence pass rate

## 12) Test Strategy (Release Blocking)

### 12.1 Unit
- parser normalization for all supported platforms + websites.
- readiness score computation edge cases.
- grounding validator claim resolution logic.

### 12.2 Integration
- intake -> seed -> shortlist -> scrape queue with mixed links.
- scrape snapshots with low media coverage and expected analysis block.
- strategy generate with injected hallucinated metrics -> must remain non-final.
- calendar duration 30/90 days with valid references.

### 12.3 E2E
- create new client with no channels, confirm suggested handle, run full pipeline.
- create competitor list mixed social+website, verify queue segregation.
- generate docs + calendar and verify only grounded status published.

## 13) Rollout Plan

### 13.1 Shadow Mode (Week 1)
- compute readiness and grounding but do not block; log only.

### 13.2 Soft Block (Week 2)
- block only critical failures, allow manual override with reason.

### 13.3 Hard Block (Week 3+)
- enforce all gates by default in production.

### 13.4 Kill Switches
- `READINESS_GATE_ENABLED`
- `DOC_GROUNDING_HARD_BLOCK`
- `CALENDAR_EVIDENCE_HARD_BLOCK`

## 14) Implementation Packets (Execution Order)
1. Packet A: Intake confirmation + typed competitor parser + website seeding.
2. Packet B: Readiness scorer + media analysis gating + queue throttles.
3. Packet C: Strategy grounding hard block and draft/final separation.
4. Packet D: Competitors tab stage model + blocker reason visibility.
5. Packet E: Calendar duration, readiness-filtered context, provenance prompt save.

## 15) Immediate Next Code Tasks
1. Finish Packet E provenance persistence:
- Save generated prompt baseline + editable prompt diff for each calendar run.
2. Add source-priority competitor queue controls:
- Prioritize `client_inspiration` and approved competitors before broad discovered pools.
3. Add downloader retry budgets tied to blocker reasons:
- Stop infinite retries for known-unavailable profiles and stale handles.
4. Add integration tests for readiness gates:
- Strategy finalization blocked when competitor readiness is below threshold.
- Calendar blocked when evidence set has no readiness-qualified inspiration.

## 16) Implementation Status (Current Iteration)
- Packet A (in progress, core implemented):
  - `suggest-intake-completion` now returns `confirmationRequired` + `confirmationReasons`.
  - Intake UI now blocks final start when channel confirmation is required.
  - Competitor inspiration parsing is now typed (`social + website`) with deterministic keys.
  - Website competitor inputs are seeded as intelligence rows and not auto-scraped.
- Packet B (implemented):
  - Added snapshot readiness fields in schema + migration.
  - Added `content-readiness` scoring service and persistence.
  - Wired media analysis to process only readiness-qualified snapshot assets.
- Packet C (implemented):
  - Added strategy `documentStatus` + `groundingReport` fields.
  - Strategy generation now persists failed grounding output as `DRAFT`.
  - Final publish path persists `FINAL` only after quality gate pass.
- Packet C+ hardening (implemented):
  - Added strict readiness checks inside strategy quality gate with explicit reason codes:
    - `READINESS_CLIENT_READY_BELOW_MINIMUM`
    - `READINESS_COMPETITOR_READY_BELOW_MINIMUM`
  - Added readiness metrics to strategy grounding report and API quality responses.
  - Added auto-rescore fallback for unscored snapshots before applying readiness gate.
- Packet D (implemented):
  - Competitor shortlist API now returns stage buckets:
    - `clientInputs`, `discoveredCandidates`, `scrapeQueue`, `scrapedReady`, `blocked`.
  - Profile rows now include:
    - `sourceType`, `scrapeEligible`, `readinessStatus`, `blockerReasonCode`, `lastStateTransitionAt`.
  - Competitor workspace now renders stage sections and blocker diagnostics.
  - Operator actions now include:
    - queue scrape, force materialize + queue, recheck availability.
  - Continue-queue hardening:
    - prioritizes `client_inspiration` + high-selection states first,
    - enforces `scrapeEligible` for non-force runs,
    - caps broad queue size via `COMPETITOR_CONTINUE_QUEUE_MAX` (default `25`).
- Packet E (in progress, core implemented):
  - Calendar generation now accepts `durationDays` (`7|14|30|90`).
  - Calendar context now pulls readiness-qualified snapshot posts and approved competitors only.
  - Slot validation now enforces inspiration evidence or explicit `BLOCKED` status.
  - Hardening implemented after old-client replay:
    - generator now forces blocked status + reason when inspiration evidence is missing,
    - pipeline now prevents persistence of non-blocked slots without evidence,
    - fallback mapping now auto-recovers missing `slotIndex`/`scheduledAt` safely.
- RAG modularization + anti-hallucination scope (implemented):
  - Added readiness scope module:
    - `apps/backend/src/services/ai/rag/readiness-context.ts`
  - `competitor-context` now filters to readiness-qualified competitor profiles.
  - `content-intelligence` now filters client/competitor pools through readiness-qualified handles.
  - RAG output now includes explicit snapshot readiness summary to constrain model claims.
- Legacy ops script hardening (implemented):
  - `audit-old-clients.ts` and `remediate-legacy-jobs.ts` now write reports via repo-absolute paths with auto-created directories.
  - remediation script now supports:
    - `--refresh-existing-docs`
    - `--refresh-calendar`
    - `--calendar-days 7|14|30|90`

## 17) Legacy Client Investigation (Current Environment)
Artifacts:
- `docs/baselines/current-user-baseline.md`
- `docs/baselines/old-client-audit.md`
- `docs/baselines/legacy-remediation-report.md`

Observed:
- Legacy client `ummahpreneur`:
  - quality improved materially after remediation loop:
    - `docsFinal`: `0 -> 9`
    - `socialPosts`: `116 -> 339`
    - `competitorSnapshots`: `8 -> 24`
    - `readyCompetitorSnapshots`: `0 -> 1`
    - `mediaDownloaded`: `1050 -> 1202`
  - still blocked for production:
    - competitor readiness remains low (`1/24` READY),
    - calendar still not generated (`0` runs, `0` slots).
  - dominant blocker reasons from readiness scoring:
    - `LOW_MEDIA_COVERAGE_CRITICAL` (`19`)
    - `LOW_POST_COUNT` (`15`)
    - `STALE_POSTS` (`9`)
    - `LOW_METRICS_COMPLETENESS` (`8`)
- Legacy client `ELUUMIS`:
  - upgraded with current improvements replayed:
    - `docsFinal=9` (`documentStatus=FINAL`, legacy-null docs cleared),
    - latest final docs carry readiness-grounding metadata and zero blocking reason codes,
    - `calendarRuns=5`, `calendarSlots=29`,
    - latest run has `14/14` slots with inspiration evidence and `0` non-blocked evidence gaps.
  - stable and production-closer baseline:
    - `client readiness 6/7 READY`,
    - `competitor readiness 1/1 READY`.

Priority implication:
1. Keep hard-blocking final strategy persistence when readiness is below threshold.
2. Narrow competitor scrape focus to high-intent sources first (`client_inspiration`, approved shortlist).
3. Tie calendar generation to both readiness and evidence integrity, with explicit operator-visible block reasons.

## 18) Deep Hardening Plan (From Current User Flows)
1. Competitor queue precision:
- Completed in current pass for continue-queue path (priority + cap + scrapeEligible guard).
- Next: apply same priority/cap policy to all queue entry points (not only continue path).
2. Downloader reliability:
- Add platform-specific retry budgets and dead-letter states for repeated `404/401/not_found`.
- Persist terminal failure codes so orchestration stops retrying dead profiles.
3. Readiness uplift loop:
- Re-score snapshots after each scrape chunk.
- Auto-promote only when post count + media + metrics thresholds are satisfied.
4. Docs/calendars hallucination floor:
- Keep strategy as `DRAFT` when readiness gate fails.
- Reject calendar slot creation when inspiration post IDs are missing readiness-qualified evidence.

## 19) Verification + Refinement (Latest Pass)
Implemented now:
1. Competitor pipeline modularization + deterministic eligibility:
- Added `apps/backend/src/services/discovery/competitor-pipeline-rules.ts`.
- Centralized `inputType/scrapeEligible/blockerReasonCode` derivation in one module.
- Wired this into:
  - `apps/backend/src/services/discovery/seed-intake-competitors.ts`
  - `apps/backend/src/services/discovery/competitor-materializer.ts`
2. Intake competitor reseed control for existing jobs:
- Updated `POST /api/research-jobs/:id/competitors/seed-from-intake` to support `force=true` resync.
3. Legacy remediation enhancement:
- `apps/backend/scripts/remediate-legacy-jobs.ts` now supports:
  - `--refresh-intake-competitors`
- This re-applies deterministic intake competitor seeding for old clients.
4. End-to-end integrity test harness (deep, production-focused):
- Added `apps/backend/scripts/test-client-workflow-integrity.ts`.
- Added npm script:
  - `npm run test:workflow-integrity --workspace=apps/backend`
- Checks include:
  - client-given + discovered competitors and scrape linkage,
  - all 13 questions (including strict Q13 JSON),
  - all 9 docs + grounding/readiness + anti-placeholder checks,
  - content analysis evidence signals + media-analysis presence,
  - content calendar evidence integrity and post/job scope validation,
  - downloader coverage on READY snapshots,
  - prompt guardrails + editable prompt provenance path,
  - DB linkage integrity across discovered/candidates/media/analysis/drafts.

Validation run on old active account (not Ummah):
- Job: `58b36b53-0039-4d3a-9520-d5483035e81d` (ELUUMIS)
- Latest strict report:
  - `docs/baselines/workflow-integrity-58b36b53-0039-4d3a-9520-d5483035e81d.md`
  - Result: `34/34` checks passing, `0` critical/high failures.

## 20) Latest Deep Refinement Pass (Current)
Implemented in this pass:
1. Qualified content pool modularization and downstream wiring:
- Added:
  - `apps/backend/src/services/orchestration/content-qualification.ts`
- Integrations:
  - `apps/backend/src/services/calendar/content-calendar-context.ts`
  - `apps/backend/src/services/orchestration/run-job-media-analysis.ts`
- Effect:
  - Calendar and media AI analysis now share a single eligibility contract:
    - readiness-qualified snapshots only,
    - media present,
    - metrics present,
    - competitor scope constrained to selected states.
2. Media-analysis RAG anti-noise hardening:
- Updated:
  - `apps/backend/src/services/ai/rag/media-analysis-context.ts`
  - `apps/backend/src/services/ai/rag/index.ts`
- Effect:
  - Strategy/media RAG now consumes qualified snapshot media assets only (legacy social-post assets excluded from grounding context).
3. Research job payload hydration for media AI:
- Updated:
  - `apps/backend/src/routes/research-jobs.ts`
- Effect:
  - Media payload now includes per-asset `analysisVisual/analysisTranscript/analysisOverall` derived from `ai_analyses` rows, not legacy nullable columns.
4. Content + AI Analysis UI scope tightening:
- Updated:
  - `apps/frontend/src/app/research/[id]/components/ContentAndAiAnalysisView.tsx`
  - `apps/frontend/src/app/research/[id]/components/ResearchTreeView.tsx`
- Effect:
  - View/counts now prioritize `READY` snapshot media (client + competitor) and fall back to raw social profile media only when snapshot media is absent.
  - Competitor media in this view is now constrained to selected competitor states (`TOP_PICK|SHORTLISTED|APPROVED`) when such selections exist.
5. Integrity test deepening (production checks):
- Updated:
  - `apps/backend/scripts/test-client-workflow-integrity.ts`
- New checks:
  - scoped media-analysis presence on qualified assets,
  - out-of-scope media-analysis leakage detection,
  - verification that both calendar context and run-job media analysis are wired to qualified content pool.
6. Downloaded-content analysis-window control (fix for oversized "items" counts):
- Updated:
  - `apps/backend/src/services/orchestration/run-job-media-analysis.ts`
  - `apps/backend/src/routes/research-jobs.ts`
  - `apps/frontend/src/app/research/[id]/components/ContentAndAiAnalysisView.tsx`
  - `apps/frontend/src/app/research/[id]/components/ResearchTreeView.tsx`
  - `apps/frontend/src/lib/api-client.ts`
- Effect:
  - media-analysis eligibility is now priority-ranked and capped (instead of analyzing very large raw pools),
  - UI analysis view now uses a bounded analysis window and surfaces analyzed assets first,
  - tree count and panel messaging now represent windowed analysis scope rather than implying all downloaded assets are immediate AI candidates.

Execution + validation:
1. Real scoped media-analysis run executed on ELUUMIS:
- `runAiAnalysisForJob(jobId, limit=10)` completed with `succeeded=10, failed=0`.
2. Strict workflow integrity re-run:
- `npm run test:workflow-integrity --workspace=apps/backend`
- Latest result:
  - `failed=1, critical=0, high=0` (strict pass preserved).
  - Residual failure is medium severity only: legacy out-of-scope media-analysis rows still exist in DB history.
3. Build validation:
- `npm run build --workspace=apps/backend` passed.
- `npm run build --workspace=apps/frontend` passed.
4. Old-client + DB architecture audits:
- `docs/baselines/old-client-audit.md` regenerated.
- `docs/baselines/db-architecture-audit.md` regenerated (`3` medium legacy drifts, `0` critical/high).
5. Oversized eligible-pool correction validated:
- Same ELUUMIS analysis path now logs `eligible=71` (windowed/capped), replacing earlier oversized candidate pool behavior.
6. Post-cleanup + post-fix strict integrity:
- `docs/baselines/workflow-integrity-58b36b53-0039-4d3a-9520-d5483035e81d.md` now reports:
  - `35/35` pass,
  - `out-of-scope media ai_analyses rows: 0`,
  - scoped media-analysis checks passing.

## 21) Downloaded Content Ordering + Filtering Contract
This is a mandatory production behavior for both "to be analyzed" and "analyzed view".

### 21.1 To-Be-Analyzed Pool (Backend)
Source:
- readiness-qualified posts only (client + selected competitors),
- metrics present, media present, scoped competitor states only.

Filtering:
- drop unsupported/out-of-scope competitors,
- dedupe by post identity and media asset ID,
- enforce hard caps:
  - max eligible posts,
  - max eligible media assets.

Ordering (highest priority first):
1. Client posts before competitor posts.
2. Higher evidence score first (likes/comments/views weighted score).
3. More recent posts first as tie-breaker.
4. Competitor fairness cap per handle to avoid one account dominating the queue.

### 21.2 Analyzed View (Frontend)
Filtering:
- default to READY snapshot media window (fallback to raw social only when snapshot window is empty),
- competitor entries constrained to selected states when present.

Ordering:
1. Assets with AI analysis first.
2. Unanalyzed assets second.
3. Within each bucket, keep source order from backend (priority-ranked pool).

Display contract:
- show windowed count (analysis scope) separately from full downloaded volume,
- avoid implying that every downloaded file is immediate analysis scope.

### 21.3 Acceptance Criteria
1. The "eligible" count should remain bounded by configured caps, not raw downloaded totals.
2. The analyzed view should never show only "No AI analysis yet" if analyzed assets exist in the same scoped window.
3. Workflow integrity must include checks for:
- scoped analysis presence,
- zero out-of-scope analysis leakage.

Residual cleanup (non-blocking but recommended before production cut):
1. Optional data hygiene migration/script:
- purge or archive legacy media `ai_analyses` linked only to social-post assets (not snapshot-qualified scope).
2. Backfill scoped media AI coverage:
- run scoped `/analyze-media` cycles until qualified-media analysis coverage reaches target threshold.

## 22) Downloader + Scraper Network Hardening (Implemented)
This pass adds production-grade proxy rotation, downloader retry logic, and safer path handling across media scrapers.

### 22.1 New Shared Modules
- `apps/backend/src/services/network/proxy-rotation.ts`
  - central proxy-pool parser from env lists,
  - round-robin proxy selection with cooldown after repeated failures,
  - retryability classifier for network/rate-limit/CAPTCHA-style failures,
  - shared backoff with jitter,
  - safe proxy redaction and axios proxy conversion.
- `apps/backend/src/services/scraper/script-runner.ts`
  - deterministic script path resolution (`scripts/*` and `apps/backend/scripts/*`),
  - JSON output parsing from script stdout (including multiline JSON cases),
  - retries with proxy target rotation per attempt,
  - process-level proxy env injection for Python/TS scrapers.

### 22.2 Downloader Path and Processing Upgrades
- `apps/backend/src/services/storage/file-manager.ts`
  - added `resolveStoragePath(...)` guard to prevent writes outside storage root,
  - `downloadAndSave(...)` now supports:
    - proxy rotation,
    - multi-attempt retries with backoff,
    - randomized user-agent rotation,
    - stronger HTML/login-page rejection checks,
    - contextual attempt diagnostics.
  - `toUrl(...)` now safely handles absolute local paths and remote URLs.
- `apps/backend/src/services/media/downloader.ts`
  - Camoufox Instagram resolver now uses shared retry runner + proxy rotation,
  - media filenames are cryptographically randomized (collision-safe),
  - downloaded paths are normalized/validated through storage guards,
  - file download calls now include contextual labels for traceability.
- `apps/backend/src/services/media/download-generic.ts`
  - hardened filename generation and safe storage path resolution before write.

### 22.3 Multi-Scraper Proxy/IP Rotation Coverage
Updated wrappers now inherit rotating proxy attempts:
- `apps/backend/src/services/scraper/tiktok-service.ts`
  - Camoufox scrape fallback to yt-dlp scrape with retry+rotation,
  - Camoufox downloader fallback to Puppeteer downloader with retry+rotation.
- `apps/backend/src/services/scraper/youtube-service.ts`
  - info and download script calls now run through shared retry+rotation runner.
- `apps/backend/src/services/scraper/instagram-service.ts`
  - Camoufox and Python layers now use shared runner with retry+rotation.

Script-level proxy propagation added:
- `apps/backend/scripts/youtube_downloader.py`
- `apps/backend/scripts/tiktok_scraper.py`
- `apps/backend/scripts/camoufox_insta_downloader.py`
- `apps/backend/scripts/camoufox_tiktok_downloader.py`
- `apps/backend/scripts/tiktok_downloader.ts`
- `apps/backend/scripts/instagram_scraper.py` (fixed proxy arg/env wiring in main entrypoint)

### 22.4 Runtime Config Surface
Added proxy and retry controls in:
- `apps/backend/.env.example`

Includes:
- global and platform-specific proxy lists,
- downloader/scraper attempt controls,
- cooldown/failure thresholds,
- direct-fallback toggles.

### 22.5 Validation Results
- `npm run build --workspace=apps/backend` passed after integration.
- `npm run check:runtime-config --workspace=apps/backend` passed.
- `npm run test:camoufox --workspace=apps/backend`:
  - Instagram resolver: pass,
  - TikTok photo downloader: pass,
  - TikTok video downloader: intermittent fail due external rate-limit/CAPTCHA behavior (known non-deterministic upstream constraint), with fallback paths now hardened.

## 23) Scenario Reliability Program (Prevent Recurrence of This Failure Class)
Goal:
- make "high downloaded count + low useful analysis + fallback-heavy calendar" a rare exception, not a normal state.
- enforce deterministic contracts so old and new clients behave the same.

### 23.1 Grounded Baseline (Current Users, 2026-02-20)
Observed from live DB (current active jobs only):

| Metric | Value | Risk |
|---|---:|---|
| Calendar runs | 11 | sample is enough to detect recurring failure pattern |
| Fallback runs | 8 (72.73%) | too high for production reliability |
| Empty-slot runs | 2 | indicates Stage-1 generation instability |
| Non-blocked slots with no inspiration | 14 | legacy evidence leakage |
| Ummah (`0ff50bfd-bd11-4e8e-bec6-e3a7ee00e63a`) fallback rate | 5/5 (100%) | stable output only via fallback path |
| ELUUMIS (`58b36b53-0039-4d3a-9520-d5483035e81d`) fallback rate | 3/6 (50%) | mixed reliability across runs |

Interpretation:
- production quality is currently protected by fallback safeguards, but upstream planning still fails too often.
- this program targets root-cause prevention, not only better fallback quality.

### 23.2 Failure Scenario Matrix (Deep, Release-Blocking)
Each scenario has a detector, hard gate, and auto-remediation path.

| ID | Failure Scenario | Detector | Hard Gate | Auto-Remediation | Release Target |
|---|---|---|---|---|---|
| S01 | Missing confirmed client channels | intake completion returns no confirmed social handle | block orchestration start | require explicit confirm/edit flow before start | `< 2%` of starts blocked for missing channel |
| S02 | Client competitor input parsed incompletely (social + website mixed) | parsed input count < raw input count | block seed commit | strict parser retry + operator error list | `>= 99%` parse coverage |
| S03 | Website-only competitors incorrectly scrape-queued | scrape queue includes `inputType=website` with no resolved social surface | reject queue insert | keep as intelligence-only + resolver task | `0` website-only queued rows |
| S04 | Client-provided competitors lose priority vs discovered candidates | queue top-N contains no `sourceType=client_inspiration` despite valid inputs | block discovery overwrite | enforce rank boost for client-provided rows | `100%` client seeds preserved in shortlist |
| S05 | Downloader returns files that are not usable media (HTML/login/empty) | MIME/type/content checks fail | reject media ingest | downloader retry with proxy rotation + alternate scraper | `>= 95%` usable-media ratio |
| S06 | Downloaded totals inflate while analysis-eligible pool stays noisy | `downloaded_total / qualified_assets` exceeds threshold | cap analysis eligibility window | enforce qualification and per-handle caps | ratio `<= 3.0` |
| S07 | UI shows "No AI analysis yet" while scoped analyses exist | scoped payload has analysis rows but panel empty state triggered | block empty-state render | strict scoped ordering + analyzed-first rendering | `0` false "no analysis" states |
| S08 | Stage-1 calendar generation returns empty slots | diagnostics `stage1SlotCount=0` | block direct publish from Stage-1 | run compressed retry path before fallback | empty Stage-1 on final run `<= 3%` |
| S09 | Fallback calendar path used too often | `usedFallback=true` rate over rolling window | release gate fail if above threshold | prompt compression + deterministic retry + evidence rebalance | fallback rate `<= 10%` shadow, `<= 3%` release |
| S10 | Non-blocked calendar slots without evidence | slot has status != `BLOCKED` and no inspiration IDs | reject slot persist | regenerate slot with qualified evidence pack | `0` non-blocked zero-evidence slots |
| S11 | Strategy docs finalize with weak grounding / hallucination risk | critical grounding issues in report | block status `FINAL` | repair cycle using evidence-only context | `0` critical grounding failures in FINAL docs |
| S12 | DB drift breaks joins between competitors/content/analysis/calendar | integrity script fails relation checks | block deployment | migration/backfill patch + integrity rerun | `0` critical/high integrity failures |

### 23.3 Deterministic Contract Upgrades (What Must Be True in Code)
1. Competitor Priority Contract:
- client-provided competitors always carry explicit `originPriority` and cannot be demoted below discovered rows until explicitly archived by operator.
- queue planner must reserve minimum slots for client-provided competitors before discovered-only expansion.

2. Analysis Scope Contract:
- separate counters must exist and be surfaced together:
  - `downloaded_total`,
  - `qualified_for_ai`,
  - `analysis_window`,
  - `analyzed_in_window`.
- AI analysis runners can only consume `qualified_for_ai` and must never infer scope from raw downloaded totals.

3. Ordered Analysis Queue Contract:
- strict ordering for to-be-analyzed pool:
  - client posts first,
  - then client-provided competitor posts,
  - then discovered competitor posts.
- each segment sorted by evidence score and recency, with per-handle fairness caps.

4. Calendar Evidence Contract:
- no slot can be persisted without inspiration IDs unless status is `BLOCKED`.
- fallback generator must consume the same qualified evidence pool as primary generator.

5. Docs Grounding Contract:
- every final factual assertion must map to stored evidence IDs.
- `FINAL` status blocked when any grounding-critical section lacks evidence bindings.

### 23.4 Auto-Remediation Runbooks (No Manual Firefighting by Default)
1. Intake/Competitor Repair:
- trigger: parse-coverage or priority contract violation.
- action: re-run intake seed normalization and competitor re-materialization for affected jobs.

2. Download/Qualification Repair:
- trigger: inflated downloaded-to-qualified ratio or unusable-media spike.
- action: re-qualify assets, purge invalid files from analysis scope, rerun bounded analysis window.

3. Calendar Repair:
- trigger: Stage-1 empty slots or non-blocked zero-evidence slot detection.
- action: rerun calendar pipeline with compressed evidence pack and deterministic fallback enforcement.

4. Legacy Data Repair:
- trigger: integrity script reports relation drift or out-of-scope analyses.
- action: run legacy remediation scripts, then re-run full workflow integrity checks.

### 23.5 Release Gates for "Nearly Never" Reliability
Release is blocked if any gate fails on rolling 7-day data:
- fallback calendar rate > `3%`.
- Stage-1 empty-slot final runs > `3%`.
- non-blocked zero-evidence slots > `0`.
- false "No AI analysis yet" states > `0`.
- docs with critical grounding failures in `FINAL` > `0`.
- workflow integrity critical/high failures > `0`.

### 23.6 Execution Plan (From Current Codebase, Not Greenfield)
Packet A: instrumentation and metrics truth.
- persist per-run scope counters (`downloaded_total`, `qualified_for_ai`, `analysis_window`, `analyzed_in_window`) and expose in API/UI.

Packet B: competitor priority hardening.
- enforce deterministic priority of client-provided competitors across queue, UI tabs, and downloader entrypoint.

Packet C: downloader-to-analysis strict qualification.
- tighten qualification filters and enforce bounded, ordered analysis windows before AI runs.

Packet D: Stage-1 calendar stability.
- add retry with prompt compression and explicit evidence budgeting to reduce fallback dependency.

Packet E: anti-hallucination finalization lock.
- enforce evidence bindings for docs and slots before final persistence.

Packet F: legacy cleanup and migration hardening.
- backfill old jobs to new contracts; block release until integrity is clean.

### 23.7 Validation Loop (Mandatory for Every Packet)
For each packet:
1. Run baseline export on current users.
2. Apply packet changes.
3. Re-run:
  - workflow integrity script,
  - baseline export,
  - targeted calendar reliability audit.
4. Compare metrics vs Section 23.5 gates.
5. Reject packet if any reliability metric regresses.

## 24) Packet A Implementation Status (Completed)
Scope implemented:
- Persist per-run media analysis scope counters with durable storage.
- Expose latest scope counters in research job payload and analyze-media response.
- Surface scope counters in UI so downloaded totals and analysis-window totals are no longer conflated.

### 24.1 Data Model + Migration
Added:
- Prisma model + enum:
  - `MediaAnalysisRun`
  - `MediaAnalysisRunStatus`
- Migration:
  - `apps/backend/prisma/migrations/20260220122000_add_media_analysis_runs/migration.sql`

Stored counters per run:
- `downloaded_total`
- `qualified_for_ai`
- `analysis_window`
- `analyzed_in_window`

Plus execution metadata:
- run status/reason, attempted/succeeded/failed, options caps, timestamps, diagnostics.

### 24.2 Backend Wiring
New module:
- `apps/backend/src/services/orchestration/media-analysis-runs.ts`

Updated:
- `apps/backend/src/services/orchestration/run-job-media-analysis.ts`
  - creates a persisted media-analysis run at start,
  - updates final status (`COMPLETE|SKIPPED|FAILED`) with scope counters,
  - emits scope metrics in start/complete events.
- `apps/backend/src/routes/research-jobs.ts`
  - `GET /api/research-jobs/:id` now includes `analysisScope` (latest run summary),
  - `POST /api/research-jobs/:id/analyze-media` returns `runId` + `analysisScope`.

### 24.3 Frontend Wiring
Updated:
- `apps/frontend/src/lib/api/types.ts`
- `apps/frontend/src/lib/api-client.ts`
- `apps/frontend/src/hooks/useResearchJob.ts`
- `apps/frontend/src/app/research/[id]/page.tsx`
- `apps/frontend/src/app/research/[id]/components/ResearchTreeView.tsx`
- `apps/frontend/src/app/research/[id]/components/ContentAndAiAnalysisView.tsx`

Behavior:
- content panel now displays persisted scope counts:
  - analysis window,
  - qualified for AI,
  - downloaded total,
  - analyzed in window.
- tree node count prefers persisted `analysisWindow` when present.

### 24.4 Validation Results
Build + schema:
- `npm run db:generate --workspace=apps/backend` passed.
- `npm run build --workspace=apps/backend` passed.
- `npm run build --workspace=apps/frontend` passed.
- migration applied with `prisma migrate deploy` (no destructive db push).

Runtime checks:
- ELUUMIS run: `71d3a634-cad1-40ec-ac9a-ecd3cf12cd79`
  - status `SKIPPED` (`no_unanalyzed_media`)
  - counters: `downloaded_total=1365`, `qualified_for_ai=354`, `analysis_window=80`, `analyzed_in_window=80`
- Ummah run: `ac01e2a6-3d7c-4c12-821b-8ae2c443c6b9`
  - status `SKIPPED` (`no_unanalyzed_media`)
  - counters: `downloaded_total=1854`, `qualified_for_ai=478`, `analysis_window=80`, `analyzed_in_window=80`

Integrity script updates:
- `apps/backend/scripts/test-client-workflow-integrity.ts` now verifies media-analysis scope metric consistency.

### 24.5 Remaining Non-Packet-A Gaps
Still failing on Ummah strict integrity:
1. no scrape-eligible competitor currently queue-ready (HIGH),
2. missing readiness metadata in legacy FINAL docs (MEDIUM).

These are not Packet A regressions and should be addressed in Packet B/E.

## 25) Packet B Implementation Status (Completed)
Goal:
- enforce deterministic competitor queue priority with client-input preference,
- eliminate legacy eligibility drift that causes false `scrapeEligible=false` and empty queue-ready pools.

### 25.1 Backend Changes
Updated:
- `apps/backend/src/services/discovery/competitor-materializer.ts`
  - added eligibility derivation helpers and drift detection:
    - `deriveEligibilityForProfile(...)`
    - `hasEligibilityDrift(...)`
  - added job-level repair routine:
    - `repairCandidateEligibilityForJob(...)`
  - `continueQueueFromCandidates(...)` now:
    - auto-repairs candidate eligibility before queue planning,
    - emits repair event with metrics,
    - uses derived effective eligibility for queue filtering,
    - enforces reserved queue capacity for client-provided competitors via:
      - `COMPETITOR_QUEUE_CLIENT_RESERVE` (default `3`),
    - keeps client-inputs deterministically ahead in queue ordering.
- `apps/backend/src/services/discovery/competitor-orchestrator-v2.ts`
  - `getCompetitorShortlist(...)` now runs eligibility repair across the job before assembling shortlist/stage buckets,
  - shortlist diagnostics now include `eligibilityRepair` summary.

### 25.2 Root Cause Resolved
Observed legacy drift (Ummah job) before Packet B:
- many candidate rows had `scrapeEligible=false` with null blocker codes despite scrape-capable platforms.
- result: strict integrity HIGH failure (`competitors.queue_ready_presence`).

After Packet B:
- eligibility drift corrected to deterministic values,
- queue-ready candidates restored for scrape/download pipeline.

### 25.3 Validation Results
Build:
- `npm run build --workspace=apps/backend` passed.

Runtime repair evidence (Ummah):
- shortlist load repair (first pass):
  - checked `38`, updated `38`, becameEligible `25`.
- shortlist load repair (full job pass):
  - checked `69`, updated `31`, becameEligible `17`.
- post-repair job snapshot:
  - `queueReady=42`,
  - `scrapeEligible=42`,
  - eligibility drift `0`.

Integrity:
- Ummah (`0ff50bfd-bd11-4e8e-bec6-e3a7ee00e63a`):
  - now `failed=1, critical=0, high=0` (HIGH failure removed).
- ELUUMIS (`58b36b53-0039-4d3a-9520-d5483035e81d`):
  - `failed=0, critical=0, high=0` preserved.

### 25.4 Remaining Gap After Packet B
Only one medium issue remains on Ummah strict integrity:
- docs grounding reports missing readiness metadata on legacy FINAL strategy docs.

This is Packet E scope (anti-hallucination finalization lock + readiness metadata backfill).

## 26) Packet E Implementation Status (Completed)
Goal:
- remove legacy `FINAL` doc grounding gaps where readiness metadata was missing,
- enforce consistent grounding report shape across strategy generation, regeneration, section edits, and remediation.

### 26.1 Backend Changes
Added:
- `apps/backend/src/services/ai/generators/readiness-metrics.ts`
  - centralized readiness metric loading + unscored snapshot auto-rescore fallback.
- `apps/backend/src/services/ai/generators/grounding-report.ts`
  - grounding report normalization with guaranteed readiness metadata,
  - shared quality-gate grounding report builder,
  - final-doc readiness backfill routine:
    - `backfillFinalDocumentGroundingReadiness(...)`.

Updated:
- `apps/backend/src/services/ai/generators/strategy-quality-gate.ts`
  - now consumes shared readiness metrics module.
- `apps/backend/src/routes/ai-strategy.ts`
  - generation/regeneration persistence now uses normalized grounding report builder,
  - manual section patch now rehydrates grounding readiness metadata before final write.
- `apps/backend/scripts/remediate-legacy-jobs.ts`
  - now runs doc-grounding readiness backfill for each processed job,
  - strategy regeneration path now uses the shared grounding report builder.

### 26.2 Runtime Validation
Build:
- `npm run build --workspace=apps/backend` passed.

Remediation run (Ummah):
- `action.backfillDocGroundingReadiness: checked=9, missing=9, updated=9`.

Strict integrity:
- Ummah (`0ff50bfd-bd11-4e8e-bec6-e3a7ee00e63a`):
  - now `failed=0, critical=0, high=0`.
  - `docs.readiness_in_grounding` now PASS.
- ELUUMIS (`58b36b53-0039-4d3a-9520-d5483035e81d`):
  - remains `failed=0, critical=0, high=0`.
