# Current Stage Issues (Based on Current Implementation)

This document compresses what we have so far, based on the current codebase and your guidance in this chat.

## Section 1 (Fixes)

### 0) Resolved by BUSINESS_STRATEGY V2 redesign (control-plane replacement)

These issues are now addressed structurally (not just patched) by the new `ProcessRun` control engine:

1. Implicit workflow selection -> explicit method decision (`NICHE_STANDARD` vs `BAT_CORE`) with rule ID + input snapshot + evidence refs.
2. Weak stage contracts -> strict deterministic state machine with hard stage transitions.
3. Loose role boundaries -> role permission map with enforced tool/action guards.
4. Heuristic quality pass-through -> policy-gate enforcement with fail-closed outcomes.
5. Missing control-plane behavior -> first-class resume/retry/escalate/idempotency runtime controls.
6. Soft evidence lineage -> claim-to-evidence persistence and final gate blocking on ungrounded claims.
7. Incomplete auditability -> dedicated decision event journal and process event stream.
8. Weak questioning flow -> runtime `QuestionTask` engine with blocker/important policy and unified surfaces.
9. Non-versioned section progression -> per-section markdown revisions with ordered lifecycle states.

Residual note:
Legacy pipeline fixes still matter during migration/cutover windows until all traffic is on V2.

### 1) Critical correctness fixes in current code

1. `P1` Calendar row counting is broken.
Reason: `countMarkdownTableRows` uses `!/^|\s*-+\s*\|/i.test(line)`, where `^` matches every line start, so data rows are effectively counted as `0`.
Impact: false "thin calendar" flags and wrong quality penalties.
Current references:
- `apps/backend/src/services/documents/premium-document-pipeline.ts:656`
- `apps/backend/src/services/documents/premium-document-pipeline.ts:710`

2. `P1` `standard` depth is effectively unreachable.
Reason: depth normalization preserves `short/deep` only, and tool normalization tends to force deep unless quick-draft is used.
Impact: a 3-depth model behaves like a 2-depth model in practice.
Current references:
- `apps/backend/src/services/documents/document-service.ts:423`
- `apps/backend/src/services/ai/chat/tools/tools-documents.ts:71`

3. `P2` Fact-check fallback is fail-open.
Reason: fallback can return `pass: true` on checker failure/timeout.
Impact: system can log "fact-check completed" as if successful when checker did not actually validate.
Current references:
- `apps/backend/src/services/documents/premium-document-pipeline.ts:541`
- `apps/backend/src/services/documents/document-service.ts:1413`

4. `P2` `softened` outcomes do not downgrade section grounding status.
Reason: only `needs_review` forces insufficient evidence status; `softened` preserves prior section status.
Impact: confidence can be overstated.
Current reference:
- `apps/backend/src/services/documents/premium-document-pipeline.ts:627`

5. `P3` Prompt/tool contract drift in document action payloads.
Reason: chat prompt suggests `template: strategy_export|competitor_audit|executive_summary`, but tool normalization expects doc types and can silently fall back.
Impact: wrong workflow/doc selection can happen silently.
Current references:
- `apps/backend/src/services/ai/chat/chat-prompt.ts:93`
- `apps/backend/src/services/ai/chat/tools/tools-documents.ts:63`

### 2) Process and architecture fixes required for current system

1. Workflow selection is too implicit.
Fix needed: explicit selection from business objective + current business state, not only inferred docType/intent.

2. Stages exist, but stage contracts are weak.
Fix needed: hard entry/exit criteria per stage with deterministic `PASS/HOLD/ESCALATE`.

3. LLM roles exist, but role boundaries are loose.
Fix needed: strict role permissions (allowed tools, allowed edits, escalation thresholds).

4. Quality logic is too heuristic-first.
Fix needed: policy gates decide publishability; scores become advisory.

5. Runtime has process events but not full control-plane governance.
Fix needed: first-class workflow governance for retries, pause, escalate, and resume.

6. Gate integrity is not fully reliable.
Fix needed: isolate and test gates as deterministic functions; fail-closed where trust-critical.

7. Workflow contracts are drifting.
Fix needed: single canonical schema for planner payloads, UI actions, and tool arguments.

8. Process model is implied, not explicit.
Fix needed: a strict workflow registry with named stages and required artifacts.

9. Evidence lineage is still soft.
Fix needed: enforce claim-to-evidence mapping before final publish.

10. Quality gates are mostly scoring, not enforcement.
Fix needed: low-trust outputs should route to `needs_review`/`partial`, not `complete`.

11. Observability is strong, auditability is incomplete.
Fix needed: every automated decision must log rule ID + input basis + output decision.

12. Runtime complexity risk is high if background processes increase now.
Fix needed: idempotency, bounded retries, and explicit concurrency limits before scaling.

13. Human override policy is not first-class.
Fix needed: explicit stop/escalation states and resume workflow after human input.

### 3) Fix ordering (baby steps, no big-bang rewrite)

1. Correct hard bugs that invalidate trust signals.
2. Lock one canonical contract for document actions and depth handling.
3. Add fail-closed behavior for trust-critical fact-check and publish decisions.
4. Introduce explicit stage contracts around the existing pipeline.
5. Add decision journal fields for full auditability.

## Section 2 (Future Plan and Vision)

This future plan is aligned to your latest direction:
1. Professor-style = academic method first, not prompt-first generation.
2. Workflow is proposed first, then client suggestion/adjustment is accepted.
3. Manager actor uses existing tools (`web search` + `Scraply` + model knowledge) under a declared standard.
4. Documents are built section by section, with markdown continuity and client checkpoints.
5. System must support full docs, selected sections, and mixed-doc packs.

### 1) Workflow-First Interaction Contract (non-negotiable)

Before execution, manager actor must do this in order:
1. Propose workflow and standard first.
2. Ask for client confirmation or edits.
3. Lock workflow version (`workflow_vX`).
4. Then run tools and section execution.

This directly captures your requirement: "suggest workflow first, then read/merge suggestion."

### 2) Standard Declaration (academic mode)

Every run begins with:
1. `Selected standard/method` (example: strategic analysis method for requested document type).
2. `Why this standard matches the request`.
3. `Section rubric` (what makes section pass beyond numeric score).

Minimum section rubric:
1. Question
2. Claim
3. Evidence
4. Analysis
5. Implication
6. Recommendation
7. Limitation / missing input

### 3) Manager Actor Evidence Loop (tool-based)

For each actor/entity relevant to a section (brand, competitor, audience, channel):
1. Run web search for fresh external signals.
2. Run Scraply for deeper extraction/verification.
3. Merge with internal model knowledge for synthesis.
4. Produce actor brief markdown with sources and confidence notes.

If section evidence is still insufficient:
1. Ask targeted client question(s) for that section only.
2. Re-run evidence loop after client input.

### 4) Section Studio (interactive markdown flow)

Each section moves through explicit states:
1. `planned`
2. `researching`
3. `drafted`
4. `needs_client_input` or `needs_review`
5. `approved`
6. `locked`

Interactive behavior:
1. Show previous approved sections before drafting the next section.
2. Show what changed since last revision.
3. Keep section history in markdown (`v1`, `v2`, `v3`) with short change rationale.

### 5) Request Modes (full, partial, mixed)

Supported request shapes:
1. Full document (`BUSINESS_STRATEGY`, etc.).
2. Section-only request from one document.
3. Mixed pack across multiple document families.

Execution rule:
1. Normalize request into canonical section library.
2. Run the same section lifecycle for every selected section.
3. Assemble output package from approved sections only.

### 6) Control-Plane Target While Reusing Current Flow

Keep current implementation as worker pipeline, but add a control-plane above it:
1. Workflow selector (explicit, policy-driven).
2. Stage contracts (hard entry/exit).
3. Tool router by role and section.
4. Publish gate (`PASS/PARTIAL/HOLD/ESCALATE`).
5. Decision journal (rule + evidence + decision trace).

### 7) Baby-Step Rollout Plan

1. Start with one document type: `BUSINESS_STRATEGY`.
2. Implement workflow-first interaction contract.
3. Implement actor evidence loop using existing tools.
4. Implement section studio states and markdown versioning.
5. Add client clarification protocol for blocked sections.
6. Only then expand to mixed-doc assembly and additional doc families.

---

Status now:
1. Fix map is clear.
2. Future model is now method-first, tool-routed, section-interactive, and aligned with your latest responses.
