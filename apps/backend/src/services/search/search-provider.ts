export type SearchVertical = 'web' | 'news' | 'videos';

export interface SearchRequest {
  query: string;
  count?: number;
  offset?: number;
  vertical?: SearchVertical;
  locale?: string;
  freshnessDays?: number;
}

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
  rank: number;
  source?: string;
  providerMeta?: Record<string, unknown>;
}

export interface SearchResponse {
  provider: string;
  query: string;
  vertical: SearchVertical;
  items: SearchResultItem[];
  rawTotal?: number;
  warnings?: string[];
}

export interface SearchProvider {
  readonly id: string;
  isConfigured(): boolean;
  search(input: SearchRequest): Promise<SearchResponse>;
}

export function clampSearchCount(value: unknown, fallback = 10): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

export function normalizeSearchVertical(value: unknown): SearchVertical {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'news') return 'news';
  if (normalized === 'videos' || normalized === 'video') return 'videos';
  return 'web';
}

export function normalizeSearchLocale(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) return 'en-US';
  if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(normalized)) return normalized;
  return 'en-US';
}
