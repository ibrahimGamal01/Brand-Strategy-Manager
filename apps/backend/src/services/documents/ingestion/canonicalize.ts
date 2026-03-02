import type { CanonicalDocument, DocumentParseResult } from './types';

function normalizeHeading(value: string): string {
  const trimmed = String(value || '').replace(/\s+/g, ' ').trim();
  return trimmed || 'Section';
}

export function toCanonicalMarkdown(result: DocumentParseResult): CanonicalDocument {
  const sections = result.sections.length
    ? result.sections
    : [
        {
          headingPath: 'Document',
          text: result.text,
        },
      ];

  let offset = 0;
  const sectionMap: CanonicalDocument['sectionMap'] = [];
  const chunks: string[] = [];

  for (const section of sections) {
    const heading = normalizeHeading(section.headingPath);
    const block = [`## ${heading}`, section.text.trim()].filter(Boolean).join('\n\n').trim();
    const startOffset = offset;
    chunks.push(block);
    offset += block.length;
    sectionMap.push({
      headingPath: heading,
      startOffset,
      endOffset: offset,
    });
    offset += 2;
  }

  const markdown = chunks.join('\n\n').trim();
  return { markdown, sectionMap };
}
