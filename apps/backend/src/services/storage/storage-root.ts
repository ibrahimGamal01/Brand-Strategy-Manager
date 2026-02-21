import path from 'path';

function resolveStorageRoot(): string {
  const explicit = String(process.env.STORAGE_ROOT || '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  // Default to <repo>/apps/backend/storage regardless of cwd.
  return path.resolve(__dirname, '../../../storage');
}

export const STORAGE_ROOT = resolveStorageRoot();
