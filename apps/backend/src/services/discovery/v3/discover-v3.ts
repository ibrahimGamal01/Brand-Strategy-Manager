import crypto from 'node:crypto';
import {
  CompetitorAvailabilityStatus,
  CompetitorCandidateState,
  CompetitorEntityType,
  CompetitorRelationshipType,
  CompetitorScrapeCapability,
  CompetitorSelectionState,
  CompetitorSurfaceType,
  CompetitorType,
  DiscoveredCompetitorStatus,
  EvidenceRefKind,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { fetchAndPersistWebSnapshot } from '../../scraping/web-intelligence-service';
import { searchWeb } from '../../search/search-service';
import { buildMarketFingerprint } from './market-fingerprint';
import { buildLaneQueries } from './query-lanes';
import type {
  CompetitorDiscoveryLane,
  CompetitorDiscoveryV3Candidate,
  CompetitorDiscoveryV3Evidence,
  CompetitorDiscoveryV3Mode,
  CompetitorDiscoveryV3SearchHit,
  DiscoverCompetitorsV3Input,
  DiscoverCompetitorsV3Seed,
  LaneQuery,
  MarketFingerprint,
} from './types';

const LANE_WEIGHTS: Record<CompetitorDiscoveryLane, number> = {
  category: 1.1,
  alternatives: 1.35,
  directories: 1.2,
  social: 1.0,
  community: 0.9,
  people: 0.95,
};

const MODE_BUDGETS: Record<
  CompetitorDiscoveryV3Mode,
  { queryLimit: number; perQueryCount: number; maxCandidates: number; maxEnrich: number }
> = {
  wide: { queryLimit: 28, perQueryCount: 8, maxCandidates: 80, maxEnrich: 4 },
  standard: { queryLimit: 48, perQueryCount: 12, maxCandidates: 140, maxEnrich: 10 },
  deep: { queryLimit: 72, perQueryCount: 14, maxCandidates: 220, maxEnrich: 20 },
};

const PERSON_HINT_RE = /\b(coach|founder|creator|influencer|speaker|author|mentor|personal brand)\b/i;
const COMMUNITY_HINT_RE = /\b(community|forum|subreddit|reddit|discord|facebook group)\b/i;
const MARKETPLACE_HINT_RE = /\b(directory|marketplace|list|top 10|best of|alternatives)\b/i;
const TRACKING_QUERY_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'si',
  'ref',
  'ref_src',
  'source',
]);

function asJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function uniqueStrings(items: string[], max = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = String(item || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeMode(value: unknown): CompetitorDiscoveryV3Mode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'deep') return 'deep';
  if (normalized === 'wide') return 'wide';
  return 'standard';
}

function hostOf(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

function pathParts(value: string): string[] {
  try {
    const parsed = new URL(value);
    return parsed.pathname
      .split('/')
      .map((part) => String(part || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function detectPlatform(url: string): string {
  const host = hostOf(url) || '';
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
  if (host.includes('reddit.com')) return 'community';
  return 'web';
}

function inferHandle(url: string, platform: string): string {
  const parts = pathParts(url);
  if (platform === 'instagram') {
    return String(parts[0] || '').replace(/^@/, '').toLowerCase();
  }
  if (platform === 'tiktok') {
    return String(parts.find((part) => part.startsWith('@')) || parts[0] || '')
      .replace(/^@/, '')
      .toLowerCase();
  }
  if (platform === 'youtube') {
    const at = parts.find((part) => part.startsWith('@'));
    return String(at || parts[0] || '').replace(/^@/, '').toLowerCase();
  }
  if (platform === 'linkedin') {
    if (parts[0] === 'company' && parts[1]) return String(parts[1]).toLowerCase();
    if (parts[0] === 'in' && parts[1]) return String(parts[1]).toLowerCase();
    return String(parts[0] || '').toLowerCase();
  }
  if (platform === 'x') {
    return String(parts[0] || '').replace(/^@/, '').toLowerCase();
  }
  if (platform === 'community') {
    return String(parts[0] || hostOf(url) || '').toLowerCase();
  }
  return String(hostOf(url) || '').toLowerCase();
}

function normalizeHandle(handle: string): string {
  return String(handle || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]/g, '');
}

function cleanNameFromTitle(title: string, url: string): string {
  const cleaned = String(title || '')
    .replace(/\s*[|\-–]\s*(instagram|tiktok|youtube|x|twitter|linkedin).*$/i, '')
    .replace(/\s+[|:-]\s+.*$/, '')
    .trim();
  if (cleaned.length >= 3) return cleaned.slice(0, 160);
  const host = hostOf(url);
  if (!host) return 'Unknown competitor';
  return host.split('.')[0];
}

function laneForRelationship(lane: CompetitorDiscoveryLane): {
  competitorType: CompetitorType;
  relationshipLabel: 'direct' | 'adjacent' | 'indirect' | 'inspiration' | 'community';
} {
  if (lane === 'alternatives') {
    return { competitorType: CompetitorType.DIRECT, relationshipLabel: 'direct' };
  }
  if (lane === 'category' || lane === 'directories') {
    return { competitorType: CompetitorType.ADJACENT, relationshipLabel: 'adjacent' };
  }
  if (lane === 'community') {
    return { competitorType: CompetitorType.COMMUNITY, relationshipLabel: 'community' };
  }
  if (lane === 'people') {
    return { competitorType: CompetitorType.INFLUENCER, relationshipLabel: 'inspiration' };
  }
  return { competitorType: CompetitorType.INDIRECT, relationshipLabel: 'indirect' };
}

function classifyCompetitorType(hit: CompetitorDiscoveryV3SearchHit): {
  competitorType: CompetitorType;
  relationshipLabel: 'direct' | 'adjacent' | 'indirect' | 'inspiration' | 'community';
} {
  const base = laneForRelationship(hit.lane);
  const text = `${hit.item.title} ${hit.item.snippet}`.toLowerCase();
  if (PERSON_HINT_RE.test(text)) {
    return { competitorType: CompetitorType.INFLUENCER, relationshipLabel: 'inspiration' };
  }
  if (COMMUNITY_HINT_RE.test(text)) {
    return { competitorType: CompetitorType.COMMUNITY, relationshipLabel: 'community' };
  }
  if (MARKETPLACE_HINT_RE.test(text)) {
    return { competitorType: CompetitorType.MARKETPLACE, relationshipLabel: 'adjacent' };
  }
  return base;
}

function scoreHit(
  hit: CompetitorDiscoveryV3SearchHit,
  fingerprint: MarketFingerprint,
  occurrenceCount: number
): { score: number; scoreBreakdown: Record<string, number> } {
  const laneWeight = LANE_WEIGHTS[hit.lane] || 1;
  const rankWeight = Math.max(0.15, 1.2 - hit.item.rank * 0.08);
  const occurrenceBoost = Math.min(0.8, occurrenceCount * 0.12);
  const text = `${hit.item.title} ${hit.item.snippet}`.toLowerCase();
  const keywordOverlap = uniqueStrings(
    [...fingerprint.categoryKeywords, ...fingerprint.problemKeywords, ...fingerprint.audienceKeywords],
    24
  ).filter((keyword) => text.includes(keyword.toLowerCase())).length;
  const keywordBoost = Math.min(0.9, keywordOverlap * 0.1);
  const score = laneWeight + rankWeight + occurrenceBoost + keywordBoost;

  return {
    score,
    scoreBreakdown: {
      laneWeight,
      rankWeight,
      occurrenceBoost,
      keywordBoost,
    },
  };
}

function selectionStateFromCandidateState(state: CompetitorCandidateState): CompetitorSelectionState {
  if (state === 'TOP_PICK') return CompetitorSelectionState.TOP_PICK;
  if (state === 'SHORTLISTED') return CompetitorSelectionState.SHORTLISTED;
  if (state === 'APPROVED') return CompetitorSelectionState.APPROVED;
  if (state === 'REJECTED') return CompetitorSelectionState.REJECTED;
  return CompetitorSelectionState.FILTERED_OUT;
}

function stateFromRank(index: number): CompetitorCandidateState {
  if (index < 5) return CompetitorCandidateState.TOP_PICK;
  if (index < 20) return CompetitorCandidateState.SHORTLISTED;
  return CompetitorCandidateState.DISCOVERED;
}

function normalizeEvidenceUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    parsed.hash = '';
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    const pairs = Array.from(parsed.searchParams.entries())
      .filter(([key]) => {
        const normalized = String(key || '').trim().toLowerCase();
        if (!normalized) return false;
        if (normalized.startsWith('utm_')) return false;
        return !TRACKING_QUERY_KEYS.has(normalized);
      })
      .sort(([left], [right]) => left.localeCompare(right));
    parsed.search = '';
    for (const [key, value] of pairs) {
      parsed.searchParams.append(key, value);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
    return parsed.toString();
  } catch {
    return raw;
  }
}

function stableEvidenceRefId(input: {
  candidate: CompetitorDiscoveryV3Candidate;
  entry: CompetitorDiscoveryV3Evidence;
  kind: EvidenceRefKind;
  normalizedUrl: string;
}): string {
  const { candidate, entry, kind, normalizedUrl } = input;
  const digest = crypto
    .createHash('sha256')
    .update(
      [
        'discover_v3',
        kind,
        candidate.platform,
        candidate.normalizedHandle,
        String(entry.lane || ''),
        String(entry.query || ''),
        String(entry.source || ''),
        String(entry.provider || ''),
        String(entry.rank || ''),
        normalizedUrl || String(entry.title || '').trim() || String(entry.snippet || '').trim().slice(0, 180),
      ].join('|')
    )
    .digest('hex')
    .slice(0, 28);
  return `v3_${digest}`;
}

function toRelationshipType(
  label: CompetitorDiscoveryV3Candidate['relationshipLabel']
): CompetitorRelationshipType {
  if (label === 'direct') return CompetitorRelationshipType.DIRECT;
  if (label === 'inspiration') return CompetitorRelationshipType.INSPIRATION;
  if (label === 'community') return CompetitorRelationshipType.COMPLEMENT;
  return CompetitorRelationshipType.INDIRECT;
}

function toEntityType(candidate: CompetitorDiscoveryV3Candidate): CompetitorEntityType {
  if (candidate.competitorType === CompetitorType.INFLUENCER) return CompetitorEntityType.PERSON;
  if (candidate.competitorType === CompetitorType.MARKETPLACE) return CompetitorEntityType.ORG;
  return CompetitorEntityType.BUSINESS;
}

function toSurfaceType(platform: string): CompetitorSurfaceType {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'instagram') return CompetitorSurfaceType.INSTAGRAM;
  if (normalized === 'tiktok') return CompetitorSurfaceType.TIKTOK;
  if (normalized === 'youtube') return CompetitorSurfaceType.YOUTUBE;
  if (normalized === 'linkedin') return CompetitorSurfaceType.LINKEDIN;
  if (normalized === 'x') return CompetitorSurfaceType.X;
  if (normalized === 'community') return CompetitorSurfaceType.DIRECTORY;
  if (normalized === 'web') return CompetitorSurfaceType.WEBSITE;
  return CompetitorSurfaceType.OTHER;
}

function normalizedSurfaceValue(candidate: CompetitorDiscoveryV3Candidate): string {
  const platform = String(candidate.platform || '').trim().toLowerCase();
  if (platform === 'web') return String(candidate.websiteDomain || hostOf(candidate.profileUrl) || candidate.normalizedHandle || '')
    .trim()
    .toLowerCase();
  return String(candidate.normalizedHandle || candidate.handle || candidate.websiteDomain || '')
    .trim()
    .toLowerCase();
}

async function upsertCanonicalEntity(input: {
  researchJobId: string;
  runId: string;
  candidate: CompetitorDiscoveryV3Candidate;
  confidence: number;
}) {
  const { researchJobId, candidate, runId, confidence } = input;
  const primaryDomain = candidate.websiteDomain || hostOf(candidate.profileUrl) || null;
  const canonicalUrl = candidate.profileUrl || null;
  const relationshipType = toRelationshipType(candidate.relationshipLabel);
  const entityType = toEntityType(candidate);
  const tags = uniqueStrings(
    [candidate.platform, candidate.relationshipLabel, ...candidate.laneHits],
    12
  );

  const existing = await prisma.competitorEntity.findFirst({
    where: {
      researchJobId,
      OR: [
        ...(canonicalUrl ? [{ canonicalUrl }] : []),
        ...(primaryDomain ? [{ primaryDomain }] : []),
        { name: candidate.name },
      ],
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.competitorEntity.update({
      where: { id: existing.id },
      data: {
        name: candidate.name,
        entityType,
        primaryDomain,
        canonicalUrl,
        relationshipType,
        confidence,
        tags: asJson(tags),
        fingerprintJson: asJson({
          source: 'discover_v3',
          runId,
          competitorType: candidate.competitorType,
          relationship: candidate.relationshipLabel,
          score: candidate.score,
          scoreBreakdown: candidate.scoreBreakdown,
          laneHits: candidate.laneHits,
        }),
      },
      select: { id: true },
    });
  }

  return prisma.competitorEntity.create({
    data: {
      researchJobId,
      entityType,
      name: candidate.name,
      primaryDomain,
      canonicalUrl,
      relationshipType,
      confidence,
      tags: asJson(tags),
      fingerprintJson: asJson({
        source: 'discover_v3',
        runId,
        competitorType: candidate.competitorType,
        relationship: candidate.relationshipLabel,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown,
        laneHits: candidate.laneHits,
      }),
      createdBy: 'AI',
    },
    select: { id: true },
  });
}

async function upsertCanonicalSurface(input: {
  researchJobId: string;
  entityId: string;
  candidate: CompetitorDiscoveryV3Candidate;
  scrapeEligible: boolean;
  blockerReasonCode: string | null;
}) {
  const { researchJobId, entityId, candidate, scrapeEligible, blockerReasonCode } = input;
  const surfaceType = toSurfaceType(candidate.platform);
  const normalizedValue = normalizedSurfaceValue(candidate);
  if (!normalizedValue) {
    throw new Error(`Missing normalized surface value for ${candidate.platform}:${candidate.handle}`);
  }
  const scrapeCapability = scrapeEligible
    ? CompetitorScrapeCapability.SCRAPABLE_NOW
    : CompetitorScrapeCapability.NOT_SCRAPABLE_YET;

  return prisma.competitorSurface.upsert({
    where: {
      researchJobId_surfaceType_normalizedValue: {
        researchJobId,
        surfaceType,
        normalizedValue,
      },
    },
    create: {
      researchJobId,
      entityId,
      surfaceType,
      value: candidate.profileUrl || candidate.handle || candidate.name,
      normalizedValue,
      url: candidate.profileUrl || null,
      scrapeCapability,
      blockerReasonCode,
      metadata: asJson({
        platform: candidate.platform,
        handle: candidate.handle,
        score: candidate.score,
      }),
    },
    update: {
      entityId,
      value: candidate.profileUrl || candidate.handle || candidate.name,
      url: candidate.profileUrl || null,
      scrapeCapability,
      blockerReasonCode,
      metadata: asJson({
        platform: candidate.platform,
        handle: candidate.handle,
        score: candidate.score,
      }),
    },
    select: { id: true },
  });
}

async function createCanonicalEvidenceRefs(input: {
  researchJobId: string;
  runId: string;
  entityId: string;
  surfaceId: string;
  candidate: CompetitorDiscoveryV3Candidate;
}): Promise<number> {
  const { researchJobId, runId, entityId, surfaceId, candidate } = input;
  const rows = candidate.evidence
    .slice(0, 12)
    .map((entry) => {
      const source = String(entry.source || '').trim().toLowerCase();
      const kind =
        source === 'web_snapshot'
          ? EvidenceRefKind.WEB_SNAPSHOT
          : source.includes('news')
            ? EvidenceRefKind.NEWS_ITEM
            : source.includes('reddit') || source.includes('community')
              ? EvidenceRefKind.URL
              : EvidenceRefKind.URL;
      const url = normalizeEvidenceUrl(String(entry.url || ''));
      const title = String(entry.title || '').trim();
      const snippet = String(entry.snippet || '').trim();
      const label = title || `${candidate.name} evidence`;
      const refId = stableEvidenceRefId({
        candidate,
        entry,
        kind,
        normalizedUrl: url,
      });
      return {
        researchJobId,
        entityId,
        surfaceId,
        kind,
        refId,
        url: url || null,
        label: label.slice(0, 280),
        metadata: asJson({
          source: 'discover_v3',
          runId,
          lane: entry.lane,
          query: entry.query,
          rank: entry.rank,
          snippet: snippet.slice(0, 800),
          provider: entry.provider,
        }),
      };
    })
    .filter((entry) => Boolean(entry.label));

  if (!rows.length) return 0;
  const result = await prisma.evidenceRef.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return Number(result.count || 0);
}

async function findOrCreateIdentity(researchJobId: string, canonicalName: string, websiteDomain: string | null) {
  const existing = await prisma.competitorIdentity.findFirst({
    where: {
      researchJobId,
      OR: [
        { canonicalName, websiteDomain: websiteDomain || undefined },
        { canonicalName },
      ],
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.competitorIdentity.create({
    data: {
      researchJobId,
      canonicalName,
      websiteDomain,
    },
    select: { id: true },
  });
  return created.id;
}

async function enrichCandidatesWithSnapshots(
  researchJobId: string,
  candidates: CompetitorDiscoveryV3Candidate[],
  maxEnrich: number
): Promise<{ enriched: number; warnings: string[] }> {
  let enriched = 0;
  const warnings: string[] = [];
  const targets = candidates
    .filter((candidate) => candidate.platform === 'web' || candidate.platform === 'linkedin' || candidate.platform === 'youtube')
    .slice(0, maxEnrich);

  for (const candidate of targets) {
    try {
      const snapshot = await fetchAndPersistWebSnapshot({
        researchJobId,
        url: candidate.profileUrl,
        sourceType: 'COMPETITOR_SITE',
        discoveredBy: 'CHAT_TOOL',
        allowExternal: true,
        mode: 'AUTO',
      });
      candidate.evidence.push({
        lane: candidate.laneHits[0] || 'category',
        query: 'enrichment:web.fetch',
        rank: 0,
        source: 'web_snapshot',
        url: snapshot.finalUrl,
        title: `Snapshot ${snapshot.snapshotId}`,
        snippet: `Fetched snapshot ${snapshot.snapshotId} (status ${snapshot.statusCode || 'n/a'})`,
        provider: 'scrapling',
      });
      enriched += 1;
    } catch (error: any) {
      warnings.push(`Enrichment failed for ${candidate.profileUrl}: ${String(error?.message || error)}`);
    }
  }
  return { enriched, warnings };
}

function aggregateCandidates(
  hits: CompetitorDiscoveryV3SearchHit[],
  fingerprint: MarketFingerprint
): CompetitorDiscoveryV3Candidate[] {
  const grouped = new Map<string, CompetitorDiscoveryV3SearchHit[]>();
  for (const hit of hits) {
    const platform = detectPlatform(hit.item.url);
    const handle = normalizeHandle(inferHandle(hit.item.url, platform));
    if (!handle) continue;
    const key = `${platform}:${handle}`;
    const group = grouped.get(key) || [];
    group.push(hit);
    grouped.set(key, group);
  }

  const candidates: CompetitorDiscoveryV3Candidate[] = [];
  for (const [key, group] of grouped.entries()) {
    const first = group[0];
    const platform = detectPlatform(first.item.url);
    const handle = normalizeHandle(inferHandle(first.item.url, platform));
    if (!handle) continue;
    const url = first.item.url;
    const domain = hostOf(url);
    const laneHits = uniqueStrings(group.map((entry) => entry.lane), 6) as CompetitorDiscoveryLane[];
    const evidence: CompetitorDiscoveryV3Evidence[] = group
      .slice(0, 12)
      .map((entry) => ({
        lane: entry.lane,
        query: entry.query,
        rank: entry.item.rank,
        source: entry.item.source || entry.provider,
        url: entry.item.url,
        title: entry.item.title,
        snippet: entry.item.snippet,
        provider: entry.provider,
      }));
    const type = classifyCompetitorType(first);
    const scoreData = scoreHit(first, fingerprint, group.length);

    candidates.push({
      key,
      name: cleanNameFromTitle(first.item.title, first.item.url),
      platform,
      handle,
      normalizedHandle: handle,
      profileUrl: url,
      websiteDomain: domain,
      competitorType: type.competitorType,
      relationshipLabel: type.relationshipLabel,
      score: scoreData.score,
      scoreBreakdown: scoreData.scoreBreakdown,
      evidence,
      laneHits,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

async function persistCandidates(input: {
  researchJobId: string;
  runId: string;
  candidates: CompetitorDiscoveryV3Candidate[];
  limit: number;
}): Promise<{
  persisted: number;
  topPicks: number;
  shortlisted: number;
  discovered: number;
  canonicalEntities: number;
  canonicalSurfaces: number;
  canonicalEvidenceRefs: number;
  artifacts: Array<{ kind: string; section?: string; id: string }>;
}> {
  const artifacts: Array<{ kind: string; section?: string; id: string }> = [];
  let persisted = 0;
  let topPicks = 0;
  let shortlisted = 0;
  let discovered = 0;
  let canonicalEntities = 0;
  let canonicalSurfaces = 0;
  let canonicalEvidenceRefs = 0;

  const limited = input.candidates.slice(0, input.limit);
  for (let index = 0; index < limited.length; index += 1) {
    const candidate = limited[index];
    const state = stateFromRank(index);
    if (state === CompetitorCandidateState.TOP_PICK) topPicks += 1;
    if (state === CompetitorCandidateState.SHORTLISTED) shortlisted += 1;
    if (state === CompetitorCandidateState.DISCOVERED) discovered += 1;

    const identityId = await findOrCreateIdentity(
      input.researchJobId,
      candidate.name,
      candidate.websiteDomain
    );

    const scrapeEligible = candidate.platform === 'instagram' || candidate.platform === 'tiktok';
    const blockerReasonCode = scrapeEligible ? null : 'UNSUPPORTED_SCRAPE_PLATFORM';
    const typeConfidence = Math.max(0.4, Math.min(0.98, candidate.score / 3.4));

    const profile = await prisma.competitorCandidateProfile.upsert({
      where: {
        researchJobId_platform_normalizedHandle: {
          researchJobId: input.researchJobId,
          platform: candidate.platform,
          normalizedHandle: candidate.normalizedHandle,
        },
      },
      create: {
        researchJobId: input.researchJobId,
        orchestrationRunId: input.runId,
        identityId,
        platform: candidate.platform,
        handle: candidate.handle,
        normalizedHandle: candidate.normalizedHandle,
        profileUrl: candidate.profileUrl,
        source: 'V3_SEARCH',
        inputType: candidate.platform,
        scrapeEligible,
        blockerReasonCode,
        availabilityStatus: CompetitorAvailabilityStatus.UNVERIFIED,
        state,
        stateReason: `V3 ranked score ${candidate.score.toFixed(2)} from lanes: ${candidate.laneHits.join(', ')}`,
        competitorType: candidate.competitorType,
        typeConfidence,
        relevanceScore: candidate.score,
        scoreBreakdown: asJson(candidate.scoreBreakdown),
        evidence: asJson({
          relationship: candidate.relationshipLabel,
          laneHits: candidate.laneHits,
        }),
      },
      update: {
        orchestrationRunId: input.runId,
        identityId,
        profileUrl: candidate.profileUrl,
        source: 'V3_SEARCH',
        inputType: candidate.platform,
        scrapeEligible,
        blockerReasonCode,
        state,
        stateReason: `V3 ranked score ${candidate.score.toFixed(2)} from lanes: ${candidate.laneHits.join(', ')}`,
        competitorType: candidate.competitorType,
        typeConfidence,
        relevanceScore: candidate.score,
        scoreBreakdown: asJson(candidate.scoreBreakdown),
        evidence: asJson({
          relationship: candidate.relationshipLabel,
          laneHits: candidate.laneHits,
        }),
      },
      select: { id: true, platform: true, handle: true, profileUrl: true },
    });

    persisted += 1;
    artifacts.push({
      kind: 'intelligence_row',
      section: 'competitor_accounts',
      id: profile.id,
    });

    const canonicalEntity = await upsertCanonicalEntity({
      researchJobId: input.researchJobId,
      runId: input.runId,
      candidate,
      confidence: typeConfidence,
    });
    canonicalEntities += 1;
    artifacts.push({
      kind: 'competitor_entity',
      section: 'competitor_entities',
      id: canonicalEntity.id,
    });

    const canonicalSurface = await upsertCanonicalSurface({
      researchJobId: input.researchJobId,
      entityId: canonicalEntity.id,
      candidate,
      scrapeEligible,
      blockerReasonCode,
    });
    canonicalSurfaces += 1;
    artifacts.push({
      kind: 'competitor_surface',
      section: 'competitor_surfaces',
      id: canonicalSurface.id,
    });

    await prisma.competitorCandidateEvidence.deleteMany({
      where: { candidateProfileId: profile.id },
    });
    if (candidate.evidence.length > 0) {
      await prisma.competitorCandidateEvidence.createMany({
        data: candidate.evidence.slice(0, 12).map((entry) => ({
          candidateProfileId: profile.id,
          sourceType: `v3_${entry.lane}`,
          query: entry.query,
          title: entry.title,
          url: entry.url,
          snippet: entry.snippet,
          signalScore: candidate.score,
        })),
      });
      const createdEvidenceRefCount = await createCanonicalEvidenceRefs({
        researchJobId: input.researchJobId,
        runId: input.runId,
        entityId: canonicalEntity.id,
        surfaceId: canonicalSurface.id,
        candidate,
      });
      canonicalEvidenceRefs += createdEvidenceRefCount;
      if (createdEvidenceRefCount > 0) {
        artifacts.push({
          kind: 'evidence_ref',
          section: 'evidence_refs',
          id: canonicalSurface.id,
        });
      }
    }

    if (scrapeEligible && (state === CompetitorCandidateState.TOP_PICK || state === CompetitorCandidateState.SHORTLISTED)) {
      await prisma.discoveredCompetitor.upsert({
        where: {
          researchJobId_platform_handle: {
            researchJobId: input.researchJobId,
            platform: profile.platform,
            handle: profile.handle,
          },
        },
        create: {
          researchJobId: input.researchJobId,
          orchestrationRunId: input.runId,
          candidateProfileId: profile.id,
          handle: profile.handle,
          platform: profile.platform,
          profileUrl: profile.profileUrl,
          relevanceScore: candidate.score,
          evidence: asJson({
            relationship: candidate.relationshipLabel,
            laneHits: candidate.laneHits,
          }),
          selectionState: selectionStateFromCandidateState(state),
          selectionReason: `Promoted from V3 search lane(s): ${candidate.laneHits.join(', ')}`,
          competitorType: candidate.competitorType,
          typeConfidence,
          status: DiscoveredCompetitorStatus.SUGGESTED,
          availabilityStatus: CompetitorAvailabilityStatus.UNVERIFIED,
        },
        update: {
          orchestrationRunId: input.runId,
          candidateProfileId: profile.id,
          profileUrl: profile.profileUrl,
          relevanceScore: candidate.score,
          evidence: asJson({
            relationship: candidate.relationshipLabel,
            laneHits: candidate.laneHits,
          }),
          selectionState: selectionStateFromCandidateState(state),
          selectionReason: `Promoted from V3 search lane(s): ${candidate.laneHits.join(', ')}`,
          competitorType: candidate.competitorType,
          typeConfidence,
          availabilityStatus: CompetitorAvailabilityStatus.UNVERIFIED,
        },
      });
    }
  }

  return {
    persisted,
    topPicks,
    shortlisted,
    discovered,
    canonicalEntities,
    canonicalSurfaces,
    canonicalEvidenceRefs,
    artifacts,
  };
}

function parseSeedCompetitors(input: DiscoverCompetitorsV3Input): DiscoverCompetitorsV3Seed[] {
  if (!Array.isArray(input.seedCompetitors)) return [];
  return input.seedCompetitors
    .map((row) => ({
      ...(typeof row?.name === 'string' && row.name.trim() ? { name: row.name.trim() } : {}),
      ...(typeof row?.url === 'string' && row.url.trim() ? { url: row.url.trim() } : {}),
      ...(typeof row?.handle === 'string' && row.handle.trim() ? { handle: row.handle.trim().replace(/^@+/, '') } : {}),
    }))
    .filter((seed) => Boolean(seed.name || seed.url || seed.handle))
    .slice(0, 30);
}

async function executeLaneQuery(query: LaneQuery, count: number): Promise<CompetitorDiscoveryV3SearchHit[]> {
  const response = await searchWeb({
    query: query.query,
    count,
    vertical: 'web',
    locale: query.locale,
    provider: 'auto',
  });

  return response.items.map((item) => ({
    lane: query.lane,
    query: query.query,
    locale: query.locale,
    provider: response.provider,
    item,
  }));
}

export async function discoverCompetitorsV3(
  researchJobId: string,
  rawInput: DiscoverCompetitorsV3Input
): Promise<{
  runId: string;
  mode: CompetitorDiscoveryV3Mode;
  summary: {
    queriesExecuted: number;
    searchResults: number;
    candidatesRanked: number;
    candidatesPersisted: number;
    canonicalEntities: number;
    canonicalSurfaces: number;
    canonicalEvidenceRefs: number;
    topPicks: number;
    shortlisted: number;
    discovered: number;
    enriched: number;
  };
  fingerprint: MarketFingerprint;
  topCandidates: Array<{
    platform: string;
    handle: string;
    name: string;
    profileUrl: string;
    score: number;
    relationship: string;
    competitorType: CompetitorType;
    laneHits: CompetitorDiscoveryLane[];
  }>;
  laneStats: Record<string, { queries: number; hits: number }>;
  artifacts: Array<{ kind: string; section?: string; id: string }>;
  evidence: Array<{ kind: string; label: string; url?: string }>;
  warnings: string[];
}> {
  const mode = normalizeMode(rawInput.mode);
  const budget = MODE_BUDGETS[mode];
  const maxCandidates = Number.isFinite(Number(rawInput.maxCandidates))
    ? Math.max(20, Math.min(300, Math.floor(Number(rawInput.maxCandidates))))
    : budget.maxCandidates;
  const maxEnrich = Number.isFinite(Number(rawInput.maxEnrich))
    ? Math.max(0, Math.min(40, Math.floor(Number(rawInput.maxEnrich))))
    : budget.maxEnrich;

  const run = await prisma.competitorOrchestrationRun.create({
    data: {
      researchJobId,
      platforms: asJson([]),
      targetCount: maxCandidates,
      mode: 'append',
      status: 'RUNNING',
      strategyVersion: 'v3-wide',
      configSnapshot: asJson({
        mode,
        lanes: rawInput.lanes || null,
        locales: rawInput.locales || ['en-US'],
        includePeople: rawInput.includePeople !== false,
        maxCandidates,
        maxEnrich,
      }),
      phase: 'wide_search',
    },
    select: { id: true },
  });

  const warnings: string[] = [];

  try {
    const seedCompetitors = parseSeedCompetitors(rawInput);
    const fingerprint = await buildMarketFingerprint(researchJobId, seedCompetitors);
    const laneQueries = buildLaneQueries(fingerprint, {
      ...rawInput,
      mode,
    }).slice(0, budget.queryLimit);

    const laneStats = new Map<string, { queries: number; hits: number }>();
    for (const lane of laneQueries.map((entry) => entry.lane)) {
      if (!laneStats.has(lane)) laneStats.set(lane, { queries: 0, hits: 0 });
    }

    const allHits: CompetitorDiscoveryV3SearchHit[] = [];
    for (const laneQuery of laneQueries) {
      const state = laneStats.get(laneQuery.lane) || { queries: 0, hits: 0 };
      state.queries += 1;
      laneStats.set(laneQuery.lane, state);
      try {
        const hits = await executeLaneQuery(laneQuery, budget.perQueryCount);
        state.hits += hits.length;
        laneStats.set(laneQuery.lane, state);
        allHits.push(...hits);
      } catch (error: any) {
        warnings.push(`Query failed (${laneQuery.lane}): ${laneQuery.query} — ${String(error?.message || error)}`);
      }
    }

    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: {
        phase: 'candidate_ranking',
        diagnostics: asJson({
          queriesExecuted: laneQueries.length,
          rawHits: allHits.length,
        }),
      },
    });

    const rankedCandidates = aggregateCandidates(allHits, fingerprint).slice(0, maxCandidates);
    const enrichment = await enrichCandidatesWithSnapshots(researchJobId, rankedCandidates, maxEnrich);
    warnings.push(...enrichment.warnings.slice(0, 10));

    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: {
        phase: 'persisting',
      },
    });

    const persistence = await persistCandidates({
      researchJobId,
      runId: run.id,
      candidates: rankedCandidates,
      limit: maxCandidates,
    });

    const platformSet = uniqueStrings(rankedCandidates.map((candidate) => candidate.platform), 12);
    const summary = {
      queriesExecuted: laneQueries.length,
      searchResults: allHits.length,
      candidatesRanked: rankedCandidates.length,
      candidatesPersisted: persistence.persisted,
      canonicalEntities: persistence.canonicalEntities,
      canonicalSurfaces: persistence.canonicalSurfaces,
      canonicalEvidenceRefs: persistence.canonicalEvidenceRefs,
      topPicks: persistence.topPicks,
      shortlisted: persistence.shortlisted,
      discovered: persistence.discovered,
      enriched: enrichment.enriched,
    };

    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        phase: 'completed',
        completedAt: new Date(),
        platforms: asJson(platformSet),
        summary: asJson(summary),
        diagnostics: asJson({
          laneStats: Object.fromEntries(laneStats.entries()),
          warnings: warnings.slice(0, 20),
        }),
      },
    });

    const topCandidates = rankedCandidates.slice(0, 20).map((candidate) => ({
      platform: candidate.platform,
      handle: candidate.handle,
      name: candidate.name,
      profileUrl: candidate.profileUrl,
      score: Number(candidate.score.toFixed(3)),
      relationship: candidate.relationshipLabel,
      competitorType: candidate.competitorType,
      laneHits: candidate.laneHits,
    }));

    const evidence = rankedCandidates
      .slice(0, 8)
      .map((candidate) => ({
        kind: 'url',
        label: `${candidate.name} (${candidate.relationshipLabel}, score ${candidate.score.toFixed(2)})`,
        url: candidate.profileUrl,
      }));

    return {
      runId: run.id,
      mode,
      summary,
      fingerprint,
      topCandidates,
      laneStats: Object.fromEntries(laneStats.entries()),
      artifacts: [
        { kind: 'orchestration_run', section: 'competitor_accounts', id: run.id },
        ...persistence.artifacts.slice(0, 40),
      ],
      evidence,
      warnings: uniqueStrings(warnings, 20),
    };
  } catch (error: any) {
    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        phase: 'failed',
        completedAt: new Date(),
        errorCode: 'V3_DISCOVERY_FAILED',
        diagnostics: asJson({
          error: String(error?.message || error),
          stack: String(error?.stack || '').slice(0, 4000),
        }),
      },
    });
    throw error;
  }
}
