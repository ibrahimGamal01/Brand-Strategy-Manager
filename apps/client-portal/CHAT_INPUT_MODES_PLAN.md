# Chat Input Modes Plan (ChatGPT/Codex Style)

## Objective
Ship a first-class chat input system that supports:
- quick/default replies
- deeper reasoning modes (long/pro)
- source control (web/library/uploaded docs/live intel)
- queued send by default during active runs
- in-thread steer controls per queued message
- clear keyboard behavior (`Enter` send, `Shift+Enter` newline)

This plan is designed for the existing BAT runtime and queue architecture.

## Product Rules
1. `Enter` submits message.
2. `Shift+Enter` inserts newline.
3. If an active run exists, `Send`/`Enter` **queues** the message by default.
4. Each queued message has its own `Steer` action.
5. Interrupt is explicit (secondary action, never implicit).
6. Input mode and source settings are attached to each message and persisted.

## Input Modes (v1)
Define per-message response mode:
- `fast`: short, minimal tool usage.
- `balanced`: standard quality/latency.
- `deep`: longer reasoning, wider evidence retrieval.
- `pro`: maximum rigor, multi-tool, explicit validation pass.

Map mode to runtime policy:
- `depth`: `fast|normal|deep`
- `maxToolCalls`: integer
- `validationLevel`: `light|standard|strict`
- `targetLength`: `short|medium|long`
- `maxLatencyMs`: soft budget

## Source Controls (v1)
Per-message source scope:
- `workspace_data` (default on)
- `library_pinned` (default on)
- `uploaded_docs` (default on when files attached)
- `website_live_fetch` (default off, enable per message)
- `web_search_ddg` (default off, enable per message)
- `social_intel` (default on when available)

Store source preferences in message metadata and runtime policy.

## UI/UX Design
### Composer Layout
Single minimal composer with:
- primary textarea
- mode pill (`Fast`, `Balanced`, `Deep`, `Pro`)
- source toggle button (opens compact popover)
- attachment button
- send button
- interrupt button (visible only while active run)

### Queue UX
When run is active:
- sending creates queue item immediately
- queue list appears under composer
- each queue row has:
  - edit
  - delete
  - reorder handle
  - `Steer` button

### Steer UX
`Steer` opens quick controls scoped to that queued message:
- tone (`concise`, `direct`, `friendly`)
- focus (`offers`, `competitors`, `content`, `funnel`)
- evidence strictness (`normal`, `strict`)
- optional free-text steer note

Steer updates queue item policy payload, not global session by default.

## Data Contract Changes
### Frontend Types
Extend queued message payload:
- `mode: "fast" | "balanced" | "deep" | "pro"`
- `sources: SourceScope`
- `steer?: { chips: string[]; note?: string; strictEvidence?: boolean }`

### Backend Runtime API
`POST /runtime/branches/:branchId/messages`
- accept optional `inputOptions`:
  - `mode`
  - `sources`
  - `steer`
  - `queueBehavior` (`queue_default`)

`PATCH /runtime/branches/:branchId/queue/:itemId`
- update queued item options (mode/sources/steer/content).

### Persistence
Message queue item schema additions (JSON-safe):
- `policyJson`
- `sourceScopeJson`
- `steerJson`

No breaking change required if existing queue schema already has a JSON field.

## Runtime Policy Mapping
Add resolver:
- `resolveRunPolicyFromInputOptions(inputOptions, workspaceDefaults)`

Rules:
- `fast`: fewer tools, lower token budget.
- `deep`: increase evidence retrieval and tool budget.
- `pro`: enforce validator pass and citations coverage threshold.
- if web toggles enabled, planner can call `web.fetch/web.crawl/ddg` tools.
- if disabled, planner must stay on workspace/library evidence.

## Keyboard Behavior
Composer logic:
- `Enter` without modifiers: submit.
- `Shift+Enter`: newline.
- `Ctrl/Cmd+Enter`: force immediate interrupt+send (power users).
- IME-safe handling: do not submit while `isComposing=true`.

## Implementation Phases
### Phase 1 (Core)
1. Add mode selector and source controls UI.
2. Make queue default when active run.
3. Add per-queue-item steer action.
4. Carry options to backend payload.

### Phase 2 (Runtime)
1. Map input options to run policy.
2. Update planner prompt to consume `mode` and `source scope`.
3. Enforce strict validation in `pro`.

### Phase 3 (Polish)
1. Persist user defaults per workspace.
2. Add usage analytics by mode.
3. Add keyboard shortcut hints and onboarding tooltip.

## Acceptance Criteria
1. Active run + `Enter` creates queue item (no browser popup).
2. Queue item displays steer controls and edits persist.
3. `Shift+Enter` always inserts newline.
4. Mode changes alter response depth/length/tool usage.
5. Source toggles constrain planner tool behavior.
6. `pro` mode always includes strict validation + citations.
7. Works on desktop and mobile composer layouts.

## Test Plan
### Unit
- keyboard submit/newline behavior
- mode -> policy resolver
- source scope -> allowed tool set

### Integration
- queue default during active run
- steer updates queued item and affects final output
- deep/pro modes trigger larger tool plans

### E2E
- user sends while active run -> queued
- user steers queued message -> output reflects steer
- mode/source settings survive refresh

## Risks and Mitigations
- Risk: mode confusion.
  - Mitigation: concise tooltips and sane default (`Balanced`).
- Risk: long latency in `pro`.
  - Mitigation: display expected latency and allow mid-run interrupt.
- Risk: source explosion with web enabled.
  - Mitigation: cap tool calls and enforce relevance filters.

## Recommended Defaults (v1)
- default mode: `balanced`
- default source scope: workspace + library + social
- default active-run behavior: queue
- default strict citations: off except `pro`
