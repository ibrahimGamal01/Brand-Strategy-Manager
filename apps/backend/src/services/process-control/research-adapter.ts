import { prisma } from '../../lib/prisma';
import { searchRawDDG } from '../discovery/duckduckgo-search';
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
