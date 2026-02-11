import { searchBrandContextDDG } from './duckduckgo-search';

export const ALL_COMPETITOR_SURFACES = [
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'x',
  'facebook',
  'website',
] as const;

export type CompetitorSurface = (typeof ALL_COMPETITOR_SURFACES)[number];

export type PlatformMatrix = {
  requested: CompetitorSurface[];
  detected: CompetitorSurface[];
  fromAccounts: CompetitorSurface[];
  fromInput: CompetitorSurface[];
  fromContext: CompetitorSurface[];
  selected: CompetitorSurface[];
  websiteDomain: string | null;
};

export type PlatformDetectionInput = {
  researchJobId: string;
  brandName: string;
  requestedSurfaces?: CompetitorSurface[];
  inputData: Record<string, unknown>;
  clientAccounts: Array<{ platform: string; handle?: string | null; profileUrl?: string | null }>;
  contextTexts?: string[];
};

const NON_PRIMARY_WEBSITE_HOST_PATTERNS = [
  /(^|\.)apple\.com$/i,
  /(^|\.)spotify\.com$/i,
  /(^|\.)linktr\.ee$/i,
  /(^|\.)beacons\.ai$/i,
  /(^|\.)patreon\.com$/i,
  /(^|\.)substack\.com$/i,
  /(^|\.)medium\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
];

function uniqueSurfaces(values: Iterable<CompetitorSurface>): CompetitorSurface[] {
  return Array.from(new Set(values));
}

function normalizeSurface(raw: string): CompetitorSurface | null {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'instagram') return 'instagram';
  if (value === 'tiktok') return 'tiktok';
  if (value === 'youtube') return 'youtube';
  if (value === 'linkedin') return 'linkedin';
  if (value === 'twitter' || value === 'x') return 'x';
  if (value === 'facebook') return 'facebook';
  if (value === 'website' || value === 'web' || value === 'site') return 'website';
  return null;
}

function domainFromUrl(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const candidate = value.startsWith('http') ? value : `https://${value}`;
    const parsed = new URL(candidate);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function surfaceFromDomain(hostname: string): CompetitorSurface | null {
  const host = String(hostname || '').toLowerCase();
  if (!host) return null;
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
  if (host.includes('facebook.com') || host.includes('fb.com')) return 'facebook';
  return null;
}

function tokenizeBrand(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function isLikelyBusinessWebsite(hostname: string, brandTokens: string[]): boolean {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return false;
  if (NON_PRIMARY_WEBSITE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return false;
  if (brandTokens.length === 0) return true;
  return brandTokens.some((token) => host.includes(token));
}

function detectFromContextTexts(texts: string[]): {
  surfaces: CompetitorSurface[];
  websiteDomain: string | null;
} {
  const surfaces = new Set<CompetitorSurface>();
  let websiteDomain: string | null = null;
  const urlRegex = /https?:\/\/[^\s)]+/gi;

  for (const text of texts) {
    const value = String(text || '');
    if (!value) continue;
    const lowered = value.toLowerCase();

    if (/\binstagram\b/.test(lowered)) surfaces.add('instagram');
    if (/\btiktok\b/.test(lowered)) surfaces.add('tiktok');
    if (/\byoutube\b/.test(lowered)) surfaces.add('youtube');
    if (/\blinkedin\b/.test(lowered)) surfaces.add('linkedin');
    if (/\btwitter\b|\bx\.com\b/.test(lowered)) surfaces.add('x');
    if (/\bfacebook\b/.test(lowered)) surfaces.add('facebook');
    if (/\bwebsite\b|\bdomain\b|\bhomepage\b/.test(lowered)) surfaces.add('website');

    const urls = value.match(urlRegex) || [];
    for (const rawUrl of urls) {
      try {
        const parsed = new URL(rawUrl);
        const socialSurface = surfaceFromDomain(parsed.hostname);
        if (socialSurface) {
          surfaces.add(socialSurface);
          continue;
        }

        const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
        if (!websiteDomain) {
          websiteDomain = host;
        }
        surfaces.add('website');
      } catch {
        continue;
      }
    }
  }

  return {
    surfaces: uniqueSurfaces(surfaces),
    websiteDomain,
  };
}

function detectFromInput(inputData: Record<string, unknown>): CompetitorSurface[] {
  const result: CompetitorSurface[] = [];

  const handles = inputData.handles;
  if (handles && typeof handles === 'object' && !Array.isArray(handles)) {
    for (const key of Object.keys(handles as Record<string, unknown>)) {
      const surface = normalizeSurface(key);
      if (surface) result.push(surface);
    }
  }

  const directPlatform = normalizeSurface(String(inputData.platform || ''));
  if (directPlatform) result.push(directPlatform);

  const website = String(inputData.website || inputData.websiteUrl || inputData.domain || '').trim();
  if (website) result.push('website');

  return uniqueSurfaces(result);
}

export async function detectPlatformMatrix(
  input: PlatformDetectionInput
): Promise<PlatformMatrix> {
  const brandTokens = tokenizeBrand(input.brandName);

  const fromAccounts = uniqueSurfaces(
    input.clientAccounts
      .map((account) => normalizeSurface(account.platform))
      .filter((surface): surface is CompetitorSurface => Boolean(surface))
  );

  const fromInput = detectFromInput(input.inputData);
  const detectedSet = new Set<CompetitorSurface>([...fromAccounts, ...fromInput]);
  let fromContext: CompetitorSurface[] = [];
  let contextWebsiteDomain: string | null = null;

  const contextTextSignals = detectFromContextTexts(input.contextTexts || []);
  if (contextTextSignals.surfaces.length > 0) {
    fromContext = uniqueSurfaces([...fromContext, ...contextTextSignals.surfaces]);
    if (contextTextSignals.websiteDomain && isLikelyBusinessWebsite(contextTextSignals.websiteDomain, brandTokens)) {
      contextWebsiteDomain = contextTextSignals.websiteDomain;
    }
    for (const surface of contextTextSignals.surfaces) detectedSet.add(surface);
  }

  try {
    const context = await searchBrandContextDDG(input.brandName, input.researchJobId);
    const contextSignals: Array<[CompetitorSurface, string | null | undefined]> = [
      ['instagram', context.instagram_handle],
      ['tiktok', context.tiktok_handle],
      ['linkedin', context.linkedin_url],
      ['facebook', context.facebook_url],
      ['youtube', context.youtube_channel],
      ['x', context.twitter_handle],
      ['website', context.website_url],
    ];

    fromContext = uniqueSurfaces([
      ...fromContext,
      ...contextSignals
        .filter(([, value]) => Boolean(String(value || '').trim()))
        .map(([surface]) => surface),
    ]);

    const detectedWebsiteDomain = domainFromUrl(String(context.website_url || ''));
    if (!contextWebsiteDomain && detectedWebsiteDomain && isLikelyBusinessWebsite(detectedWebsiteDomain, brandTokens)) {
      contextWebsiteDomain = detectedWebsiteDomain;
    }
    for (const surface of fromContext) detectedSet.add(surface);
  } catch {
    // Non-fatal: detector should still return account/input based surface matrix.
  }

  const requested = uniqueSurfaces(input.requestedSurfaces || []);
  const detected = uniqueSurfaces(detectedSet);
  // Detector is a signal collector. Final surface selection is policy-engine driven.
  const selected = requested.length > 0 ? requested : detected;

  const explicitWebsiteDomain =
    domainFromUrl(String(input.inputData.website || input.inputData.websiteUrl || input.inputData.domain || '')) || null;
  let websiteDomain =
    (explicitWebsiteDomain && isLikelyBusinessWebsite(explicitWebsiteDomain, brandTokens)
      ? explicitWebsiteDomain
      : null) || contextWebsiteDomain;

  if (!websiteDomain) {
    const accountDomain = input.clientAccounts
      .map((account) => domainFromUrl(String(account.profileUrl || '')))
      .find((value): value is string => typeof value === 'string' && isLikelyBusinessWebsite(value, brandTokens));
    websiteDomain = accountDomain || null;
  }

  return {
    requested,
    detected,
    fromAccounts,
    fromInput,
    fromContext,
    selected,
    websiteDomain,
  };
}
