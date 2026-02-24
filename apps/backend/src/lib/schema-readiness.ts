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
  'raw_search_results',
  'ddg_news_results',
  'ddg_video_results',
  'ddg_image_results',
  'search_trends',
  'ai_questions',
  'client_accounts',
  'media_assets',
  'web_sources',
  'web_page_snapshots',
  'web_extraction_recipes',
  'web_extraction_runs',
  'adaptive_selector_memory',
  // BAT Brain collaboration surfaces
  'brain_profile_suggestions',
  // Workspace chat
  'chat_sessions',
  'chat_messages',
  'chat_block_events',
  'chat_saved_blocks',
  'client_intake_answers',
  'screenshot_attachments',
  'strategy_doc_chat_sessions',
  'strategy_doc_chat_messages',
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
    'is_active',
    'archived_at',
    'archived_by',
    'updated_at',
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
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  community_insights: [
    'brand_intelligence_run_id',
    'source_query',
    'evidence',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  raw_search_results: [
    'research_job_id',
    'href',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  ddg_news_results: [
    'research_job_id',
    'url',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  ddg_video_results: [
    'research_job_id',
    'url',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  ddg_image_results: [
    'research_job_id',
    'image_url',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  search_trends: [
    'research_job_id',
    'keyword',
    'region',
    'timeframe',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  ai_questions: [
    'research_job_id',
    'question_type',
    'question',
    'is_answered',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  client_accounts: [
    'client_id',
    'platform',
    'handle',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  media_assets: [
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  web_sources: [
    'research_job_id',
    'url',
    'domain',
    'source_type',
    'discovered_by',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  web_page_snapshots: [
    'research_job_id',
    'web_source_id',
    'fetched_at',
    'fetcher_used',
    'status_code',
    'content_hash',
    'html_path',
    'text_path',
    'clean_text',
    'metadata',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  web_extraction_recipes: [
    'research_job_id',
    'name',
    'target_domain',
    'schema',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  web_extraction_runs: [
    'research_job_id',
    'recipe_id',
    'snapshot_id',
    'extracted',
    'confidence',
    'warnings',
    'is_active',
    'archived_at',
    'archived_by',
    'manually_modified',
    'last_modified_at',
    'last_modified_by',
    'updated_at',
  ],
  adaptive_selector_memory: [
    'research_job_id',
    'namespace',
    'key',
    'element_json',
    'created_at',
    'updated_at',
  ],
  brain_profile_suggestions: ['client_id', 'field', 'proposed_value', 'status'],
  chat_sessions: ['research_job_id', 'title', 'created_at', 'updated_at', 'last_active_at'],
  chat_messages: ['session_id', 'role', 'content', 'blocks', 'design_options', 'created_at'],
  chat_block_events: ['session_id', 'message_id', 'block_id', 'event_type', 'created_at'],
  chat_saved_blocks: ['session_id', 'block_id', 'message_id', 'block_data', 'created_at'],
  client_intake_answers: ['research_job_id', 'question_set_id', 'question_key', 'answer_type', 'answer', 'created_at'],
  screenshot_attachments: ['research_job_id', 'storage_path', 'mime_type', 'is_app_screenshot', 'created_at'],
  strategy_doc_chat_sessions: ['research_job_id', 'scope', 'status', 'last_message_at'],
  strategy_doc_chat_messages: ['session_id', 'role', 'content', 'created_at'],
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
