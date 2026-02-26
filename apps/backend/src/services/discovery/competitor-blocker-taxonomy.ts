export type CompetitorBlockerSeverity = 'hard' | 'soft' | 'none';

const HARD_BLOCKER_CODES = new Set([
  'INVALID_HANDLE',
  'PROFILE_UNAVAILABLE',
  'SCRAPE_NOT_ELIGIBLE',
]);

const SOFT_BLOCKER_CODES = new Set([
  'UNSUPPORTED_SCRAPE_PLATFORM',
  'WEBSITE_ONLY_REQUIRES_SURFACE_RESOLUTION',
  'REQUIRES_SURFACE_RESOLUTION',
  'REQUIRES_AUTH',
  'PAYWALL',
  'JS_REQUIRED',
  'RATE_LIMITED',
  'CONNECTOR_DEGRADED',
]);

export function normalizeBlockerReasonCode(code: unknown): string {
  return String(code || '').trim().toUpperCase();
}

export function isHardBlockerReasonCode(code: unknown): boolean {
  const normalized = normalizeBlockerReasonCode(code);
  return normalized ? HARD_BLOCKER_CODES.has(normalized) : false;
}

export function isSoftBlockerReasonCode(code: unknown): boolean {
  const normalized = normalizeBlockerReasonCode(code);
  return normalized ? SOFT_BLOCKER_CODES.has(normalized) : false;
}

export function classifyBlockerSeverity(code: unknown): CompetitorBlockerSeverity {
  const normalized = normalizeBlockerReasonCode(code);
  if (!normalized) return 'none';
  if (isHardBlockerReasonCode(normalized)) return 'hard';
  if (isSoftBlockerReasonCode(normalized)) return 'soft';
  return 'soft';
}

export function describeBlockerReason(code: unknown): { severity: CompetitorBlockerSeverity; label: string } {
  const normalized = normalizeBlockerReasonCode(code);
  const severity = classifyBlockerSeverity(normalized);
  if (!normalized) {
    return { severity, label: 'No blocker' };
  }

  const labels: Record<string, string> = {
    UNSUPPORTED_SCRAPE_PLATFORM: 'Platform not scraped yet',
    WEBSITE_ONLY_REQUIRES_SURFACE_RESOLUTION: 'Website needs social surface resolution',
    REQUIRES_SURFACE_RESOLUTION: 'Needs additional surface resolution',
    REQUIRES_AUTH: 'Requires authentication to access profile',
    PAYWALL: 'Content is paywalled',
    JS_REQUIRED: 'Requires JavaScript rendering',
    RATE_LIMITED: 'Rate-limited; retry later',
    CONNECTOR_DEGRADED: 'Connector degraded; retry later',
    INVALID_HANDLE: 'Invalid handle',
    PROFILE_UNAVAILABLE: 'Profile unavailable',
    SCRAPE_NOT_ELIGIBLE: 'Profile not eligible for scraping',
  };

  return {
    severity,
    label: labels[normalized] || normalized.replace(/_/g, ' ').toLowerCase(),
  };
}
