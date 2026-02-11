export function toMediaUrl(path?: string | null): string {
  if (!path) return '';

  if (path.startsWith('/storage/')) {
    return path;
  }

  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const storageMarker = '/storage/';
  const markerIndex = path.indexOf(storageMarker);
  if (markerIndex >= 0) {
    return path.slice(markerIndex);
  }

  const normalized = path.replace(/^\/+/, '');
  return `/storage/${normalized}`;
}
