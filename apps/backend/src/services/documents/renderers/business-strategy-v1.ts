import type { DocumentDataPayload } from '../document-spec';
import type { DocumentSpecV1 } from '../document-spec-schema';
import type { DraftedDocumentSection } from '../section-drafter';

function findSection(sections: DraftedDocumentSection[], kind: DraftedDocumentSection['kind']): string {
  return sections.find((section) => section.kind === kind)?.contentMd || '- Not available.';
}

export function renderBusinessStrategyV1(input: {
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
          '> Partial draft notice: this document returned best-available depth. Use \"Continue deepening document\" to enrich missing evidence lanes.',
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
    '| Signal | Captured | Target |',
    '| --- | ---: | ---: |',
    `| Competitors | ${input.payload.coverage.counts.competitors} | ${input.payload.coverage.targets.competitors} |`,
    `| Social posts | ${input.payload.coverage.counts.posts} | ${input.payload.coverage.targets.posts} |`,
    `| Web snapshots | ${input.payload.coverage.counts.webSnapshots} | ${input.payload.coverage.targets.webSnapshots} |`,
    `| News items | ${input.payload.coverage.counts.news} | ${input.payload.coverage.targets.news} |`,
    `| Community insights | ${input.payload.coverage.counts.community} | ${input.payload.coverage.targets.community} |`,
    '',
    '## Market Context',
    findSection(input.sections, 'market_context'),
    '',
    '## Competitor Deep Dives',
    findSection(input.sections, 'competitor_deep_dive'),
    '',
    '## Content Signal Analysis',
    findSection(input.sections, 'signal_analysis'),
    '',
    '## Strategic Implications',
    findSection(input.sections, 'positioning'),
    '',
    '## Offer Stack',
    findSection(input.sections, 'offer_stack'),
    '',
    '## Channel Plan',
    findSection(input.sections, 'channel_plan'),
    '',
    '## KPI Block',
    findSection(input.sections, 'kpi_block'),
    '',
    '## 30/60/90 Action Plan',
    findSection(input.sections, 'roadmap_30_60_90'),
    '',
    '## Risk Register',
    findSection(input.sections, 'risk_register'),
    '',
    '## Evidence Gaps And Next Research Actions',
    findSection(input.sections, 'evidence_gaps'),
    '',
    '## Source Ledger',
    findSection(input.sections, 'source_ledger'),
  ].join('\n');
}
