import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

type CheckResult = {
  id: string;
  title: string;
  severity: Severity;
  passed: boolean;
  value: number;
  details: string[];
  recommendation?: string;
};

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function migrationDirs(): string[] {
  const migrationsPath = path.resolve(__dirname, '..', 'prisma', 'migrations');
  if (!existsSync(migrationsPath)) return [];
  return readdirSync(migrationsPath)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();
}

function toMd(checks: CheckResult[], metadata: Record<string, string | number>) {
  const lines: string[] = [];
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.length - passed;
  lines.push('# DB Architecture Audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  for (const [key, value] of Object.entries(metadata)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Checks passed: ${passed}/${checks.length}`);
  lines.push(`- Checks failed: ${failed}`);
  lines.push(`- Critical failures: ${checks.filter((c) => !c.passed && c.severity === 'CRITICAL').length}`);
  lines.push(`- High failures: ${checks.filter((c) => !c.passed && c.severity === 'HIGH').length}`);
  lines.push(`- Medium failures: ${checks.filter((c) => !c.passed && c.severity === 'MEDIUM').length}`);
  lines.push('');

  const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM'];
  for (const severity of order) {
    lines.push(`## ${severity}`);
    const rows = checks.filter((c) => c.severity === severity);
    if (rows.length === 0) {
      lines.push('- none');
      lines.push('');
      continue;
    }
    for (const row of rows) {
      lines.push(`- [${row.passed ? 'PASS' : 'FAIL'}] ${row.title}`);
      lines.push(`  - value: ${row.value}`);
      for (const detail of row.details) {
        lines.push(`  - ${detail}`);
      }
      if (row.recommendation) {
        lines.push(`  - recommendation: ${row.recommendation}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function countQuery(sql: string): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe<{ count: number }[]>(sql)) || [];
  return Number(rows[0]?.count || 0);
}

async function run() {
  const checks: CheckResult[] = [];
  const migrations = migrationDirs();
  const migrationLockPath = path.resolve(__dirname, '..', 'prisma', 'migrations', 'migration_lock.toml');
  const appliedMigrations = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
    'SELECT migration_name FROM "_prisma_migrations"'
  );
  const appliedSet = new Set(appliedMigrations.map((row) => String(row.migration_name || '')));
  const pending = migrations.filter((name) => !appliedSet.has(name));
  const extraApplied = Array.from(appliedSet).filter((name) => !migrations.includes(name));

  checks.push({
    id: 'migration_lock_present',
    title: 'Migration lock file exists',
    severity: 'HIGH',
    passed: existsSync(migrationLockPath),
    value: existsSync(migrationLockPath) ? 1 : 0,
    details: [migrationLockPath],
    recommendation: 'Keep migration_lock.toml committed so migrate diff/deploy stays deterministic.',
  });

  checks.push({
    id: 'pending_migrations',
    title: 'No pending migrations in database',
    severity: 'CRITICAL',
    passed: pending.length === 0,
    value: pending.length,
    details: pending.length > 0 ? pending : ['All migration directories are applied'],
    recommendation:
      'Apply pending migrations before running orchestrations that depend on new schema fields/tables.',
  });

  checks.push({
    id: 'applied_migrations_backed_by_repo',
    title: 'Applied migrations are present in repository',
    severity: 'HIGH',
    passed: extraApplied.length === 0,
    value: extraApplied.length,
    details: extraApplied.length > 0 ? extraApplied : ['All applied migrations exist in prisma/migrations'],
    recommendation:
      'If extra DB-only migrations exist, restore them in repo or baseline a fresh schema snapshot to prevent environment drift.',
  });

  const calendarChatSessionsMissing = await countQuery(
    "SELECT CASE WHEN to_regclass('public.calendar_chat_sessions') IS NULL THEN 1 ELSE 0 END::int AS count"
  );
  const calendarChatMessagesMissing = await countQuery(
    "SELECT CASE WHEN to_regclass('public.calendar_chat_messages') IS NULL THEN 1 ELSE 0 END::int AS count"
  );
  const calendarChatCommandsMissing = await countQuery(
    "SELECT CASE WHEN to_regclass('public.calendar_chat_commands') IS NULL THEN 1 ELSE 0 END::int AS count"
  );
  checks.push({
    id: 'calendar_chat_tables_present',
    title: 'Calendar chat tables exist for schema compatibility',
    severity: 'HIGH',
    passed:
      calendarChatSessionsMissing + calendarChatMessagesMissing + calendarChatCommandsMissing === 0,
    value:
      calendarChatSessionsMissing + calendarChatMessagesMissing + calendarChatCommandsMissing,
    details: [
      `calendar_chat_sessions missing: ${calendarChatSessionsMissing}`,
      `calendar_chat_messages missing: ${calendarChatMessagesMissing}`,
      `calendar_chat_commands missing: ${calendarChatCommandsMissing}`,
    ],
  });

  const discoveredSocialWithoutCandidate = await countQuery(
    "SELECT COUNT(*)::int AS count FROM discovered_competitors dc WHERE dc.platform IN ('instagram','tiktok') AND dc.selection_state IN ('TOP_PICK','APPROVED','SHORTLISTED') AND dc.candidate_profile_id IS NULL"
  );
  checks.push({
    id: 'discovered_social_candidate_link',
    title: 'Social discovered competitors keep candidate linkage',
    severity: 'CRITICAL',
    passed: discoveredSocialWithoutCandidate === 0,
    value: discoveredSocialWithoutCandidate,
    details: ['Expected zero social discovered competitors without candidate_profile_id linkage'],
  });

  const discoveredCandidateCrossJob = await countQuery(
    'SELECT COUNT(*)::int AS count FROM discovered_competitors dc JOIN competitor_candidate_profiles cp ON cp.id = dc.candidate_profile_id WHERE cp.research_job_id <> dc.research_job_id'
  );
  checks.push({
    id: 'discovered_candidate_same_job',
    title: 'Discovered rows and candidate rows stay in same research job',
    severity: 'CRITICAL',
    passed: discoveredCandidateCrossJob === 0,
    value: discoveredCandidateCrossJob,
    details: ['Prevents cross-job contamination in competitor pipeline'],
  });

  const candidateRunCrossJob = await countQuery(
    'SELECT COUNT(*)::int AS count FROM competitor_candidate_profiles cp JOIN competitor_orchestration_runs cor ON cor.id = cp.orchestration_run_id WHERE cp.research_job_id <> cor.research_job_id'
  );
  checks.push({
    id: 'candidate_run_same_job',
    title: 'Candidate profiles map to orchestration runs from same job',
    severity: 'CRITICAL',
    passed: candidateRunCrossJob === 0,
    value: candidateRunCrossJob,
    details: ['Run/job mismatch can corrupt shortlist and queueing logic'],
  });

  const slotInspirationUnresolved = await countQuery(
    "WITH slot_ids AS ( SELECT cs.id AS slot_id, ccr.research_job_id, unnest(cs.inspiration_post_ids) AS post_id FROM calendar_slots cs JOIN content_calendar_runs ccr ON ccr.id = cs.calendar_run_id ) SELECT COUNT(*)::int AS count FROM slot_ids si LEFT JOIN client_post_snapshots cps ON cps.id = si.post_id LEFT JOIN client_profile_snapshots cprs ON cprs.id = cps.client_profile_snapshot_id AND cprs.research_job_id = si.research_job_id LEFT JOIN competitor_post_snapshots kps ON kps.id = si.post_id LEFT JOIN competitor_profile_snapshots kprs ON kprs.id = kps.competitor_profile_snapshot_id AND kprs.research_job_id = si.research_job_id WHERE cprs.id IS NULL AND kprs.id IS NULL"
  );
  checks.push({
    id: 'calendar_slot_inspiration_resolution',
    title: 'Calendar slot inspiration IDs resolve to snapshot posts within same job',
    severity: 'CRITICAL',
    passed: slotInspirationUnresolved === 0,
    value: slotInspirationUnresolved,
    details: ['Protects calendar → prompt → draft pipeline from dangling references'],
  });

  const draftInspirationUnresolved = await countQuery(
    "WITH draft_ids AS ( SELECT cd.id AS draft_id, ccr.research_job_id, unnest(cd.used_inspiration_post_ids) AS post_id FROM content_drafts cd JOIN calendar_slots cs ON cs.id = cd.slot_id JOIN content_calendar_runs ccr ON ccr.id = cs.calendar_run_id ) SELECT COUNT(*)::int AS count FROM draft_ids di LEFT JOIN client_post_snapshots cps ON cps.id = di.post_id LEFT JOIN client_profile_snapshots cprs ON cprs.id = cps.client_profile_snapshot_id AND cprs.research_job_id = di.research_job_id LEFT JOIN competitor_post_snapshots kps ON kps.id = di.post_id LEFT JOIN competitor_profile_snapshots kprs ON kprs.id = kps.competitor_profile_snapshot_id AND kprs.research_job_id = di.research_job_id WHERE cprs.id IS NULL AND kprs.id IS NULL"
  );
  checks.push({
    id: 'content_draft_inspiration_resolution',
    title: 'Content draft inspiration IDs resolve to snapshot posts within same job',
    severity: 'HIGH',
    passed: draftInspirationUnresolved === 0,
    value: draftInspirationUnresolved,
    details: ['Draft regeneration and auditability rely on resolvable inspiration lineage'],
  });

  const aiAnalysisMediaCrossJob = await countQuery(
    'SELECT COUNT(*)::int AS count FROM ai_analyses aa JOIN media_assets ma ON ma.id = aa.media_asset_id LEFT JOIN client_post_snapshots cps ON cps.id = ma.client_post_snapshot_id LEFT JOIN client_profile_snapshots cprs ON cprs.id = cps.client_profile_snapshot_id LEFT JOIN competitor_post_snapshots kps ON kps.id = ma.competitor_post_snapshot_id LEFT JOIN competitor_profile_snapshots kprs ON kprs.id = kps.competitor_profile_snapshot_id WHERE aa.research_job_id IS NOT NULL AND ((cprs.id IS NOT NULL AND cprs.research_job_id <> aa.research_job_id) OR (kprs.id IS NOT NULL AND kprs.research_job_id <> aa.research_job_id))'
  );
  checks.push({
    id: 'ai_analysis_media_job_scope',
    title: 'AI analyses stay within the same job scope as source media',
    severity: 'CRITICAL',
    passed: aiAnalysisMediaCrossJob === 0,
    value: aiAnalysisMediaCrossJob,
    details: ['Avoids cross-job grounding leakage in docs and prompt generation'],
  });

  const dualSnapshotLinkedAssets = await countQuery(
    'SELECT COUNT(*)::int AS count FROM media_assets WHERE client_post_snapshot_id IS NOT NULL AND competitor_post_snapshot_id IS NOT NULL'
  );
  checks.push({
    id: 'media_asset_single_snapshot_link',
    title: 'Media assets are not linked to both client and competitor snapshots simultaneously',
    severity: 'HIGH',
    passed: dualSnapshotLinkedAssets === 0,
    value: dualSnapshotLinkedAssets,
    details: ['Mixed ownership would break downloader and metric attribution'],
  });

  const missingBrainProfiles = await countQuery(
    'SELECT COUNT(*)::int AS count FROM clients c WHERE EXISTS (SELECT 1 FROM research_jobs r WHERE r.client_id = c.id) AND NOT EXISTS (SELECT 1 FROM brain_profiles bp WHERE bp.client_id = c.id)'
  );
  checks.push({
    id: 'brain_profile_presence',
    title: 'Clients with research jobs have a brain profile row',
    severity: 'HIGH',
    passed: missingBrainProfiles === 0,
    value: missingBrainProfiles,
    details: ['Brain tab and orchestration rely on profile-backed context'],
  });

  const legacyBrainSuggestionTable = await countQuery(
    "SELECT CASE WHEN to_regclass('public.brain_profile_suggestions') IS NULL THEN 0 ELSE 1 END::int AS count"
  );
  checks.push({
    id: 'legacy_brain_suggestion_table',
    title: 'Legacy brain suggestion table remains as non-blocking schema drift',
    severity: 'MEDIUM',
    passed: legacyBrainSuggestionTable === 0,
    value: legacyBrainSuggestionTable,
    details: [
      legacyBrainSuggestionTable
        ? 'Table exists in DB but is not represented in Prisma schema.'
        : 'No legacy suggestion table drift detected.',
    ],
    recommendation:
      'Either reintroduce this model in schema and implement suggestion APIs, or add a cleanup migration once you confirm data is no longer needed.',
  });

  const legacyMediaAssetColumns = await countQuery(
    "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name IN ('analysis_overall','analysis_transcript','analysis_visual','extracted_on_screen_text','extracted_transcript')"
  );
  checks.push({
    id: 'legacy_media_asset_columns',
    title: 'Legacy media analysis columns remain as non-blocking schema drift',
    severity: 'MEDIUM',
    passed: legacyMediaAssetColumns === 0,
    value: legacyMediaAssetColumns,
    details: [
      legacyMediaAssetColumns
        ? 'Legacy media_assets columns still exist in DB but not in Prisma schema.'
        : 'No legacy media_assets column drift detected.',
    ],
    recommendation:
      'Drop legacy columns in a dedicated migration once you confirm no rollback path depends on them.',
  });

  const legacySnapshotColumns = await countQuery(
    "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'client_profile_snapshots' AND column_name = 'last_media_download_queued_at') OR (table_name = 'competitor_profile_snapshots' AND column_name = 'last_media_download_queued_at'))"
  );
  checks.push({
    id: 'legacy_snapshot_columns',
    title: 'Legacy snapshot queue timestamp columns remain as non-blocking schema drift',
    severity: 'MEDIUM',
    passed: legacySnapshotColumns === 0,
    value: legacySnapshotColumns,
    details: [
      legacySnapshotColumns
        ? 'Legacy *_profile_snapshots.last_media_download_queued_at columns still exist in DB.'
        : 'No legacy snapshot queue column drift detected.',
    ],
    recommendation:
      'Drop these legacy columns in a cleanup migration when data retention requirements are confirmed.',
  });

  const reportPath = path.resolve(repoRoot(), 'docs', 'baselines', 'db-architecture-audit.md');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    toMd(checks, {
      database: process.env.DATABASE_URL ? 'configured' : 'missing',
      migrationDirs: migrations.length,
      appliedMigrations: appliedSet.size,
    }),
    'utf8'
  );

  const failedCritical = checks.filter((c) => !c.passed && c.severity === 'CRITICAL').length;
  const failedHigh = checks.filter((c) => !c.passed && c.severity === 'HIGH').length;
  console.log(`[DB Architecture Audit] Report written: ${reportPath}`);
  console.log(
    `[DB Architecture Audit] Result: failed=${checks.filter((c) => !c.passed).length}, critical=${failedCritical}, high=${failedHigh}`
  );
}

run()
  .catch((error) => {
    console.error('[DB Architecture Audit] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
