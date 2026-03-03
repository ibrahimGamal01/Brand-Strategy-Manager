import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  buildPlatformHandles,
  getProfileUrl,
  normalizeWebsiteDomain,
  parseStringList,
  syncBrainGoals,
} from '../intake/brain-intake-utils';
import { searchRawDDG } from '../discovery/duckduckgo-search';
import { evaluatePendingQuestionSets } from '../intake/question-workflow';
import { suggestIntakeCompletion, type IntakeSuggestionStep } from '../intake/suggest-intake-completion';
import { resumeResearchJob } from '../social/research-resume';
import {
  parseSocialReferenceList,
  parseWebsiteList,
  resolveIntakeWebsites,
  seedPortalIntakeWebsites,
} from './portal-intake-websites';

type IntakePlatform = 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'linkedin';

type IntakeHandles = Record<IntakePlatform, string>;
type IntakeHandlesV2Item = {
  primary: string;
  handles: string[];
};
type IntakeHandlesV2 = Record<IntakePlatform, IntakeHandlesV2Item>;

export type PortalWorkspaceIntakePrefill = {
  name: string;
  website: string;
  websites: string[];
  socialReferences: string[];
  oneSentenceDescription: string;
  niche: string;
  businessType: string;
  operateWhere: string;
  wantClientsWhere: string;
  idealAudience: string;
  targetAudience: string;
  geoScope: string;
  servicesList: string;
  mainOffer: string;
  primaryGoal: string;
  secondaryGoals: string;
  futureGoal: string;
  engineGoal: string;
  topProblems: string;
  resultsIn90Days: string;
  questionsBeforeBuying: string;
  brandVoiceWords: string;
  brandTone: string;
  topicsToAvoid: string;
  constraints: string;
  excludedCategories: string;
  language: string;
  planningHorizon: string;
  autonomyLevel: 'assist' | 'auto';
  budgetSensitivity: string;
  competitorInspirationLinks: string;
  handles: IntakeHandles;
  handlesV2: IntakeHandlesV2;
};

export type PortalWorkspaceIntakeStatus = {
  workspaceId: string;
  required: boolean;
  completed: boolean;
  readyForChat: boolean;
  source: string;
  updatedAt: string;
  prefill: PortalWorkspaceIntakePrefill;
  pendingQuestionSets: Array<{
    id: string;
    title: string;
    description?: string;
    questionCount: number;
  }>;
};

export type PortalWorkspaceIntakeSubmitResult = {
  success: true;
  workspaceId: string;
  client: {
    id: string;
    name: string;
  };
  researchJob: {
    id: string;
    status: string;
  };
  handles: Record<string, string>;
  pendingQuestionSets: PortalWorkspaceIntakeStatus['pendingQuestionSets'];
  message: string;
};

type WorkspaceWithClient = Prisma.ResearchJobGetPayload<{
  include: {
    client: {
      include: {
        clientAccounts: true;
        brainProfile: true;
      };
    };
  };
}>;

const EMPTY_HANDLES: IntakeHandles = {
  instagram: '',
  tiktok: '',
  youtube: '',
  twitter: '',
  linkedin: '',
};
const EMPTY_HANDLES_V2: IntakeHandlesV2 = {
  instagram: { primary: '', handles: [] },
  tiktok: { primary: '', handles: [] },
  youtube: { primary: '', handles: [] },
  twitter: { primary: '', handles: [] },
  linkedin: { primary: '', handles: [] },
};

function logIntakeSuggestEvent(input: {
  event:
    | 'INTAKE_SUGGEST_STEP_STARTED'
    | 'INTAKE_SUGGEST_STEP_COMPLETED'
    | 'INTAKE_SUGGEST_LOW_SIGNAL_BLOCKED'
    | 'INTAKE_SOCIAL_CANDIDATES_EMITTED';
  workspaceId: string;
  step?: IntakeSuggestionStep;
  warnings?: string[];
  candidateCount?: number;
  suggestedFieldCount?: number;
  durationMs?: number;
}) {
  const payload: Record<string, unknown> = {
    event: input.event,
    workspaceId: input.workspaceId,
    step: input.step || null,
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    candidateCount: Number.isFinite(input.candidateCount as number)
      ? Math.max(0, Math.floor(input.candidateCount as number))
      : 0,
    suggestedFieldCount: Number.isFinite(input.suggestedFieldCount as number)
      ? Math.max(0, Math.floor(input.suggestedFieldCount as number))
      : 0,
    durationMs: Number.isFinite(input.durationMs as number)
      ? Math.max(0, Math.floor(input.durationMs as number))
      : 0,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function stringify(value: unknown): string {
  return String(value || '').trim();
}

function joinLines(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join('\n');
  }
  return stringify(value);
}

function normalizeHandle(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function normalizeHandleList(value: unknown, maxItems = 5): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,;|]+/)
      : [];
  return Array.from(
    new Set(
      values
        .map((entry) => normalizeHandle(entry))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

function toAccountPlatform(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'x' || normalized === 'twitter') return 'x';
  return normalized;
}

function fromAccountPlatform(value: string): IntakePlatform | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'instagram') return 'instagram';
  if (normalized === 'tiktok') return 'tiktok';
  if (normalized === 'youtube') return 'youtube';
  if (normalized === 'linkedin') return 'linkedin';
  if (normalized === 'x' || normalized === 'twitter') return 'twitter';
  return null;
}

function parseList(value: unknown, maxItems = 12): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  return text
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function compactText(value: unknown, maxChars = 2400): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function getHostname(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function buildEvidenceHostnames(payload: Record<string, unknown>): Set<string> {
  const websites = parseWebsiteList([payload.website, payload.websites], 8);
  const socialReferences = parseSocialReferenceList([payload.socialReferences], 12);
  return new Set(
    [...websites, ...socialReferences]
      .map((entry) => getHostname(entry))
      .filter(Boolean)
  );
}

function buildBrandTokens(payload: Record<string, unknown>): string[] {
  const nameTokens = String(payload.name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 5);
  const websiteTokens = parseWebsiteList([payload.website, payload.websites], 3)
    .map((entry) => {
      const host = getHostname(entry);
      return host.split('.')[0] || '';
    })
    .map((token) => token.replace(/[^a-z0-9]+/g, ''))
    .filter((token) => token.length >= 3);
  return Array.from(new Set([...nameTokens, ...websiteTokens])).slice(0, 12);
}

function countTokenHits(text: string, tokens: string[]): number {
  if (!text || !tokens.length) return 0;
  let hits = 0;
  for (const token of tokens) {
    if (text.includes(token)) hits += 1;
  }
  return hits;
}

function evidenceSignalScore(text: string): number {
  let score = 0;
  if (
    /(offer|offers|service|services|program|product|products|subscription|pricing|plans|book|consult|demo|audience|who we help|benefit|results|case study|solution|positioning)/i.test(
      text
    )
  ) {
    score += 2;
  }
  if (/(about|mission|value proposition|what we do|why choose|for professionals|for teams)/i.test(text)) {
    score += 1;
  }
  return score;
}

function shouldRunLiveDdgSuggest(): boolean {
  const value = String(process.env.PORTAL_INTAKE_LIVE_DDG_SUGGEST || 'true')
    .trim()
    .toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function collectHandleSeedsFromPayload(payload: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const pushValue = (raw: unknown) => {
    const normalized = String(raw || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!normalized) return;
    if (normalized.length < 2 || normalized.length > 80) return;
    if (/[^a-z0-9._-]/i.test(normalized)) return;
    out.add(normalized);
  };

  const handles = asRecord(payload.handles);
  for (const value of Object.values(handles)) {
    pushValue(value);
  }

  const handlesV2 = asRecord(payload.handlesV2);
  for (const bucketRaw of Object.values(handlesV2)) {
    const bucket = asRecord(bucketRaw);
    pushValue(bucket.primary);
    const list = Array.isArray(bucket.handles) ? bucket.handles : [];
    for (const value of list) {
      pushValue(value);
    }
  }

  const socialReferences = parseSocialReferenceList([payload.socialReferences], 12);
  for (const ref of socialReferences) {
    const lowered = ref.toLowerCase();
    const patterns: RegExp[] = [];
    if (lowered.includes('linkedin.com/')) {
      patterns.push(/linkedin\.com\/(?:in|company)\/([a-z0-9-]{2,100})/i);
    }
    if (lowered.includes('instagram.com/')) {
      patterns.push(/instagram\.com\/([a-z0-9._]{2,40})/i);
    }
    if (lowered.includes('tiktok.com/')) {
      patterns.push(/tiktok\.com\/@?([a-z0-9._]{2,40})/i);
    }
    if (lowered.includes('youtube.com/')) {
      patterns.push(/youtube\.com\/(?:@|c\/|user\/|channel\/)?([a-z0-9._-]{2,80})/i);
    }
    if (lowered.includes('x.com/') || lowered.includes('twitter.com/')) {
      patterns.push(/(?:x|twitter)\.com\/([a-z0-9_]{1,40})/i);
    }
    for (const pattern of patterns) {
      const match = ref.match(pattern)?.[1];
      if (match) pushValue(match);
    }
  }

  return Array.from(out).slice(0, 12);
}

function buildLiveDdgSuggestQueries(payload: Record<string, unknown>): string[] {
  const name = String(payload.name || '').trim();
  const websites = parseWebsiteList([payload.website, payload.websites], 3);
  const website = websites[0] || '';
  const domain = getHostname(website);
  const socialReferences = parseSocialReferenceList([payload.socialReferences], 6);
  const socialHints = socialReferences
    .map((entry) => {
      const host = getHostname(entry);
      if (host.includes('linkedin.com')) return 'linkedin';
      if (host.includes('instagram.com')) return 'instagram';
      if (host.includes('tiktok.com')) return 'tiktok';
      if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
      if (host.includes('x.com') || host.includes('twitter.com')) return 'twitter';
      return '';
    })
    .filter(Boolean)
    .slice(0, 3);
  const handleSeeds = collectHandleSeedsFromPayload(payload);
  const handleQueries = handleSeeds.flatMap((seed) => [
    `"${seed}" "linkedin"`,
    `"${seed}" "instagram"`,
    `"${seed}" "tiktok"`,
    `site:linkedin.com "${seed}"`,
  ]);
  const queries = [
    [name, domain].filter(Boolean).join(' ').trim(),
    domain ? `site:${domain}` : '',
    domain ? `site:${domain} services` : '',
    domain ? `site:${domain} about` : '',
    [name, 'what they do'].filter(Boolean).join(' ').trim(),
    [name, 'services pricing'].filter(Boolean).join(' ').trim(),
    [domain, 'about services'].filter(Boolean).join(' ').trim(),
    socialHints.length > 0 ? `${name || domain} ${socialHints.join(' ')}` : '',
    ...handleQueries,
  ]
    .map((query) => query.trim())
    .filter(Boolean);
  return Array.from(new Set(queries)).slice(0, 16);
}

async function buildWebsiteEvidenceSummary(
  workspaceId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const hostnames = buildEvidenceHostnames(payload);
  const brandTokens = buildBrandTokens(payload);

  const snapshots = await prisma.webPageSnapshot.findMany({
    where: { researchJobId: workspaceId, isActive: true },
    orderBy: { fetchedAt: 'desc' },
    take: 50,
    select: {
      finalUrl: true,
      cleanText: true,
      fetchedAt: true,
    },
  });

  const filtered = snapshots
    .filter((row) => String(row.cleanText || '').trim().length > 0)
    .map((row) => {
      const url = String(row.finalUrl || '').trim();
      const host = getHostname(url);
      const text = compactText(row.cleanText || '', 2000);
      const lowered = text.toLowerCase();
      const hostScore = host && hostnames.has(host) ? 2 : 0;
      const tokenHits = countTokenHits(lowered, brandTokens);
      const signalScore = evidenceSignalScore(lowered);
      return {
        row,
        url,
        text,
        score: hostScore + tokenHits + signalScore,
      };
    })
    .filter((item) => (hostnames.size > 0 ? item.score > 0 : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!filtered.length) return '';

  const lines = filtered.map((item, index) => {
    const excerpt = compactText(item.text, 1200);
    return `Snapshot ${index + 1}: ${item.url}\n${excerpt}`;
  });

  return compactText(lines.join('\n\n'), 5000);
}

async function buildDdgEvidenceSummary(
  workspaceId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const hostnames = buildEvidenceHostnames(payload);
  const brandTokens = buildBrandTokens(payload);

  const rawRows = await prisma.rawSearchResult.findMany({
    where: { researchJobId: workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: {
      query: true,
      title: true,
      href: true,
      body: true,
      createdAt: true,
      source: true,
    },
  });

  const filteredRaw = rawRows
    .map((row) => {
      const hrefHost = getHostname(String(row.href || ''));
      const lowered = `${row.title || ''} ${row.body || ''} ${row.href || ''}`.toLowerCase();
      const hostMatch = hrefHost && hostnames.has(hrefHost);
      const tokenHits = countTokenHits(lowered, brandTokens);
      const signalScore = evidenceSignalScore(lowered);
      return {
        row,
        hostMatch,
        tokenHits,
        score: (hostMatch ? 3 : 0) + tokenHits + signalScore,
      };
    })
    .filter((item) => {
      if (!hostnames.size) return item.score > 0;
      if (item.hostMatch) return item.score > 0;
      return item.score >= 2 && item.tokenHits >= 1;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((item) => item.row);

  const newsRows = await prisma.ddgNewsResult.findMany({
    where: { researchJobId: workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      title: true,
      body: true,
      url: true,
      query: true,
      source: true,
    },
  });

  const filteredNews = newsRows
    .map((row) => {
      const hrefHost = getHostname(String(row.url || ''));
      const lowered = `${row.title || ''} ${row.body || ''} ${row.url || ''}`.toLowerCase();
      const hostMatch = hrefHost && hostnames.has(hrefHost);
      const tokenHits = countTokenHits(lowered, brandTokens);
      const signalScore = evidenceSignalScore(lowered);
      return {
        row,
        hostMatch,
        tokenHits,
        score: (hostMatch ? 3 : 0) + tokenHits + signalScore,
      };
    })
    .filter((item) => {
      if (!hostnames.size) return item.score > 0;
      if (item.hostMatch) return item.score > 0;
      return item.score >= 2 && item.tokenHits >= 1;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.row);

  if (!filteredRaw.length && !filteredNews.length) return '';

  const rawLines = filteredRaw.map((row, index) => {
    const title = compactText(row.title || '', 180);
    const href = String(row.href || '').trim();
    const body = compactText(row.body || '', 300);
    return `Raw ${index + 1}: ${title}\nURL: ${href}\n${body}`;
  });

  const newsLines = filteredNews.map((row, index) => {
    const title = compactText(row.title || '', 180);
    const href = String(row.url || '').trim();
    const body = compactText(row.body || '', 300);
    return `News ${index + 1}: ${title}\nURL: ${href}\n${body}`;
  });

  return compactText(
    [`DDG raw context:`, ...rawLines, '', 'DDG news context:', ...newsLines].join('\n'),
    5000
  );
}

function stripUndefinedFromJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedFromJson(entry))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value === undefined ? null : value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    out[key] = stripUndefinedFromJson(entry);
  }
  return out;
}

function ensurePrimaryForHandlesV2Item(item: IntakeHandlesV2Item): IntakeHandlesV2Item {
  const normalizedHandles = normalizeHandleList(item.handles, 5);
  const primary = normalizeHandle(item.primary);
  const resolvedPrimary =
    normalizedHandles.includes(primary) ? primary : normalizedHandles[0] || '';
  return {
    primary: resolvedPrimary,
    handles: normalizedHandles,
  };
}

function collectHandlesV2(job: WorkspaceWithClient): IntakeHandlesV2 {
  const handles: IntakeHandlesV2 = {
    instagram: { ...EMPTY_HANDLES_V2.instagram, handles: [] },
    tiktok: { ...EMPTY_HANDLES_V2.tiktok, handles: [] },
    youtube: { ...EMPTY_HANDLES_V2.youtube, handles: [] },
    twitter: { ...EMPTY_HANDLES_V2.twitter, handles: [] },
    linkedin: { ...EMPTY_HANDLES_V2.linkedin, handles: [] },
  };
  const input = asRecord(job.inputData);
  const inputHandles = asRecord(input.handles);
  const inputHandlesV2 = asRecord(input.handlesV2);
  const primaryHandlesByPlatform = asRecord(input.primaryHandlesByPlatform);

  for (const [platformRaw, rawBucket] of Object.entries(inputHandlesV2)) {
    const platform = fromAccountPlatform(platformRaw);
    if (!platform) continue;
    const bucket = asRecord(rawBucket);
    const list = normalizeHandleList(bucket.handles, 5);
    for (const handle of list) {
      if (!handles[platform].handles.includes(handle)) {
        handles[platform].handles.push(handle);
      }
    }
    const primary = normalizeHandle(bucket.primary || primaryHandlesByPlatform[platform]);
    if (primary && handles[platform].handles.includes(primary)) {
      handles[platform].primary = primary;
    }
  }

  for (const [platformRaw, handleRaw] of Object.entries(inputHandles)) {
    const platform = fromAccountPlatform(platformRaw);
    if (!platform) continue;
    const handle = normalizeHandle(handleRaw);
    if (!handle) continue;
    if (!handles[platform].handles.includes(handle)) {
      handles[platform].handles.push(handle);
    }
    if (!handles[platform].primary) {
      handles[platform].primary = handle;
    }
  }

  const channels = Array.isArray(input.channels) ? input.channels : [];
  for (const row of channels) {
    const rowRecord = asRecord(row);
    const platform = fromAccountPlatform(stringify(rowRecord.platform));
    if (!platform) continue;
    const handle = normalizeHandle(rowRecord.handle);
    if (!handle) continue;
    if (!handles[platform].handles.includes(handle)) {
      handles[platform].handles.push(handle);
    }
    if (!handles[platform].primary) {
      handles[platform].primary = handle;
    }
  }

  for (const account of job.client.clientAccounts) {
    const platform = fromAccountPlatform(account.platform);
    if (!platform) continue;
    const handle = normalizeHandle(account.handle);
    if (!handle) continue;
    if (!handles[platform].handles.includes(handle)) {
      handles[platform].handles.push(handle);
    }
    if (!handles[platform].primary) {
      handles[platform].primary = handle;
    }
  }

  (Object.keys(handles) as IntakePlatform[]).forEach((platform) => {
    const primary = normalizeHandle(primaryHandlesByPlatform[platform]);
    if (primary && handles[platform].handles.includes(primary)) {
      handles[platform].primary = primary;
    }
    handles[platform] = ensurePrimaryForHandlesV2Item(handles[platform]);
  });

  return handles;
}

function collectHandles(job: WorkspaceWithClient): IntakeHandles {
  const handlesV2 = collectHandlesV2(job);
  return {
    instagram: handlesV2.instagram.primary || '',
    tiktok: handlesV2.tiktok.primary || '',
    youtube: handlesV2.youtube.primary || '',
    twitter: handlesV2.twitter.primary || '',
    linkedin: handlesV2.linkedin.primary || '',
  };
}

function hasRequiredIntakeData(prefill: PortalWorkspaceIntakePrefill): boolean {
  const hasName = stringify(prefill.name).length > 0;
  const hasChannel =
    Object.values(prefill.handles).some((handle) => normalizeHandle(handle).length > 0) ||
    Object.values(prefill.handlesV2 || {}).some((bucket) =>
      Array.isArray(bucket?.handles) ? bucket.handles.some((entry) => normalizeHandle(entry).length > 0) : false,
    );
  const hasWebsite =
    stringify(prefill.website).length > 0 || parseWebsiteList(prefill.websites, 1).length > 0;
  return hasName && (hasChannel || hasWebsite);
}

function buildConstraintObject(
  payload: Record<string, unknown>,
  existingConstraints: Record<string, unknown>
): Record<string, unknown> {
  const excludedCategories = parseStringList(
    payload.excludedCategories ?? existingConstraints.excludedCategories
  );
  const topicsToAvoid = parseList(
    payload.topicsToAvoid ?? existingConstraints.topicsToAvoid,
    20
  );

  return {
    ...existingConstraints,
    operatorGoal: stringify(payload.engineGoal) || stringify(payload.operatorGoal) || undefined,
    businessConstraints: stringify(payload.constraints) || undefined,
    excludedCategories: excludedCategories.length ? excludedCategories : undefined,
    autonomyLevel: stringify(payload.autonomyLevel) || undefined,
    budgetSensitivity: stringify(payload.budgetSensitivity) || undefined,
    brandTone: stringify(payload.brandTone) || undefined,
    brandVoiceWords: stringify(payload.brandVoiceWords) || undefined,
    topicsToAvoid: topicsToAvoid.length ? topicsToAvoid : undefined,
    language: stringify(payload.language) || undefined,
    planningHorizon: stringify(payload.planningHorizon) || undefined,
  };
}

function buildPrefill(job: WorkspaceWithClient): PortalWorkspaceIntakePrefill {
  const input = asRecord(job.inputData);
  const profile = job.client.brainProfile;
  const constraints = asRecord(profile?.constraints);
  const websites = parseWebsiteList([input.website, input.websites], 8);
  const socialReferences = parseSocialReferenceList(
    [input.socialReferences, input.website, input.websites],
    12
  );
  const websiteFromInput = stringify(input.website);
  const websiteFromInputIsSocial = parseSocialReferenceList([websiteFromInput], 1).length > 0;
  const primaryWebsite = websites[0] || (websiteFromInputIsSocial ? '' : websiteFromInput);
  const handlesV2 = collectHandlesV2(job);
  const handles = collectHandles(job);

  return {
    name: stringify(input.brandName) || job.client.name || '',
    website: primaryWebsite,
    websites,
    socialReferences,
    oneSentenceDescription:
      stringify(input.description) || stringify(input.businessOverview) || stringify(job.client.businessOverview),
    niche: stringify(input.niche),
    businessType: stringify(input.businessType) || stringify(profile?.businessType),
    operateWhere: stringify(input.operateWhere),
    wantClientsWhere: stringify(input.wantClientsWhere),
    idealAudience: stringify(input.idealAudience),
    targetAudience: stringify(input.targetAudience) || stringify(profile?.targetMarket),
    geoScope: stringify(input.geoScope) || stringify(profile?.geoScope),
    servicesList: joinLines(input.servicesList),
    mainOffer: stringify(input.mainOffer) || stringify(profile?.offerModel),
    primaryGoal: stringify(input.primaryGoal) || stringify(profile?.primaryGoal),
    secondaryGoals: joinLines(input.secondaryGoals || profile?.secondaryGoals),
    futureGoal: stringify(input.futureGoal),
    engineGoal: stringify(input.engineGoal || constraints.operatorGoal),
    topProblems: joinLines(input.topProblems),
    resultsIn90Days: joinLines(input.resultsIn90Days),
    questionsBeforeBuying: joinLines(input.questionsBeforeBuying),
    brandVoiceWords: stringify(input.brandVoiceWords || constraints.brandVoiceWords),
    brandTone: stringify(input.brandTone || constraints.brandTone),
    topicsToAvoid: joinLines(input.topicsToAvoid || constraints.topicsToAvoid),
    constraints: stringify(input.businessConstraints || constraints.businessConstraints),
    excludedCategories: joinLines(input.excludedCategories || constraints.excludedCategories),
    language: stringify(input.language || constraints.language),
    planningHorizon: stringify(input.planningHorizon || constraints.planningHorizon),
    autonomyLevel: stringify(input.autonomyLevel || constraints.autonomyLevel) === 'auto' ? 'auto' : 'assist',
    budgetSensitivity: stringify(input.budgetSensitivity || constraints.budgetSensitivity),
    competitorInspirationLinks: joinLines(input.competitorInspirationLinks),
    handles,
    handlesV2,
  };
}

function buildHandlesV2FromPayload(payload: Record<string, unknown>): IntakeHandlesV2 {
  const handlesV2: IntakeHandlesV2 = {
    instagram: { ...EMPTY_HANDLES_V2.instagram, handles: [] },
    tiktok: { ...EMPTY_HANDLES_V2.tiktok, handles: [] },
    youtube: { ...EMPTY_HANDLES_V2.youtube, handles: [] },
    twitter: { ...EMPTY_HANDLES_V2.twitter, handles: [] },
    linkedin: { ...EMPTY_HANDLES_V2.linkedin, handles: [] },
  };

  const payloadHandlesV2 = asRecord(payload.handlesV2);
  for (const [platformRaw, rawBucket] of Object.entries(payloadHandlesV2)) {
    const platform = fromAccountPlatform(platformRaw);
    if (!platform) continue;
    const bucket = asRecord(rawBucket);
    const handles = normalizeHandleList(bucket.handles, 5);
    const primary = normalizeHandle(bucket.primary);
    handlesV2[platform] = ensurePrimaryForHandlesV2Item({
      primary,
      handles,
    });
  }

  const payloadHandles = asRecord(payload.handles);
  for (const [platformRaw, handleRaw] of Object.entries(payloadHandles)) {
    const platform = fromAccountPlatform(platformRaw);
    if (!platform) continue;
    const handle = normalizeHandle(handleRaw);
    if (!handle) continue;
    if (!handlesV2[platform].handles.includes(handle)) {
      handlesV2[platform].handles.push(handle);
    }
    if (!handlesV2[platform].primary) {
      handlesV2[platform].primary = handle;
    }
  }

  (Object.keys(handlesV2) as IntakePlatform[]).forEach((platform) => {
    handlesV2[platform] = ensurePrimaryForHandlesV2Item(handlesV2[platform]);
  });

  return handlesV2;
}

function flattenHandlesV2(handlesV2: IntakeHandlesV2): Array<{ platform: string; handle: string }> {
  const out: Array<{ platform: string; handle: string }> = [];
  for (const [platform, bucket] of Object.entries(handlesV2) as Array<[IntakePlatform, IntakeHandlesV2Item]>) {
    const ordered = bucket.primary
      ? [bucket.primary, ...bucket.handles.filter((handle) => handle !== bucket.primary)]
      : bucket.handles;
    for (const handle of ordered.slice(0, 5)) {
      out.push({
        platform: platform === 'twitter' ? 'x' : platform,
        handle,
      });
    }
  }
  return out;
}

function toLegacyHandles(handlesV2: IntakeHandlesV2): IntakeHandles {
  return {
    instagram: handlesV2.instagram.primary || '',
    tiktok: handlesV2.tiktok.primary || '',
    youtube: handlesV2.youtube.primary || '',
    twitter: handlesV2.twitter.primary || '',
    linkedin: handlesV2.linkedin.primary || '',
  };
}

async function getWorkspaceWithClient(workspaceId: string): Promise<WorkspaceWithClient | null> {
  return prisma.researchJob.findUnique({
    where: { id: workspaceId },
    include: {
      client: {
        include: {
          clientAccounts: true,
          brainProfile: true,
        },
      },
    },
  });
}

function summarizeQuestionSets(
  sets: Awaited<ReturnType<typeof evaluatePendingQuestionSets>>
): PortalWorkspaceIntakeStatus['pendingQuestionSets'] {
  return sets.map((set) => ({
    id: set.id,
    title: set.title,
    ...(set.description ? { description: set.description } : {}),
    questionCount: set.questions.length,
  }));
}

export async function getPortalWorkspaceIntakeStatus(
  workspaceId: string
): Promise<PortalWorkspaceIntakeStatus | null> {
  const workspace = await getWorkspaceWithClient(workspaceId);
  if (!workspace) return null;

  const prefill = buildPrefill(workspace);
  const input = asRecord(workspace.inputData);
  const source = stringify(input.source) || 'portal_intro_form';
  const explicitCompletion =
    source === 'portal_intro_form' ||
    source === 'portal_intro_form_v2' ||
    Boolean(stringify(input.intakeCompletedAt));
  const completed = hasRequiredIntakeData(prefill) && explicitCompletion;
  const pendingSets = completed ? await evaluatePendingQuestionSets(workspaceId) : [];

  return {
    workspaceId,
    required: !completed,
    completed,
    readyForChat: completed,
    source,
    updatedAt: workspace.client.updatedAt.toISOString(),
    prefill,
    pendingQuestionSets: summarizeQuestionSets(pendingSets),
  };
}

export async function suggestPortalWorkspaceIntakeCompletion(
  workspaceId: string,
  partialPayload: Record<string, unknown>
) {
  const startedAt = Date.now();
  const workspace = await getWorkspaceWithClient(workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }
  const prefill = buildPrefill(workspace);
  const rawStep = stringify(partialPayload.step).toLowerCase();
  const suggestionStep: IntakeSuggestionStep | undefined =
    rawStep === 'brand' ||
    rawStep === 'channels' ||
    rawStep === 'offer' ||
    rawStep === 'audience' ||
    rawStep === 'voice'
      ? rawStep
      : undefined;
  logIntakeSuggestEvent({
    event: 'INTAKE_SUGGEST_STEP_STARTED',
    workspaceId,
    step: suggestionStep,
  });

  const payload = {
    ...prefill,
    ...partialPayload,
    socialReferences: parseSocialReferenceList(
      [partialPayload.socialReferences, partialPayload.website, partialPayload.websites, prefill.socialReferences],
      12
    ),
    handles:
      partialPayload.handles && typeof partialPayload.handles === 'object'
        ? partialPayload.handles
        : prefill.handles,
    handlesV2:
      partialPayload.handlesV2 && typeof partialPayload.handlesV2 === 'object'
        ? partialPayload.handlesV2
        : prefill.handlesV2,
  };

  const websiteEvidence = await buildWebsiteEvidenceSummary(workspaceId, payload).catch((error) => {
    console.warn(
      `[PortalIntake] Failed to build website evidence summary for ${workspaceId}:`,
      (error as Error)?.message || String(error)
    );
    return '';
  });
  let ddgEvidence = await buildDdgEvidenceSummary(workspaceId, payload).catch((error) => {
    console.warn(
      `[PortalIntake] Failed to build DDG evidence summary for ${workspaceId}:`,
      (error as Error)?.message || String(error)
    );
    return '';
  });
  if (!ddgEvidence && shouldRunLiveDdgSuggest()) {
    const liveQueries = buildLiveDdgSuggestQueries(payload);
    if (liveQueries.length > 0) {
      try {
        await searchRawDDG(liveQueries, {
          researchJobId: workspaceId,
          source: 'portal_intake_suggest_live_ddg',
          maxResults: 80,
          timeoutMs: 45_000,
        });
        ddgEvidence = await buildDdgEvidenceSummary(workspaceId, payload).catch(() => '');
      } catch (error) {
        console.warn(
          `[PortalIntake] Live DDG suggest enrichment failed for ${workspaceId}:`,
          (error as Error)?.message || String(error)
        );
      }
    }
  }

  const payloadWithEvidence = {
    ...payload,
    ...(websiteEvidence ? { _websiteEvidence: websiteEvidence } : {}),
    ...(ddgEvidence ? { _ddgEvidence: ddgEvidence } : {}),
  };

  try {
    const scopeRaw = stringify(partialPayload.scope).toLowerCase();
    const overwritePolicyRaw = stringify(partialPayload.overwritePolicy).toLowerCase();
    const fieldMeta = asRecord(partialPayload.fieldMeta);
    const result = await suggestIntakeCompletion(payloadWithEvidence, {
      step: suggestionStep,
      scope: scopeRaw === 'step' ? 'step' : 'global',
      overwritePolicy: overwritePolicyRaw === 'missing_only' ? 'missing_only' : 'missing_or_low_signal',
      fieldMeta: fieldMeta as any,
    });
    const warnings = Array.isArray((result as { warnings?: string[] }).warnings)
      ? ((result as { warnings?: string[] }).warnings as string[])
      : [];
    const candidateCount = Array.isArray((result as { suggestedHandleCandidates?: unknown[] }).suggestedHandleCandidates)
      ? ((result as { suggestedHandleCandidates?: unknown[] }).suggestedHandleCandidates as unknown[]).length
      : 0;
    const suggestedFieldCount = result.suggested && typeof result.suggested === 'object'
      ? Object.keys(result.suggested).length
      : 0;

    logIntakeSuggestEvent({
      event: 'INTAKE_SUGGEST_STEP_COMPLETED',
      workspaceId,
      step: suggestionStep,
      warnings,
      candidateCount,
      suggestedFieldCount,
      durationMs: Date.now() - startedAt,
    });

    if (warnings.includes('LOW_SIGNAL_COPY')) {
      logIntakeSuggestEvent({
        event: 'INTAKE_SUGGEST_LOW_SIGNAL_BLOCKED',
        workspaceId,
        step: suggestionStep,
        warnings,
        durationMs: Date.now() - startedAt,
      });
    }

    if (candidateCount > 0) {
      logIntakeSuggestEvent({
        event: 'INTAKE_SOCIAL_CANDIDATES_EMITTED',
        workspaceId,
        step: suggestionStep,
        warnings,
        candidateCount,
        durationMs: Date.now() - startedAt,
      });
    }

    return result;
  } catch (error) {
    console.warn(
      `[PortalIntake] Suggestion fallback for workspace ${workspaceId}:`,
      (error as Error)?.message || String(error)
    );
    logIntakeSuggestEvent({
      event: 'INTAKE_SUGGEST_STEP_COMPLETED',
      workspaceId,
      step: suggestionStep,
      warnings: ['AI_UNAVAILABLE'],
      durationMs: Date.now() - startedAt,
    });
    return {
      suggested: {},
      filledByUser: [],
      warnings: ['AI_UNAVAILABLE'],
      confirmationRequired: false,
      confirmationReasons: ['AI_UNAVAILABLE'],
    };
  }
}

export async function submitPortalWorkspaceIntake(
  workspaceId: string,
  payload: Record<string, unknown>
): Promise<PortalWorkspaceIntakeSubmitResult> {
  const workspace = await getWorkspaceWithClient(workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const existingPrefill = buildPrefill(workspace);
  const nextPayload: Record<string, unknown> = {
    ...existingPrefill,
    ...payload,
    handles:
      payload.handles && typeof payload.handles === 'object'
        ? payload.handles
        : existingPrefill.handles,
    handlesV2:
      payload.handlesV2 && typeof payload.handlesV2 === 'object'
        ? payload.handlesV2
        : existingPrefill.handlesV2,
  };

  const mergedName = stringify(nextPayload.name) || workspace.client.name;
  if (!mergedName) {
    throw new Error('name is required');
  }

  const handlesV2 = buildHandlesV2FromPayload(nextPayload);
  const platformHandles = toLegacyHandles(handlesV2);
  const channels = flattenHandlesV2(handlesV2);

  const { websites, primaryWebsite, socialReferences } = resolveIntakeWebsites(nextPayload);
  const website = primaryWebsite || stringify(nextPayload.website) || stringify(nextPayload.websiteDomain);
  const hasWebsite = websites.length > 0 || website.length > 0;
  if (!channels.length && !hasWebsite) {
    throw new Error('Provide at least one social handle/channel or a website');
  }

  const existingConstraints = asRecord(workspace.client.brainProfile?.constraints);
  const mergedConstraints = buildConstraintObject(nextPayload, existingConstraints);

  const secondaryGoals = parseStringList(nextPayload.secondaryGoals);
  const oneSentenceDescription =
    stringify(nextPayload.oneSentenceDescription) ||
    stringify(nextPayload.description) ||
    stringify(nextPayload.businessOverview);
  const primaryGoal = stringify(nextPayload.primaryGoal);

  const servicesList = parseList(nextPayload.servicesList, 20);
  const topProblems = parseList(nextPayload.topProblems, 3);
  const resultsIn90Days = parseList(nextPayload.resultsIn90Days, 2);
  const questionsBeforeBuying = parseList(nextPayload.questionsBeforeBuying, 3);
  const competitorInspirationLinks = parseList(nextPayload.competitorInspirationLinks, 5);
  const topicsToAvoid = parseList(nextPayload.topicsToAvoid, 20);
  const excludedCategories = parseStringList(nextPayload.excludedCategories);
  const inputData = asRecord(workspace.inputData);

  const updatedClient = await prisma.client.update({
    where: { id: workspace.client.id },
    data: {
      name: mergedName,
      businessOverview: oneSentenceDescription || workspace.client.businessOverview,
      goalsKpis: primaryGoal || workspace.client.goalsKpis,
    },
  });

  const submittedByPlatform = new Map<string, Set<string>>();
  for (const row of channels) {
    const platform = String(row.platform || '').trim().toLowerCase();
    const handle = normalizeHandle(row.handle);
    if (!platform || !handle) continue;
    if (!submittedByPlatform.has(platform)) {
      submittedByPlatform.set(platform, new Set<string>());
    }
    submittedByPlatform.get(platform)!.add(handle);
  }

  for (const row of channels) {
    const platform = String(row.platform || '').trim().toLowerCase();
    const handle = normalizeHandle(row.handle);
    if (!platform || !handle) continue;
    await prisma.clientAccount.upsert({
      where: {
        clientId_platform_handle: {
          clientId: workspace.client.id,
          platform,
          handle,
        },
      },
      update: {
        profileUrl: getProfileUrl(platform, handle),
        isActive: true,
        archivedAt: null,
        archivedBy: null,
      },
      create: {
        clientId: workspace.client.id,
        platform,
        handle,
        profileUrl: getProfileUrl(platform, handle),
        isActive: true,
      },
    });
  }

  if (submittedByPlatform.size > 0) {
    const activeAccounts = await prisma.clientAccount.findMany({
      where: {
        clientId: workspace.client.id,
        platform: {
          in: Array.from(submittedByPlatform.keys()),
        },
        isActive: true,
      },
      select: {
        id: true,
        platform: true,
        handle: true,
      },
    });
    for (const account of activeAccounts) {
      const keepSet = submittedByPlatform.get(String(account.platform || '').toLowerCase());
      if (!keepSet) continue;
      const normalized = normalizeHandle(account.handle);
      if (keepSet.has(normalized)) continue;
      await prisma.clientAccount.update({
        where: { id: account.id },
        data: {
          isActive: false,
          archivedAt: new Date(),
          archivedBy: 'portal_intake',
        },
      });
    }
  }

  const brainProfile = await prisma.brainProfile.upsert({
    where: { clientId: workspace.client.id },
    update: {
      businessType: stringify(nextPayload.businessType) || null,
      offerModel: stringify(nextPayload.mainOffer) || stringify(nextPayload.offerModel) || null,
      primaryGoal: primaryGoal || null,
      secondaryGoals: toJson(secondaryGoals),
      targetMarket: stringify(nextPayload.targetAudience) || null,
      geoScope: stringify(nextPayload.geoScope) || null,
    websiteDomain: normalizeWebsiteDomain(website),
      channels: toJson(channels),
      constraints: toJson(stripUndefinedFromJson(mergedConstraints)),
    },
    create: {
      clientId: workspace.client.id,
      businessType: stringify(nextPayload.businessType) || null,
      offerModel: stringify(nextPayload.mainOffer) || stringify(nextPayload.offerModel) || null,
      primaryGoal: primaryGoal || null,
      secondaryGoals: toJson(secondaryGoals),
      targetMarket: stringify(nextPayload.targetAudience) || null,
      geoScope: stringify(nextPayload.geoScope) || null,
    websiteDomain: normalizeWebsiteDomain(website),
      channels: toJson(channels),
      constraints: toJson(stripUndefinedFromJson(mergedConstraints)),
    },
  });

  await syncBrainGoals(brainProfile.id, primaryGoal || null, secondaryGoals);

  const preferredPrimaryChannel = fromAccountPlatform(stringify(nextPayload.primaryChannel));
  const preferredPrimaryPlatform = preferredPrimaryChannel
    ? preferredPrimaryChannel === 'twitter'
      ? 'x'
      : preferredPrimaryChannel
    : '';
  const preferredPrimaryHandle = preferredPrimaryChannel
    ? handlesV2[preferredPrimaryChannel].primary
    : '';
  const primaryPlatform = preferredPrimaryHandle ? preferredPrimaryPlatform : channels[0]?.platform || undefined;
  const primaryHandle = preferredPrimaryHandle || channels[0]?.handle || undefined;
  const surfaces =
    channels.length > 0
      ? channels.map((row) => row.platform)
      : websites.length > 0
        ? ['web']
        : undefined;
  const updatedInputData = stripUndefinedFromJson({
    ...inputData,
    source: 'portal_intro_form',
    intakeVersion: 'portal-v1',
    intakeCompletedAt: new Date().toISOString(),
    brandName: mergedName,
    niche: stringify(nextPayload.niche),
    businessType: stringify(nextPayload.businessType),
    website,
    websites: websites.length ? websites : undefined,
    socialReferences: socialReferences.length ? socialReferences : undefined,
    primaryGoal,
    secondaryGoals,
    futureGoal: stringify(nextPayload.futureGoal),
    targetAudience: stringify(nextPayload.targetAudience),
    geoScope: stringify(nextPayload.geoScope),
    language: stringify(nextPayload.language),
    planningHorizon: stringify(nextPayload.planningHorizon),
    autonomyLevel: stringify(nextPayload.autonomyLevel) || 'assist',
    budgetSensitivity: stringify(nextPayload.budgetSensitivity),
    brandTone: stringify(nextPayload.brandTone),
    constraints: stripUndefinedFromJson(mergedConstraints),
    description: oneSentenceDescription || undefined,
    businessOverview: oneSentenceDescription || undefined,
    operateWhere: stringify(nextPayload.operateWhere),
    wantClientsWhere: stringify(nextPayload.wantClientsWhere),
    idealAudience: stringify(nextPayload.idealAudience),
    servicesList: servicesList.length ? servicesList : undefined,
    mainOffer: stringify(nextPayload.mainOffer),
    topProblems: topProblems.length ? topProblems : undefined,
    resultsIn90Days: resultsIn90Days.length ? resultsIn90Days : undefined,
    questionsBeforeBuying: questionsBeforeBuying.length ? questionsBeforeBuying : undefined,
    competitorInspirationLinks: competitorInspirationLinks.length
      ? competitorInspirationLinks
      : undefined,
    brandVoiceWords: stringify(nextPayload.brandVoiceWords),
    topicsToAvoid: topicsToAvoid.length ? topicsToAvoid : undefined,
    excludedCategories: excludedCategories.length ? excludedCategories : undefined,
    handles: platformHandles,
    handlesV2,
    primaryHandlesByPlatform: Object.fromEntries(
      (Object.keys(handlesV2) as IntakePlatform[]).map((platform) => [
        platform === 'twitter' ? 'x' : platform,
        handlesV2[platform].primary,
      ]),
    ),
    channels,
    platform: primaryPlatform,
    handle: primaryHandle,
    surfaces,
    engineGoal: stringify(nextPayload.engineGoal),
  });

  await prisma.researchJob.update({
    where: { id: workspaceId },
    data: {
      inputData: toJson(updatedInputData),
      startedAt: workspace.startedAt || new Date(),
    },
  });

  if (competitorInspirationLinks.length > 0) {
    const { seedTopPicksFromInspirationLinks } = await import('../discovery/seed-intake-competitors');
    await seedTopPicksFromInspirationLinks(workspaceId, competitorInspirationLinks).catch((error) => {
      console.error(`[PortalIntake] Failed to seed competitor inspiration links for ${workspaceId}:`, error);
    });
  }

  if (websites.length > 0) {
    void seedPortalIntakeWebsites(workspaceId, websites).catch((error) => {
      console.error(`[PortalIntake] Failed to seed website scraping for ${workspaceId}:`, error);
    });
  }

  void resumeResearchJob(workspaceId).catch((error) => {
    console.error(`[PortalIntake] Failed to resume research job ${workspaceId}:`, error);
  });

  const pendingSets = await evaluatePendingQuestionSets(workspaceId);

  return {
    success: true,
    workspaceId,
    client: {
      id: updatedClient.id,
      name: updatedClient.name,
    },
    researchJob: {
      id: workspaceId,
      status: workspace.status,
    },
    handles: platformHandles,
    pendingQuestionSets: summarizeQuestionSets(pendingSets),
    message: 'Workspace intake saved. Smart workflow is running.',
  };
}
