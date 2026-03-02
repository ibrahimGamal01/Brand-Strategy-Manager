import path from 'path';
import type { FileDetectionResult, SupportedDocumentParser } from './types';

const EXTENSION_TO_PARSER: Record<string, SupportedDocumentParser> = {
  '.txt': 'text',
  '.md': 'text',
  '.markdown': 'text',
  '.html': 'text',
  '.htm': 'text',
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.pdf': 'pdf',
};

function parserFromMime(mimeType: string): SupportedDocumentParser {
  const mime = String(mimeType || '').trim().toLowerCase();
  if (!mime) return 'unknown';
  if (mime.includes('text/plain') || mime.includes('text/markdown') || mime.includes('text/html')) return 'text';
  if (mime.includes('text/csv') || mime.includes('application/csv')) return 'csv';
  if (mime.includes('spreadsheetml') || mime.includes('application/vnd.ms-excel')) return 'xlsx';
  if (mime.includes('wordprocessingml')) return 'docx';
  if (mime.includes('presentationml')) return 'pptx';
  if (mime.includes('application/pdf')) return 'pdf';
  return 'unknown';
}

export function detectDocumentFile(fileName: string, mimeType: string): FileDetectionResult {
  const extension = path.extname(String(fileName || '').trim().toLowerCase()) || '';
  const byExt = EXTENSION_TO_PARSER[extension] || 'unknown';
  const byMime = parserFromMime(mimeType);
  const parser = byExt !== 'unknown' ? byExt : byMime;

  return {
    parser,
    extension,
    mimeType: String(mimeType || 'application/octet-stream').trim() || 'application/octet-stream',
    isBinary: parser !== 'text' && parser !== 'csv',
  };
}

export function isAllowedDocumentParser(parser: SupportedDocumentParser): boolean {
  return parser !== 'unknown';
}
