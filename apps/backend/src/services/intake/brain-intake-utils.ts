import { prisma } from '../../lib/prisma';

const COMPETITOR_INPUT_SOCIAL_TYPES = [
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'linkedin',
  'facebook',
] as const;

type CompetitorInputSocialType = (typeof COMPETITOR_INPUT_SOCIAL_TYPES)[number];

export type ParsedCompetitorInput =
  | {
      inputType: CompetitorInputSocialType;
      handle: string;
      normalizedKey: string;
      sourceUrl: string;
    }
  | {
      inputType: 'website';
      domain: string;
      normalizedKey: string;
      sourceUrl: string;
    };

/**
 * Extract handle from social URL or raw handle string.
 * Supports: instagram.com/username, tiktok.com/@username, or plain @username / username.
 */
export function normalizeHandle(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const igMatch = raw.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
  if (igMatch) return igMatch[1].toLowerCase();

  const ttMatch = raw.match(/tiktok\.com\/@?([a-z0-9._]{2,30})/i);
  if (ttMatch) return ttMatch[1].toLowerCase();

  return raw.replace(/^@+/, '').trim().toLowerCase();
}

export function buildPlatformHandles(payload: any): Record<string, string> {
  const out: Record<string, string> = {};

  if (payload?.handles && typeof payload.handles === 'object') {
    for (const [platform, handle] of Object.entries(payload.handles)) {
      const normalized = normalizeHandle(handle);
      if (normalized) out[String(platform).toLowerCase()] = normalized;
    }
  }

  if (Array.isArray(payload?.channels)) {
    for (const row of payload.channels) {
      if (!row) continue;
      const platform = String((row as any).platform || '').toLowerCase().trim();
      const normalized = normalizeHandle((row as any).handle);
      if (platform && normalized) out[platform] = normalized;
    }
  }

  if (Object.keys(out).length === 0 && payload?.handle) {
    const platform = String(payload?.platform || 'instagram').toLowerCase().trim();
    const normalized = normalizeHandle(payload.handle);
    if (normalized) out[platform] = normalized;
  }

  return out;
}

export function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function normalizeWebsiteDomain(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function normalizeUrlCandidate(raw: string): string {
  if (/^[a-z]+:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw)) return `https://${raw}`;
  return raw;
}

function parseUrlSafe(raw: string): URL | null {
  try {
    return new URL(normalizeUrlCandidate(raw));
  } catch {
    return null;
  }
}

function cleanToken(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^[<(\["']+/, '')
    .replace(/[>)\]"',.;:!?]+$/, '')
    .trim();
}

function isKnownSocialHost(hostname: string): boolean {
  const host = String(hostname || '').replace(/^www\./i, '').toLowerCase();
  return (
    host.includes('instagram.com') ||
    host.includes('tiktok.com') ||
    host.includes('youtube.com') ||
    host.includes('x.com') ||
    host.includes('twitter.com') ||
    host.includes('linkedin.com') ||
    host.includes('facebook.com')
  );
}

function aliasToPlatform(alias: string): CompetitorInputSocialType | null {
  const value = String(alias || '').trim().toLowerCase();
  if (value === 'instagram' || value === 'ig') return 'instagram';
  if (value === 'tiktok' || value === 'tt') return 'tiktok';
  if (value === 'youtube' || value === 'yt') return 'youtube';
  if (value === 'linkedin' || value === 'li') return 'linkedin';
  if (value === 'facebook' || value === 'fb') return 'facebook';
  if (value === 'x' || value === 'twitter') return 'x';
  return null;
}

function isValidHandleForPlatform(platform: CompetitorInputSocialType, handle: string): boolean {
  if (platform === 'x') return /^[a-z0-9_]{1,15}$/i.test(handle);
  if (platform === 'linkedin') return /^[a-z0-9-]{2,80}$/i.test(handle);
  if (platform === 'facebook') return /^[a-z0-9.]{2,80}$/i.test(handle);
  if (platform === 'youtube') return /^[a-z0-9._-]{2,60}$/i.test(handle);
  return /^[a-z0-9._]{2,30}$/i.test(handle);
}

function parsePlatformTaggedHandleEntries(raw: string): Array<{ inputType: CompetitorInputSocialType; handle: string }> {
  const out: Array<{ inputType: CompetitorInputSocialType; handle: string }> = [];
  const text = String(raw || '');
  const pattern =
    /(?:^|[\s|,;])(?:platform\s*)?(instagram|ig|tiktok|tt|youtube|yt|linkedin|li|facebook|fb|x|twitter)\s*(?:[:=\-]|\s+handle\s+)\s*@?([a-z0-9._-]{1,80})/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const platform = aliasToPlatform(match[1] || '');
    const handle = String(match[2] || '').replace(/^@+/, '').toLowerCase().trim();
    if (!platform || !handle) continue;
    if (!isValidHandleForPlatform(platform, handle)) continue;
    out.push({ inputType: platform, handle });
  }

  return out;
}

function extractUrlCandidates(raw: string): string[] {
  const out: string[] = [];
  const text = String(raw || '');

  const markdownUrlPattern = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gi;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownUrlPattern.exec(text)) !== null) {
    out.push(cleanToken(markdownMatch[1] || ''));
  }

  const plainUrlPattern = /(https?:\/\/[^\s)]+)(?=[\s)]|$)/gi;
  let plainMatch: RegExpExecArray | null;
  while ((plainMatch = plainUrlPattern.exec(text)) !== null) {
    out.push(cleanToken(plainMatch[1] || ''));
  }

  const domainPattern = /(?:^|[\s(])([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)/gi;
  let domainMatch: RegExpExecArray | null;
  while ((domainMatch = domainPattern.exec(text)) !== null) {
    out.push(cleanToken(domainMatch[1] || ''));
  }

  return out.filter(Boolean);
}

function parseSocialMentionsFromRichText(raw: string): Array<{ inputType: CompetitorInputSocialType; handle: string }> {
  const out: Array<{ inputType: CompetitorInputSocialType; handle: string }> = [];
  const text = String(raw || '');
  const socialHints: Array<{ hint: string; inputType: CompetitorInputSocialType }> = [
    { hint: 'instagram', inputType: 'instagram' },
    { hint: 'tiktok', inputType: 'tiktok' },
    { hint: 'youtube', inputType: 'youtube' },
    { hint: 'linkedin', inputType: 'linkedin' },
    { hint: 'facebook', inputType: 'facebook' },
    { hint: 'twitter', inputType: 'x' },
    { hint: 'x ', inputType: 'x' },
  ];

  for (const row of socialHints) {
    if (!text.toLowerCase().includes(row.hint)) continue;
    const mentionPattern = /@([a-z0-9._-]{1,80})/gi;
    let match: RegExpExecArray | null;
    while ((match = mentionPattern.exec(text)) !== null) {
      const handle = String(match[1] || '').replace(/^@+/, '').toLowerCase().trim();
      if (!handle) continue;
      if (!isValidHandleForPlatform(row.inputType, handle)) continue;
      out.push({ inputType: row.inputType, handle });
    }
  }

  return out;
}

function parsePlatformHandleFromUrl(url: URL): { inputType: CompetitorInputSocialType; handle: string } | null {
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const pathParts = url.pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const first = pathParts[0]?.toLowerCase() || '';
  const second = pathParts[1]?.toLowerCase() || '';

  if (host.includes('instagram.com')) {
    const reserved = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'api']);
    if (!first || reserved.has(first)) return null;
    const handle = first.replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9._]{2,30}$/i.test(handle)) return null;
    return { inputType: 'instagram', handle };
  }

  if (host.includes('tiktok.com')) {
    if (!first.startsWith('@')) return null;
    const handle = first.replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9._]{2,30}$/i.test(handle)) return null;
    return { inputType: 'tiktok', handle };
  }

  if (host.includes('youtube.com')) {
    let handle = '';
    if (first.startsWith('@')) {
      handle = first.replace(/^@+/, '').toLowerCase();
    } else if ((first === 'channel' || first === 'user' || first === 'c') && second) {
      handle = second.toLowerCase();
    } else {
      return null;
    }
    if (!/^[a-z0-9._-]{2,60}$/i.test(handle)) return null;
    return { inputType: 'youtube', handle };
  }

  if (host.includes('x.com') || host.includes('twitter.com')) {
    const reserved = new Set([
      'home',
      'explore',
      'search',
      'i',
      'settings',
      'messages',
      'notifications',
      'intent',
      'hashtag',
      'share',
    ]);
    if (!first || reserved.has(first)) return null;
    const handle = first.replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/i.test(handle)) return null;
    return { inputType: 'x', handle };
  }

  if (host.includes('linkedin.com')) {
    let handle = '';
    if ((first === 'in' || first === 'company') && second) {
      handle = second.toLowerCase();
    } else {
      return null;
    }
    if (!/^[a-z0-9-]{2,80}$/i.test(handle)) return null;
    return { inputType: 'linkedin', handle };
  }

  if (host.includes('facebook.com')) {
    const reserved = new Set([
      'pages',
      'groups',
      'watch',
      'reel',
      'share.php',
      'photo',
      'profile.php',
      'events',
      'marketplace',
      'ads',
      'gaming',
    ]);
    if (!first || reserved.has(first)) return null;
    const handle = first.replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9.]{2,80}$/i.test(handle)) return null;
    return { inputType: 'facebook', handle };
  }

  return null;
}

/**
 * Parse mixed competitor inspiration links into typed rows.
 * Supports social profile URLs and website domains/URLs.
 * Does not infer handles from unsupported URL routes.
 */
export function parseCompetitorInspirationInputs(links: string[]): ParsedCompetitorInput[] {
  const out: ParsedCompetitorInput[] = [];
  const seen = new Set<string>();

  const pushSocial = (
    inputType: CompetitorInputSocialType,
    handleRaw: string,
    sourceUrl: string
  ) => {
    const handle = String(handleRaw || '').replace(/^@+/, '').toLowerCase().trim();
    if (!handle || !isValidHandleForPlatform(inputType, handle)) return;
    const normalizedKey = `${inputType}:${handle}`;
    if (seen.has(normalizedKey)) return;
    seen.add(normalizedKey);
    out.push({
      inputType,
      handle,
      normalizedKey,
      sourceUrl,
    });
  };

  const pushWebsite = (domainRaw: string, sourceUrl: string) => {
    const domain = normalizeWebsiteDomain(domainRaw);
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return;
    if (isKnownSocialHost(domain)) return;
    const normalizedKey = `website:${domain}`;
    if (seen.has(normalizedKey)) return;
    seen.add(normalizedKey);
    out.push({
      inputType: 'website',
      domain,
      normalizedKey,
      sourceUrl,
    });
  };

  for (const rawValue of links) {
    const raw = String(rawValue || '').trim();
    if (!raw) continue;

    const urlCandidates = extractUrlCandidates(raw);
    for (const urlCandidate of urlCandidates) {
      const parsedUrl = parseUrlSafe(urlCandidate);
      if (!parsedUrl) continue;

      const social = parsePlatformHandleFromUrl(parsedUrl);
      if (social) {
        pushSocial(social.inputType, social.handle, parsedUrl.toString());
        continue;
      }

      if (!isKnownSocialHost(parsedUrl.hostname)) {
        pushWebsite(parsedUrl.toString(), parsedUrl.toString());
      }
    }

    for (const entry of parsePlatformTaggedHandleEntries(raw)) {
      const profileUrl = getProfileUrl(entry.inputType, entry.handle) || `${entry.inputType}:${entry.handle}`;
      pushSocial(entry.inputType, entry.handle, profileUrl);
    }

    for (const mention of parseSocialMentionsFromRichText(raw)) {
      const profileUrl = getProfileUrl(mention.inputType, mention.handle) || `${mention.inputType}:${mention.handle}`;
      pushSocial(mention.inputType, mention.handle, profileUrl);
    }

    const parsedDirectUrl = parseUrlSafe(cleanToken(raw));
    if (parsedDirectUrl && !isKnownSocialHost(parsedDirectUrl.hostname)) {
      pushWebsite(parsedDirectUrl.toString(), parsedDirectUrl.toString());
    } else if (!parsedDirectUrl && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanToken(raw))) {
      const domain = cleanToken(raw);
      pushWebsite(domain, normalizeUrlCandidate(domain));
    }
  }

  return out;
}

/**
 * Parse competitor inspiration links (Instagram/TikTok URLs) into platform + handle.
 * Returns only instagram and tiktok; other URLs are skipped.
 */
export function parseCompetitorInspirationLinks(
  links: string[]
): Array<{ platform: 'instagram' | 'tiktok'; handle: string }> {
  const out: Array<{ platform: 'instagram' | 'tiktok'; handle: string }> = [];
  for (const row of parseCompetitorInspirationInputs(links)) {
    if (row.inputType !== 'instagram' && row.inputType !== 'tiktok') continue;
    out.push({ platform: row.inputType, handle: row.handle });
  }
  return out;
}

export function getProfileUrl(platform: string, handle: string): string {
  const urls: Record<string, string> = {
    instagram: `https://instagram.com/${handle}/`,
    tiktok: `https://tiktok.com/@${handle}`,
    youtube: `https://youtube.com/@${handle}`,
    twitter: `https://twitter.com/${handle}`,
    linkedin: `https://linkedin.com/in/${handle}`,
    facebook: `https://facebook.com/${handle}`,
    x: `https://x.com/${handle}`,
  };
  return urls[platform] || '';
}

export async function syncBrainGoals(
  brainProfileId: string,
  primaryGoal: string | null,
  secondaryGoals: string[]
): Promise<void> {
  await prisma.brainGoal.deleteMany({ where: { brainProfileId } });

  const goalRows = [];
  if (primaryGoal && primaryGoal.trim()) {
    goalRows.push({
      brainProfileId,
      goalType: 'PRIMARY',
      priority: 1,
      targetMetric: 'primary_goal',
      targetValue: primaryGoal.trim(),
      notes: 'Captured during intake',
    });
  }

  secondaryGoals.slice(0, 8).forEach((goal, index) => {
    goalRows.push({
      brainProfileId,
      goalType: 'SECONDARY',
      priority: index + 2,
      targetMetric: 'secondary_goal',
      targetValue: goal,
      notes: 'Captured during intake',
    });
  });

  if (goalRows.length > 0) {
    await prisma.brainGoal.createMany({ data: goalRows });
  }
}
