import { prisma } from '../../lib/prisma';

export type PortalLibraryCollection =
  | 'web'
  | 'competitors'
  | 'social'
  | 'community'
  | 'news'
  | 'deliverables';

export type PortalLibraryItem = {
  id: string;
  collection: PortalLibraryCollection;
  title: string;
  summary: string;
  freshness: string;
  tags: string[];
  evidenceLabel: string;
  evidenceHref?: string;
};

type ListPortalLibraryOptions = {
  collection?: PortalLibraryCollection;
  query?: string;
  limit?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactText(value: unknown, maxChars = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
}

function toHttpHref(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function titleFromUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return 'Web source';
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${hostname}${path}`.slice(0, 140);
  } catch {
    return raw.slice(0, 140);
  }
}

function normalizeCollection(value: unknown): PortalLibraryCollection | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (
    raw === 'web' ||
    raw === 'competitors' ||
    raw === 'social' ||
    raw === 'community' ||
    raw === 'news' ||
    raw === 'deliverables'
  ) {
    return raw;
  }
  return undefined;
}

function withQuery(items: PortalLibraryItem[], queryRaw?: string): PortalLibraryItem[] {
  const query = String(queryRaw || '').trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => {
    const haystack = `${item.title} ${item.summary} ${item.tags.join(' ')} ${item.evidenceLabel}`.toLowerCase();
    return haystack.includes(query);
  });
}

function byFreshnessDesc(a: PortalLibraryItem, b: PortalLibraryItem): number {
  return Date.parse(b.freshness) - Date.parse(a.freshness);
}

function dedupeItems(items: PortalLibraryItem[]): PortalLibraryItem[] {
  const map = new Map<string, PortalLibraryItem>();
  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

export async function listPortalWorkspaceLibrary(
  workspaceId: string,
  options?: ListPortalLibraryOptions
): Promise<{
  items: PortalLibraryItem[];
  counts: Record<PortalLibraryCollection, number>;
}> {
  const limit = Math.max(10, Math.min(300, Math.floor(Number(options?.limit || 160))));
  const collectionFilter = normalizeCollection(options?.collection);

  const [
    webSources,
    webSnapshots,
    webExtractionRuns,
    competitors,
    socialPosts,
    communityInsights,
    news,
    calendarRuns,
    fileAttachments,
    aiBusinessAnalyses,
  ] = await Promise.all([
    prisma.webSource.findMany({
      where: { researchJobId: workspaceId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),
    prisma.webPageSnapshot.findMany({
      where: { researchJobId: workspaceId, isActive: true },
      include: {
        webSource: {
          select: {
            url: true,
            domain: true,
            sourceType: true,
            discoveredBy: true,
          },
        },
      },
      orderBy: { fetchedAt: 'desc' },
      take: limit,
    }),
    prisma.webExtractionRun.findMany({
      where: { researchJobId: workspaceId, isActive: true },
      include: {
        recipe: {
          select: { name: true, targetDomain: true },
        },
        snapshot: {
          select: {
            finalUrl: true,
            fetchedAt: true,
            webSource: {
              select: { url: true, domain: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 120),
    }),
    prisma.discoveredCompetitor.findMany({
      where: { researchJobId: workspaceId, isActive: true },
      include: {
        competitor: {
          select: { name: true },
        },
      },
      orderBy: [{ relevanceScore: 'desc' }, { updatedAt: 'desc' }],
      take: Math.min(limit, 120),
    }),
    prisma.socialPost.findMany({
      where: { socialProfile: { researchJobId: workspaceId } },
      include: {
        socialProfile: {
          select: {
            platform: true,
            handle: true,
          },
        },
      },
      orderBy: [{ postedAt: 'desc' }, { scrapedAt: 'desc' }],
      take: Math.min(limit, 120),
    }),
    prisma.communityInsight.findMany({
      where: { researchJobId: workspaceId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 120),
    }),
    prisma.ddgNewsResult.findMany({
      where: { researchJobId: workspaceId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 120),
    }),
    prisma.contentCalendarRun.findMany({
      where: { researchJobId: workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.fileAttachment.findMany({
      where: { researchJobId: workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 48,
    }),
    prisma.aiBusinessAnalysis.findMany({
      where: { researchJobId: workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const webSourceItems: PortalLibraryItem[] = webSources.map((source) => {
    const href = toHttpHref(source.url);
    const sourceType = String(source.sourceType || 'OTHER').toLowerCase();
    const discoveredBy = String(source.discoveredBy || 'user').toLowerCase();
    return {
      id: `web-source:${source.id}`,
      collection: 'web',
      title: titleFromUrl(source.url),
      summary: `Tracked source for ${source.domain}. Added via ${discoveredBy.replace(/_/g, ' ')}.`,
      freshness: toIso(source.updatedAt || source.createdAt),
      tags: ['source', sourceType, discoveredBy].filter(Boolean),
      evidenceLabel: `${sourceType.toUpperCase()} source`,
      ...(href ? { evidenceHref: href } : {}),
    };
  });

  const webItems: PortalLibraryItem[] = webSnapshots.map((snapshot) => {
    const href = toHttpHref(snapshot.finalUrl || snapshot.webSource.url);
    const sourceType = String(snapshot.webSource.sourceType || 'OTHER').toLowerCase();
    const discoveredBy = String(snapshot.webSource.discoveredBy || 'user').toLowerCase();
    const fetcher = String(snapshot.fetcherUsed || 'auto').toLowerCase();
    return {
      id: `web:${snapshot.id}`,
      collection: 'web',
      title: titleFromUrl(snapshot.finalUrl || snapshot.webSource.url),
      summary:
        compactText(snapshot.cleanText, 240) ||
        `Snapshot captured from ${snapshot.webSource.domain || titleFromUrl(snapshot.webSource.url)}.`,
      freshness: toIso(snapshot.fetchedAt),
      tags: ['snapshot', sourceType, discoveredBy, fetcher].filter(Boolean),
      evidenceLabel: `${sourceType.toUpperCase()} • ${fetcher.toUpperCase()}`,
      ...(href ? { evidenceHref: href } : {}),
    };
  });

  const crawlRuns = new Map<
    string,
    {
      runId: string;
      latestAt: string;
      domains: Set<string>;
      pages: number;
      link?: string;
      discoveredBy: Set<string>;
    }
  >();

  for (const snapshot of webSnapshots) {
    const metadata = isRecord(snapshot.metadata) ? snapshot.metadata : null;
    const crawlRunId = String(metadata?.crawlRunId || '').trim();
    if (!crawlRunId) continue;

    const existing = crawlRuns.get(crawlRunId) || {
      runId: crawlRunId,
      latestAt: toIso(snapshot.fetchedAt),
      domains: new Set<string>(),
      pages: 0,
      link: toHttpHref(snapshot.finalUrl || snapshot.webSource.url),
      discoveredBy: new Set<string>(),
    };

    existing.pages += 1;
    existing.domains.add(String(snapshot.webSource.domain || '').trim());
    existing.discoveredBy.add(String(snapshot.webSource.discoveredBy || '').toLowerCase());
    const snapshotFreshness = Date.parse(toIso(snapshot.fetchedAt));
    const existingFreshness = Date.parse(existing.latestAt);
    if (!Number.isFinite(existingFreshness) || snapshotFreshness > existingFreshness) {
      existing.latestAt = toIso(snapshot.fetchedAt);
    }
    if (!existing.link) {
      existing.link = toHttpHref(snapshot.finalUrl || snapshot.webSource.url);
    }

    crawlRuns.set(crawlRunId, existing);
  }

  const crawlRunItems: PortalLibraryItem[] = Array.from(crawlRuns.values()).map((row) => ({
    id: `web-crawl:${row.runId}`,
    collection: 'web',
    title: `Crawl run ${row.runId.slice(0, 8)}`,
    summary: `Captured ${row.pages} page snapshot(s) across ${row.domains.size || 1} domain(s).`,
    freshness: row.latestAt,
    tags: ['crawl', ...Array.from(row.discoveredBy)],
    evidenceLabel: `Crawl • ${row.pages} pages`,
    ...(row.link ? { evidenceHref: row.link } : {}),
  }));

  const extractionItems: PortalLibraryItem[] = webExtractionRuns.map((run) => {
    const extracted = isRecord(run.extracted) ? run.extracted : null;
    const extractedFieldCount = extracted ? Object.keys(extracted).length : 0;
    const warningsCount = Array.isArray(run.warnings) ? run.warnings.length : 0;
    const sourceUrl = run.snapshot.finalUrl || run.snapshot.webSource.url;
    const domain = run.recipe.targetDomain || run.snapshot.webSource.domain || titleFromUrl(sourceUrl);

    return {
      id: `web-extraction:${run.id}`,
      collection: 'web',
      title: `Extraction ${run.recipe.name}`,
      summary: compactText(
        `Extracted ${extractedFieldCount} field(s) from ${domain}${warningsCount ? ` with ${warningsCount} warning(s)` : ''}.`,
        240
      ),
      freshness: toIso(run.createdAt),
      tags: ['extraction', String(domain || '').toLowerCase()].filter(Boolean),
      evidenceLabel: `Confidence ${Number(run.confidence || 0).toFixed(2)}`,
      ...(toHttpHref(sourceUrl) ? { evidenceHref: toHttpHref(sourceUrl) } : {}),
    };
  });

  const competitorItems: PortalLibraryItem[] = competitors.map((row) => {
    const platform = String(row.platform || '').toLowerCase();
    const handle = String(row.handle || '').trim();
    const titleBase = row.competitor?.name ? `${row.competitor.name}` : `@${handle}`;
    const title = handle ? `${titleBase} (${platform})` : titleBase;
    const score = typeof row.relevanceScore === 'number' ? row.relevanceScore.toFixed(2) : 'n/a';
    return {
      id: `competitor:${row.id}`,
      collection: 'competitors',
      title: title.slice(0, 140),
      summary: compactText(
        row.discoveryReason ||
          row.selectionReason ||
          `Selection ${row.selectionState}, status ${row.status}, relevance ${score}.`,
        240
      ),
      freshness: toIso(row.updatedAt || row.discoveredAt),
      tags: [platform, String(row.selectionState || '').toLowerCase(), String(row.status || '').toLowerCase()].filter(Boolean),
      evidenceLabel: handle ? `${platform} @${handle}` : platform || 'competitor',
      ...(toHttpHref(row.profileUrl) ? { evidenceHref: toHttpHref(row.profileUrl) } : {}),
    };
  });

  const socialItems: PortalLibraryItem[] = socialPosts.map((post) => {
    const platform = String(post.socialProfile.platform || '').toLowerCase();
    const handle = String(post.socialProfile.handle || '').trim();
    const type = String(post.type || '').trim().toLowerCase();
    return {
      id: `social:${post.id}`,
      collection: 'social',
      title: `@${handle} • ${platform}`.slice(0, 140),
      summary: compactText(post.caption || `Captured ${type || 'post'} from ${platform}.`, 240),
      freshness: toIso(post.postedAt || post.scrapedAt),
      tags: [platform, type || 'post'].filter(Boolean),
      evidenceLabel: 'Social post',
      ...(toHttpHref(post.url) ? { evidenceHref: toHttpHref(post.url) } : {}),
    };
  });

  const communityItems: PortalLibraryItem[] = communityInsights.map((row) => ({
    id: `community:${row.id}`,
    collection: 'community',
    title: compactText(row.sourceQuery || row.source || 'Community signal', 140),
    summary: compactText(row.content, 240),
    freshness: toIso(row.updatedAt || row.createdAt),
    tags: [String(row.source || '').toLowerCase(), String(row.sentiment || '').toLowerCase()].filter(Boolean),
    evidenceLabel: String(row.source || 'Community'),
    ...(toHttpHref(row.url) ? { evidenceHref: toHttpHref(row.url) } : {}),
  }));

  const newsItems: PortalLibraryItem[] = news.map((row) => ({
    id: `news:${row.id}`,
    collection: 'news',
    title: compactText(row.title || 'News mention', 140),
    summary: compactText(row.body || row.query || 'News evidence', 240),
    freshness: toIso(row.updatedAt || row.createdAt),
    tags: ['news', String(row.source || '').toLowerCase()].filter(Boolean),
    evidenceLabel: String(row.source || 'News'),
    ...(toHttpHref(row.url) ? { evidenceHref: toHttpHref(row.url) } : {}),
  }));

  const deliverableItems: PortalLibraryItem[] = [
    ...calendarRuns.map((run) => ({
      id: `deliverable:calendar:${run.id}`,
      collection: 'deliverables' as const,
      title: `Content calendar • ${run.weekStart.toISOString().slice(0, 10)}`,
      summary: compactText(
        `Status ${run.status}. Generated ${run.completedAt ? 'and completed' : 'as draft'} for ${run.timezone}.`,
        240
      ),
      freshness: toIso(run.completedAt || run.createdAt),
      tags: ['calendar', String(run.status || '').toLowerCase()],
      evidenceLabel: 'Calendar run',
    })),
    ...fileAttachments.map((file) => ({
      id: `deliverable:file:${file.id}`,
      collection: 'deliverables' as const,
      title: compactText(file.fileName || 'File attachment', 140),
      summary: compactText(`${file.mimeType || 'file'}${file.fileSizeBytes ? ` • ${file.fileSizeBytes} bytes` : ''}`, 240),
      freshness: toIso(file.createdAt),
      tags: ['file', String(file.mimeType || '').toLowerCase()].filter(Boolean),
      evidenceLabel: 'Attachment',
    })),
    ...aiBusinessAnalyses.map((analysis) => ({
      id: `deliverable:analysis:${analysis.id}`,
      collection: 'deliverables' as const,
      title: 'AI business analysis',
      summary: compactText(
        analysis.valueProposition || analysis.targetAudience || analysis.brandVoice || 'Strategy analysis generated.',
        240
      ),
      freshness: toIso(analysis.updatedAt || analysis.createdAt),
      tags: ['analysis', String(analysis.modelUsed || '').toLowerCase()].filter(Boolean),
      evidenceLabel: String(analysis.modelUsed || 'AI'),
    })),
  ];

  const allWebItems = [...webSourceItems, ...webItems, ...crawlRunItems, ...extractionItems];

  const counts = {
    web: allWebItems.length,
    competitors: competitorItems.length,
    social: socialItems.length,
    community: communityItems.length,
    news: newsItems.length,
    deliverables: deliverableItems.length,
  };

  let items = dedupeItems([
    ...allWebItems,
    ...competitorItems,
    ...socialItems,
    ...communityItems,
    ...newsItems,
    ...deliverableItems,
  ]);

  if (collectionFilter) {
    items = items.filter((item) => item.collection === collectionFilter);
  }
  items = withQuery(items, options?.query).sort(byFreshnessDesc);

  return { items, counts };
}
