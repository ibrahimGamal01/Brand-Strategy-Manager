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
};

const CRAWL_SETTINGS_BY_MODE: Record<PortalIntakeScanMode, CrawlSettings> = {
  quick: { maxPages: 4, maxDepth: 1 },
  standard: { maxPages: 20, maxDepth: 2 },
  deep: { maxPages: 100, maxDepth: 3 },
};

const activeScans = new Set<string>();

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
  pagesPersisted: number;
  warnings: number;
  failures: number;
};

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
      pagesPersisted: 0,
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
      pagesPersisted: 0,
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
      pagesPersisted: 0,
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
      pagesPersisted: 0,
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
  let pagesPersisted = 0;
  let warnings = 0;
  let failures = 0;
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
        });
        snapshotsSaved += 1;

        await publish('SNAPSHOT_SAVED', `Saved homepage snapshot for ${target}.`, {
          target,
          snapshotId: snapshot.snapshotId,
          sourceId: snapshot.sourceId,
          blockedSuspected: snapshot.blockedSuspected,
          fetcherUsed: snapshot.fetcherUsed,
          statusCode: snapshot.statusCode,
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
        });

        pagesPersisted += Number(crawl.persisted || 0);
        targetsCompleted += 1;

        if (crawl.fallbackReason) {
          warnings += 1;
          await publish('SCAN_WARNING', `Crawler used fallback mode for ${target}.`, {
            target,
            fallbackReason: crawl.fallbackReason,
            persisted: crawl.persisted,
            runId: crawl.runId,
          });
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
      pagesPersisted,
      warnings,
      failures,
    }
  );

  const finalStatus: 'COMPLETED' | 'FAILED' =
    failures > 0 && targetsCompleted === 0 ? 'FAILED' : 'COMPLETED';
  await updatePortalIntakeScanRun(resolvedScanRunId, {
    status: finalStatus,
    targetsCompleted,
    snapshotsSaved,
    pagesPersisted,
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
    pagesPersisted,
    warnings,
    failures,
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

  void scanPortalIntakeWebsites(workspaceId, normalizedWebsites, {
    ...options,
    mode,
    initiatedBy,
    scanRunId: scanRun.id,
  }).catch(async (error) => {
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
  });

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
