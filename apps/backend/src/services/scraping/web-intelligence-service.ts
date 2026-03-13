import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { scraplingClient } from './scrapling-client';
import { validateScrapeUrl } from './scrapling-security';
import {
  compactText,
  normalizeUrl,
  writeSnapshotArtifact,
} from './web-intelligence-utils';
import { extractAndPersistWebsiteDesignLineage } from './web-design-intelligence';
import { getJobDomains, upsertWebSource } from './web-intelligence-domain-service';
import type {
  ScraplingCrawlRequest,
  ScraplingExtractRequest,
  ScraplingFetchRequest,
  ScraplingMode,
} from './scrapling-types';

function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function getHostnameFromUrl(value: string): string {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizePathPattern(value: string): string {
  try {
    const parsed = new URL(value);
    const normalizedSegments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5)
      .map((segment) => {
        if (/^\d+$/.test(segment)) return '{n}';
        if (/^[a-f0-9]{8,}$/i.test(segment)) return '{id}';
        if (segment.length > 26) return '{slug}';
        return segment;
      });
    if (normalizedSegments.length === 0) return '/';
    return `/${normalizedSegments.join('/')}`;
  } catch {
    return '/';
  }
}

function toAllowedDomainSet(startUrls: string[], explicitAllowedDomains?: string[]): Set<string> {
  if (Array.isArray(explicitAllowedDomains) && explicitAllowedDomains.length > 0) {
    return new Set(
      explicitAllowedDomains
        .map((entry) => String(entry || '').trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, ''))
        .map((entry) => entry.split('/')[0] || '')
        .filter(Boolean)
    );
  }
  return new Set(startUrls.map((url) => getHostnameFromUrl(url)).filter(Boolean));
}

function extractLinksForCoverage(html: string, baseUrl: string, allowedDomains: Set<string>): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const source = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ');
  if (!source.trim()) return links;

  const hrefRegex = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'<>`]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(source))) {
    const rawHref = String(match[1] || match[2] || match[3] || '').trim();
    if (!rawHref) continue;
    if (
      rawHref.startsWith('#') ||
      /^javascript:/i.test(rawHref) ||
      /^mailto:/i.test(rawHref) ||
      /^tel:/i.test(rawHref) ||
      /^data:/i.test(rawHref) ||
      /^blob:/i.test(rawHref)
    ) {
      continue;
    }

    try {
      const resolved = normalizeUrl(new URL(rawHref, baseUrl).toString());
      if (!resolved) continue;
      const host = getHostnameFromUrl(resolved);
      if (allowedDomains.size > 0 && host && !allowedDomains.has(host)) continue;
      if (/\.(?:pdf|jpg|jpeg|png|gif|svg|webp|mp4|mov|avi|zip|rar|7z|docx?|xlsx?|pptx?)(?:$|[?#])/i.test(resolved)) {
        continue;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      links.push(resolved);
    } catch {
      // Ignore malformed URLs.
    }
  }

  return links;
}

async function discoverCoverageSeedUrls(input: {
  startUrls: string[];
  allowedDomains?: string[];
  mode?: ScraplingMode;
}): Promise<string[]> {
  const seedSet = new Set<string>(input.startUrls);
  const allowedDomainSet = toAllowedDomainSet(input.startUrls, input.allowedDomains);

  for (const startUrl of input.startUrls.slice(0, 5)) {
    try {
      const result = await scraplingClient.fetch({
        url: startUrl,
        mode: input.mode || 'AUTO',
        returnHtml: true,
        returnText: false,
      });
      const finalUrl = normalizeUrl(result.finalUrl || startUrl);
      if (finalUrl) seedSet.add(finalUrl);

      const links = extractLinksForCoverage(result.html || '', finalUrl || startUrl, allowedDomainSet);
      for (const link of links.slice(0, 80)) {
        seedSet.add(link);
      }
    } catch {
      // Ignore single-url discovery failures and continue deterministic pass.
    }
  }

  for (const domain of Array.from(allowedDomainSet)) {
    seedSet.add(`https://${domain}/sitemap.xml`);
    seedSet.add(`https://${domain}/sitemap_index.xml`);
    seedSet.add(`https://${domain}/about`);
    seedSet.add(`https://${domain}/services`);
    seedSet.add(`https://${domain}/contact`);
    seedSet.add(`https://${domain}/pricing`);
    seedSet.add(`https://${domain}/blog`);
  }

  return Array.from(seedSet).map((entry) => normalizeUrl(entry)).filter(Boolean).slice(0, 160);
}

export async function fetchAndPersistWebSnapshot(input: {
  researchJobId: string;
  url: string;
  sourceType?: string;
  discoveredBy?: string;
  mode?: ScraplingMode;
  sessionKey?: string;
  allowExternal?: boolean;
  scanRunId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  sourceId: string;
  snapshotId: string;
  finalUrl: string;
  statusCode: number | null;
  fetcherUsed: ScraplingMode;
  blockedSuspected: boolean;
  cleanTextSnippet: string;
  lineageSummary?: {
    persisted: number;
    logos: number;
    images: number;
    fonts: number;
    designTokens: number;
    stylesheets: number;
    ambiguities: string[];
  };
  fallbackReason?: string;
}> {
  const normalizedUrl = normalizeUrl(input.url);
  const allowedDomains = input.allowExternal ? undefined : await getJobDomains(input.researchJobId);
  const guard = validateScrapeUrl(normalizedUrl, allowedDomains);
  if (!guard.allowed || !guard.normalizedUrl) {
    throw new Error(`Blocked URL for scraping: ${guard.reason || 'URL guard rejected request'}`);
  }

  const source = await upsertWebSource({
    researchJobId: input.researchJobId,
    normalizedUrl: guard.normalizedUrl,
    sourceType: input.sourceType,
    discoveredBy: input.discoveredBy,
  });

  const fetchResult = await scraplingClient.fetch({
    url: guard.normalizedUrl,
    mode: input.mode || 'AUTO',
    sessionKey: input.sessionKey || `job:${input.researchJobId}:domain:${source.domain}`,
    returnHtml: true,
    returnText: true,
  } as ScraplingFetchRequest);

  const snapshot = await prisma.webPageSnapshot.create({
    data: {
      researchJobId: input.researchJobId,
      webSourceId: source.id,
      scanRunId: normalizeText(input.scanRunId) || null,
      fetcherUsed: fetchResult.fetcherUsed,
      finalUrl: fetchResult.finalUrl || guard.normalizedUrl,
      statusCode: fetchResult.statusCode,
      contentHash: createHash('sha256')
        .update(String(fetchResult.html || fetchResult.text || fetchResult.finalUrl || guard.normalizedUrl))
        .digest('hex'),
      metadata: toJsonSafe({
        blockedSuspected: fetchResult.blockedSuspected,
        timings: fetchResult.timings || null,
        fallbackReason: fetchResult.fallbackReason || null,
        sourceTransport:
          (fetchResult.metadata && (fetchResult.metadata as Record<string, unknown>).sourceTransport) ||
          (fetchResult.fallbackReason ? 'HTTP_FALLBACK' : 'SCRAPLING_WORKER'),
        sourceMetadata: fetchResult.metadata || null,
        scanRunId: normalizeText(input.scanRunId) || null,
        lineageMetadata: input.metadata || null,
        ...(input.metadata || {}),
      }),
      cleanText: compactText(String(fetchResult.text || ''), 30000) || null,
    },
  });

  const htmlPath = await writeSnapshotArtifact(input.researchJobId, snapshot.id, 'html', String(fetchResult.html || ''));
  const textPath = await writeSnapshotArtifact(
    input.researchJobId,
    snapshot.id,
    'txt',
    String(fetchResult.text || snapshot.cleanText || ''),
  );

  await prisma.webPageSnapshot.update({
    where: { id: snapshot.id },
    data: {
      htmlPath,
      textPath,
    },
  });

  const lineageSummary = await extractAndPersistWebsiteDesignLineage({
    researchJobId: input.researchJobId,
    snapshotId: snapshot.id,
    scanRunId: normalizeText(input.scanRunId) || null,
    pageUrl: fetchResult.finalUrl || guard.normalizedUrl,
    html: String(fetchResult.html || ''),
  }).catch(() => ({
    persisted: 0,
    logos: 0,
    images: 0,
    fonts: 0,
    designTokens: 0,
    stylesheets: 0,
    ambiguities: ['Lineage extraction failed.'],
  }));

  return {
    sourceId: source.id,
    snapshotId: snapshot.id,
    finalUrl: fetchResult.finalUrl || guard.normalizedUrl,
    statusCode: fetchResult.statusCode,
    fetcherUsed: fetchResult.fetcherUsed,
    blockedSuspected: fetchResult.blockedSuspected,
    cleanTextSnippet: compactText(fetchResult.text || snapshot.cleanText || '', 500),
    ...(lineageSummary ? { lineageSummary } : {}),
    ...(fetchResult.fallbackReason ? { fallbackReason: fetchResult.fallbackReason } : {}),
  };
}

export async function crawlAndPersistWebSources(input: {
  researchJobId: string;
  startUrls: string[];
  allowedDomains?: string[];
  maxPages?: number;
  maxDepth?: number;
  crawlTimeoutMs?: number;
  mode?: ScraplingMode;
  allowExternal?: boolean;
  scanRunId?: string;
  coverageProfile?: 'default' | 'coverage_first';
}) {
  const coverageProfile = input.coverageProfile === 'coverage_first' ? 'coverage_first' : 'default';
  if (coverageProfile === 'coverage_first' && !scraplingClient.isWorkerConfigured()) {
    throw new Error('COVERAGE_FIRST_REQUIRES_SCRAPLING_WORKER');
  }

  const normalizedStartUrls = Array.from(new Set(input.startUrls.map((url) => normalizeUrl(url)).filter(Boolean)));
  if (!normalizedStartUrls.length) throw new Error('At least one start URL is required for crawl');

  const explicitAllowedDomains = Array.isArray(input.allowedDomains)
    ? Array.from(
        new Set(
          input.allowedDomains
            .map((domain) => String(domain || '').trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, ''))
            .map((domain) => domain.split('/')[0] || '')
            .filter(Boolean),
        ),
      )
    : [];
  const allowedDomains =
    explicitAllowedDomains.length > 0
      ? explicitAllowedDomains
      : input.allowExternal
        ? undefined
        : await getJobDomains(input.researchJobId);
  const guardedUrls = normalizedStartUrls
    .map((url) => ({ url, guard: validateScrapeUrl(url, allowedDomains) }))
    .filter((entry) => entry.guard.allowed && entry.guard.normalizedUrl)
    .map((entry) => entry.guard.normalizedUrl as string);
  if (!guardedUrls.length) {
    throw new Error('No crawl URL passed guard checks. Add allowed domains or use allowExternal=true intentionally.');
  }

  const crawlStartUrls =
    coverageProfile === 'coverage_first'
      ? await discoverCoverageSeedUrls({
          startUrls: guardedUrls,
          allowedDomains,
          mode: input.mode || 'AUTO',
        })
      : guardedUrls;

  const crawlResult = await scraplingClient.crawl({
    startUrls: crawlStartUrls,
    allowedDomains,
    maxPages: input.maxPages,
    maxDepth: input.maxDepth,
    timeoutMs: input.crawlTimeoutMs,
    mode: input.mode || 'AUTO',
    concurrency: 4,
    resumeKey: `job:${input.researchJobId}:crawl`,
  } as ScraplingCrawlRequest);

  let persisted = 0;
  let lineagePersisted = 0;
  let logoCount = 0;
  let imageCount = 0;
  let fontCount = 0;
  let designTokenCount = 0;
  let stylesheetCount = 0;
  const failures: string[] = [];
  const uniquePathPatterns = new Set<string>();

  for (const page of crawlResult.pages || []) {
    const pageUrlRaw = String(page.finalUrl || page.url || '').trim();
    if (!pageUrlRaw) continue;

    try {
      const pageUrl = normalizeUrl(pageUrlRaw);
      const pageHost = getHostnameFromUrl(pageUrl);
      if (explicitAllowedDomains.length > 0 && pageHost && !explicitAllowedDomains.includes(pageHost)) {
        failures.push(`Skipped external page outside allowed domains: ${pageUrl}`);
        continue;
      }

      const source = await upsertWebSource({
        researchJobId: input.researchJobId,
        normalizedUrl: pageUrl,
        sourceType: 'OTHER',
        discoveredBy: 'SCRAPLING_CRAWL',
      });

      const snapshot = await prisma.webPageSnapshot.create({
        data: {
          researchJobId: input.researchJobId,
          webSourceId: source.id,
          scanRunId: normalizeText(input.scanRunId) || null,
          fetcherUsed: page.fetcherUsed || input.mode || 'AUTO',
          finalUrl: pageUrl,
          statusCode: page.statusCode || null,
          contentHash: createHash('sha256')
            .update(String(page.html || page.text || pageUrl))
            .digest('hex'),
          cleanText: compactText(page.text || '', 30000) || null,
          metadata: toJsonSafe({
            crawlRunId: crawlResult.runId,
            fallbackReason: crawlResult.fallbackReason || null,
            sourceTransport:
              (page.metadata && (page.metadata as Record<string, unknown>).sourceTransport) ||
              (crawlResult.fallbackReason ? 'HTTP_FALLBACK' : 'SCRAPLING_WORKER'),
            sourceMetadata: page.metadata || null,
            scanRunId: normalizeText(input.scanRunId) || null,
            coverageProfile,
          }),
        },
      });

      const htmlPath = await writeSnapshotArtifact(input.researchJobId, snapshot.id, 'html', String(page.html || ''));
      const textPath = await writeSnapshotArtifact(input.researchJobId, snapshot.id, 'txt', String(page.text || ''));
      await prisma.webPageSnapshot.update({ where: { id: snapshot.id }, data: { htmlPath, textPath } });
      persisted += 1;
      uniquePathPatterns.add(normalizePathPattern(pageUrl));

      const lineage = await extractAndPersistWebsiteDesignLineage({
        researchJobId: input.researchJobId,
        snapshotId: snapshot.id,
        scanRunId: normalizeText(input.scanRunId) || null,
        pageUrl,
        html: String(page.html || ''),
      }).catch(() => ({
        persisted: 0,
        logos: 0,
        images: 0,
        fonts: 0,
        designTokens: 0,
        stylesheets: 0,
        ambiguities: [],
      }));
      lineagePersisted += lineage.persisted;
      logoCount += lineage.logos;
      imageCount += lineage.images;
      fontCount += lineage.fonts;
      designTokenCount += lineage.designTokens;
      stylesheetCount += lineage.stylesheets;
    } catch (error: any) {
      failures.push(`Failed to persist ${pageUrlRaw}: ${error?.message || error}`);
    }
  }

  const pagesDiscovered = Number(crawlResult.summary?.queued || crawlStartUrls.length || 0);
  const pagesFetched = Number(crawlResult.summary?.fetched || 0);
  const minPersistedForCoverage =
    coverageProfile === 'coverage_first'
      ? Math.max(24, Math.min(120, Math.floor((Number(input.maxPages || 100) || 100) * 0.35)))
      : 0;
  const templateCoverageScore = clamp(
    coverageProfile === 'coverage_first' ? uniquePathPatterns.size / 18 : uniquePathPatterns.size / 10,
  );
  const coverageStatus =
    coverageProfile === 'coverage_first'
      ? persisted >= minPersistedForCoverage && uniquePathPatterns.size >= 12 && pagesFetched >= 20
        ? 'SUFFICIENT'
        : 'THIN'
      : 'NOT_EVALUATED';

  return {
    runId: crawlResult.runId,
    summary: crawlResult.summary,
    pagesDiscovered,
    pagesFetched,
    persisted,
    uniquePathPatterns: uniquePathPatterns.size,
    templateCoverageScore,
    coverageStatus,
    assetStats: {
      lineagePersisted,
      logos: logoCount,
      images: imageCount,
      fonts: fontCount,
      designTokens: designTokenCount,
      stylesheets: stylesheetCount,
    },
    failures,
    fallbackReason: crawlResult.fallbackReason || null,
  };
}

export async function extractFromWebSnapshot(input: {
  researchJobId: string;
  snapshotId: string;
  recipeId?: string;
  recipeSchema?: Record<string, unknown>;
  adaptiveNamespace?: string;
}) {
  const snapshot = await prisma.webPageSnapshot.findFirst({
    where: { id: input.snapshotId, researchJobId: input.researchJobId },
  });
  if (!snapshot) throw new Error('Snapshot not found for this research job');

  let recipeSchema = input.recipeSchema;
  if (!recipeSchema && input.recipeId) {
    const recipe = await prisma.webExtractionRecipe.findFirst({
      where: { id: input.recipeId, researchJobId: input.researchJobId, isActive: true },
    });
    if (!recipe) throw new Error('Recipe not found for this research job');
    recipeSchema = recipe.schema as Record<string, unknown>;
  }
  if (!recipeSchema || typeof recipeSchema !== 'object') {
    throw new Error('recipeSchema (or recipeId) is required to run extract');
  }

  const html = snapshot.htmlPath ? await fs.readFile(snapshot.htmlPath, 'utf8').catch(() => '') : '';

  const extractResult = await scraplingClient.extract({
    snapshotHtml: html || undefined,
    recipeSchema,
    adaptiveNamespace: input.adaptiveNamespace,
  } as ScraplingExtractRequest);

  const extractionRun = input.recipeId
    ? await prisma.webExtractionRun.create({
        data: {
          researchJobId: input.researchJobId,
          recipeId: input.recipeId,
          snapshotId: input.snapshotId,
          extracted: toJsonSafe(extractResult.extracted),
          confidence: extractResult.confidence,
          warnings: toJsonSafe(extractResult.warnings),
        },
      })
    : null;

  if (input.adaptiveNamespace && Array.isArray(extractResult.adaptiveUpdates)) {
    for (const update of extractResult.adaptiveUpdates) {
      if (!update.key) continue;
      await prisma.adaptiveSelectorMemory.upsert({
        where: {
          researchJobId_namespace_key: {
            researchJobId: input.researchJobId,
            namespace: input.adaptiveNamespace,
            key: update.key,
          },
        },
        update: {
          elementJson: toJsonSafe(update.element),
        },
        create: {
          researchJobId: input.researchJobId,
          namespace: input.adaptiveNamespace,
          key: update.key,
          elementJson: toJsonSafe(update.element),
        },
      });
    }
  }

  return {
    extracted: extractResult.extracted,
    confidence: extractResult.confidence,
    warnings: extractResult.warnings,
    extractionRunId: extractionRun?.id || null,
    fallbackReason: extractResult.fallbackReason || null,
  };
}

export async function listWebSources(researchJobId: string, includeInactive = false, limit = 200) {
  return prisma.webSource.findMany({
    where: {
      researchJobId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 500)),
  });
}

export async function listWebSnapshots(researchJobId: string, sourceId?: string, includeInactive = false, limit = 100) {
  return prisma.webPageSnapshot.findMany({
    where: {
      researchJobId,
      ...(sourceId ? { webSourceId: sourceId } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: { fetchedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 500)),
  });
}

export async function resolveAllowedDomainsForJob(researchJobId: string): Promise<string[]> {
  return getJobDomains(researchJobId);
}
