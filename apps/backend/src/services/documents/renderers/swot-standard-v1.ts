import type { DocumentDataPayload } from '../document-spec';
import type { DocumentSpecV1 } from '../document-spec-schema';
import type { DraftedDocumentSection } from '../section-drafter';

function sectionMap(sections: DraftedDocumentSection[]): Record<string, DraftedDocumentSection> {
  const map: Record<string, DraftedDocumentSection> = {};
  for (const section of sections) {
    map[section.kind] = section;
  }
  return map;
}

export function renderSwotStandardV1(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  sections: DraftedDocumentSection[];
}): string {
  const byKind = sectionMap(input.sections);
  const matrix = byKind.swot_matrix?.contentMd || '| Strengths | Weaknesses |\n| --- | --- |\n| Insufficient evidence | Insufficient evidence |';

  return [
    `# ${input.spec.title}`,
    '',
    `Generated: ${input.payload.generatedAt}`,
    '',
    ...(input.payload.coverage.partial
      ? [
          '> Partial draft notice: SWOT produced with best-available evidence. Continue deepening to increase confidence before external distribution.',
          '',
        ]
      : []),
    '## Executive Summary',
    byKind.executive_summary?.contentMd || '- Summary unavailable.',
    '',
    '## Data Quality And Confidence',
    `- Coverage score: **${input.payload.coverage.overallScore}/100** (${input.payload.coverage.band}).`,
    `- Quantity score: **${input.payload.coverage.quantityScore}/100**.`,
    `- Relevance score: **${input.payload.coverage.relevanceScore}/100**.`,
    `- Freshness score: **${input.payload.coverage.freshnessScore}/100**.`,
    ...(input.payload.coverage.partialReasons.length
      ? [
          '',
          '### Partial Reasons',
          ...input.payload.coverage.partialReasons.map((reason) => `- ${reason}`),
        ]
      : []),
    '',
    '## SWOT Matrix',
    matrix,
    '',
    '## Evidence-Tagged Quadrants',
    byKind.swot_matrix?.contentMd || '- Quadrants unavailable.',
    '',
    '## Prioritized Strategic Implications (Top 5)',
    byKind.swot_implications?.contentMd || '- Implications unavailable.',
    '',
    '## 30/60/90 Action Plan',
    byKind.roadmap_30_60_90?.contentMd || '- Plan unavailable.',
    '',
    '## Risk Register',
    byKind.risk_register?.contentMd || '- Risks unavailable.',
    '',
    '## Evidence Gaps',
    byKind.evidence_gaps?.contentMd || '- Gaps unavailable.',
    '',
    '## Source Ledger',
    byKind.source_ledger?.contentMd || '- Source ledger unavailable.',
    '',
    `Evidence coverage: ${input.payload.coverage.overallScore}/100 (${input.payload.coverage.band}).`,
  ].join('\n');
}
