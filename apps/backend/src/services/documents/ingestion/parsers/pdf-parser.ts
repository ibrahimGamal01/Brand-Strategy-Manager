import pdf from 'pdf-parse';
import type { DocumentParseResult } from '../types';

export async function parsePdfDocument(input: {
  buffer: Buffer;
}): Promise<DocumentParseResult> {
  const data = await pdf(input.buffer);
  const text = String(data.text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const pages = Number(data.numpages || 0);

  return {
    parser: 'pdf',
    text,
    sections: [
      {
        headingPath: 'PDF Document',
        text,
      },
    ],
    warnings: [],
    pagesTotal: pages > 0 ? pages : undefined,
    pagesParsed: pages > 0 ? pages : undefined,
    needsReview: !text || text.length < 180,
  };
}
