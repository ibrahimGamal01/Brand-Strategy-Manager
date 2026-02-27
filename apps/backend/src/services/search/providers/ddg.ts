import { searchRawDDG } from '../../discovery/duckduckgo-search';
import {
  clampSearchCount,
  normalizeSearchVertical,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from '../search-provider';

function verticalQueryPrefix(vertical: 'web' | 'news' | 'videos'): string {
  if (vertical === 'news') return 'latest news';
  if (vertical === 'videos') return 'videos';
  return '';
}

export class DdgSearchProvider implements SearchProvider {
  readonly id = 'ddg';

  isConfigured(): boolean {
    return true;
  }

  async search(input: SearchRequest): Promise<SearchResponse> {
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
    const prefixedQuery = `${verticalQueryPrefix(vertical)} ${query}`.trim();
    const rows = await searchRawDDG([prefixedQuery], {
      maxResults: count * 2,
      source: `chat_search_${vertical}`,
      timeoutMs: 45_000,
    });

    const deduped = new Map<string, { url: string; title: string; snippet: string; rank: number; providerMeta: Record<string, unknown> }>();
    let rank = 1;
    for (const row of rows) {
      const url = String(row.href || '').trim();
      if (!url || deduped.has(url)) continue;
      deduped.set(url, {
        url,
        title: String(row.title || url).trim() || url,
        snippet: String(row.body || '').trim(),
        rank,
        providerMeta: {
          query: row.query,
        },
      });
      rank += 1;
      if (deduped.size >= count) break;
    }

    return {
      provider: this.id,
      query,
      vertical,
      items: Array.from(deduped.values()),
      rawTotal: rows.length,
    };
  }
}
