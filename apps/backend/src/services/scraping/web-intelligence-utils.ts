import fs from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_ROOT } from '../storage/storage-root';
import { fileManager } from '../storage/file-manager';

type SourceType = 'CLIENT_SITE' | 'COMPETITOR_SITE' | 'ARTICLE' | 'REVIEW' | 'FORUM' | 'DOC' | 'OTHER';

type DiscoveryType = 'DDG' | 'USER' | 'SCRAPLING_CRAWL' | 'CHAT_TOOL' | 'IMPORT';

const WEB_STORAGE_DIR = path.join(STORAGE_ROOT, 'web');

export function normalizeUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) throw new Error('URL is required');
  const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  parsed.hash = '';
  return parsed.toString();
}

export function getDomain(raw: string): string {
  return new URL(raw).hostname.replace(/^www\./i, '').toLowerCase();
}

export function toSourceType(raw?: string): SourceType {
  const value = String(raw || '').trim().toUpperCase();
  if (['CLIENT_SITE', 'COMPETITOR_SITE', 'ARTICLE', 'REVIEW', 'FORUM', 'DOC', 'OTHER'].includes(value)) {
    return value as SourceType;
  }
  return 'OTHER';
}

export function toDiscovery(raw?: string): DiscoveryType {
  const value = String(raw || '').trim().toUpperCase();
  if (['DDG', 'USER', 'SCRAPLING_CRAWL', 'CHAT_TOOL', 'IMPORT'].includes(value)) {
    return value as DiscoveryType;
  }
  return 'CHAT_TOOL';
}

export function compactText(value: string, max = 16000): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

export async function writeSnapshotArtifact(
  researchJobId: string,
  snapshotId: string,
  extension: 'html' | 'txt',
  payload: string,
): Promise<string | null> {
  const text = String(payload || '');
  if (!text.trim()) return null;

  const dir = fileManager.resolveStoragePath(path.join(WEB_STORAGE_DIR, researchJobId, 'snapshots'));
  await fs.mkdir(dir, { recursive: true });

  const fileName = `${snapshotId}.${extension}`;
  const absolutePath = fileManager.resolveStoragePath(path.join(dir, fileName));
  await fs.writeFile(absolutePath, text, 'utf8');
  return absolutePath;
}
