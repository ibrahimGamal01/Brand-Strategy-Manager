import { crawlAndPersistWebSources, fetchAndPersistWebSnapshot } from '../scraping/web-intelligence-service';
import { publishPortalIntakeEvent } from './portal-intake-events';
import {
  createPortalIntakeScanRun,
  updatePortalIntakeScanRun,
} from './portal-intake-events-repository';

export type PortalIntakeScanMode = 'quick' | 'standard' | 'deep';

type CrawlSettings = {
  maxPages: number;
  maxDepth: number;
  coverageProfile: 'default' | 'coverage_first';
  minPagesPersisted: number;
  minPagesFetched: number;
  minTemplatePatterns: number;
};

const CRAWL_SETTINGS_BY_MODE: Record<PortalIntakeScanMode, CrawlSettings> = {
  quick: {
    maxPages: 4,
    maxDepth: 1,
    coverageProfile: 'default',
    minPagesPersisted: 0,
    minPagesFetched: 0,
    minTemplatePatterns: 0,
  },
  standard: {
    maxPages: 20,
    maxDepth: 2,
    coverageProfile: 'default',
    minPagesPersisted: 0,
    minPagesFetched: 0,
    minTemplatePatterns: 0,
  },
  deep: {
    maxPages: 180,
    maxDepth: 4,
    coverageProfile: 'coverage_first',
    minPagesPersisted: 35,
    minPagesFetched: 40,
    minTemplatePatterns: 14,
  },
};

const activeScans = new Set<string>();
const scanQueueByWorkspace = new Map<string, Promise<void>>();

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

function normalizeUrlForStorage(parsed: URL): string {
  parsed.hash = '';
  const normalized = parsed.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function toHostname(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
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
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!hostname) return '';
    if (/[, ]/.test(hostname)) return '';
    if (isSocialHost(hostname)) return '';

    return normalizeUrlForStorage(parsed);
  } catch {
    return '';
  }
}

function normalizeSocialReferenceCandidate(rawValue: string): string {
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
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!hostname) return '';
    if (/[, ]/.test(hostname)) return '';
    if (!isSocialHost(hostname)) return '';
    return normalizeUrlForStorage(parsed);
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

  const urlMatches = source.match(/https?:\/\/[^\s),;]+/gi) || [];
  results.push(...urlMatches);

  const domainMatches = source.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[\w\-./?%&=]*)?/gi) || [];
  results.push(...domainMatches);

  if (!results.length && !/\s/.test(source)) {
    results.push(source);
  }

  return results;
}

export function parseWebsiteList(input: unknown, maxItems = 8): string[] {
  return classifyIntakeUrlInputs(input, maxItems, maxItems).crawlWebsites;
}

export function parseSocialReferenceList(input: unknown, maxItems = 12): string[] {
  return classifyIntakeUrlInputs(input, maxItems, maxItems).socialReferences;
}

export function classifyIntakeUrlInputs(
  input: unknown,
  maxWebsiteItems = 8,
  maxSocialItems = 12
): {
  crawlWebsites: string[];
  socialReferences: string[];
} {
  const chunks = Array.isArray(input) ? input : [input];
  const crawlWebsites: string[] = [];
  const socialReferences: string[] = [];
  const seenWeb = new Set<string>();
  const seenSocial = new Set<string>();

  for (const chunk of chunks) {
    const candidates = extractWebsiteCandidates(String(chunk || ''));
    for (const candidate of candidates) {
      const normalized = normalizeWebsiteCandidate(candidate);
      if (normalized) {
        const key = normalized.toLowerCase();
        if (!seenWeb.has(key)) {
          seenWeb.add(key);
          crawlWebsites.push(normalized);
          if (crawlWebsites.length >= maxWebsiteItems) break;
        }
        continue;
      }

      const socialReference = normalizeSocialReferenceCandidate(candidate);
      if (!socialReference) continue;
      const socialKey = socialReference.toLowerCase();
      if (seenSocial.has(socialKey)) continue;
      seenSocial.add(socialKey);
      socialReferences.push(socialReference);
      if (socialReferences.length >= maxSocialItems) break;
    }
  }

  return {
    crawlWebsites,
    socialReferences,
  };
}

export function resolveIntakeWebsites(payload: Record<string, unknown>): {
  websites: string[];
  primaryWebsite: string;
  socialReferences: string[];
} {
  const directWebsite = String(payload.website || payload.websiteDomain || '').trim();
  const classified = classifyIntakeUrlInputs([directWebsite, payload.websites, payload.socialReferences], 8, 12);
  const websites = classified.crawlWebsites;
  const socialReferences = classified.socialReferences;
  const directWebsiteHost = toHostname(directWebsite);
  const hasDirectWebsite = Boolean(directWebsiteHost && !isSocialHost(directWebsiteHost));

  return {
    websites,
    primaryWebsite: websites[0] || (hasDirectWebsite ? directWebsite : ''),
    socialReferences,
  };
}

function resolveCrawlSettings(mode: PortalIntakeScanMode): CrawlSettings {
  return CRAWL_SETTINGS_BY_MODE[mode] || CRAWL_SETTINGS_BY_MODE.quick;
}

export type PortalIntakeWebsiteScanSummary = {
  scanRunId: string;
  started: boolean;
  mode: PortalIntakeScanMode;
  queuedTargets: string[];
  targetsCompleted: number;
  snapshotsSaved: number;
  pagesDiscovered: number;
  pagesFetched: number;
  pagesPersisted: number;
  uniquePathPatterns: number;
  templateCoverageScore: number;
  coverageStatus: string;
  warnings: number;
  failures: number;
  proof?: Record<string, unknown>;
};

function clampCoverageScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export async function scanPortalIntakeWebsites(
  workspaceId: string,
  websites: string[],
  options?: {
    mode?: PortalIntakeScanMode;
    initiatedBy?: 'USER' | 'SYSTEM';
    skipIfRunning?: boolean;
    scanRunId?: string;
  }
): Promise<PortalIntakeWebsiteScanSummary> {
  const mode = options?.mode || 'quick';
  const initiatedBy = options?.initiatedBy || 'USER';
  const skipIfRunning = options?.skipIfRunning !== false;
  const targets = parseWebsiteList(websites, 5);
  const crawlSettings = resolveCrawlSettings(mode);
  const scanRunId = String(options?.scanRunId || '').trim();
  if (!scanRunId) {
    const scanRun = await createPortalIntakeScanRun({
      workspaceId,
      mode,
      status: 'RUNNING',
      initiatedBy,
      targets,
      crawlSettings,
    });
    options = {
      ...(options || {}),
      scanRunId: scanRun.id,
    };
  }
  const resolvedScanRunId = String(options?.scanRunId || '').trim();
  if (!resolvedScanRunId) {
    throw new Error('scanRunId is required for portal intake scan execution');
  }

  const publish = async (
    type: Parameters<typeof publishPortalIntakeEvent>[1],
    message: string,
    payload?: Record<string, unknown>
  ) =>
    publishPortalIntakeEvent(
      workspaceId,
      type,
      message,
      {
        ...(payload || {}),
        scanRunId: resolvedScanRunId,
      },
      { scanRunId: resolvedScanRunId }
    );

  if (!targets.length) {
    await publish('SCAN_WARNING', 'No valid websites found to scan.', {
      mode,
      initiatedBy,
    });
    await updatePortalIntakeScanRun(resolvedScanRunId, {
      status: 'FAILED',
      targetsCompleted: 0,
      snapshotsSaved: 0,
      pagesDiscovered: 0,
      pagesFetched: 0,
      pagesPersisted: 0,
      uniquePathPatterns: 0,
      templateCoverageScore: 0,
      coverageStatus: 'FAILED',
      proof: {
        coverage: {
          profile: crawlSettings.coverageProfile,
          status: 'FAILED',
          pagesDiscovered: 0,
          pagesFetched: 0,
          pagesPersisted: 0,
          uniquePathPatterns: 0,
          templateCoverageScore: 0,
        },
      },
      warnings: 1,
      failures: 1,
      error: 'No valid websites found to scan.',
      endedAt: new Date(),
    });
    return {
      scanRunId: resolvedScanRunId,
      started: false,
      mode,
      queuedTargets: [],
      targetsCompleted: 0,
      snapshotsSaved: 0,
      pagesDiscovered: 0,
      pagesFetched: 0,
      pagesPersisted: 0,
      uniquePathPatterns: 0,
      templateCoverageScore: 0,
      coverageStatus: 'FAILED',
      warnings: 1,
      failures: 1,
    };
  }

  if (activeScans.has(workspaceId) && skipIfRunning) {
    await publish('SCAN_WARNING', 'A scan is already running for this workspace.', {
      mode,
      initiatedBy,
      targets,
    });
    await updatePortalIntakeScanRun(resolvedScanRunId, {
      status: 'CANCELLED',
      targetsCompleted: 0,
      snapshotsSaved: 0,
      pagesDiscovered: 0,
      pagesFetched: 0,
      pagesPersisted: 0,
      uniquePathPatterns: 0,
      templateCoverageScore: 0,
      coverageStatus: 'CANCELLED',
      warnings: 1,
      failures: 0,
      error: 'Scan skipped because another scan is already running.',
      endedAt: new Date(),
    });
    return {
      scanRunId: resolvedScanRunId,
      started: false,
      mode,
      queuedTargets: targets,
      targetsCompleted: 0,
      snapshotsSaved: 0,
      pagesDiscovered: 0,
      pagesFetched: 0,
      pagesPersisted: 0,
      uniquePathPatterns: 0,
      templateCoverageScore: 0,
      coverageStatus: 'CANCELLED',
      warnings: 1,
      failures: 0,
    };
  }

  activeScans.add(workspaceId);
  const allowedDomains = Array.from(
    new Set(
      targets
        .map((target) => toHostname(target))
        .filter(Boolean),
    ),
  );

  let targetsCompleted = 0;
  let snapshotsSaved = 0;
  let pagesDiscovered = 0;
  let pagesFetched = 0;
  let pagesPersisted = 0;
  let uniquePathPatterns = 0;
  let templateCoverageScore = 0;
  let coverageSamples = 0;
  let warnings = 0;
  let failures = 0;
  let lineagePersisted = 0;
  let logoCount = 0;
  let imageCount = 0;
  let fontCount = 0;
  let designTokenCount = 0;
  let stylesheetCount = 0;
  const coverageStatuses: string[] = [];
  let coverageHoldTriggered = false;
  let terminalError: string | null = null;

  await publish('SCAN_STARTED', `Starting ${mode} scan for ${targets.length} website(s).`, {
    mode,
    initiatedBy,
    targets,
    crawlSettings,
  });

  try {
    for (const [index, target] of targets.entries()) {
      await publish('SCAN_TARGET_STARTED', `Scanning ${target} (${index + 1}/${targets.length}).`, {
        mode,
        target,
        index: index + 1,
        total: targets.length,
      });

      try {
        const snapshot = await fetchAndPersistWebSnapshot({
          researchJobId: workspaceId,
          url: target,
          sourceType: 'CLIENT_SITE',
          discoveredBy: initiatedBy,
          mode: 'AUTO',
          allowExternal: true,
          scanRunId: resolvedScanRunId,
          metadata: {
            coverageProfile: crawlSettings.coverageProfile,
            scanMode: mode,
            policy: 'website_intelligence_v2',
          },
        });
        snapshotsSaved += 1;
        if (snapshot.lineageSummary) {
          lineagePersisted += Number(snapshot.lineageSummary.persisted || 0);
          logoCount += Number(snapshot.lineageSummary.logos || 0);
          imageCount += Number(snapshot.lineageSummary.images || 0);
          fontCount += Number(snapshot.lineageSummary.fonts || 0);
          designTokenCount += Number(snapshot.lineageSummary.designTokens || 0);
          stylesheetCount += Number(snapshot.lineageSummary.stylesheets || 0);
        }

        await publish('SNAPSHOT_SAVED', `Saved homepage snapshot for ${target}.`, {
          target,
          snapshotId: snapshot.snapshotId,
          sourceId: snapshot.sourceId,
          blockedSuspected: snapshot.blockedSuspected,
          fetcherUsed: snapshot.fetcherUsed,
          statusCode: snapshot.statusCode,
          ...(snapshot.lineageSummary ? { lineageSummary: snapshot.lineageSummary } : {}),
          ...(snapshot.fallbackReason ? { fallbackReason: snapshot.fallbackReason } : {}),
        });

        const crawl = await crawlAndPersistWebSources({
          researchJobId: workspaceId,
          startUrls: [target],
          allowedDomains,
          maxPages: crawlSettings.maxPages,
          maxDepth: crawlSettings.maxDepth,
          mode: 'AUTO',
          allowExternal: true,
          scanRunId: resolvedScanRunId,
          coverageProfile: crawlSettings.coverageProfile,
        });

        pagesDiscovered += Number(crawl.pagesDiscovered || 0);
        pagesFetched += Number(crawl.pagesFetched || 0);
        pagesPersisted += Number(crawl.persisted || 0);
        uniquePathPatterns += Number(crawl.uniquePathPatterns || 0);
        templateCoverageScore =
          coverageSamples === 0
            ? clampCoverageScore(Number(crawl.templateCoverageScore || 0))
            : clampCoverageScore(
                (templateCoverageScore * coverageSamples + Number(crawl.templateCoverageScore || 0)) /
                  (coverageSamples + 1)
              );
        coverageSamples += 1;
        coverageStatuses.push(String(crawl.coverageStatus || 'NOT_EVALUATED'));
        if (crawl.assetStats) {
          lineagePersisted += Number(crawl.assetStats.lineagePersisted || 0);
          logoCount += Number(crawl.assetStats.logos || 0);
          imageCount += Number(crawl.assetStats.images || 0);
          fontCount += Number(crawl.assetStats.fonts || 0);
          designTokenCount += Number(crawl.assetStats.designTokens || 0);
          stylesheetCount += Number(crawl.assetStats.stylesheets || 0);
        }
        targetsCompleted += 1;

        if (crawl.fallbackReason && crawlSettings.coverageProfile === 'coverage_first') {
          failures += 1;
          coverageHoldTriggered = true;
          terminalError = `Coverage-first crawl degraded to fallback for ${target}: ${crawl.fallbackReason}`;
          await publish('SCAN_FAILED', `Coverage-first hold triggered for ${target}.`, {
            target,
            reason: 'coverage_fallback_degraded',
            fallbackReason: crawl.fallbackReason,
            persisted: crawl.persisted,
            pagesDiscovered: crawl.pagesDiscovered,
            pagesFetched: crawl.pagesFetched,
            coverageStatus: crawl.coverageStatus,
            runId: crawl.runId,
          });
          break;
        }

        if (crawl.fallbackReason) {
          warnings += 1;
          await publish('SCAN_WARNING', `Crawler used fallback mode for ${target}.`, {
            target,
            fallbackReason: crawl.fallbackReason,
            persisted: crawl.persisted,
            runId: crawl.runId,
          });
        }

        if (crawlSettings.coverageProfile === 'coverage_first' && String(crawl.coverageStatus || '') !== 'SUFFICIENT') {
          failures += 1;
          coverageHoldTriggered = true;
          terminalError =
            terminalError ||
            `Coverage thresholds were not met for ${target}. status=${crawl.coverageStatus} persisted=${crawl.persisted} patterns=${crawl.uniquePathPatterns}`;
          await publish('SCAN_FAILED', `Coverage-first thresholds not met for ${target}.`, {
            target,
            reason: 'coverage_threshold_not_met',
            coverageStatus: crawl.coverageStatus,
            pagesDiscovered: crawl.pagesDiscovered,
            pagesFetched: crawl.pagesFetched,
            pagesPersisted: crawl.persisted,
            uniquePathPatterns: crawl.uniquePathPatterns,
            templateCoverageScore: crawl.templateCoverageScore,
            thresholds: {
              minPagesPersisted: crawlSettings.minPagesPersisted,
              minPagesFetched: crawlSettings.minPagesFetched,
              minTemplatePatterns: crawlSettings.minTemplatePatterns,
            },
            runId: crawl.runId,
          });
          break;
        }

        if (Array.isArray(crawl.failures) && crawl.failures.length > 0) {
          warnings += crawl.failures.length;
          await publish('SCAN_WARNING', `Crawl completed for ${target} with ${crawl.failures.length} warning(s).`, {
            target,
            warnings: crawl.failures.slice(0, 5),
            persisted: crawl.persisted,
            runId: crawl.runId,
          });
        }

        await publish('CRAWL_COMPLETED', `Crawl completed for ${target}.`, {
          target,
          persisted: crawl.persisted,
          runId: crawl.runId,
          summary: crawl.summary,
          coverage: {
            pagesDiscovered: crawl.pagesDiscovered,
            pagesFetched: crawl.pagesFetched,
            uniquePathPatterns: crawl.uniquePathPatterns,
            templateCoverageScore: crawl.templateCoverageScore,
            coverageStatus: crawl.coverageStatus,
          },
          assetStats: crawl.assetStats,
          ...(crawl.fallbackReason ? { fallbackReason: crawl.fallbackReason } : {}),
        });
      } catch (error) {
        failures += 1;
        const message = (error as Error)?.message || String(error);
        terminalError = message;
        await publish('SCAN_FAILED', `Scan failed for ${target}: ${message}`, {
          target,
          error: message,
        });
      }
    }
  } catch (error) {
    failures += 1;
    terminalError = (error as Error)?.message || String(error);
    await publish('SCAN_FAILED', `Scan failed unexpectedly: ${terminalError}`, {
      error: terminalError,
    });
  } finally {
    activeScans.delete(workspaceId);
  }

  await publish(
    'SCAN_DONE',
    `Scan finished. ${targetsCompleted}/${targets.length} sites processed, ${pagesPersisted} page snapshots added.`,
    {
      mode,
      targets,
      targetsCompleted,
      snapshotsSaved,
      pagesDiscovered,
      pagesFetched,
      pagesPersisted,
      uniquePathPatterns,
      templateCoverageScore,
      warnings,
      failures,
    }
  );

  const coverageStatus =
    crawlSettings.coverageProfile === 'coverage_first'
      ? coverageHoldTriggered || failures > 0 || coverageStatuses.length === 0 || coverageStatuses.some((status) => status !== 'SUFFICIENT')
        ? 'THIN'
        : 'SUFFICIENT'
      : 'NOT_EVALUATED';

  const proofPayload = {
    coverage: {
      profile: crawlSettings.coverageProfile,
      status: coverageStatus,
      pagesDiscovered,
      pagesFetched,
      pagesPersisted,
      uniquePathPatterns,
      templateCoverageScore: clampCoverageScore(templateCoverageScore),
      thresholds:
        crawlSettings.coverageProfile === 'coverage_first'
          ? {
              minPagesPersisted: crawlSettings.minPagesPersisted,
              minPagesFetched: crawlSettings.minPagesFetched,
              minTemplatePatterns: crawlSettings.minTemplatePatterns,
            }
          : null,
      sampleStatuses: coverageStatuses.slice(0, 8),
    },
    extraction: {
      lineagePersisted,
      logos: logoCount,
      images: imageCount,
      fonts: fontCount,
      designTokens: designTokenCount,
      stylesheets: stylesheetCount,
    },
    quality: {
      warnings,
      failures,
      failClosed: crawlSettings.coverageProfile === 'coverage_first',
    },
  };

  const finalStatus: 'COMPLETED' | 'FAILED' =
    coverageHoldTriggered || (failures > 0 && targetsCompleted === 0) ? 'FAILED' : 'COMPLETED';
  await updatePortalIntakeScanRun(resolvedScanRunId, {
    status: finalStatus,
    targetsCompleted,
    snapshotsSaved,
    pagesDiscovered,
    pagesFetched,
    pagesPersisted,
    uniquePathPatterns,
    templateCoverageScore: clampCoverageScore(templateCoverageScore),
    coverageStatus,
    proof: proofPayload,
    assetStats: proofPayload.extraction,
    warnings,
    failures,
    error: finalStatus === 'FAILED' ? terminalError || 'Scan failed.' : null,
    endedAt: new Date(),
  });

  return {
    scanRunId: resolvedScanRunId,
    started: true,
    mode,
    queuedTargets: targets,
    targetsCompleted,
    snapshotsSaved,
    pagesDiscovered,
    pagesFetched,
    pagesPersisted,
    uniquePathPatterns,
    templateCoverageScore: clampCoverageScore(templateCoverageScore),
    coverageStatus,
    warnings,
    failures,
    proof: proofPayload,
  };
}

export async function queuePortalIntakeWebsiteScan(
  workspaceId: string,
  websites: string[],
  options?: {
    mode?: PortalIntakeScanMode;
    initiatedBy?: 'USER' | 'SYSTEM';
    skipIfRunning?: boolean;
  }
): Promise<{
  scanRunId: string;
  mode: PortalIntakeScanMode;
  websites: string[];
}> {
  const mode = options?.mode || 'quick';
  const initiatedBy = options?.initiatedBy || 'USER';
  const normalizedWebsites = parseWebsiteList(websites, 5);
  const crawlSettings = resolveCrawlSettings(mode);

  const scanRun = await createPortalIntakeScanRun({
    workspaceId,
    mode,
    status: 'RUNNING',
    initiatedBy,
    targets: normalizedWebsites,
    crawlSettings,
  });

  const previousTask = scanQueueByWorkspace.get(workspaceId) || Promise.resolve();
  const nextTask = previousTask
    .catch(() => undefined)
    .then(async () => {
      await scanPortalIntakeWebsites(workspaceId, normalizedWebsites, {
        ...options,
        mode,
        initiatedBy,
        scanRunId: scanRun.id,
        skipIfRunning: false,
      });
    })
    .catch(async (error) => {
      const message = (error as Error)?.message || String(error);
      try {
        await updatePortalIntakeScanRun(scanRun.id, {
          status: 'FAILED',
          failures: 1,
          error: message,
          endedAt: new Date(),
        });
      } catch {
        // Best effort; run-level failure logging handled by caller/event stream.
      }
    })
    .finally(() => {
      if (scanQueueByWorkspace.get(workspaceId) === nextTask) {
        scanQueueByWorkspace.delete(workspaceId);
      }
    });

  scanQueueByWorkspace.set(workspaceId, nextTask);

  return {
    scanRunId: scanRun.id,
    mode,
    websites: normalizedWebsites,
  };
}

export async function seedPortalIntakeWebsites(workspaceId: string, websites: string[]): Promise<void> {
  await scanPortalIntakeWebsites(workspaceId, websites, {
    mode: 'quick',
    initiatedBy: 'SYSTEM',
  });
}
