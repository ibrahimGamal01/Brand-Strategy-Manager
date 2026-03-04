import { suggestCompetitorInspirationLinks } from '../services/intake/suggest-competitor-inspiration-links';
import type { SearchRequest, SearchResponse, SearchResultItem } from '../services/search/search-provider';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const stubSearch = async (
  input: SearchRequest & { provider?: 'auto' | 'brave' | 'ddg' }
): Promise<SearchResponse> => {
  const query = String(input.query || '');
  const items: SearchResultItem[] = [
    {
      url: 'https://eluumis.com',
      title: 'ELUUMIS Official Site',
      snippet: 'Biophoton devices and streaming experiences.',
      rank: 1,
    },
    {
      url: 'https://www.instagram.com/eluumis/',
      title: 'ELUUMIS on Instagram',
      snippet: 'Official account.',
      rank: 2,
    },
    {
      url: 'https://joovv.com',
      title: 'JOOVV | Red light therapy devices',
      snippet: 'Red light therapy devices for home and practitioners.',
      rank: 3,
    },
    {
      url: 'https://www.instagram.com/joovv/',
      title: 'JOOVV on Instagram',
      snippet: 'Official account.',
      rank: 4,
    },
    {
      url: 'https://mitoredlight.com',
      title: 'Mito Red Light',
      snippet: 'Red light therapy panels and accessories.',
      rank: 5,
    },
    {
      url: 'https://platinumtherapylights.com',
      title: 'PlatinumLED Therapy Lights',
      snippet: 'Red light therapy and infrared light devices.',
      rank: 6,
    },
    {
      url: 'https://www.tiktok.com/@joovv',
      title: 'JOOVV on TikTok',
      snippet: 'Red light therapy tips.',
      rank: 7,
    },
    {
      url: 'https://redlighttherapy.org/best-red-light-therapy-devices/',
      title: 'Best red light therapy devices (list)',
      snippet: 'Comparison directory of popular red light therapy brands.',
      rank: 8,
    },
  ];

  return {
    provider: 'stub',
    query,
    vertical: 'web',
    items: items.slice(0, input.count || 6),
  };
};

async function main(): Promise<void> {
  const intakePayload = {
    name: 'ELUUMIS',
    website: 'https://eluumis.com',
    websites: ['https://eluumis.com'],
    niche: 'Biophoton-based wellness devices and guided programs',
    oneSentenceDescription: 'Biophoton “Living Light” devices and guided programs for calm and coherence.',
    servicesList: ['Streaming sessions', 'Light-based devices', 'Guided programs'],
    idealAudience: 'Wellness seekers and practitioners',
    topProblems: ['Stress', 'Sleep', 'Nervous system regulation'],
    socialReferences: ['https://www.instagram.com/eluumis/'],
    handles: {
      instagram: 'eluumis',
      tiktok: '',
      youtube: '',
      twitter: '',
      linkedin: '',
    },
  } as Record<string, unknown>;

  const existingLinks = [
    'https://voidspacetech.org/products/eluumis-sky',
    'https://balancehealthhq.com/products/eluumis-sky',
  ];

  const result = await suggestCompetitorInspirationLinks({
    intakePayload,
    existingLinks,
    desiredCount: 5,
    search: stubSearch,
  });

  assert(result.links.length === 5, `Expected 5 links, got ${result.links.length}`);
  assert(!result.links.some((link) => link.includes('eluumis.com')), 'Expected self domain to be excluded');
  assert(
    !result.links.some((link) => link.includes('instagram.com/eluumis')),
    'Expected self Instagram to be excluded'
  );
  assert(
    result.links.some((link) => link.includes('instagram.com/') || link.includes('tiktok.com/') || link.includes('youtube.com/')),
    'Expected at least one social profile link'
  );
  assert(
    result.links[0]?.includes('voidspacetech.org/products/eluumis-sky'),
    'Expected existing link to remain first'
  );
  assert(
    result.links[1]?.includes('balancehealthhq.com/products/eluumis-sky'),
    'Expected existing link to remain second'
  );

  console.log('intake-competitor-links-suggest tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

