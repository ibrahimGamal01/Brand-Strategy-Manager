import { crawlAndPersistWebSources, fetchAndPersistWebSnapshot } from '../scraping/web-intelligence-service';
import { publishPortalIntakeEvent } from './portal-intake-events';

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
  }
): Promise<PortalIntakeWebsiteScanSummary> {
  const mode = options?.mode || 'quick';
  const initiatedBy = options?.initiatedBy || 'USER';
  const skipIfRunning = options?.skipIfRunning !== false;
  const targets = parseWebsiteList(websites, 5);

  if (!targets.length) {
    publishPortalIntakeEvent(workspaceId, 'SCAN_WARNING', 'No valid websites found to scan.', {
      mode,
      initiatedBy,
    });
    return {
      started: false,
      mode,
      queuedTargets: [],
      targetsCompleted: 0,
      snapshotsSaved: 0,
      pagesPersisted: 0,
      warnings: 1,
      failures: 0,
    };
  }

  if (activeScans.has(workspaceId) && skipIfRunning) {
    publishPortalIntakeEvent(workspaceId, 'SCAN_WARNING', 'A scan is already running for this workspace.', {
      mode,
      initiatedBy,
      targets,
    });
    return {
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
  const crawlSettings = resolveCrawlSettings(mode);

  let targetsCompleted = 0;
  let snapshotsSaved = 0;
  let pagesPersisted = 0;
  let warnings = 0;
  let failures = 0;

  publishPortalIntakeEvent(workspaceId, 'SCAN_STARTED', `Starting ${mode} scan for ${targets.length} website(s).`, {
    mode,
    initiatedBy,
    targets,
    crawlSettings,
  });

  try {
    for (const [index, target] of targets.entries()) {
      publishPortalIntakeEvent(
        workspaceId,
        'SCAN_TARGET_STARTED',
        `Scanning ${target} (${index + 1}/${targets.length}).`,
        { mode, target, index: index + 1, total: targets.length }
      );

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

        publishPortalIntakeEvent(workspaceId, 'SNAPSHOT_SAVED', `Saved homepage snapshot for ${target}.`, {
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
          maxPages: crawlSettings.maxPages,
          maxDepth: crawlSettings.maxDepth,
          mode: 'AUTO',
          allowExternal: true,
        });

        pagesPersisted += Number(crawl.persisted || 0);
        targetsCompleted += 1;

        if (Array.isArray(crawl.failures) && crawl.failures.length > 0) {
          warnings += crawl.failures.length;
          publishPortalIntakeEvent(
            workspaceId,
            'SCAN_WARNING',
            `Crawl completed for ${target} with ${crawl.failures.length} warning(s).`,
            {
              target,
              warnings: crawl.failures.slice(0, 5),
              persisted: crawl.persisted,
              runId: crawl.runId,
            }
          );
        }

        publishPortalIntakeEvent(workspaceId, 'CRAWL_COMPLETED', `Crawl completed for ${target}.`, {
          target,
          persisted: crawl.persisted,
          runId: crawl.runId,
          summary: crawl.summary,
          ...(crawl.fallbackReason ? { fallbackReason: crawl.fallbackReason } : {}),
        });
      } catch (error) {
        failures += 1;
        const message = (error as Error)?.message || String(error);
        publishPortalIntakeEvent(workspaceId, 'SCAN_FAILED', `Scan failed for ${target}: ${message}`, {
          target,
          error: message,
        });
      }
    }
  } finally {
    activeScans.delete(workspaceId);
  }

  publishPortalIntakeEvent(
    workspaceId,
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

  return {
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

export async function seedPortalIntakeWebsites(workspaceId: string, websites: string[]): Promise<void> {
  await scanPortalIntakeWebsites(workspaceId, websites, {
    mode: 'quick',
    initiatedBy: 'SYSTEM',
  });
}
