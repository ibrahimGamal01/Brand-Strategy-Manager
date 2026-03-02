import mammoth from 'mammoth';
import type { DocumentParseResult } from '../types';

function splitSections(text: string): Array<{ headingPath: string; text: string }> {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return [{ headingPath: 'Document', text: '' }];
  }

  const sections: Array<{ headingPath: string; text: string }> = [];
  let currentHeading = 'Document';
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    sections.push({
      headingPath: currentHeading,
      text: buffer.join('\n').trim(),
    });
    buffer = [];
  };

  for (const line of lines) {
    const isLikelyHeading = line.length <= 120 && /^[A-Z0-9][A-Za-z0-9\s:,'"&()/-]{0,118}$/.test(line);
    if (isLikelyHeading && buffer.length > 0) {
      flush();
      currentHeading = line;
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections.length ? sections : [{ headingPath: 'Document', text: lines.join('\n') }];
}

export async function parseDocxDocument(input: {
  buffer: Buffer;
}): Promise<DocumentParseResult> {
  const result = await mammoth.extractRawText({ buffer: input.buffer });
  const text = String(result.value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const sections = splitSections(text);
  const warnings = Array.isArray(result.messages)
    ? result.messages.map((entry: { message?: unknown }) => String(entry.message || '').trim()).filter(Boolean)
    : [];

  return {
    parser: 'docx',
    text,
    sections,
    warnings,
  };
}
