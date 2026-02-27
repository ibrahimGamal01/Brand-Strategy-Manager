import { BraveSearchProvider } from './providers/brave';
import { DdgSearchProvider } from './providers/ddg';
import {
  normalizeSearchVertical,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from './search-provider';

export type SearchProviderId = 'auto' | 'brave' | 'ddg';

const braveProvider = new BraveSearchProvider();
const ddgProvider = new DdgSearchProvider();

function resolvePreferredProvider(preferred?: SearchProviderId): SearchProvider {
  const explicit = String(preferred || '').trim().toLowerCase();
  if (explicit === 'brave') return braveProvider.isConfigured() ? braveProvider : ddgProvider;
  if (explicit === 'ddg') return ddgProvider;

  const envPreferred = String(process.env.SEARCH_PROVIDER || '').trim().toLowerCase();
  if (envPreferred === 'ddg') return ddgProvider;
  if (envPreferred === 'brave') return braveProvider.isConfigured() ? braveProvider : ddgProvider;

  return braveProvider.isConfigured() ? braveProvider : ddgProvider;
}

export async function searchWeb(
  input: SearchRequest & {
    provider?: SearchProviderId;
  }
): Promise<SearchResponse> {
  const provider = resolvePreferredProvider(input.provider);
  const request: SearchRequest = {
    ...input,
    vertical: normalizeSearchVertical(input.vertical),
  };
  try {
    return await provider.search(request);
  } catch (error: any) {
    if (provider.id === 'brave') {
      const fallback = await ddgProvider.search(request);
      return {
        ...fallback,
        warnings: [
          `Brave provider failed and DDG fallback was used: ${String(error?.message || error)}`,
        ],
      };
    }
    throw error;
  }
}

export function listSearchProviders(): Array<{ id: string; configured: boolean }> {
  return [
    { id: braveProvider.id, configured: braveProvider.isConfigured() },
    { id: ddgProvider.id, configured: ddgProvider.isConfigured() },
  ];
}
