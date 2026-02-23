import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { STORAGE_ROOT } from '../storage/storage-root';

export type StoredDocument = {
  id: string;
  storagePath: string;
  absPath: string;
  fileName: string;
  sizeBytes: number;
};

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
}

export async function saveDocumentBuffer(
  researchJobId: string,
  title: string,
  buffer: Buffer,
): Promise<StoredDocument> {
  const id = uuid();
  const safeTitle = sanitizeFileName(title);
  const relDir = path.join('docs', researchJobId);
  const fileName = `${safeTitle}-${id}.pdf`;
  const relPath = path.join(relDir, fileName);
  const absDir = path.join(STORAGE_ROOT, relDir);
  const absPath = path.join(STORAGE_ROOT, relPath);

  await fs.promises.mkdir(absDir, { recursive: true });
  await fs.promises.writeFile(absPath, buffer);

  const stats = await fs.promises.stat(absPath);
  return {
    id,
    storagePath: `storage/${relPath}`.replace(/\\/g, '/'),
    absPath,
    fileName,
    sizeBytes: stats.size,
  };
}
