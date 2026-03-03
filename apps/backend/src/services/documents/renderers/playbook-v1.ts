import type { DocumentDataPayload } from '../document-spec';
import type { DocumentSpecV1 } from '../document-spec-schema';
import type { DraftedDocumentSection } from '../section-drafter';

function findSection(sections: DraftedDocumentSection[], kind: DraftedDocumentSection['kind']): string {
  return sections.find((section) => section.kind === kind)?.contentMd || '- Not available.';
}

export function renderPlaybookV1(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  sections: DraftedDocumentSection[];
}): string {
  return [
    `# ${input.spec.title}`,
    '',
    `Generated: ${input.payload.generatedAt}`,
    '',
    '## Playbook Summary',
    findSection(input.sections, 'executive_summary'),
    '',
    '## Channel Plan',
    findSection(input.sections, 'channel_plan'),
    '',
    '## Weekly Cadence',
    findSection(input.sections, 'playbook_cadence'),
    '',
    '## KPI Block',
    findSection(input.sections, 'kpi_block'),
    '',
    '## 30/60/90 Plan',
    findSection(input.sections, 'roadmap_30_60_90'),
    '',
    '## Risk Register',
    findSection(input.sections, 'risk_register'),
    '',
    '## Source Ledger',
    findSection(input.sections, 'source_ledger'),
    '',
    `Data quality and confidence: ${input.payload.coverage.overallScore}/100 (${input.payload.coverage.band}).`,
  ].join('\n');
}
