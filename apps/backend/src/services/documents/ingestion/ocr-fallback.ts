import type { DocumentParseResult } from './types';

export type OcrFallbackResult = {
  applied: boolean;
  text?: string;
  warnings: string[];
};

export async function runOcrFallbackIfNeeded(input: {
  parser: string;
  parseResult: DocumentParseResult;
}): Promise<OcrFallbackResult> {
  const parser = String(input.parser || '').toLowerCase();
  const textLength = String(input.parseResult.text || '').trim().length;
  const shouldFallback = parser === 'pdf' && textLength < 180;

  if (!shouldFallback) {
    return { applied: false, warnings: [] };
  }

  // Placeholder for OCR engine integration.
  // Current phase preserves deterministic behavior and asks for manual review when OCR is unavailable.
  return {
    applied: false,
    warnings: [
      'OCR fallback requested but OCR worker is not configured yet. Upload a text-based PDF or proceed with manual summary.',
    ],
  };
}
