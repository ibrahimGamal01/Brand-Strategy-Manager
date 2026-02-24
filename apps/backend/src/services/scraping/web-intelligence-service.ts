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

export async function fetchAndPersistWebSnapshot(input: {
  researchJobId: string;
  url: string;
  sourceType?: string;
  discoveredBy?: string;
  mode?: ScraplingMode;
  sessionKey?: string;
  allowExternal?: boolean;
}): Promise<{
  sourceId: string;
  snapshotId: string;
  finalUrl: string;
  statusCode: number | null;
  fetcherUsed: ScraplingMode;
  blockedSuspected: boolean;
  cleanTextSnippet: string;
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

  return {
    sourceId: source.id,
    snapshotId: snapshot.id,
    finalUrl: fetchResult.finalUrl || guard.normalizedUrl,
    statusCode: fetchResult.statusCode,
    fetcherUsed: fetchResult.fetcherUsed,
    blockedSuspected: fetchResult.blockedSuspected,
    cleanTextSnippet: compactText(fetchResult.text || snapshot.cleanText || '', 500),
    ...(fetchResult.fallbackReason ? { fallbackReason: fetchResult.fallbackReason } : {}),
  };
}

export async function crawlAndPersistWebSources(input: {
  researchJobId: string;
  startUrls: string[];
  maxPages?: number;
  maxDepth?: number;
  mode?: ScraplingMode;
  allowExternal?: boolean;
}) {
  const normalizedStartUrls = Array.from(new Set(input.startUrls.map((url) => normalizeUrl(url)).filter(Boolean)));
  if (!normalizedStartUrls.length) throw new Error('At least one start URL is required for crawl');

  const allowedDomains = input.allowExternal ? undefined : await getJobDomains(input.researchJobId);
  const guardedUrls = normalizedStartUrls
    .map((url) => ({ url, guard: validateScrapeUrl(url, allowedDomains) }))
    .filter((entry) => entry.guard.allowed && entry.guard.normalizedUrl)
    .map((entry) => entry.guard.normalizedUrl as string);
  if (!guardedUrls.length) {
    throw new Error('No crawl URL passed guard checks. Add allowed domains or use allowExternal=true intentionally.');
  }

  const crawlResult = await scraplingClient.crawl({
    startUrls: guardedUrls,
    allowedDomains,
    maxPages: input.maxPages,
    maxDepth: input.maxDepth,
    mode: input.mode || 'AUTO',
    concurrency: 4,
    resumeKey: `job:${input.researchJobId}:crawl`,
  } as ScraplingCrawlRequest);

  let persisted = 0;
  const failures: string[] = [];

  for (const page of crawlResult.pages || []) {
    const pageUrl = String(page.finalUrl || page.url || '').trim();
    if (!pageUrl) continue;

    try {
      const source = await upsertWebSource({
        researchJobId: input.researchJobId,
        normalizedUrl: normalizeUrl(pageUrl),
        sourceType: 'OTHER',
        discoveredBy: 'SCRAPLING_CRAWL',
      });

      const snapshot = await prisma.webPageSnapshot.create({
        data: {
          researchJobId: input.researchJobId,
          webSourceId: source.id,
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
          }),
        },
      });

      const htmlPath = await writeSnapshotArtifact(input.researchJobId, snapshot.id, 'html', String(page.html || ''));
      const textPath = await writeSnapshotArtifact(input.researchJobId, snapshot.id, 'txt', String(page.text || ''));
      await prisma.webPageSnapshot.update({ where: { id: snapshot.id }, data: { htmlPath, textPath } });
      persisted += 1;
    } catch (error: any) {
      failures.push(`Failed to persist ${pageUrl}: ${error?.message || error}`);
    }
  }

  return {
    runId: crawlResult.runId,
    summary: crawlResult.summary,
    persisted,
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
