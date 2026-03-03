import type { DocumentDataPayload } from '../document-spec';
import type { DocumentSpecV1 } from '../document-spec-schema';
import type { DraftedDocumentSection } from '../section-drafter';

function findSection(sections: DraftedDocumentSection[], kind: DraftedDocumentSection['kind']): string {
  return sections.find((section) => section.kind === kind)?.contentMd || '- Not available.';
}

export function renderCompetitorAuditV1(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  sections: DraftedDocumentSection[];
}): string {
  return [
    `# ${input.spec.title}`,
    '',
    `Generated: ${input.payload.generatedAt}`,
    '',
    ...(input.payload.coverage.partial
      ? [
          '> Partial draft notice: competitor audit returned best-available coverage. Continue deepening for higher confidence.',
          '',
        ]
      : []),
    '## Executive Summary',
    findSection(input.sections, 'executive_summary'),
    '',
    '## Data Quality And Confidence',
    `- Coverage score: **${input.payload.coverage.overallScore}/100** (${input.payload.coverage.band}).`,
    `- Quantity score: **${input.payload.coverage.quantityScore}/100**.`,
    `- Relevance score: **${input.payload.coverage.relevanceScore}/100**.`,
    `- Freshness score: **${input.payload.coverage.freshnessScore}/100**.`,
    '',
    '## Competitor Market Map',
    findSection(input.sections, 'competitor_market_map'),
    '',
    '## Comparison Table',
    findSection(input.sections, 'competitor_comparison_table'),
    '',
    '## Battlecards',
    findSection(input.sections, 'competitor_battlecards'),
    '',
    '## Signal Delta Analysis',
    findSection(input.sections, 'signal_delta_analysis'),
    '',
    '## KPI Watchlist',
    findSection(input.sections, 'kpi_block'),
    '',
    '## Risk Register',
    findSection(input.sections, 'risk_register'),
    '',
    '## Evidence Gaps',
    findSection(input.sections, 'evidence_gaps'),
    '',
    '## Source Ledger',
    findSection(input.sections, 'source_ledger'),
  ].join('\n');
}
