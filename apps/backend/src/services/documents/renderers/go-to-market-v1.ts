import type { DocumentDataPayload } from '../document-spec';
import type { DocumentSpecV1 } from '../document-spec-schema';
import type { DraftedDocumentSection } from '../section-drafter';

function findSection(sections: DraftedDocumentSection[], kind: DraftedDocumentSection['kind']): string {
  return sections.find((section) => section.kind === kind)?.contentMd || '- Not available.';
}

export function renderGoToMarketV1(input: {
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
          '> Partial draft notice: GTM plan returned best-available coverage. Continue deepening for higher confidence.',
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
    '## ICP Definition',
    findSection(input.sections, 'icp_definition'),
    '',
    '## Positioning',
    findSection(input.sections, 'positioning'),
    '',
    '## Messaging House',
    findSection(input.sections, 'messaging_house'),
    '',
    '## Channel Strategy',
    findSection(input.sections, 'channel_plan'),
    '',
    '## Launch Phases',
    findSection(input.sections, 'launch_phases'),
    '',
    '## Budget And KPI Tree',
    findSection(input.sections, 'budget_kpi_tree'),
    '',
    '## Risk Register',
    findSection(input.sections, 'risk_register'),
    '',
    '## Source Ledger',
    findSection(input.sections, 'source_ledger'),
  ].join('\n');
}
