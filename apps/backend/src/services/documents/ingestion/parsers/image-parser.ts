import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runScreenshotOcr } from '../../../screenshots/screenshot-ocr';
import type { DocumentParseResult } from '../types';

function extensionFromMime(mimeType: string): string {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

export async function parseImageDocument(input: {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
}): Promise<DocumentParseResult> {
  const ext = extensionFromMime(input.mimeType);
  const tempPath = path.join(os.tmpdir(), `bat-image-${randomUUID()}.${ext}`);
  try {
    await fs.writeFile(tempPath, input.buffer);
    const ocr = await runScreenshotOcr(tempPath);
    const summary = String(ocr.aiSummary || '').trim();
    const text = String(ocr.ocrText || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const merged = [summary, text].filter(Boolean).join('\n\n').trim();
    const warnings: string[] = [];
    if (!merged || merged.length < 80) {
      warnings.push('OCR text confidence is limited for this image. Review before relying on detailed claims.');
    }

    return {
      parser: 'image',
      text: merged,
      sections: [
        {
          headingPath: 'Image OCR',
          text: merged || 'No readable text extracted from the image.',
        },
      ],
      warnings,
      needsReview: warnings.length > 0,
      pagesTotal: 1,
      pagesParsed: 1,
    };
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}
