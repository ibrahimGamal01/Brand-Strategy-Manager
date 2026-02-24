import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { scrapeBrandMentions } from '../../discovery/brand-mentions';
import { fetchAndPersistWebSnapshot } from '../../scraping/web-intelligence-service';
import { BrandIntelligenceContext, BrandIntelligenceModuleResult, BrandMentionsDepth } from '../types';

function normalizeDepth(value: unknown): BrandMentionsDepth {
  return value === 'deep' ? 'deep' : 'standard';
}

function dedupeByUrl<T extends { url: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    const key = String(row.url || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

export async function runBrandMentionsModule(input: {
  context: BrandIntelligenceContext;
  runId: string;
  moduleInput?: { depth?: BrandMentionsDepth };
}): Promise<BrandIntelligenceModuleResult> {
  const warnings: string[] = [];
  const depth = normalizeDepth(input.moduleInput?.depth);

  let collected = 0;
  let filtered = 0;
  let persisted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let deepEnriched = 0;

  const rawMentions = await scrapeBrandMentions(input.context.brandName);
  const uniqueMentions = dedupeByUrl(rawMentions);
  collected = uniqueMentions.length;
  filtered = Math.max(rawMentions.length - uniqueMentions.length, 0);

  if (rawMentions.length === 0) {
    warnings.push('No brand mentions were returned by the collector');
  }

  for (const mention of uniqueMentions) {
    const url = String(mention.url || '').trim();
    if (!url) {
      filtered += 1;
      continue;
    }

    try {
      const existing = await prisma.brandMention.findFirst({
        where: {
          clientId: input.context.clientId,
          url,
        },
        select: {
          id: true,
        },
      });

      const payload: Prisma.BrandMentionUncheckedCreateInput = {
        id: existing?.id,
        clientId: input.context.clientId,
        brandIntelligenceRunId: input.runId,
        url,
        title: mention.title || null,
        snippet: mention.snippet || null,
        fullText: mention.full_text || null,
        sourceType: mention.source_type || 'web',
        availabilityStatus: 'VERIFIED',
        availabilityReason: null,
        resolverConfidence: 0.9,
        evidence: {
          collector: 'web_search_scraper',
          depth,
        } as Prisma.InputJsonValue,
      };

      if (depth === 'deep') {
        try {
          const enrichment = await fetchAndPersistWebSnapshot({
            researchJobId: input.context.researchJobId,
            url,
            sourceType: 'ARTICLE',
            discoveredBy: 'DDG',
            mode: 'AUTO',
            allowExternal: true,
          });
          const existingEvidence =
            payload.evidence && typeof payload.evidence === 'object'
              ? (payload.evidence as Record<string, unknown>)
              : {};
          payload.evidence = {
            ...existingEvidence,
            deepEnrichment: {
              snapshotId: enrichment.snapshotId,
              sourceId: enrichment.sourceId,
              fetcherUsed: enrichment.fetcherUsed,
              statusCode: enrichment.statusCode,
              blockedSuspected: enrichment.blockedSuspected,
              fallbackReason: enrichment.fallbackReason || null,
            },
          } as Prisma.InputJsonValue;
          if (!payload.fullText && enrichment.cleanTextSnippet) {
            payload.fullText = enrichment.cleanTextSnippet;
          }
          deepEnriched += 1;
        } catch (deepError: any) {
          warnings.push(`Deep enrichment failed for ${url}: ${deepError?.message || deepError}`);
        }
      }

      if (existing) {
        await prisma.brandMention.update({
          where: { id: existing.id },
          data: payload,
        });
        updated += 1;
        continue;
      }

      delete payload.id;
      await prisma.brandMention.create({ data: payload });
      persisted += 1;
    } catch (error: any) {
      failed += 1;
      warnings.push(`Failed to persist mention ${url}: ${error?.message || error}`);
    }
  }

  return {
    module: 'brand_mentions',
    success: failed === 0,
    collected,
    filtered,
    persisted,
    updated,
    skipped,
    failed,
    warnings,
    diagnostics: {
      depth,
      uniqueMentions: uniqueMentions.length,
      totalMentions: rawMentions.length,
      deepEnriched,
    },
  };
}
