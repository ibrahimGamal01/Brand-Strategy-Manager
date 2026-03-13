import { prisma } from '../../lib/prisma';
import { searchRawDDG } from '../discovery/duckduckgo-search';
import { getLatestWorkspaceWebsiteAssetPacks } from '../scraping/website-asset-packs';
import { isProcessControlV2LiveResearchEnabled } from './feature-flags';

export type ResearchAdapterMethod = 'NICHE_STANDARD' | 'BAT_CORE';

export type ResearchEvidenceItem = {
  sourceType: string;
  refId?: string;
  url?: string;
  title?: string;
  snippet?: string;
  fetchedAt?: Date;
  metadata?: Record<string, unknown>;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function buildLinkedinActorQueries(input: {
  actorName: string;
  brandShortName?: string;
  brandDomain?: string;
}): string[] {
  const actorName = normalizeText(input.actorName);
  const brandShortName = normalizeText(input.brandShortName);
  const brandDomain = normalizeText(input.brandDomain).replace(/^https?:\/\//i, '');

  const seeds = Array.from(
    new Set([actorName, brandShortName, brandDomain].map((entry) => normalizeText(entry)).filter(Boolean))
  );

  const queries = seeds.flatMap((seed) => [
    `site:linkedin.com "${seed}"`,
    `site:linkedin.com ("${seed}" OR "${seed.replace(/\.[a-z]{2,}$/i, '')}") profile`,
  ]);

  return Array.from(new Set(queries)).slice(0, 8);
}

function extractDomain(value: string): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function buildBaseQueries(input: {
  brandName: string;
  domain: string;
  objective: string;
}): string[] {
  const brandName = normalizeText(input.brandName);
  const domain = normalizeText(input.domain);
  const objective = normalizeText(input.objective);
  const queries = [
    [brandName, 'market analysis'].filter(Boolean).join(' '),
    [brandName, objective].filter(Boolean).join(' '),
    domain ? `site:${domain}` : '',
    domain ? `site:${domain} services` : '',
    domain ? `site:${domain} about` : '',
    ...buildLinkedinActorQueries({
      actorName: brandName,
      brandShortName: brandName.split(/\s+/)[0] || brandName,
      brandDomain: domain,
    }),
  ]
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  return Array.from(new Set(queries)).slice(0, 12);
}

export async function collectResearchEvidence(params: {
  researchJobId: string;
  processRunId: string;
  method: ResearchAdapterMethod;
  objective: string;
}): Promise<ResearchEvidenceItem[]> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: params.researchJobId },
    include: {
      client: true,
      webSources: {
        where: { isActive: true },
        orderBy: { updatedAt: 'desc' },
        take: 16,
      },
      webPageSnapshots: {
        where: { isActive: true },
        orderBy: { fetchedAt: 'desc' },
        take: 16,
      },
      workspaceEvidenceRefs: {
        orderBy: { createdAt: 'desc' },
        take: 24,
      },
    },
  });

  if (!workspace) {
    throw new Error(`Workspace ${params.researchJobId} not found`);
  }

  const inputData = (workspace.inputData || {}) as Record<string, unknown>;
  const website = normalizeText(inputData.website);
  const domain = extractDomain(website);
  const brandName = normalizeText(workspace.client?.name || inputData.brandName);

  const evidence: ResearchEvidenceItem[] = [];
  for (const item of workspace.workspaceEvidenceRefs) {
    evidence.push({
      sourceType: 'workspace_evidence_ref',
      refId: item.refId || item.id,
      url: item.url || undefined,
      title: item.label || undefined,
      snippet: item.snippet || undefined,
      fetchedAt: item.fetchedAt || item.createdAt,
      metadata: {
        kind: item.kind,
        provider: item.provider,
        confidence: item.confidence,
      },
    });
  }

  for (const source of workspace.webSources) {
    evidence.push({
      sourceType: 'web_source',
      refId: source.id,
      url: source.url,
      title: source.domain,
      snippet: `Source discovered by ${source.discoveredBy}`,
      fetchedAt: source.updatedAt,
      metadata: {
        discoveredBy: source.discoveredBy,
        sourceType: source.sourceType,
      },
    });
  }

  for (const snapshot of workspace.webPageSnapshots) {
    evidence.push({
      sourceType: 'web_snapshot',
      refId: snapshot.id,
      url: snapshot.finalUrl || undefined,
      title: snapshot.finalUrl || snapshot.webSourceId,
      snippet: normalizeText(snapshot.cleanText).slice(0, 420),
      fetchedAt: snapshot.fetchedAt,
      metadata: {
        fetcher: snapshot.fetcherUsed,
        statusCode: snapshot.statusCode,
      },
    });
  }

  try {
    const assetPacks = await getLatestWorkspaceWebsiteAssetPacks({
      workspaceId: params.researchJobId,
      maxRows: 500,
      maxPerPack: 40,
    });

    const selectionCandidates = [
      {
        sourceType: 'website_asset_selection_logo',
        selection: assetPacks.selection.primaryLogo,
      },
      {
        sourceType: 'website_asset_selection_typography',
        selection: assetPacks.selection.typography,
      },
      {
        sourceType: 'website_asset_selection_palette',
        selection: assetPacks.selection.colorPalette,
      },
    ];

    for (const entry of selectionCandidates) {
      if (!entry.selection) continue;
      evidence.push({
        sourceType: entry.sourceType,
        refId: entry.selection.evidenceRefs[0] || entry.selection.value,
        url: undefined,
        title: entry.selection.label,
        snippet: `Selected with confidence ${entry.selection.confidence.toFixed(2)}.`,
        fetchedAt: new Date(),
        metadata: {
          value: entry.selection.value,
          confidence: entry.selection.confidence,
          evidenceRefs: entry.selection.evidenceRefs,
          sourceScanRunId: assetPacks.sourceScanRunId,
        },
      });
    }

    const packEntries = Object.entries(assetPacks.packs) as Array<
      [
        keyof typeof assetPacks.packs,
        {
          items: Array<{
            id: string;
            assetType: string;
            role: string;
            normalizedAssetUrl: string;
            pageUrl: string;
            confidence: number;
            discoveryRuleId: string;
          }>;
        },
      ]
    >;

    for (const [packKey, pack] of packEntries) {
      for (const item of pack.items.slice(0, 16)) {
        evidence.push({
          sourceType: `website_asset_${packKey}`,
          refId: item.id,
          url: item.pageUrl || undefined,
          title: `${item.assetType} ${item.role || ''}`.trim() || `website asset (${packKey})`,
          snippet: item.normalizedAssetUrl,
          fetchedAt: new Date(),
          metadata: {
            packKey,
            role: item.role,
            confidence: item.confidence,
            discoveryRuleId: item.discoveryRuleId,
            normalizedAssetUrl: item.normalizedAssetUrl,
            pageUrl: item.pageUrl,
            sourceScanRunId: assetPacks.sourceScanRunId,
          },
        });
      }
    }

    for (const ambiguity of assetPacks.ambiguities.slice(0, 6)) {
      evidence.push({
        sourceType: 'website_asset_ambiguity',
        refId: ambiguity.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        title: 'Brand asset ambiguity',
        snippet: ambiguity,
        fetchedAt: new Date(),
        metadata: {
          sourceScanRunId: assetPacks.sourceScanRunId,
        },
      });
    }
  } catch (error) {
    console.warn('[ProcessControlV2] Failed to load website asset packs:', (error as Error)?.message || error);
  }

  const shouldRunLiveSearch = isProcessControlV2LiveResearchEnabled();
  if (shouldRunLiveSearch) {
    const queries = buildBaseQueries({
      brandName,
      domain,
      objective: params.objective,
    });
    const live = await searchRawDDG(queries, {
      researchJobId: params.researchJobId,
      source: 'process_control_v2',
      maxResults: params.method === 'NICHE_STANDARD' ? 40 : 24,
      timeoutMs: 55_000,
    });

    for (const result of live.slice(0, 20)) {
      evidence.push({
        sourceType: 'ddg_raw',
        refId: result.href,
        url: result.href,
        title: result.title,
        snippet: result.body,
        fetchedAt: new Date(),
        metadata: {
          query: result.query,
        },
      });
    }
  }

  const deduped: ResearchEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    const key = `${item.sourceType}|${normalizeText(item.refId)}|${normalizeText(item.url)}|${normalizeText(item.title)}`.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= 80) break;
  }

  return deduped;
}
