import { crawlAndPersistWebSources, fetchAndPersistWebSnapshot } from '../scraping/web-intelligence-service';

const SOCIAL_HOST_MARKERS = [
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  'facebook.com',
  'linkedin.com',
];

function isSocialHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  return SOCIAL_HOST_MARKERS.some((marker) => host.includes(marker));
}

function normalizeWebsiteCandidate(rawValue: string): string {
  let candidate = String(rawValue || '').trim();
  if (!candidate) return '';

  candidate = candidate
    .replace(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i, '$2')
    .replace(/[)\],;.!]+$/g, '');

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (isSocialHost(parsed.hostname)) return '';

    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return '';
  }
}

function extractWebsiteCandidates(value: string): string[] {
  const source = String(value || '').trim();
  if (!source) return [];

  const results: string[] = [];

  const markdownLinkMatches = source.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi) || [];
  for (const match of markdownLinkMatches) {
    const extracted = match.match(/\((https?:\/\/[^)]+)\)/i)?.[1];
    if (extracted) results.push(extracted);
  }

  const urlMatches = source.match(/https?:\/\/[^\s)]+/gi) || [];
  results.push(...urlMatches);

  const domainMatches = source.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[\w\-./?%&=]*)?/gi) || [];
  results.push(...domainMatches);

  if (!results.length && !/\s/.test(source)) {
    results.push(source);
  }

  return results;
}

export function parseWebsiteList(input: unknown, maxItems = 8): string[] {
  const chunks = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const candidates = extractWebsiteCandidates(String(chunk || ''));
    for (const candidate of candidates) {
      const normalized = normalizeWebsiteCandidate(candidate);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
      if (out.length >= maxItems) {
        return out;
      }
    }
  }

  return out;
}

export function resolveIntakeWebsites(payload: Record<string, unknown>): {
  websites: string[];
  primaryWebsite: string;
} {
  const directWebsite = String(payload.website || payload.websiteDomain || '').trim();
  const websites = parseWebsiteList([directWebsite, payload.websites], 8);

  return {
    websites,
    primaryWebsite: websites[0] || directWebsite,
  };
}

export async function seedPortalIntakeWebsites(workspaceId: string, websites: string[]): Promise<void> {
  const targets = parseWebsiteList(websites, 5);
  for (const target of targets) {
    try {
      await fetchAndPersistWebSnapshot({
        researchJobId: workspaceId,
        url: target,
        sourceType: 'CLIENT_SITE',
        discoveredBy: 'USER',
        mode: 'AUTO',
        allowExternal: true,
      });

      await crawlAndPersistWebSources({
        researchJobId: workspaceId,
        startUrls: [target],
        maxPages: 4,
        maxDepth: 1,
        mode: 'AUTO',
        allowExternal: true,
      });
    } catch (error) {
      console.error(`[PortalIntake] Failed website scrape seed for ${workspaceId} (${target}):`, error);
    }
  }
}
