import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { STORAGE_ROOT } from '../storage/storage-root';

export type SavedScreenshot = {
  id: string;
  storagePath: string;
  absPath: string;
  mimeType: string;
  sizeBytes: number;
};

export async function saveScreenshotBuffer(
  researchJobId: string,
  buffer: Buffer,
  mimeType: string
): Promise<SavedScreenshot> {
  const id = uuid();
  const relDir = path.join('screenshots', researchJobId);
  const relPath = path.join(relDir, `${id}.png`);
  const absDir = path.join(STORAGE_ROOT, relDir);
  const absPath = path.join(STORAGE_ROOT, relPath);

  await fs.promises.mkdir(absDir, { recursive: true });
  await fs.promises.writeFile(absPath, buffer);

  const stats = await fs.promises.stat(absPath);
  return {
    id,
    storagePath: `storage/${relPath}`.replace(/\\/g, '/'),
    absPath,
    mimeType: mimeType || 'image/png',
    sizeBytes: stats.size,
  };
}
