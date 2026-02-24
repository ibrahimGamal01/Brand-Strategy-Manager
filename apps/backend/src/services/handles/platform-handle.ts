export const SOCIAL_HANDLE_PLATFORMS = [
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'linkedin',
  'facebook',
] as const;

export type SocialHandlePlatform = (typeof SOCIAL_HANDLE_PLATFORMS)[number];

type HandleValidationReason =
  | 'empty'
  | 'length'
  | 'charset'
  | 'no_letters'
  | 'numeric_id'
  | 'edge_punctuation'
  | 'invalid_punctuation'
  | 'unsupported_platform';

const SOCIAL_PLATFORM_ALIASES: Record<string, SocialHandlePlatform> = {
  instagram: 'instagram',
  ig: 'instagram',
  tiktok: 'tiktok',
  tt: 'tiktok',
  youtube: 'youtube',
  yt: 'youtube',
  x: 'x',
  twitter: 'x',
  linkedin: 'linkedin',
  li: 'linkedin',
  facebook: 'facebook',
  fb: 'facebook',
};

function isKnownSocialPlatform(value: string): value is SocialHandlePlatform {
  return SOCIAL_HANDLE_PLATFORMS.includes(value as SocialHandlePlatform);
}

export function normalizeSocialHandlePlatform(value: unknown): SocialHandlePlatform | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (isKnownSocialPlatform(normalized)) return normalized;
  return SOCIAL_PLATFORM_ALIASES[normalized] || null;
}

function sanitizeRawHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, '')
    .split('?')[0]
    .split('#')[0]
    .split('/')[0]
    .trim()
    .toLowerCase();
}

function tryParseHandleFromUrl(raw: string, platformHint: SocialHandlePlatform | null): string {
  const text = String(raw || '').trim();
  if (!text) return '';

  const value = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const platform = platformHint || inferPlatformFromUrl(value);

  if (platform === 'instagram') {
    const match = value.match(/instagram\.com\/([a-z0-9._]{1,40})/i);
    if (match) return sanitizeRawHandle(match[1] || '');
  }

  if (platform === 'tiktok') {
    const match = value.match(/tiktok\.com\/@?([a-z0-9._]{1,40})/i);
    if (match) return sanitizeRawHandle(match[1] || '');
  }

  if (platform === 'youtube') {
    const match = value.match(/youtube\.com\/(?:@|c\/|channel\/|user\/)?([a-z0-9._-]{1,80})/i);
    if (match) return sanitizeRawHandle(match[1] || '');
  }

  if (platform === 'linkedin') {
    const match = value.match(/linkedin\.com\/(?:company|in)\/([a-z0-9-]{1,100})/i);
    if (match) return sanitizeRawHandle(match[1] || '');
  }

  if (platform === 'facebook') {
    const match = value.match(/facebook\.com\/([a-z0-9.]{1,100})/i);
    if (match) return sanitizeRawHandle(match[1] || '');
  }

  if (platform === 'x') {
    const match = value.match(/(?:x|twitter)\.com\/@?([a-z0-9_]{1,40})/i);
    if (match) return sanitizeRawHandle(match[1] || '');
  }

  return sanitizeRawHandle(value);
}

function inferPlatformFromUrl(value: string): SocialHandlePlatform | null {
  const lower = String(value || '').toLowerCase();
  if (lower.includes('instagram.com/')) return 'instagram';
  if (lower.includes('tiktok.com/')) return 'tiktok';
  if (lower.includes('youtube.com/')) return 'youtube';
  if (lower.includes('linkedin.com/')) return 'linkedin';
  if (lower.includes('facebook.com/')) return 'facebook';
  if (lower.includes('x.com/') || lower.includes('twitter.com/')) return 'x';
  return null;
}

function platformPattern(platform: SocialHandlePlatform): RegExp {
  if (platform === 'instagram') return /^[a-z0-9._]{2,30}$/i;
  if (platform === 'tiktok') return /^[a-z0-9._]{2,30}$/i;
  if (platform === 'youtube') return /^[a-z0-9._-]{2,60}$/i;
  if (platform === 'linkedin') return /^[a-z0-9-]{2,80}$/i;
  if (platform === 'facebook') return /^[a-z0-9.]{2,80}$/i;
  return /^[a-z0-9_]{1,15}$/i;
}

export function normalizeHandleFromUrlOrHandle(
  value: unknown,
  platformHint?: unknown
): string {
  const platform = normalizeSocialHandlePlatform(platformHint);
  return tryParseHandleFromUrl(String(value || ''), platform);
}

export function validateHandleForPlatform(
  platformInput: unknown,
  rawHandle: unknown,
  options: { requireLetters?: boolean; rejectNumericIds?: boolean } = {}
): { allowed: boolean; reason?: HandleValidationReason } {
  const platform = normalizeSocialHandlePlatform(platformInput);
  const handle = sanitizeRawHandle(String(rawHandle || ''));

  if (!platform) return { allowed: false, reason: 'unsupported_platform' };
  if (!handle) return { allowed: false, reason: 'empty' };
  if (!platformPattern(platform).test(handle)) return { allowed: false, reason: 'charset' };

  if (handle.startsWith('.') || handle.endsWith('.')) {
    return { allowed: false, reason: 'edge_punctuation' };
  }
  if (platform !== 'x' && (handle.includes('..') || handle.includes('._') || handle.includes('_.'))) {
    return { allowed: false, reason: 'invalid_punctuation' };
  }

  const requireLetters = options.requireLetters !== false;
  if (requireLetters && !/[a-z]/i.test(handle)) {
    return { allowed: false, reason: 'no_letters' };
  }

  const rejectNumericIds = options.rejectNumericIds !== false;
  if (rejectNumericIds && /^\d{6,}$/.test(handle)) {
    return { allowed: false, reason: 'numeric_id' };
  }

  if (platform === 'instagram' || platform === 'tiktok') {
    if (handle.length < 2 || handle.length > 30) {
      return { allowed: false, reason: 'length' };
    }
  }

  return { allowed: true };
}
