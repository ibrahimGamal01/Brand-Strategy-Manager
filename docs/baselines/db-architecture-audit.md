# DB Architecture Audit

Generated: 2026-02-18T13:38:57.431Z
database: configured
migrationDirs: 9
appliedMigrations: 9

## Summary
- Checks passed: 12/15
- Checks failed: 3
- Critical failures: 0
- High failures: 0
- Medium failures: 3

## CRITICAL
- [PASS] No pending migrations in database
  - value: 0
  - All migration directories are applied
  - recommendation: Apply pending migrations before running orchestrations that depend on new schema fields/tables.
- [PASS] Social discovered competitors keep candidate linkage
  - value: 0
  - Expected zero social discovered competitors without candidate_profile_id linkage
- [PASS] Discovered rows and candidate rows stay in same research job
  - value: 0
  - Prevents cross-job contamination in competitor pipeline
- [PASS] Candidate profiles map to orchestration runs from same job
  - value: 0
  - Run/job mismatch can corrupt shortlist and queueing logic
- [PASS] Calendar slot inspiration IDs resolve to snapshot posts within same job
  - value: 0
  - Protects calendar → prompt → draft pipeline from dangling references
- [PASS] AI analyses stay within the same job scope as source media
  - value: 0
  - Avoids cross-job grounding leakage in docs and prompt generation

## HIGH
- [PASS] Migration lock file exists
  - value: 1
  - /Users/ibrahimgamal/Downloads/ali/upwork/brand-strategy-manager/apps/backend/prisma/migrations/migration_lock.toml
  - recommendation: Keep migration_lock.toml committed so migrate diff/deploy stays deterministic.
- [PASS] Applied migrations are present in repository
  - value: 0
  - All applied migrations exist in prisma/migrations
  - recommendation: If extra DB-only migrations exist, restore them in repo or baseline a fresh schema snapshot to prevent environment drift.
- [PASS] Calendar chat tables exist for schema compatibility
  - value: 0
  - calendar_chat_sessions missing: 0
  - calendar_chat_messages missing: 0
  - calendar_chat_commands missing: 0
- [PASS] Content draft inspiration IDs resolve to snapshot posts within same job
  - value: 0
  - Draft regeneration and auditability rely on resolvable inspiration lineage
- [PASS] Media assets are not linked to both client and competitor snapshots simultaneously
  - value: 0
  - Mixed ownership would break downloader and metric attribution
- [PASS] Clients with research jobs have a brain profile row
  - value: 0
  - Brain tab and orchestration rely on profile-backed context

## MEDIUM
- [FAIL] Legacy brain suggestion table remains as non-blocking schema drift
  - value: 1
  - Table exists in DB but is not represented in Prisma schema.
  - recommendation: Either reintroduce this model in schema and implement suggestion APIs, or add a cleanup migration once you confirm data is no longer needed.
- [FAIL] Legacy media analysis columns remain as non-blocking schema drift
  - value: 5
  - Legacy media_assets columns still exist in DB but not in Prisma schema.
  - recommendation: Drop legacy columns in a dedicated migration once you confirm no rollback path depends on them.
- [FAIL] Legacy snapshot queue timestamp columns remain as non-blocking schema drift
  - value: 2
  - Legacy *_profile_snapshots.last_media_download_queued_at columns still exist in DB.
  - recommendation: Drop these legacy columns in a cleanup migration when data retention requirements are confirmed.

