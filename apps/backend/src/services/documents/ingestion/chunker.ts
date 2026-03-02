import type { DocumentChunk } from './types';

const TARGET_CHARS = 1400;

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 1.3));
}

export function buildDocumentChunks(input: {
  markdown: string;
  sectionMap: Array<{ headingPath: string; startOffset: number; endOffset: number }>;
}): DocumentChunk[] {
  const markdown = String(input.markdown || '').trim();
  if (!markdown) return [];

  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const section of input.sectionMap) {
    const text = markdown.slice(section.startOffset, section.endOffset).trim();
    if (!text) continue;

    if (text.length <= TARGET_CHARS) {
      chunks.push({
        chunkIndex: chunkIndex += 1,
        headingPath: section.headingPath,
        text,
        tokenCount: estimateTokens(text),
      });
      continue;
    }

    const paragraphs = text.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
    let buffer = '';
    for (const paragraph of paragraphs) {
      const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (next.length > TARGET_CHARS && buffer) {
        chunks.push({
          chunkIndex: chunkIndex += 1,
          headingPath: section.headingPath,
          text: buffer,
          tokenCount: estimateTokens(buffer),
        });
        buffer = paragraph;
      } else {
        buffer = next;
      }
    }
    if (buffer) {
      chunks.push({
        chunkIndex: chunkIndex += 1,
        headingPath: section.headingPath,
        text: buffer,
        tokenCount: estimateTokens(buffer),
      });
    }
  }

  return chunks;
}
