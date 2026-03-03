import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { searchBrandContextDDG, searchRawDDG } from '../discovery/duckduckgo-search';
import { fetchAndPersistWebSnapshot } from '../scraping/web-intelligence-service';
import { publishPortalIntakeEvent } from './portal-intake-events';
import {
  parseWebsiteList,
  parseSocialReferenceList,
  PortalIntakeScanMode,
  queuePortalIntakeWebsiteScan,
} from './portal-intake-websites';

function hashEmailForLogs(email?: string | null): string | null {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

function logPortalEnrichmentEvent(input: {
  event:
    | 'PORTAL_ENRICHMENT_STARTED'
    | 'PORTAL_ENRICHMENT_SCAN_QUEUED'
    | 'PORTAL_ENRICHMENT_DDG_COMPLETED'
    | 'PORTAL_ENRICHMENT_WARNING'
    | 'PORTAL_ENRICHMENT_DONE';
  workspaceId: string;
  status: string;
  durationMs?: number;
  errorCode?: string;
  email?: string | null;
}) {
  const payload: Record<string, unknown> = {
    event: input.event,
    workspaceId: input.workspaceId,
    emailHash: hashEmailForLogs(input.email),
    status: input.status,
    durationMs: Number.isFinite(input.durationMs as number) ? Math.max(0, Math.round(input.durationMs as number)) : 0,
    timestamp: new Date().toISOString(),
  };
  if (input.errorCode) {
    payload.errorCode = input.errorCode;
  }
  console.log(JSON.stringify(payload));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toHostname(value: string): string {
  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

type SocialPlatform = 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'twitter';
type PlatformHandleSeed = {
  platform: SocialPlatform;
  handle: string;
};

function normalizePlatform(value: unknown): SocialPlatform | null {
  const platform = String(value || '')
    .trim()
    .toLowerCase();
  if (platform === 'instagram') return 'instagram';
  if (platform === 'tiktok') return 'tiktok';
  if (platform === 'youtube') return 'youtube';
  if (platform === 'linkedin') return 'linkedin';
  if (platform === 'x' || platform === 'twitter') return 'twitter';
  return null;
}

function normalizeHandleValue(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

function collectPlatformHandleSeeds(input: unknown): PlatformHandleSeed[] {
  const record = asRecord(input);
  const out: PlatformHandleSeed[] = [];
  const seen = new Set<string>();

  for (const [platformRaw, rawValue] of Object.entries(record)) {
    const platform = normalizePlatform(platformRaw);
    if (!platform) continue;
    if (typeof rawValue === 'string') {
      const normalized = normalizeHandleValue(rawValue);
      if (!normalized) continue;
      const key = `${platform}:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ platform, handle: normalized });
      continue;
    }

    const bucket = asRecord(rawValue);
    const primary = normalizeHandleValue(bucket.primary);
    if (primary) {
      const key = `${platform}:${primary}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ platform, handle: primary });
      }
    }
    const handles = Array.isArray(bucket.handles) ? bucket.handles : [];
    for (const entry of handles) {
      const normalized = normalizeHandleValue(entry);
      if (!normalized) continue;
      const key = `${platform}:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ platform, handle: normalized });
    }
  }
  return out.slice(0, 24);
}

function profileUrlForHandleSeed(seed: PlatformHandleSeed): string {
  const handle = normalizeHandleValue(seed.handle);
  if (!handle) return '';
  if (seed.platform === 'instagram') return `https://www.instagram.com/${handle}/`;
  if (seed.platform === 'tiktok') return `https://www.tiktok.com/@${handle}`;
  if (seed.platform === 'youtube') return `https://www.youtube.com/@${handle}`;
  if (seed.platform === 'linkedin') return `https://www.linkedin.com/in/${handle}`;
  return `https://x.com/${handle}`;
}

function socialTokenToPlatformHint(value: string): SocialPlatform | null {
  const lower = String(value || '').toLowerCase();
  if (lower.includes('linkedin.com/')) return 'linkedin';
  if (lower.includes('instagram.com/')) return 'instagram';
  if (lower.includes('tiktok.com/')) return 'tiktok';
  if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) return 'youtube';
  if (lower.includes('x.com/') || lower.includes('twitter.com/')) return 'twitter';
  return null;
}

function toValidHttpUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (!parsed.hostname.includes('.')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractHandleSeedTokensFromReferences(references: string[]): string[] {
  const tokens: string[] = [];
  for (const reference of references) {
    const raw = String(reference || '').trim();
    if (!raw) continue;

    const urlToken = raw.match(/(?:instagram\.com|tiktok\.com\/@|youtube\.com\/@|x\.com|twitter\.com|linkedin\.com\/(?:in|company))\/([a-z0-9._-]{2,100})/i)?.[1];
    if (urlToken) {
      tokens.push(normalizeHandleValue(urlToken));
      continue;
    }

    if (!/^https?:\/\//i.test(raw)) {
      const normalized = normalizeHandleValue(raw);
      if (normalized.length >= 2) {
        tokens.push(normalized);
      }
    }
  }
  return Array.from(new Set(tokens.filter(Boolean))).slice(0, 12);
}

function resolveSignupScanMode(): PortalIntakeScanMode {
  const mode = String(process.env.PORTAL_SIGNUP_SCAN_MODE || 'deep')
    .trim()
    .toLowerCase();
  if (mode === 'quick' || mode === 'standard' || mode === 'deep') return mode;
  return 'deep';
}

function isSignupDdgEnabled(): boolean {
  const raw = String(process.env.PORTAL_SIGNUP_DDG_ENABLED || 'true')
    .trim()
    .toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function buildDdgQueries(input: { brandName: string; domain: string }): string[] {
  const brandName = String(input.brandName || '').trim();
  const domain = String(input.domain || '').trim();
  const conservativeBrand = brandName.length >= 5 ? brandName : '';
  const domainToken = domain.split('.')[0]?.replace(/[^a-z0-9-]/gi, '').trim();
  const linkedinSeeds = Array.from(
    new Set(
      [conservativeBrand, domain, domainToken]
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length >= 3)
    )
  );
  const linkedinQueries = linkedinSeeds.flatMap((seed) => [
    `"${seed}" "linkedin"`,
    `site:linkedin.com "${seed}"`,
  ]);
  const queries = [
    domain ? `site:${domain}` : '',
    domain ? `site:${domain} services` : '',
    domain ? `site:${domain} about` : '',
    [conservativeBrand, domain].filter(Boolean).join(' ').trim(),
    [conservativeBrand, 'official website'].filter(Boolean).join(' ').trim(),
    domain ? `${domain} reviews` : '',
    [conservativeBrand, 'pricing'].filter(Boolean).join(' ').trim(),
    ...linkedinQueries,
    [conservativeBrand, 'linkedin instagram tiktok youtube'].filter(Boolean).join(' ').trim(),
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(queries)).slice(0, 8);
}

function resolveContinuousScanMode(): PortalIntakeScanMode {
  const mode = String(process.env.PORTAL_INTAKE_CONTINUOUS_SCAN_MODE || 'standard')
    .trim()
    .toLowerCase();
  if (mode === 'quick' || mode === 'standard' || mode === 'deep') return mode;
  return 'standard';
}

function resolveContinuousCooldownMs(): number {
  const raw = Number(process.env.PORTAL_INTAKE_CONTINUOUS_COOLDOWN_MS || 90_000);
  if (!Number.isFinite(raw) || raw < 5_000) return 90_000;
  return Math.floor(raw);
}

function normalizeHandleTokenList(input: unknown): string[] {
  return Array.from(new Set(collectPlatformHandleSeeds(input).map((seed) => seed.handle))).slice(0, 16);
}

function mergeUnique(values: Array<string | null | undefined>, maxItems: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

async function readWorkspaceIntakeSourceState(workspaceId: string): Promise<{
  inputData: Record<string, unknown>;
  websites: string[];
  socialReferences: string[];
  handles: string[];
  handleSeeds: PlatformHandleSeed[];
  brandName: string;
}> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      client: {
        select: {
          name: true,
        },
      },
      inputData: true,
    },
  });
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const inputData = asRecord(workspace.inputData);
  const websites = parseWebsiteList([inputData.website, inputData.websites], 5);
  const socialReferences = parseSocialReferenceList([inputData.socialReferences], 12);
  const handleSeeds = collectPlatformHandleSeeds({
    ...(asRecord(inputData.handlesV2) || {}),
    ...(asRecord(inputData.handles) || {}),
  });
  const handles = Array.from(new Set(handleSeeds.map((seed) => seed.handle))).slice(0, 16);
  const brandName = String(inputData.brandName || workspace.client?.name || '').trim();
  return {
    inputData,
    websites,
    socialReferences,
    handles,
    handleSeeds,
    brandName,
  };
}

async function persistEnrichmentState(
  workspaceId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: { inputData: true },
  });
  if (!workspace) return;

  const inputData = asRecord(workspace.inputData);
  const nextState = {
    ...asRecord(inputData.enrichmentState),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await prisma.researchJob.update({
    where: { id: workspaceId },
    data: {
      inputData: {
        ...inputData,
        enrichmentState: nextState,
      },
    },
  });
}

function buildContinuousDdgQueries(input: {
  brandName: string;
  domain: string;
  socialReferences: string[];
  handles: string[];
  handleSeeds: PlatformHandleSeed[];
}): string[] {
  const baseQueries = buildDdgQueries({ brandName: input.brandName, domain: input.domain });
  const socialHints = input.socialReferences
    .map((entry) => socialTokenToPlatformHint(String(entry || '').trim()))
    .filter((entry): entry is SocialPlatform => Boolean(entry));
  const referenceHandleTokens = extractHandleSeedTokensFromReferences(input.socialReferences);

  const handleQueries = input.handles.flatMap((handle) => [
    `"${handle}" "linkedin"`,
    `"${handle}" "instagram"`,
    `"${handle}" "tiktok"`,
    `"${handle}" "youtube"`,
    `"${handle}" "twitter"`,
  ]);
  const seededPlatformQueries = input.handleSeeds.flatMap((seed) => {
    const platformLabel =
      seed.platform === 'twitter'
        ? ['"twitter"', '"x"']
        : [`"${seed.platform}"`];
    return platformLabel.map((label) => `"${seed.handle}" ${label}`);
  });
  const referenceTokenQueries = referenceHandleTokens.flatMap((token) => [
    `"${token}" "linkedin"`,
    `"${token}" "instagram"`,
    `"${token}" "tiktok"`,
    `"${token}" "youtube"`,
    `"${token}" "twitter"`,
  ]);
  const socialBundleSeed = [input.brandName, input.domain, ...socialHints].filter(Boolean).join(' ').trim();
  return Array.from(
    new Set(
      [
        ...baseQueries,
        ...handleQueries,
        ...seededPlatformQueries,
        ...referenceTokenQueries,
        socialBundleSeed,
      ]
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
    ),
  ).slice(0, 24);
}

function computeEnrichmentFingerprint(input: {
  websites: string[];
  socialReferences: string[];
  handles: string[];
  handleSeeds: PlatformHandleSeed[];
}): string {
  const payload = JSON.stringify({
    websites: [...input.websites].sort(),
    socialReferences: [...input.socialReferences].sort(),
    handles: [...input.handles].sort(),
    handleSeeds: [...input.handleSeeds]
      .map((seed) => `${seed.platform}:${seed.handle}`)
      .sort(),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function updateSignupEnrichmentMetadata(
  workspaceId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: {
      inputData: true,
    },
  });
  if (!workspace) return;

  const inputData = asRecord(workspace.inputData);
  const signupEnrichment = asRecord(inputData.signupEnrichment);

  await prisma.researchJob.update({
    where: { id: workspaceId },
    data: {
      inputData: {
        ...inputData,
        signupEnrichment: {
          ...signupEnrichment,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });
}

export async function startPortalSignupEnrichment(input: {
  workspaceId: string;
  brandName: string;
  website?: string;
  websites?: string[];
  socialReferences?: string[];
  handlesV2?: Record<string, unknown>;
  handles?: Record<string, unknown>;
}): Promise<void> {
  const startedAt = Date.now();
  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) return;

  const websites = parseWebsiteList([input.website, input.websites], 5);
  const socialReferences = parseSocialReferenceList([input.socialReferences], 12);
  const providedHandleSeeds = collectPlatformHandleSeeds({
    ...(asRecord(input.handlesV2) || {}),
    ...(asRecord(input.handles) || {}),
  });
  const providedHandles = Array.from(new Set(providedHandleSeeds.map((seed) => seed.handle))).slice(0, 16);
  const primaryWebsite = websites[0] || '';
  const domain = toHostname(primaryWebsite);
  const scanMode = resolveSignupScanMode();
  const ddgEnabled = isSignupDdgEnabled();

  let scanRunId: string | undefined;

  logPortalEnrichmentEvent({
    event: 'PORTAL_ENRICHMENT_STARTED',
    workspaceId,
    status: 'started',
  });

  await publishPortalIntakeEvent(
    workspaceId,
    'ENRICHMENT_STARTED',
    'Signup enrichment started. BAT is collecting website and search evidence.',
    {
      stage: 'bootstrap',
      websiteCount: websites.length,
      socialReferenceCount: socialReferences.length,
      handleCount: providedHandleSeeds.length,
      scanMode,
      ddgEnabled,
    }
  );

  await updateSignupEnrichmentMetadata(workspaceId, {
    startedAt: new Date().toISOString(),
    scanMode,
    ddgEnabled,
    websites,
    socialReferences,
    handles: providedHandleSeeds,
  });

  if (socialReferences.length > 0 || providedHandleSeeds.length > 0) {
    const profileTargets = mergeUnique(
      [
        ...socialReferences.map((entry) => toValidHttpUrl(entry)),
        ...providedHandleSeeds.map((seed) => profileUrlForHandleSeed(seed)),
      ],
      10,
    );
    for (const socialUrl of profileTargets) {
      if (!socialUrl) continue;
      try {
        await fetchAndPersistWebSnapshot({
          researchJobId: workspaceId,
          url: socialUrl,
          sourceType: 'SOCIAL_PROFILE',
          discoveredBy: 'SYSTEM',
          mode: 'AUTO',
          allowExternal: true,
        });
      } catch (error) {
        await publishPortalIntakeEvent(
          workspaceId,
          'ENRICHMENT_WARNING',
          `Social profile enrichment warning for ${socialUrl}.`,
          {
            stage: 'signup_social_snapshot',
            socialUrl,
            error: (error as Error)?.message || String(error),
          },
          scanRunId ? { scanRunId } : undefined,
        );
      }
    }
  }

  if (websites.length > 0) {
    try {
      const queued = await queuePortalIntakeWebsiteScan(workspaceId, websites, {
        mode: scanMode,
        initiatedBy: 'SYSTEM',
      });
      scanRunId = queued.scanRunId;
      logPortalEnrichmentEvent({
        event: 'PORTAL_ENRICHMENT_SCAN_QUEUED',
        workspaceId,
        status: 'queued',
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logPortalEnrichmentEvent({
        event: 'PORTAL_ENRICHMENT_WARNING',
        workspaceId,
        status: 'warning',
        durationMs: Date.now() - startedAt,
        errorCode: 'SCAN_QUEUE_FAILED',
      });
      await publishPortalIntakeEvent(
        workspaceId,
        'ENRICHMENT_WARNING',
        'Website enrichment queue failed. You can rescan from intake later.',
        {
          stage: 'website_scan_queue',
          error: (error as Error)?.message || String(error),
        }
      );
    }
  } else {
    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_WARNING',
      workspaceId,
      status: 'warning',
      durationMs: Date.now() - startedAt,
      errorCode: 'WEBSITE_MISSING',
    });
    await publishPortalIntakeEvent(
      workspaceId,
      'ENRICHMENT_WARNING',
      'No website provided at signup, so website scan was skipped.',
      {
        stage: 'website_scan_queue',
      }
    );
  }

  if (!ddgEnabled) {
    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_DONE',
      workspaceId,
      status: 'completed',
      durationMs: Date.now() - startedAt,
    });
    await publishPortalIntakeEvent(
      workspaceId,
      'ENRICHMENT_DONE',
      'Signup enrichment completed (DDG enrichment disabled by config).',
      {
        stage: 'finalize',
        ddgEnabled: false,
      },
      scanRunId ? { scanRunId } : undefined
    );
    await updateSignupEnrichmentMetadata(workspaceId, {
      completedAt: new Date().toISOString(),
      ddgStatus: 'disabled',
      scanRunId: scanRunId || null,
    });
    return;
  }

  try {
    const brandName = String(input.brandName || '').trim();
    const ddgQueries = buildContinuousDdgQueries({
      brandName,
      domain,
      socialReferences,
      handles: providedHandles,
      handleSeeds: providedHandleSeeds,
    });

    await publishPortalIntakeEvent(
      workspaceId,
      'DDG_STARTED',
      'Running DuckDuckGo enrichment for business context and additional sources.',
      {
        stage: 'ddg',
        queryCount: ddgQueries.length,
        queries: ddgQueries,
      },
      scanRunId ? { scanRunId } : undefined
    );

    const brandContextSeed =
      (brandName.length >= 5 ? [brandName, domain].filter(Boolean).join(' ').trim() : '') ||
      domain ||
      brandName ||
      'business';
    const brandContext = await searchBrandContextDDG(
      brandContextSeed,
      workspaceId,
      { timeoutMs: 90_000 }
    );
    const rawResults = await searchRawDDG(ddgQueries, {
      timeoutMs: 90_000,
      maxResults: 120,
      researchJobId: workspaceId,
      source: 'portal_signup_ddg_raw_query',
    });

    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_DDG_COMPLETED',
      workspaceId,
      status: 'completed',
      durationMs: Date.now() - startedAt,
    });

    await publishPortalIntakeEvent(
      workspaceId,
      'DDG_COMPLETED',
      `DDG enrichment completed with ${rawResults.length} raw results.`,
      {
        stage: 'ddg',
        rawResults: rawResults.length,
        hasContextSummary: Boolean(String(brandContext.context_summary || '').trim()),
        instagramHandle: brandContext.instagram_handle || null,
        tiktokHandle: brandContext.tiktok_handle || null,
        websiteUrl: brandContext.website_url || null,
      },
      scanRunId ? { scanRunId } : undefined
    );

    await updateSignupEnrichmentMetadata(workspaceId, {
      completedAt: new Date().toISOString(),
      ddgStatus: 'completed',
      ddgQueries,
      ddgRawCount: rawResults.length,
      contextSummaryPresent: Boolean(String(brandContext.context_summary || '').trim()),
      scanRunId: scanRunId || null,
    });
  } catch (error) {
    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_WARNING',
      workspaceId,
      status: 'warning',
      durationMs: Date.now() - startedAt,
      errorCode: 'DDG_FAILED',
    });
    await publishPortalIntakeEvent(
      workspaceId,
      'ENRICHMENT_WARNING',
      'DDG enrichment failed. Website scan data is still available.',
      {
        stage: 'ddg',
        error: (error as Error)?.message || String(error),
      },
      scanRunId ? { scanRunId } : undefined
    );
    await updateSignupEnrichmentMetadata(workspaceId, {
      completedAt: new Date().toISOString(),
      ddgStatus: 'failed',
      ddgError: (error as Error)?.message || String(error),
      scanRunId: scanRunId || null,
    });
  }

  await publishPortalIntakeEvent(
    workspaceId,
    'ENRICHMENT_DONE',
    'Signup enrichment completed. Intake autofill can use this evidence now.',
    {
      stage: 'finalize',
      scanRunId: scanRunId || null,
    },
    scanRunId ? { scanRunId } : undefined
  );
  logPortalEnrichmentEvent({
    event: 'PORTAL_ENRICHMENT_DONE',
    workspaceId,
    status: 'completed',
    durationMs: Date.now() - startedAt,
  });
}

export async function syncPortalIntakeContinuousEnrichment(input: {
  workspaceId: string;
  websites?: string[];
  website?: string;
  socialReferences?: string[];
  handlesV2?: Record<string, unknown>;
  handles?: Record<string, unknown>;
  brandName?: string;
  trigger?: string;
  force?: boolean;
}): Promise<{
  scheduled: boolean;
  fingerprint: string;
  scanRunId?: string;
  reason?: string;
}> {
  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) {
    throw new Error('workspaceId is required');
  }

  const sourceState = await readWorkspaceIntakeSourceState(workspaceId);
  const websites = mergeUnique(
    [
      ...parseWebsiteList([input.website, input.websites], 5),
      ...sourceState.websites,
    ],
    5,
  );
  const socialReferences = mergeUnique(
    [
      ...parseSocialReferenceList([input.socialReferences], 12),
      ...sourceState.socialReferences,
    ],
    12,
  );
  const handles = mergeUnique(
    [
      ...normalizeHandleTokenList({
        ...(asRecord(input.handlesV2) || {}),
        ...(asRecord(input.handles) || {}),
      }),
      ...sourceState.handles,
    ],
    16,
  );
  const handleSeeds = collectPlatformHandleSeeds({
    ...(asRecord(input.handlesV2) || {}),
    ...(asRecord(input.handles) || {}),
  }).concat(sourceState.handleSeeds);
  const dedupedHandleSeeds = Array.from(
    new Map(
      handleSeeds
        .map((seed) => [`${seed.platform}:${seed.handle}`, seed] as const)
    ).values()
  ).slice(0, 24);
  const brandName = String(input.brandName || sourceState.brandName || '').trim();
  const domain = toHostname(websites[0] || '');
  const fingerprint = computeEnrichmentFingerprint({ websites, socialReferences, handles, handleSeeds: dedupedHandleSeeds });
  const cooldownMs = resolveContinuousCooldownMs();
  const now = Date.now();
  const enrichmentState = asRecord(sourceState.inputData.enrichmentState);
  const lastFingerprint = String(enrichmentState.lastFingerprint || '').trim();
  const lastStartedAt = Date.parse(String(enrichmentState.lastStartedAt || ''));
  const withinCooldown = Number.isFinite(lastStartedAt) && now - lastStartedAt < cooldownMs;
  if (!input.force && fingerprint && lastFingerprint && fingerprint === lastFingerprint && withinCooldown) {
    return {
      scheduled: false,
      fingerprint,
      reason: 'duplicate_within_cooldown',
    };
  }

  await persistEnrichmentState(workspaceId, {
    status: 'running',
    lastFingerprint: fingerprint,
    lastStartedAt: new Date().toISOString(),
    lastTrigger: String(input.trigger || 'intake_draft'),
    websites,
    socialReferences,
    handles,
    handleSeeds: dedupedHandleSeeds,
  });

  const mode = resolveContinuousScanMode();
  let scanRunId: string | undefined;
  if (websites.length > 0) {
    const queued = await queuePortalIntakeWebsiteScan(workspaceId, websites, {
      mode,
      initiatedBy: 'SYSTEM',
      skipIfRunning: false,
    });
    scanRunId = queued.scanRunId;
  }

  await publishPortalIntakeEvent(
    workspaceId,
    'ENRICHMENT_STARTED',
    'Background enrichment is running with your latest website/social references.',
    {
      stage: 'continuous',
      trigger: String(input.trigger || 'intake_draft'),
      websiteCount: websites.length,
      socialReferenceCount: socialReferences.length,
      handleCount: handles.length,
      mode,
      fingerprint,
    },
    scanRunId ? { scanRunId } : undefined,
  );

  const socialSnapshotTargets = mergeUnique(
    [
      ...socialReferences.map((entry) => toValidHttpUrl(entry)),
      ...dedupedHandleSeeds.map((seed) => profileUrlForHandleSeed(seed)),
    ],
    12
  );
  if (socialSnapshotTargets.length > 0) {
    for (const socialUrl of socialSnapshotTargets.slice(0, 10)) {
      if (!socialUrl) continue;
      try {
        await fetchAndPersistWebSnapshot({
          researchJobId: workspaceId,
          url: socialUrl,
          sourceType: 'SOCIAL_PROFILE',
          discoveredBy: 'SYSTEM',
          mode: 'AUTO',
          allowExternal: true,
        });
      } catch (error) {
        await publishPortalIntakeEvent(
          workspaceId,
          'ENRICHMENT_WARNING',
          `Profile enrichment warning for ${socialUrl}.`,
          {
            stage: 'social_snapshot',
            socialUrl,
            error: (error as Error)?.message || String(error),
          },
          scanRunId ? { scanRunId } : undefined,
        );
      }
    }
  }

  if (isSignupDdgEnabled()) {
    const queries = buildContinuousDdgQueries({
      brandName,
      domain,
      socialReferences,
      handles,
      handleSeeds: dedupedHandleSeeds,
    });
    if (queries.length > 0) {
      await publishPortalIntakeEvent(
        workspaceId,
        'DDG_STARTED',
        'Running continuous DDG enrichment for new references.',
        {
          stage: 'continuous_ddg',
          queryCount: queries.length,
        },
        scanRunId ? { scanRunId } : undefined,
      );
      try {
        const rawResults = await searchRawDDG(queries, {
          timeoutMs: 60_000,
          maxResults: 140,
          researchJobId: workspaceId,
          source: 'portal_intake_continuous_ddg',
        });
        await publishPortalIntakeEvent(
          workspaceId,
          'DDG_COMPLETED',
          `Continuous DDG enrichment completed with ${rawResults.length} raw results.`,
          {
            stage: 'continuous_ddg',
            rawResults: rawResults.length,
          },
          scanRunId ? { scanRunId } : undefined,
        );
      } catch (error) {
        await publishPortalIntakeEvent(
          workspaceId,
          'ENRICHMENT_WARNING',
          'Continuous DDG enrichment failed for latest references.',
          {
            stage: 'continuous_ddg',
            error: (error as Error)?.message || String(error),
          },
          scanRunId ? { scanRunId } : undefined,
        );
      }
    }
  }

  await persistEnrichmentState(workspaceId, {
    status: 'ready',
    lastCompletedAt: new Date().toISOString(),
    lastFingerprint: fingerprint,
    lastScanRunId: scanRunId || null,
    websites,
    socialReferences,
    handles,
    handleSeeds: dedupedHandleSeeds,
  });

  await publishPortalIntakeEvent(
    workspaceId,
    'ENRICHMENT_DONE',
    'Background enrichment updated with your latest references.',
    {
      stage: 'continuous',
      mode,
      fingerprint,
      scanRunId: scanRunId || null,
    },
    scanRunId ? { scanRunId } : undefined,
  );

  return {
    scheduled: true,
    fingerprint,
    ...(scanRunId ? { scanRunId } : {}),
  };
}
