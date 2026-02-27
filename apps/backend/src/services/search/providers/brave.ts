import axios from 'axios';
import {
  clampSearchCount,
  normalizeSearchLocale,
  normalizeSearchVertical,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
  type SearchResultItem,
} from '../search-provider';

const BRAVE_ENDPOINTS: Record<'web' | 'news' | 'videos', string> = {
  web: 'https://api.search.brave.com/res/v1/web/search',
  news: 'https://api.search.brave.com/res/v1/news/search',
  videos: 'https://api.search.brave.com/res/v1/videos/search',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeItem(raw: Record<string, unknown>, rank: number): SearchResultItem | null {
  const url = String(raw.url || raw.link || '').trim();
  if (!url) return null;
  const title = String(raw.title || raw.name || url).trim();
  const snippet = String(raw.description || raw.snippet || raw.page_age || '').trim();
  const source = String(raw.source || raw.page_fetched_from || '').trim();
  return {
    url,
    title: title || url,
    snippet,
    rank,
    ...(source ? { source } : {}),
    providerMeta: raw,
  };
}

function parseBraveResults(data: Record<string, unknown>, vertical: 'web' | 'news' | 'videos'): SearchResultItem[] {
  const candidates = [
    ...asArray(asRecord(data.web).results),
    ...asArray(asRecord(data.news).results),
    ...asArray(asRecord(data.videos).results),
    ...asArray(data.results),
  ];

  const deduped = new Map<string, SearchResultItem>();
  let rank = 1;
  for (const row of candidates) {
    const normalized = normalizeItem(asRecord(row), rank);
    if (!normalized) continue;
    if (deduped.has(normalized.url)) continue;
    deduped.set(normalized.url, normalized);
    rank += 1;
  }

  // Some Brave verticals may nest under the selected key only.
  if (deduped.size === 0) {
    const verticalRows = asArray(asRecord(data[vertical]).results);
    for (const row of verticalRows) {
      const normalized = normalizeItem(asRecord(row), rank);
      if (!normalized) continue;
      if (deduped.has(normalized.url)) continue;
      deduped.set(normalized.url, normalized);
      rank += 1;
    }
  }

  return Array.from(deduped.values());
}

export class BraveSearchProvider implements SearchProvider {
  readonly id = 'brave';
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = String(apiKey || process.env.BRAVE_SEARCH_API_KEY || '').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(input: SearchRequest): Promise<SearchResponse> {
    if (!this.isConfigured()) {
      throw new Error('Brave search provider is not configured. Missing BRAVE_SEARCH_API_KEY.');
    }

    const query = String(input.query || '').trim();
    if (!query) {
      return {
        provider: this.id,
        query: '',
        vertical: 'web',
        items: [],
      };
    }

    const vertical = normalizeSearchVertical(input.vertical);
    const count = clampSearchCount(input.count, 10);
    const offset = Math.max(0, Number.isFinite(Number(input.offset)) ? Math.floor(Number(input.offset)) : 0);
    const locale = normalizeSearchLocale(input.locale);
    const freshnessDays = Number.isFinite(Number(input.freshnessDays))
      ? Math.max(1, Math.min(3650, Math.floor(Number(input.freshnessDays))))
      : null;

    const response = await axios.get(BRAVE_ENDPOINTS[vertical], {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
      params: {
        q: query,
        count,
        offset,
        country: locale.split('-')[1] || 'US',
        search_lang: locale.split('-')[0] || 'en',
        ...(freshnessDays ? { freshness: `${freshnessDays}d` } : {}),
      },
      timeout: 20_000,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (response.status >= 400) {
      throw new Error(`Brave search request failed (${response.status}): ${JSON.stringify(response.data || {})}`);
    }

    const payload = asRecord(response.data);
    const items = parseBraveResults(payload, vertical).slice(0, count);

    const rawTotal = Number(asRecord(payload.web).total || payload.total || items.length);

    return {
      provider: this.id,
      query,
      vertical,
      items,
      ...(Number.isFinite(rawTotal) ? { rawTotal } : {}),
    };
  }
}
