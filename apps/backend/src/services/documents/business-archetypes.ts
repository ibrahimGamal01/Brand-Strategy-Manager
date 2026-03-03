import type { BusinessArchetype, DocFamily } from './document-spec';

export type DocumentSectionKind =
  | 'executive_summary'
  | 'market_context'
  | 'swot_matrix'
  | 'swot_implications'
  | 'competitor_deep_dive'
  | 'competitor_market_map'
  | 'competitor_comparison_table'
  | 'competitor_battlecards'
  | 'signal_delta_analysis'
  | 'signal_analysis'
  | 'content_calendar_slots'
  | 'channel_pillar_matrix'
  | 'cadence_assumptions'
  | 'positioning'
  | 'offer_stack'
  | 'channel_plan'
  | 'icp_definition'
  | 'messaging_house'
  | 'launch_phases'
  | 'budget_kpi_tree'
  | 'kpi_block'
  | 'roadmap_30_60_90'
  | 'risk_register'
  | 'evidence_gaps'
  | 'source_ledger'
  | 'playbook_cadence';

export type ArchetypeSectionBlueprint = {
  kind: DocumentSectionKind;
  title: string;
  requiredEvidenceLane?: 'competitors' | 'posts' | 'web' | 'news' | 'community';
  minEvidenceRefs?: number;
};

export type ArchetypeProfile = {
  archetype: BusinessArchetype;
  requiredSections: ArchetypeSectionBlueprint[];
};

const STRATEGY_BASE_SECTIONS: ArchetypeSectionBlueprint[] = [
  { kind: 'executive_summary', title: 'Executive Summary', minEvidenceRefs: 2 },
  { kind: 'market_context', title: 'Market Context', requiredEvidenceLane: 'web', minEvidenceRefs: 2 },
  { kind: 'competitor_deep_dive', title: 'Competitor Deep Dives', requiredEvidenceLane: 'competitors', minEvidenceRefs: 3 },
  { kind: 'signal_analysis', title: 'Signal Analysis', requiredEvidenceLane: 'posts', minEvidenceRefs: 3 },
  { kind: 'positioning', title: 'Positioning', minEvidenceRefs: 2 },
  { kind: 'channel_plan', title: 'Channel Plan', minEvidenceRefs: 2 },
  { kind: 'kpi_block', title: 'KPI Block', minEvidenceRefs: 1 },
  { kind: 'roadmap_30_60_90', title: '30/60/90 Plan', minEvidenceRefs: 1 },
  { kind: 'risk_register', title: 'Risk Register', minEvidenceRefs: 1 },
  { kind: 'evidence_gaps', title: 'Evidence Gaps', minEvidenceRefs: 1 },
  { kind: 'source_ledger', title: 'Source Ledger', minEvidenceRefs: 2 },
];

const ARCHETYPE_PROFILES: Record<BusinessArchetype, ArchetypeProfile> = {
  b2b_saas: {
    archetype: 'b2b_saas',
    requiredSections: [
      ...STRATEGY_BASE_SECTIONS,
      { kind: 'offer_stack', title: 'Offer Stack', minEvidenceRefs: 1 },
    ],
  },
  ecommerce: {
    archetype: 'ecommerce',
    requiredSections: [
      ...STRATEGY_BASE_SECTIONS,
      { kind: 'offer_stack', title: 'Merchandising + Offer Stack', minEvidenceRefs: 1 },
    ],
  },
  wellness: {
    archetype: 'wellness',
    requiredSections: [
      ...STRATEGY_BASE_SECTIONS,
      { kind: 'offer_stack', title: 'Offer Ladder And Trust Guardrails', minEvidenceRefs: 1 },
    ],
  },
  financial_services: {
    archetype: 'financial_services',
    requiredSections: [
      ...STRATEGY_BASE_SECTIONS,
      { kind: 'offer_stack', title: 'Offer Architecture + Compliance Notes', minEvidenceRefs: 1 },
    ],
  },
  professional_services: {
    archetype: 'professional_services',
    requiredSections: [
      ...STRATEGY_BASE_SECTIONS,
      { kind: 'offer_stack', title: 'Expertise Proof + Offer Ladder', minEvidenceRefs: 1 },
    ],
  },
  generic: {
    archetype: 'generic',
    requiredSections: STRATEGY_BASE_SECTIONS,
  },
};

export function inferBusinessArchetype(input: {
  businessType?: string;
  docFamily?: DocFamily;
  userIntent?: string;
}): BusinessArchetype {
  const normalized = `${input.businessType || ''} ${input.userIntent || ''}`.toLowerCase();
  if (/saas|software|b2b/.test(normalized)) return 'b2b_saas';
  if (/ecom|shop|retail|dtc/.test(normalized)) return 'ecommerce';
  if (/wellness|health|coach|healing|yoga|meditation/.test(normalized)) return 'wellness';
  if (/finance|financial|insurance|bank|wealth/.test(normalized)) return 'financial_services';
  if (/agency|consult|service|professional/.test(normalized)) return 'professional_services';
  return 'generic';
}

export function resolveArchetypeProfile(archetype: BusinessArchetype): ArchetypeProfile {
  return ARCHETYPE_PROFILES[archetype] || ARCHETYPE_PROFILES.generic;
}

export function resolveSectionsForDocFamily(input: {
  docFamily: DocFamily;
  archetype: BusinessArchetype;
}): ArchetypeSectionBlueprint[] {
  if (input.docFamily === 'SWOT') {
    return [
      { kind: 'executive_summary', title: 'Executive Summary', minEvidenceRefs: 2 },
      { kind: 'swot_matrix', title: 'SWOT Matrix', minEvidenceRefs: 4 },
      { kind: 'swot_implications', title: 'Strategic Implications', minEvidenceRefs: 2 },
      { kind: 'roadmap_30_60_90', title: '30/60/90 Plan', minEvidenceRefs: 1 },
      { kind: 'risk_register', title: 'Risk Register', minEvidenceRefs: 1 },
      { kind: 'evidence_gaps', title: 'Evidence Gaps', minEvidenceRefs: 1 },
      { kind: 'source_ledger', title: 'Source Ledger', minEvidenceRefs: 2 },
    ];
  }

  if (input.docFamily === 'PLAYBOOK') {
    return [
      { kind: 'executive_summary', title: 'Playbook Summary', minEvidenceRefs: 1 },
      { kind: 'channel_plan', title: 'Channel Plan', minEvidenceRefs: 2 },
      { kind: 'playbook_cadence', title: 'Weekly Cadence', minEvidenceRefs: 1 },
      { kind: 'kpi_block', title: 'KPI Block', minEvidenceRefs: 1 },
      { kind: 'roadmap_30_60_90', title: '30/60/90 Plan', minEvidenceRefs: 1 },
      { kind: 'risk_register', title: 'Risk Register', minEvidenceRefs: 1 },
      { kind: 'source_ledger', title: 'Source Ledger', minEvidenceRefs: 2 },
    ];
  }

  if (input.docFamily === 'COMPETITOR_AUDIT') {
    return [
      { kind: 'executive_summary', title: 'Executive Summary', minEvidenceRefs: 2 },
      { kind: 'competitor_market_map', title: 'Competitor Market Map', requiredEvidenceLane: 'competitors', minEvidenceRefs: 3 },
      { kind: 'competitor_comparison_table', title: 'Comparison Table', requiredEvidenceLane: 'competitors', minEvidenceRefs: 4 },
      { kind: 'competitor_battlecards', title: 'Battlecards', requiredEvidenceLane: 'competitors', minEvidenceRefs: 4 },
      { kind: 'signal_delta_analysis', title: 'Signal Delta Analysis', requiredEvidenceLane: 'posts', minEvidenceRefs: 3 },
      { kind: 'kpi_block', title: 'KPI Watchlist', minEvidenceRefs: 1 },
      { kind: 'risk_register', title: 'Risk Register', minEvidenceRefs: 1 },
      { kind: 'evidence_gaps', title: 'Evidence Gaps', minEvidenceRefs: 1 },
      { kind: 'source_ledger', title: 'Source Ledger', minEvidenceRefs: 2 },
    ];
  }

  if (input.docFamily === 'CONTENT_CALENDAR') {
    return [
      { kind: 'executive_summary', title: 'Calendar Summary', minEvidenceRefs: 1 },
      { kind: 'cadence_assumptions', title: 'Cadence Assumptions', requiredEvidenceLane: 'posts', minEvidenceRefs: 2 },
      { kind: 'content_calendar_slots', title: 'Weekly Calendar', requiredEvidenceLane: 'posts', minEvidenceRefs: 3 },
      { kind: 'channel_pillar_matrix', title: 'Channel/Pillar Matrix', requiredEvidenceLane: 'posts', minEvidenceRefs: 2 },
      { kind: 'kpi_block', title: 'KPI Plan', minEvidenceRefs: 1 },
      { kind: 'risk_register', title: 'Risk Register', minEvidenceRefs: 1 },
      { kind: 'source_ledger', title: 'Source Ledger', minEvidenceRefs: 2 },
    ];
  }

  if (input.docFamily === 'GO_TO_MARKET') {
    return [
      { kind: 'executive_summary', title: 'Executive Summary', minEvidenceRefs: 2 },
      { kind: 'icp_definition', title: 'ICP Definition', requiredEvidenceLane: 'community', minEvidenceRefs: 2 },
      { kind: 'positioning', title: 'Positioning', requiredEvidenceLane: 'web', minEvidenceRefs: 2 },
      { kind: 'messaging_house', title: 'Messaging House', requiredEvidenceLane: 'web', minEvidenceRefs: 2 },
      { kind: 'channel_plan', title: 'Channel Strategy', requiredEvidenceLane: 'posts', minEvidenceRefs: 2 },
      { kind: 'launch_phases', title: 'Launch Phases', minEvidenceRefs: 1 },
      { kind: 'budget_kpi_tree', title: 'Budget And KPI Tree', minEvidenceRefs: 1 },
      { kind: 'risk_register', title: 'Risk Register', minEvidenceRefs: 1 },
      { kind: 'source_ledger', title: 'Source Ledger', minEvidenceRefs: 2 },
    ];
  }

  return resolveArchetypeProfile(input.archetype).requiredSections;
}
