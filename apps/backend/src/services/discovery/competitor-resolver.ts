import { CompetitorAvailabilityStatus } from '@prisma/client';
import axios from 'axios';
import { validateHandleDDG } from './duckduckgo-search';
import { CollectedCandidate } from './competitor-collector';
import { ConnectorHealthTracker } from './connector-health';
import { WebsitePolicy } from './competitor-policy-engine';

export interface ResolvedCandidate extends CollectedCandidate {
  availabilityStatus: CompetitorAvailabilityStatus;
  availabilityReason: string | null;
  resolverConfidence: number;
}

export interface ResolverDiagnostics {
  verifiedCount: number;
  profileUnavailableCount: number;
  byStatus: Record<CompetitorAvailabilityStatus, number>;
  skippedDeepValidationCount: number;
  deepValidatedCount: number;
}

export interface ResolverPolicyInput {
  websitePolicy: WebsitePolicy;
}

const VALIDATION_MAX_PER_PLATFORM = Math.max(
  4,
  Number(process.env.COMPETITOR_VALIDATION_MAX_PER_PLATFORM || 8)
);
const VALIDATION_CONCURRENCY = Math.max(
  1,
  Number(process.env.COMPETITOR_VALIDATION_CONCURRENCY || 6)
);

const GENERIC_LOW_SIGNAL_HANDLES = new Set([
  'reel',
  'reels',
  'explore',
  'viral',
  'motivation',
  'quotes',
  'business',
  'entrepreneur',
  'startup',
  'news',
]);

const LOW_SIGNAL_HANDLE_RE = /(coupon|deal|giveaway|fan|meme|quotes|viral|clip|news|promo)/i;

function normalizeReason(reason: string | undefined | null, fallback: string): string {
  const value = String(reason || '').trim();
  return value.length > 0 ? value.slice(0, 280) : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function classifyConnectorFailure(reason: string): CompetitorAvailabilityStatus {
  const lower = reason.toLowerCase();
  if (/(429|rate limit|too many requests)/i.test(lower)) {
    return 'RATE_LIMITED';
  }
  return 'CONNECTOR_ERROR';
}

function looksValidWebsiteDomain(domain: string): boolean {
  const value = String(domain || '').toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) && !value.includes('..');
}

function websiteEvidenceCounts(candidate: CollectedCandidate): {
  sourceCount: number;
  urlEvidenceCount: number;
  hostMatchCount: number;
} {
  const sourceCount = new Set(candidate.sources.map((item) => String(item || '').trim()).filter(Boolean)).size;
  const urlEvidence = candidate.evidence.filter((row) => Boolean(row.url));
  const urlEvidenceCount = urlEvidence.length;
  const normalizedHost = String(candidate.normalizedHandle || '').toLowerCase();

  const hostMatchCount = urlEvidence.reduce((sum, row) => {
    try {
      const parsed = new URL(String(row.url));
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      if (host === normalizedHost) return sum + 1;
      return sum;
    } catch {
      return sum;
    }
  }, 0);

  return {
    sourceCount,
    urlEvidenceCount,
    hostMatchCount,
  };
}

function candidateKey(candidate: CollectedCandidate): string {
  return `${candidate.platform}:${candidate.normalizedHandle}`;
}

function candidatePriority(candidate: CollectedCandidate): number {
  const sourcesScore = Math.min(candidate.sources.length, 4) * 0.35;
  const evidenceScore = Math.min(candidate.evidence.length, 4) * 0.15;
  const urlEvidence = candidate.evidence.some((row) => Boolean(row.url)) ? 0.4 : 0;
  return candidate.baseSignal + sourcesScore + evidenceScore + urlEvidence;
}

function shouldSkipDeepValidation(candidate: CollectedCandidate): { skip: boolean; reason?: string } {
  if (candidate.platform !== 'instagram' && candidate.platform !== 'tiktok') {
    return { skip: false };
  }

  const handle = String(candidate.normalizedHandle || '').toLowerCase();
  const hasStrongEvidence =
    candidate.baseSignal >= 0.7 ||
    candidate.sources.length >= 2 ||
    candidate.evidence.some((row) => Boolean(row.url) && (row.signalScore || 0) >= 0.55);

  if (!hasStrongEvidence) {
    if (handle.length < 4 || GENERIC_LOW_SIGNAL_HANDLES.has(handle) || LOW_SIGNAL_HANDLE_RE.test(handle)) {
      return { skip: true, reason: 'Low-signal generic handle' };
    }
  }

  return { skip: false };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: size }).map(async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) break;
        await worker(items[index]);
      }
    })
  );
}

async function probeTikTokProfileViaHttp(handle: string): Promise<{
  availabilityStatus: CompetitorAvailabilityStatus;
  availabilityReason: string;
  resolverConfidence: number;
}> {
  const clean = String(handle || '').trim().replace(/^@+/, '');
  if (!clean) {
    return {
      availabilityStatus: 'INVALID_HANDLE',
      availabilityReason: 'Invalid TikTok handle',
      resolverConfidence: 0.05,
    };
  }

  try {
    const response = await axios.get(`https://www.tiktok.com/@${clean}`, {
      timeout: 12000,
      maxRedirects: 2,
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const body = String(response.data || '').toLowerCase();
    const unavailableSignal =
      body.includes("couldn't find this account") ||
      body.includes("profile isn't available") ||
      body.includes('profile is not available') ||
      body.includes('\"statuscode\":10216') ||
      body.includes('\"statuscode\":10215');

    if (response.status === 429) {
      return {
        availabilityStatus: 'RATE_LIMITED',
        availabilityReason: 'TikTok profile probe was rate limited',
        resolverConfidence: 0.22,
      };
    }

    if (response.status === 404 || unavailableSignal) {
      return {
        availabilityStatus: 'PROFILE_UNAVAILABLE',
        availabilityReason: 'TikTok profile is not available',
        resolverConfidence: 0.9,
      };
    }

    if (response.status === 200) {
      return {
        availabilityStatus: 'VERIFIED',
        availabilityReason: 'Verified via direct TikTok profile probe',
        resolverConfidence: 0.68,
      };
    }

    if (response.status >= 500) {
      return {
        availabilityStatus: 'CONNECTOR_ERROR',
        availabilityReason: `TikTok profile probe failed with status ${response.status}`,
        resolverConfidence: 0.2,
      };
    }

    return {
      availabilityStatus: 'CONNECTOR_ERROR',
      availabilityReason: `TikTok profile probe returned status ${response.status}`,
      resolverConfidence: 0.2,
    };
  } catch (error: any) {
    const message = String(error?.message || 'TikTok profile probe failed');
    if (/(429|rate limit|too many requests)/i.test(message)) {
      return {
        availabilityStatus: 'RATE_LIMITED',
        availabilityReason: 'TikTok profile probe rate limited',
        resolverConfidence: 0.2,
      };
    }
    return {
      availabilityStatus: 'CONNECTOR_ERROR',
      availabilityReason: `TikTok profile probe failed: ${message}`,
      resolverConfidence: 0.12,
    };
  }
}

async function probeInstagramProfileViaHttp(handle: string): Promise<{
  availabilityStatus: CompetitorAvailabilityStatus;
  availabilityReason: string;
  resolverConfidence: number;
}> {
  const clean = String(handle || '').trim().replace(/^@+/, '');
  if (!clean) {
    return {
      availabilityStatus: 'INVALID_HANDLE',
      availabilityReason: 'Invalid Instagram handle',
      resolverConfidence: 0.05,
    };
  }

  try {
    const response = await axios.get(`https://www.instagram.com/${clean}/`, {
      timeout: 12000,
      maxRedirects: 2,
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const body = String(response.data || '').toLowerCase();
    const unavailableSignal =
      body.includes("sorry, this page isn't available") ||
      body.includes('profile is not available') ||
      body.includes('this content is unavailable') ||
      body.includes('\"error_type\":\"not_found\"');

    if (response.status === 429) {
      return {
        availabilityStatus: 'RATE_LIMITED',
        availabilityReason: 'Instagram profile probe was rate limited',
        resolverConfidence: 0.22,
      };
    }

    if (response.status === 404 || unavailableSignal) {
      return {
        availabilityStatus: 'PROFILE_UNAVAILABLE',
        availabilityReason: 'Instagram profile is not available',
        resolverConfidence: 0.9,
      };
    }

    if (response.status === 200) {
      return {
        availabilityStatus: 'VERIFIED',
        availabilityReason: 'Verified via direct Instagram profile probe',
        resolverConfidence: 0.7,
      };
    }

    if (response.status >= 500) {
      return {
        availabilityStatus: 'CONNECTOR_ERROR',
        availabilityReason: `Instagram profile probe failed with status ${response.status}`,
        resolverConfidence: 0.2,
      };
    }

    return {
      availabilityStatus: 'CONNECTOR_ERROR',
      availabilityReason: `Instagram profile probe returned status ${response.status}`,
      resolverConfidence: 0.2,
    };
  } catch (error: any) {
    const message = String(error?.message || 'Instagram profile probe failed');
    if (/(429|rate limit|too many requests)/i.test(message)) {
      return {
        availabilityStatus: 'RATE_LIMITED',
        availabilityReason: 'Instagram profile probe rate limited',
        resolverConfidence: 0.2,
      };
    }
    return {
      availabilityStatus: 'CONNECTOR_ERROR',
      availabilityReason: `Instagram profile probe failed: ${message}`,
      resolverConfidence: 0.12,
    };
  }
}

async function resolveCandidate(
  candidate: CollectedCandidate,
  connectorHealth: ConnectorHealthTracker,
  policy: ResolverPolicyInput
): Promise<ResolvedCandidate> {
  const platform = candidate.platform;
  if (platform === 'instagram' || platform === 'tiktok') {
    try {
      const result = await validateHandleDDG(candidate.handle, platform);
      connectorHealth.markOk('ddg_handle_validation');

      if (result.is_valid) {
        const confidence = clamp01(result.confidence || 0.72);
        return {
          ...candidate,
          availabilityStatus: 'VERIFIED',
          availabilityReason: normalizeReason(result.reason, 'Verified'),
          resolverConfidence: confidence,
        };
      }

      if (platform === 'instagram') {
        const probe = await probeInstagramProfileViaHttp(candidate.handle);
        if (probe.availabilityStatus === 'VERIFIED') {
          connectorHealth.markOk('instagram_resolver');
          return {
            ...candidate,
            availabilityStatus: 'VERIFIED',
            availabilityReason: probe.availabilityReason,
            resolverConfidence: clamp01(Math.max(probe.resolverConfidence, result.confidence || 0)),
          };
        }
        if (probe.availabilityStatus === 'RATE_LIMITED' || probe.availabilityStatus === 'CONNECTOR_ERROR') {
          connectorHealth.markDegraded('instagram_resolver', probe.availabilityReason);
        }
        if (
          probe.availabilityStatus === 'PROFILE_UNAVAILABLE' ||
          probe.availabilityStatus === 'INVALID_HANDLE' ||
          probe.availabilityStatus === 'RATE_LIMITED'
        ) {
          return {
            ...candidate,
            availabilityStatus: probe.availabilityStatus,
            availabilityReason: probe.availabilityReason,
            resolverConfidence: clamp01(probe.resolverConfidence),
          };
        }
      }

      if (platform === 'tiktok') {
        const probe = await probeTikTokProfileViaHttp(candidate.handle);
        if (probe.availabilityStatus === 'VERIFIED') {
          connectorHealth.markOk('tiktok_resolver');
          return {
            ...candidate,
            availabilityStatus: 'VERIFIED',
            availabilityReason: probe.availabilityReason,
            resolverConfidence: clamp01(Math.max(probe.resolverConfidence, result.confidence || 0)),
          };
        }
        if (probe.availabilityStatus === 'RATE_LIMITED' || probe.availabilityStatus === 'CONNECTOR_ERROR') {
          connectorHealth.markDegraded('tiktok_resolver', probe.availabilityReason);
        }
        if (
          probe.availabilityStatus === 'PROFILE_UNAVAILABLE' ||
          probe.availabilityStatus === 'INVALID_HANDLE' ||
          probe.availabilityStatus === 'RATE_LIMITED'
        ) {
          return {
            ...candidate,
            availabilityStatus: probe.availabilityStatus,
            availabilityReason: probe.availabilityReason,
            resolverConfidence: clamp01(probe.resolverConfidence),
          };
        }
      }

      if (result.error) {
        const status = classifyConnectorFailure(result.error);
        if (platform === 'instagram') {
          connectorHealth.markDegraded('instagram_resolver', result.error);
        }
        if (platform === 'tiktok') {
          connectorHealth.markDegraded('tiktok_resolver', result.error);
        }
        return {
          ...candidate,
          availabilityStatus: status,
          availabilityReason: normalizeReason(result.reason || result.error, 'Resolver error'),
          resolverConfidence: clamp01(result.confidence || 0.2),
        };
      }

      return {
        ...candidate,
        availabilityStatus: 'PROFILE_UNAVAILABLE',
        availabilityReason: normalizeReason(result.reason, 'Profile is not available'),
        resolverConfidence: clamp01(result.confidence || 0.2),
      };
    } catch (error: any) {
      const message = String(error?.message || 'Handle validation failed');
      const status = classifyConnectorFailure(message);
      connectorHealth.markDegraded('ddg_handle_validation', message);
      if (platform === 'instagram') {
        connectorHealth.markDegraded('instagram_resolver', message);
      }
      if (platform === 'tiktok') {
        connectorHealth.markDegraded('tiktok_resolver', message);
      }
      return {
        ...candidate,
        availabilityStatus: status,
        availabilityReason: normalizeReason(message, 'Resolver error'),
        resolverConfidence: 0.1,
      };
    }
  }

  if (platform === 'website') {
    if (looksValidWebsiteDomain(candidate.normalizedHandle)) {
      const evidence = websiteEvidenceCounts(candidate);
      const minSources = policy.websitePolicy === 'peer_candidate' ? 2 : 1;
      const minUrlEvidence = policy.websitePolicy === 'peer_candidate' ? 2 : 1;
      const minHostMatches = policy.websitePolicy === 'evidence_only' ? 1 : 1;

      const corroborated =
        evidence.sourceCount >= minSources &&
        evidence.urlEvidenceCount >= minUrlEvidence &&
        evidence.hostMatchCount >= minHostMatches;

      if (!corroborated) {
        return {
          ...candidate,
          availabilityStatus: 'UNVERIFIED',
          availabilityReason: 'Website domain syntax valid, but corroborating evidence is insufficient',
          resolverConfidence: 0.36,
        };
      }

      const policyConfidence =
        policy.websitePolicy === 'peer_candidate'
          ? 0.66
          : policy.websitePolicy === 'fallback_only'
            ? 0.62
            : 0.58;
      return {
        ...candidate,
        availabilityStatus: 'VERIFIED',
        availabilityReason: 'Website domain corroborated by multi-source URL evidence',
        resolverConfidence: policyConfidence,
      };
    }
    return {
      ...candidate,
      availabilityStatus: 'INVALID_HANDLE',
      availabilityReason: 'Invalid website domain',
      resolverConfidence: 0.1,
    };
  }

  const hasProfileSignal = Boolean(candidate.profileUrl || candidate.evidence.some((row) => Boolean(row.url)));
  return {
    ...candidate,
    availabilityStatus: hasProfileSignal ? 'VERIFIED' : 'UNVERIFIED',
    availabilityReason: hasProfileSignal ? 'Resolved from cross-surface profile evidence' : 'Not enough profile evidence',
    resolverConfidence: hasProfileSignal ? 0.62 : 0.35,
  };
}

export async function resolveCandidateAvailability(
  candidates: CollectedCandidate[],
  connectorHealth: ConnectorHealthTracker,
  policy: ResolverPolicyInput
): Promise<{ candidates: ResolvedCandidate[]; diagnostics: ResolverDiagnostics }> {
  const resolvedMap = new Map<string, ResolvedCandidate>();
  const deepValidationPoolByPlatform: Record<'instagram' | 'tiktok', CollectedCandidate[]> = {
    instagram: [],
    tiktok: [],
  };
  const quickResolveCandidates: CollectedCandidate[] = [];
  let skippedDeepValidationCount = 0;

  for (const candidate of candidates) {
    if (candidate.platform !== 'instagram' && candidate.platform !== 'tiktok') {
      quickResolveCandidates.push(candidate);
      continue;
    }

    const skip = shouldSkipDeepValidation(candidate);
    if (skip.skip) {
      skippedDeepValidationCount += 1;
      resolvedMap.set(candidateKey(candidate), {
        ...candidate,
        availabilityStatus: 'UNVERIFIED',
        availabilityReason: skip.reason || 'Skipped deep validation',
        resolverConfidence: 0.22,
      });
      continue;
    }

    deepValidationPoolByPlatform[candidate.platform].push(candidate);
  }

  const deepValidationQueue: CollectedCandidate[] = [];
  for (const platform of ['instagram', 'tiktok'] as const) {
    const prioritized = [...deepValidationPoolByPlatform[platform]].sort(
      (a, b) => candidatePriority(b) - candidatePriority(a)
    );
    const allowed = prioritized.slice(0, VALIDATION_MAX_PER_PLATFORM);
    const overflow = prioritized.slice(VALIDATION_MAX_PER_PLATFORM);
    deepValidationQueue.push(...allowed);
    for (const candidate of overflow) {
      skippedDeepValidationCount += 1;
      resolvedMap.set(candidateKey(candidate), {
        ...candidate,
        availabilityStatus: 'UNVERIFIED',
        availabilityReason: 'Deferred deep validation due candidate cap',
        resolverConfidence: 0.24,
      });
    }
  }

  let deepValidatedCount = 0;
  await runWithConcurrency(deepValidationQueue, VALIDATION_CONCURRENCY, async (candidate) => {
    const resolved = await resolveCandidate(candidate, connectorHealth, policy);
    resolvedMap.set(candidateKey(candidate), resolved);
    deepValidatedCount += 1;
  });

  for (const candidate of quickResolveCandidates) {
    resolvedMap.set(candidateKey(candidate), await resolveCandidate(candidate, connectorHealth, policy));
  }

  const resolved: ResolvedCandidate[] = candidates.map((candidate) => {
    const key = candidateKey(candidate);
    return (
      resolvedMap.get(key) || {
        ...candidate,
        availabilityStatus: 'UNVERIFIED',
        availabilityReason: 'Resolver fallback',
        resolverConfidence: 0.2,
      }
    );
  });

  const byStatus: Record<CompetitorAvailabilityStatus, number> = {
    UNVERIFIED: 0,
    VERIFIED: 0,
    PROFILE_UNAVAILABLE: 0,
    INVALID_HANDLE: 0,
    RATE_LIMITED: 0,
    CONNECTOR_ERROR: 0,
  };

  for (const candidate of resolved) {
    byStatus[candidate.availabilityStatus] = (byStatus[candidate.availabilityStatus] || 0) + 1;
  }

  return {
    candidates: resolved,
    diagnostics: {
      verifiedCount: byStatus.VERIFIED,
      profileUnavailableCount: byStatus.PROFILE_UNAVAILABLE + byStatus.INVALID_HANDLE,
      byStatus,
      skippedDeepValidationCount,
      deepValidatedCount,
    },
  };
}
