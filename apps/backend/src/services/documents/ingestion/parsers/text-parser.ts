import type { DocumentParseResult } from '../types';

function stripHtmlTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function parseTextDocument(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<DocumentParseResult> {
  const mime = String(input.mimeType || '').toLowerCase();
  const raw = input.buffer.toString('utf8');
  const text = mime.includes('html') ? stripHtmlTags(raw) : raw;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    parser: 'text',
    text: normalized,
    sections: [
      {
        headingPath: 'Document',
        text: normalized,
      },
    ],
    warnings: [],
  };
}
