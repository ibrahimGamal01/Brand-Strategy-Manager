import { prisma } from '../../lib/prisma';

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
