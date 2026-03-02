# Ibra Autofill Investigation Audit (2026-03-02)

## Scope
- Account tested: `ibra@ibra.one`
- Login password used: `ibrahimg01897@gmail.com`
- Environment tested: `https://client-portal-khaki-one.vercel.app`
- Constraint honored: **intake form was not submitted** (no final submit action triggered)

## Test Method
1. Logged in as the user and opened workspace intake.
2. Captured live `POST /api/portal/workspaces/:id/intake/suggest` requests/responses.
3. Tested two variants:
- Variant A: website only (`https://ibra.one`) with no social references.
- Variant B: website + social reference (`https://www.linkedin.com/in/ibrahimgamal01`).
4. Pulled DB evidence for workspace `4478bb6d-4978-4774-84b4-8509d314c9c8`:
- `research_jobs.input_data`
- `portal_intake_scan_runs`
- `portal_intake_scan_events`
- `raw_search_results`
- `web_sources`
- `web_page_snapshots`
5. Pulled public website evidence from `https://ibra.one` HTML metadata.

## Ground Truth Signals Found Online
From `https://ibra.one` page HTML:
- Title: `Ibrahim ( Ibra ) Gamal | Full-Stack Software Engineer | MERN Stack | Data Governance | Former UN Developer`
- Description includes: MERN, data governance, climate tech, former UN/UNFCCC.
- Direct LinkedIn reference exists in page metadata:
  - `<link rel="me" href="https://www.linkedin.com/in/ibrahimgamal01/" />`
- Structured data includes same-as/profile aliases and skills (MERN, data governance).

## What The Orchestrator/Enrichment Actually Stored
### Signup enrichment run
- Mode: `deep`
- Status: `COMPLETED`
- Targets completed: `1`
- Pages persisted: `1`
- Snapshots saved: `1`

### Snapshot quality
- Only 2 snapshots total, both for homepage.
- Latest snapshot clean text length: **106 chars** only.
- Stored text was mostly just the short title line, not rich page content.

### DDG/raw search quality
- `portal_signup_ddg_raw_query`: 103 rows.
- Domain distribution in sampled recent rows is mostly noise (`github.com`, random TikTok/Youtube/Twitter/music pages).
- Many results are unrelated to the user identity or business context.

## Autofill Comparison Results

### Variant A: Website only (no social reference)
Observed output:
- Description quality: decent.
- Handle candidates: low-confidence, mostly wrong (`@ibraonelove`, `@ibra_official` etc).
- No high-confidence LinkedIn candidate, despite LinkedIn being present in site metadata.

### Variant B: Website + LinkedIn social reference
Observed output:
- LinkedIn candidate correctly detected: `ibrahimgamal01` with confidence `0.98`.
- Brand/offer/audience/voice steps produced materially richer suggestions.
- Candidate workflow behaved correctly (no forced low-confidence auto-apply).

## Issues Found (Ranked)

### 1) P1: Social discovery still misses website-embedded LinkedIn unless user re-provides it
- Evidence: `ibra.one` contains explicit LinkedIn URL in metadata, but website-only autofill did not recover it.
- Impact: user must manually add LinkedIn in social references to get accurate channels.

### 2) P1: DDG enrichment query set is too broad for short names ("ibra") and pollutes candidate pool
- Evidence: stored DDG rows include many irrelevant domains and unrelated entities.
- Impact: noisy wrong social candidates and lower trust in autofill.

### 3) P1: Deep website scan produced shallow effective evidence
- Evidence: deep run persisted only 1 page and snapshot text length was only 106 chars.
- Impact: suggestion engine under-utilizes rich on-site profile content and relies too much on noisy external search.

### 4) P2: Channels step returns candidates but often no direct structured channel recommendation unless confidence is very high
- Evidence: with website-only input, channels suggestions were empty and only low-confidence candidates were returned.
- Impact: step can feel unhelpful unless user manually reviews candidate cards.

### 5) P2: DDG pipeline records high volume but low precision for this identity shape
- Evidence: 103 raw results but low actionable signal in social identity matching.
- Impact: unnecessary data noise and slower/high-variance suggestion quality.

## What Worked Correctly
- Queue-free intake autofill requests fired successfully per step in live flow.
- Step-aware autofill contract is active (`step` field changed correctly: brand/channels/offer/audience/voice).
- With explicit LinkedIn social reference, model behavior improved significantly and became aligned.

## Recommended Fix Priorities
1. Parse and prioritize website metadata/social links (`rel=me`, JSON-LD `sameAs`) before DDG social discovery.
2. Tighten DDG query planner for personal-brand domains with short names:
- stronger domain-anchored queries,
- strict domain/name overlap scoring,
- higher penalties for generic celebrity/music/noise pages.
3. Improve deep-scan extraction breadth for this site type (capture more than title-only clean text).
4. Keep candidate review flow, but add one high-confidence fallback from first-party site metadata when present.

## Artifacts Produced During This Audit
- `/tmp/test_ibra_autofill_pw_output.json` (live step-by-step suggest captures)
- `/tmp/test_ibra_autofill_brand_no_social_output.json` (website-only baseline)
- `/tmp/inspect_ibra_workspace2_clean.json` (DB workspace evidence snapshot)
- `/tmp/ibra_one_home.html` (public site evidence capture)
