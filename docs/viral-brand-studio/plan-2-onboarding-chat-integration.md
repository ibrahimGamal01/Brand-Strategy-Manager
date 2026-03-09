# Viral Brand Studio Plan 2

## Objective

Ship Pomelli-style Brand DNA onboarding as a required gate for generation, while keeping the chat runtime as the central execution surface for business operations.

## Implemented in Plan 2

1. Brand DNA persistence moved to workspace-backed storage (`workspace_memory_snapshots`) with stable key:
   - `scope=workspace_profile`
   - `key=viral_studio_brand_dna`
   - `branch_id=global`
2. Onboarding API supports:
   - create draft
   - patch draft/final
   - fetch profile
   - generate summary preview (`POST /brand-dna/summary`)
3. Generation API gate:
   - returns `BRAND_DNA_REQUIRED` unless Brand DNA is finalized and complete.
4. Client onboarding UX:
   - progressive 4-step wizard
   - live tone preview
   - AI-style summary generation button
   - finalize gate to unlock pipeline
   - post-finalize edit flow
5. Chat-first integration:
   - send shortlisted references to runtime chat
   - send generated pack to runtime chat
   - command palette command: `Open Viral Studio`
   - command palette command: `Use Viral Studio context`
   - direct quick actions from chat layout into Viral Studio route

## Business Integration Guarantees

1. Chat remains the core operating channel.
2. Viral Studio outputs become chat inputs, not isolated artifacts.
3. Workspace context remains shared across chat runtime and Viral Studio workflows.
