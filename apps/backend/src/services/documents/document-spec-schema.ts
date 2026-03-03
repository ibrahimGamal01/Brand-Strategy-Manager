import type { DocumentSectionKind } from './business-archetypes';
import type { BusinessArchetype, DocFamily } from './document-spec';

export type DocumentSpecSection = {
  id: string;
  kind: DocumentSectionKind;
  title: string;
  requirements: string[];
  evidenceRefIds: string[];
};

export type DocumentSpecV1 = {
  version: 'v1';
  docFamily: DocFamily;
  title: string;
  audience: 'internal' | 'client' | 'board';
  businessArchetype: BusinessArchetype;
  depth: 'short' | 'standard' | 'deep';
  requestedIntent?: string;
  renderedIntent?: string;
  styleProfile: string;
  sections: DocumentSpecSection[];
};

export type DocumentSpecValidationResult = {
  valid: boolean;
  errors: string[];
  value: DocumentSpecV1 | null;
};

const ALLOWED_DOC_FAMILIES = new Set<DocFamily>([
  'SWOT',
  'BUSINESS_STRATEGY',
  'PLAYBOOK',
  'COMPETITOR_AUDIT',
  'CONTENT_CALENDAR',
  'GO_TO_MARKET',
]);
const ALLOWED_ARCHETYPES = new Set<BusinessArchetype>([
  'b2b_saas',
  'ecommerce',
  'wellness',
  'financial_services',
  'professional_services',
  'generic',
]);
const ALLOWED_AUDIENCES = new Set(['internal', 'client', 'board']);
const ALLOWED_DEPTH = new Set(['short', 'standard', 'deep']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeSection(value: unknown, index: number): DocumentSpecSection | null {
  if (!isRecord(value)) return null;
  const id = String(value.id || `section-${index + 1}`).trim();
  const kind = String(value.kind || '').trim() as DocumentSectionKind;
  const title = String(value.title || '').trim();
  if (!id || !kind || !title) return null;
  return {
    id,
    kind,
    title,
    requirements: asStringArray(value.requirements, 12),
    evidenceRefIds: asStringArray(value.evidenceRefIds, 40),
  };
}

export const DOCUMENT_SPEC_V1_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'docFamily', 'title', 'audience', 'businessArchetype', 'depth', 'styleProfile', 'sections'],
  properties: {
    version: { const: 'v1' },
    docFamily: {
      type: 'string',
      enum: ['SWOT', 'BUSINESS_STRATEGY', 'PLAYBOOK', 'COMPETITOR_AUDIT', 'CONTENT_CALENDAR', 'GO_TO_MARKET'],
    },
    title: { type: 'string', minLength: 2, maxLength: 180 },
    audience: { type: 'string', enum: ['internal', 'client', 'board'] },
    businessArchetype: {
      type: 'string',
      enum: ['b2b_saas', 'ecommerce', 'wellness', 'financial_services', 'professional_services', 'generic'],
    },
    depth: { type: 'string', enum: ['short', 'standard', 'deep'] },
    requestedIntent: { type: 'string' },
    renderedIntent: { type: 'string' },
    styleProfile: { type: 'string', minLength: 2, maxLength: 120 },
    sections: {
      type: 'array',
      minItems: 3,
      maxItems: 32,
      items: {
        type: 'object',
        required: ['id', 'kind', 'title', 'requirements', 'evidenceRefIds'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 2, maxLength: 120 },
          kind: { type: 'string', minLength: 2, maxLength: 80 },
          title: { type: 'string', minLength: 2, maxLength: 180 },
          requirements: { type: 'array', items: { type: 'string' } },
          evidenceRefIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export function validateDocumentSpecV1(input: unknown): DocumentSpecValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { valid: false, errors: ['DocumentSpec must be an object.'], value: null };
  }

  const version = String(input.version || '').trim();
  if (version !== 'v1') {
    errors.push('version must be v1.');
  }

  const docFamily = String(input.docFamily || '').trim() as DocFamily;
  if (!ALLOWED_DOC_FAMILIES.has(docFamily)) {
    errors.push(`Unsupported docFamily: ${docFamily || 'empty'}.`);
  }

  const title = String(input.title || '').trim();
  if (title.length < 2) {
    errors.push('title is required.');
  }

  const audience = String(input.audience || '').trim().toLowerCase();
  if (!ALLOWED_AUDIENCES.has(audience)) {
    errors.push(`Invalid audience: ${audience || 'empty'}.`);
  }

  const businessArchetype = String(input.businessArchetype || '').trim() as BusinessArchetype;
  if (!ALLOWED_ARCHETYPES.has(businessArchetype)) {
    errors.push(`Invalid businessArchetype: ${businessArchetype || 'empty'}.`);
  }

  const depth = String(input.depth || '').trim().toLowerCase();
  if (!ALLOWED_DEPTH.has(depth)) {
    errors.push(`Invalid depth: ${depth || 'empty'}.`);
  }

  const styleProfile = String(input.styleProfile || '').trim();
  if (styleProfile.length < 2) {
    errors.push('styleProfile is required.');
  }

  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const sections = rawSections
    .map((section, index) => normalizeSection(section, index))
    .filter((section): section is DocumentSpecSection => Boolean(section))
    .slice(0, 32);

  const minSectionsByFamily: Record<DocFamily, number> = {
    SWOT: 7,
    BUSINESS_STRATEGY: 10,
    PLAYBOOK: 7,
    COMPETITOR_AUDIT: 8,
    CONTENT_CALENDAR: 6,
    GO_TO_MARKET: 9,
  };
  const minSections = minSectionsByFamily[docFamily] ?? 3;
  if (sections.length < minSections) {
    errors.push(`At least ${minSections} sections are required for ${docFamily}.`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: {
      version: 'v1',
      docFamily,
      title,
      audience: audience as DocumentSpecV1['audience'],
      businessArchetype,
      depth: depth as DocumentSpecV1['depth'],
      requestedIntent: String(input.requestedIntent || '').trim() || undefined,
      renderedIntent: String(input.renderedIntent || '').trim() || undefined,
      styleProfile,
      sections,
    },
  };
}

export function repairDocumentSpecV1(input: unknown): DocumentSpecV1 {
  const record = isRecord(input) ? input : {};
  const requestedFamily = String(record.docFamily || '').trim() as DocFamily;
  const fallbackFamily: DocFamily = ALLOWED_DOC_FAMILIES.has(requestedFamily) ? requestedFamily : 'BUSINESS_STRATEGY';
  const fallbackStyleProfileByFamily: Record<DocFamily, string> = {
    SWOT: 'swot_standard_v1',
    BUSINESS_STRATEGY: 'strategy_standard_generic_v1',
    PLAYBOOK: 'playbook_standard_v1',
    COMPETITOR_AUDIT: 'competitor_audit_v1',
    CONTENT_CALENDAR: 'content_calendar_v1',
    GO_TO_MARKET: 'go_to_market_v1',
  };
  const fallbackSectionsByFamily: Record<DocFamily, DocumentSpecSection[]> = {
    SWOT: [
      { id: 'executive-summary', kind: 'executive_summary', title: 'Executive Summary', requirements: ['Summarize objective and confidence.'], evidenceRefIds: [] },
      { id: 'swot-matrix', kind: 'swot_matrix', title: 'SWOT Matrix', requirements: ['Provide a 2x2 SWOT matrix.'], evidenceRefIds: [] },
      { id: 'swot-implications', kind: 'swot_implications', title: 'Strategic Implications', requirements: ['Translate SWOT into implications.'], evidenceRefIds: [] },
      { id: 'market-context', kind: 'market_context', title: 'Market Context', requirements: ['Capture key market signals.'], evidenceRefIds: [] },
      { id: 'signal-analysis', kind: 'signal_analysis', title: 'Signal Analysis', requirements: ['Summarize strongest audience signals.'], evidenceRefIds: [] },
      { id: 'roadmap', kind: 'roadmap_30_60_90', title: '30/60/90 Plan', requirements: ['Define phased actions.'], evidenceRefIds: [] },
      { id: 'risk-register', kind: 'risk_register', title: 'Risk Register', requirements: ['List top execution risks.'], evidenceRefIds: [] },
      { id: 'evidence-gaps', kind: 'evidence_gaps', title: 'Evidence Gaps', requirements: ['Declare missing evidence.'], evidenceRefIds: [] },
      { id: 'source-ledger', kind: 'source_ledger', title: 'Source Ledger', requirements: ['List auditable sources.'], evidenceRefIds: [] },
    ],
    BUSINESS_STRATEGY: [
      { id: 'executive-summary', kind: 'executive_summary', title: 'Executive Summary', requirements: ['Summarize objective and confidence.'], evidenceRefIds: [] },
      { id: 'market-context', kind: 'market_context', title: 'Market Context', requirements: ['Capture macro and category context.'], evidenceRefIds: [] },
      { id: 'competitor-deep-dive', kind: 'competitor_deep_dive', title: 'Competitor Deep Dives', requirements: ['Describe direct/adjacent competitors.'], evidenceRefIds: [] },
      { id: 'signal-analysis', kind: 'signal_analysis', title: 'Signal Analysis', requirements: ['Summarize audience/content signals.'], evidenceRefIds: [] },
      { id: 'positioning', kind: 'positioning', title: 'Positioning', requirements: ['Define positioning hypothesis.'], evidenceRefIds: [] },
      { id: 'offer-stack', kind: 'offer_stack', title: 'Offer Stack', requirements: ['Recommend offer architecture.'], evidenceRefIds: [] },
      { id: 'channel-plan', kind: 'channel_plan', title: 'Channel Plan', requirements: ['Map channels and tactics.'], evidenceRefIds: [] },
      { id: 'kpi-block', kind: 'kpi_block', title: 'KPI Block', requirements: ['Define KPI tree and owners.'], evidenceRefIds: [] },
      { id: 'roadmap', kind: 'roadmap_30_60_90', title: '30/60/90 Plan', requirements: ['Define phased actions.'], evidenceRefIds: [] },
      { id: 'risk-register', kind: 'risk_register', title: 'Risk Register', requirements: ['List top execution risks.'], evidenceRefIds: [] },
      { id: 'evidence-gaps', kind: 'evidence_gaps', title: 'Evidence Gaps', requirements: ['Declare missing evidence.'], evidenceRefIds: [] },
      { id: 'source-ledger', kind: 'source_ledger', title: 'Source Ledger', requirements: ['List auditable sources.'], evidenceRefIds: [] },
    ],
    PLAYBOOK: [
      { id: 'playbook-summary', kind: 'executive_summary', title: 'Playbook Summary', requirements: ['Summarize outcome and audience.'], evidenceRefIds: [] },
      { id: 'channel-plan', kind: 'channel_plan', title: 'Channel Plan', requirements: ['Map execution channels.'], evidenceRefIds: [] },
      { id: 'playbook-cadence', kind: 'playbook_cadence', title: 'Weekly Cadence', requirements: ['Define weekly execution rhythm.'], evidenceRefIds: [] },
      { id: 'signal-analysis', kind: 'signal_analysis', title: 'Signal Analysis', requirements: ['Use strongest existing signals.'], evidenceRefIds: [] },
      { id: 'kpi-block', kind: 'kpi_block', title: 'KPI Block', requirements: ['Define KPIs and owners.'], evidenceRefIds: [] },
      { id: 'roadmap', kind: 'roadmap_30_60_90', title: '30/60/90 Plan', requirements: ['Define phased actions.'], evidenceRefIds: [] },
      { id: 'risk-register', kind: 'risk_register', title: 'Risk Register', requirements: ['List top execution risks.'], evidenceRefIds: [] },
      { id: 'source-ledger', kind: 'source_ledger', title: 'Source Ledger', requirements: ['List auditable sources.'], evidenceRefIds: [] },
    ],
    COMPETITOR_AUDIT: [
      { id: 'executive-summary', kind: 'executive_summary', title: 'Executive Summary', requirements: ['Summarize competitor landscape.'], evidenceRefIds: [] },
      { id: 'market-map', kind: 'competitor_market_map', title: 'Competitor Market Map', requirements: ['Map major competitors.'], evidenceRefIds: [] },
      { id: 'comparison-table', kind: 'competitor_comparison_table', title: 'Comparison Table', requirements: ['Compare top competitors.'], evidenceRefIds: [] },
      { id: 'battlecards', kind: 'competitor_battlecards', title: 'Battlecards', requirements: ['Provide battlecards and counters.'], evidenceRefIds: [] },
      { id: 'signal-delta', kind: 'signal_delta_analysis', title: 'Signal Delta Analysis', requirements: ['Explain momentum deltas.'], evidenceRefIds: [] },
      { id: 'signal-analysis', kind: 'signal_analysis', title: 'Signal Analysis', requirements: ['Summarize high-signal examples.'], evidenceRefIds: [] },
      { id: 'kpi-watchlist', kind: 'kpi_block', title: 'KPI Watchlist', requirements: ['Define KPI watchlist.'], evidenceRefIds: [] },
      { id: 'risk-register', kind: 'risk_register', title: 'Risk Register', requirements: ['List audit risks.'], evidenceRefIds: [] },
      { id: 'source-ledger', kind: 'source_ledger', title: 'Source Ledger', requirements: ['List auditable sources.'], evidenceRefIds: [] },
    ],
    CONTENT_CALENDAR: [
      { id: 'calendar-summary', kind: 'executive_summary', title: 'Calendar Summary', requirements: ['Summarize objective and audience.'], evidenceRefIds: [] },
      { id: 'cadence-assumptions', kind: 'cadence_assumptions', title: 'Cadence Assumptions', requirements: ['Set cadence assumptions.'], evidenceRefIds: [] },
      { id: 'calendar-slots', kind: 'content_calendar_slots', title: 'Weekly Calendar', requirements: ['Provide dated slots.'], evidenceRefIds: [] },
      { id: 'pillar-matrix', kind: 'channel_pillar_matrix', title: 'Channel/Pillar Matrix', requirements: ['Map channels to pillars.'], evidenceRefIds: [] },
      { id: 'signal-analysis', kind: 'signal_analysis', title: 'Signal Analysis', requirements: ['Use strongest signal patterns.'], evidenceRefIds: [] },
      { id: 'kpi-plan', kind: 'kpi_block', title: 'KPI Plan', requirements: ['Define KPI plan.'], evidenceRefIds: [] },
      { id: 'risk-register', kind: 'risk_register', title: 'Risk Register', requirements: ['List execution risks.'], evidenceRefIds: [] },
      { id: 'source-ledger', kind: 'source_ledger', title: 'Source Ledger', requirements: ['List auditable sources.'], evidenceRefIds: [] },
    ],
    GO_TO_MARKET: [
      { id: 'executive-summary', kind: 'executive_summary', title: 'Executive Summary', requirements: ['Summarize launch objective.'], evidenceRefIds: [] },
      { id: 'market-context', kind: 'market_context', title: 'Market Context', requirements: ['Capture market and category context.'], evidenceRefIds: [] },
      { id: 'icp-definition', kind: 'icp_definition', title: 'ICP Definition', requirements: ['Define ICP segments.'], evidenceRefIds: [] },
      { id: 'positioning', kind: 'positioning', title: 'Positioning', requirements: ['Define positioning strategy.'], evidenceRefIds: [] },
      { id: 'messaging-house', kind: 'messaging_house', title: 'Messaging House', requirements: ['Define messaging layers.'], evidenceRefIds: [] },
      { id: 'channel-strategy', kind: 'channel_plan', title: 'Channel Strategy', requirements: ['Define launch channels.'], evidenceRefIds: [] },
      { id: 'launch-phases', kind: 'launch_phases', title: 'Launch Phases', requirements: ['Define phased launch.'], evidenceRefIds: [] },
      { id: 'budget-kpi-tree', kind: 'budget_kpi_tree', title: 'Budget And KPI Tree', requirements: ['Define budget and KPI tree.'], evidenceRefIds: [] },
      { id: 'roadmap', kind: 'roadmap_30_60_90', title: '30/60/90 Plan', requirements: ['Define phased actions.'], evidenceRefIds: [] },
      { id: 'risk-register', kind: 'risk_register', title: 'Risk Register', requirements: ['List GTM risks.'], evidenceRefIds: [] },
      { id: 'source-ledger', kind: 'source_ledger', title: 'Source Ledger', requirements: ['List auditable sources.'], evidenceRefIds: [] },
    ],
  };
  const fallback: DocumentSpecV1 = {
    version: 'v1',
    docFamily: fallbackFamily,
    title: 'Generated Document',
    audience: 'client',
    businessArchetype: 'generic',
    depth: 'deep',
    styleProfile: fallbackStyleProfileByFamily[fallbackFamily],
    sections: fallbackSectionsByFamily[fallbackFamily],
  };

  const candidate = {
    version: 'v1',
    docFamily: String(record.docFamily || fallback.docFamily).trim(),
    title: String(record.title || fallback.title).trim(),
    audience: String(record.audience || fallback.audience).trim().toLowerCase(),
    businessArchetype: String(record.businessArchetype || fallback.businessArchetype).trim(),
    depth: String(record.depth || fallback.depth).trim().toLowerCase(),
    requestedIntent: String(record.requestedIntent || '').trim() || undefined,
    renderedIntent: String(record.renderedIntent || '').trim() || undefined,
    styleProfile: String(record.styleProfile || fallback.styleProfile).trim(),
    sections: Array.isArray(record.sections) ? record.sections : fallback.sections,
  };

  const validation = validateDocumentSpecV1(candidate);
  if (validation.valid && validation.value) {
    return validation.value;
  }
  return fallback;
}
