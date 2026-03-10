import type { DocumentDataPayload } from '../document-spec';
import type { DocumentSpecV1 } from '../document-spec-schema';
import type { DraftedDocumentSection } from '../section-drafter';

function findSection(sections: DraftedDocumentSection[], kind: DraftedDocumentSection['kind']): string {
  return sections.find((section) => section.kind === kind)?.contentMd || '- Not available.';
}

export function renderContentCalendarV1(input: {
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
          '> Partial draft notice: content calendar returned best-available evidence set. Continue deepening if you need richer signals.',
          '',
        ]
      : []),
    '## Calendar Summary',
    findSection(input.sections, 'executive_summary'),
    '',
    '## Data Quality And Confidence',
    `- Coverage score: **${input.payload.coverage.overallScore}/100** (${input.payload.coverage.band}).`,
    `- Quantity score: **${input.payload.coverage.quantityScore}/100**.`,
    `- Relevance score: **${input.payload.coverage.relevanceScore}/100**.`,
    `- Freshness score: **${input.payload.coverage.freshnessScore}/100**.`,
    '',
    '## Cadence Assumptions',
    findSection(input.sections, 'cadence_assumptions'),
    '',
    '## Weekly Calendar',
    findSection(input.sections, 'content_calendar_slots'),
    '',
    '## Content Signal Analysis',
    findSection(input.sections, 'signal_analysis'),
    '',
    '## Channel/Pillar Matrix',
    findSection(input.sections, 'channel_pillar_matrix'),
    '',
    '## KPI Plan',
    findSection(input.sections, 'kpi_block'),
    '',
    '## Risk Register',
    findSection(input.sections, 'risk_register'),
    '',
    '## Source Ledger',
    findSection(input.sections, 'source_ledger'),
  ].join('\n');
}
