import { prisma } from './prisma';

export interface SchemaReadinessReport {
  schemaReady: boolean;
  missingTables: string[];
  missingColumns: Record<string, string[]>;
  checkedAt: string;
}

const REQUIRED_TABLES = [
  'competitor_orchestration_runs',
  'discovered_competitors',
  'competitor_identities',
  'competitor_candidate_profiles',
  'competitor_candidate_evidence',
  'brand_intelligence_runs',
  // Brand intelligence v2 columns live on these core tables
  'brand_mentions',
  'community_insights',
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  discovered_competitors: [
    'orchestration_run_id',
    'candidate_profile_id',
    'availability_status',
    'selection_state',
    'selection_reason',
    'score_breakdown',
    'evidence',
  ],
  competitor_orchestration_runs: ['strategy_version', 'config_snapshot', 'diagnostics'],
  competitor_candidate_profiles: [
    'research_job_id',
    'orchestration_run_id',
    'platform',
    'normalized_handle',
    'availability_status',
    'state',
  ],
  brand_mentions: [
    'brand_intelligence_run_id',
    'availability_status',
    'availability_reason',
    'resolver_confidence',
    'evidence',
  ],
  community_insights: ['brand_intelligence_run_id', 'source_query', 'evidence'],
};

export async function checkSchemaReadiness(): Promise<SchemaReadinessReport> {
  const tableRows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${REQUIRED_TABLES})
  `;
  const existingTableSet = new Set(tableRows.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((tableName) => !existingTableSet.has(tableName));

  const missingColumns: Record<string, string[]> = {};
  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existingTableSet.has(tableName)) {
      missingColumns[tableName] = [...columns];
      continue;
    }

    const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    `;
    const existingColumns = new Set(columnRows.map((row) => row.column_name));
    const missing = columns.filter((column) => !existingColumns.has(column));
    if (missing.length > 0) {
      missingColumns[tableName] = missing;
    }
  }

  return {
    schemaReady: missingTables.length === 0 && Object.keys(missingColumns).length === 0,
    missingTables,
    missingColumns,
    checkedAt: new Date().toISOString(),
  };
}

export function assertSchemaReadiness(report: SchemaReadinessReport): void {
  if (report.schemaReady) return;
  const messages: string[] = [];
  if (report.missingTables.length > 0) {
    messages.push(`missing tables: ${report.missingTables.join(', ')}`);
  }
  const missingColumnsRows = Object.entries(report.missingColumns).map(
    ([table, columns]) => `${table} -> [${columns.join(', ')}]`
  );
  if (missingColumnsRows.length > 0) {
    messages.push(`missing columns: ${missingColumnsRows.join('; ')}`);
  }
  throw new Error(
    `SCHEMA_NOT_MIGRATED: ${messages.join(' | ')}. Run backend migrations before starting the server.`
  );
}
