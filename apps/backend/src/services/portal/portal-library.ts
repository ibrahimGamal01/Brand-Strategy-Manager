import { prisma } from '../../lib/prisma';
import { fileManager } from '../storage/file-manager';

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
  links?: Array<{ label: string; href: string }>;
  details?: string[];
  previewText?: string;
  downloadHref?: string;
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

function compactInline(value: unknown, maxChars = 220): string {
  return compactText(value, maxChars).replace(/\s+/g, ' ').trim();
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

function toStorageHref(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const url = fileManager.toUrl(raw);
  return toHttpHref(url) || (url.startsWith('/storage/') ? url : undefined);
}

function readableBytes(value: unknown): string | undefined {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function metadataString(metadata: unknown, keys: string[]): string | undefined {
  if (!isRecord(metadata)) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pushLink(
  list: Array<{ label: string; href: string }>,
  label: string,
  href?: string
) {
  const safeHref = toHttpHref(href) || (String(href || '').startsWith('/storage/') ? String(href) : undefined);
  if (!safeHref) return;
  if (list.some((entry) => entry.href === safeHref)) return;
  list.push({ label, href: safeHref });
}

function normalizeSocialPostHref(input: {
  platform: string;
  handle: string;
  externalId?: string | null;
  url?: string | null;
  metadata?: unknown;
}): string | undefined {
  const direct =
    toHttpHref(input.url) ||
    toHttpHref(metadataString(input.metadata, ['permalink', 'post_url', 'postUrl', 'share_url', 'shareUrl', 'url']));
  if (direct) return direct;

  const platform = String(input.platform || '').trim().toLowerCase();
  const handle = String(input.handle || '').trim().replace(/^@/, '');
  const externalId = String(input.externalId || '').trim();
  if (!externalId || !handle) return undefined;

  if (platform === 'instagram') {
    return `https://www.instagram.com/p/${externalId}/`;
  }
  if (platform === 'tiktok') {
    return `https://www.tiktok.com/@${handle}/video/${externalId}`;
  }
  if (platform === 'x' || platform === 'twitter') {
    return `https://x.com/${handle}/status/${externalId}`;
  }
  if (platform === 'youtube') {
    return `https://www.youtube.com/watch?v=${externalId}`;
  }
  return undefined;
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
    workspace,
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
    prisma.researchJob.findUnique({
      where: { id: workspaceId },
      select: { clientId: true },
    }),
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
            textPath: true,
            htmlPath: true,
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
            url: true,
          },
        },
        mediaAssets: {
          where: { isActive: true },
          select: {
            id: true,
            mediaType: true,
            isDownloaded: true,
            blobStoragePath: true,
            thumbnailPath: true,
            fileSizeBytes: true,
            downloadedAt: true,
          },
          orderBy: { downloadedAt: 'desc' },
          take: 6,
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

  const clientDocuments = workspace?.clientId
    ? await prisma.clientDocument.findMany({
        where: { clientId: workspace.clientId },
        orderBy: { uploadedAt: 'desc' },
        take: 40,
      })
    : [];

  const webSourceItems: PortalLibraryItem[] = webSources.map((source) => {
    const href = toHttpHref(source.url);
    const sourceType = String(source.sourceType || 'OTHER').toLowerCase();
    const discoveredBy = String(source.discoveredBy || 'user').toLowerCase();
    const links: Array<{ label: string; href: string }> = [];
    pushLink(links, 'Open source', href);
    return {
      id: `web-source:${source.id}`,
      collection: 'web',
      title: titleFromUrl(source.url),
      summary: `Tracked source for ${source.domain}. Added via ${discoveredBy.replace(/_/g, ' ')}.`,
      freshness: toIso(source.updatedAt || source.createdAt),
      tags: ['source', sourceType, discoveredBy].filter(Boolean),
      evidenceLabel: `${sourceType.toUpperCase()} source`,
      ...(href ? { evidenceHref: href } : {}),
      ...(links.length ? { links } : {}),
      details: [`Domain: ${source.domain}`, `Type: ${sourceType}`, `Discovered by: ${discoveredBy.replace(/_/g, ' ')}`],
    };
  });

  const webItems: PortalLibraryItem[] = webSnapshots.map((snapshot) => {
    const href = toHttpHref(snapshot.finalUrl || snapshot.webSource.url);
    const textHref = toStorageHref(snapshot.textPath);
    const htmlHref = toStorageHref(snapshot.htmlPath);
    const sourceType = String(snapshot.webSource.sourceType || 'OTHER').toLowerCase();
    const discoveredBy = String(snapshot.webSource.discoveredBy || 'user').toLowerCase();
    const fetcher = String(snapshot.fetcherUsed || 'auto').toLowerCase();
    const cleanText = String(snapshot.cleanText || '');
    const previewText = compactInline(cleanText, 440);
    const links: Array<{ label: string; href: string }> = [];
    pushLink(links, 'Open page', href);
    pushLink(links, 'Downloaded text', textHref);
    pushLink(links, 'Downloaded HTML', htmlHref);
    const statusCode = Number(snapshot.statusCode);
    return {
      id: `web:${snapshot.id}`,
      collection: 'web',
      title: titleFromUrl(snapshot.finalUrl || snapshot.webSource.url),
      summary: compactText(
        previewText ||
          `Snapshot captured from ${snapshot.webSource.domain || titleFromUrl(snapshot.webSource.url)}.`,
        260
      ),
      freshness: toIso(snapshot.fetchedAt),
      tags: ['snapshot', sourceType, discoveredBy, fetcher].filter(Boolean),
      evidenceLabel: `${sourceType.toUpperCase()} • ${fetcher.toUpperCase()}${Number.isFinite(statusCode) ? ` • ${statusCode}` : ''}`,
      ...(href ? { evidenceHref: href } : {}),
      ...(links.length ? { links } : {}),
      ...(previewText ? { previewText } : {}),
      ...(textHref || htmlHref ? { downloadHref: textHref || htmlHref } : {}),
      details: [
        `Snapshot: ${snapshot.id.slice(0, 8)}`,
        `Status: ${Number.isFinite(statusCode) ? statusCode : 'unknown'}`,
        `Captured chars: ${cleanText.length || 0}`,
        `Fetcher: ${fetcher}`,
      ],
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
      textLink?: string;
      htmlLink?: string;
      discoveredBy: Set<string>;
      textSnapshots: number;
      htmlSnapshots: number;
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
      textLink: toStorageHref(snapshot.textPath),
      htmlLink: toStorageHref(snapshot.htmlPath),
      discoveredBy: new Set<string>(),
      textSnapshots: 0,
      htmlSnapshots: 0,
    };

    existing.pages += 1;
    if (snapshot.textPath) existing.textSnapshots += 1;
    if (snapshot.htmlPath) existing.htmlSnapshots += 1;
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
    if (!existing.textLink) {
      existing.textLink = toStorageHref(snapshot.textPath);
    }
    if (!existing.htmlLink) {
      existing.htmlLink = toStorageHref(snapshot.htmlPath);
    }

    crawlRuns.set(crawlRunId, existing);
  }

  const crawlRunItems: PortalLibraryItem[] = Array.from(crawlRuns.values()).map((row) => {
    const links: Array<{ label: string; href: string }> = [];
    pushLink(links, 'Open sample page', row.link);
    pushLink(links, 'Open downloaded text', row.textLink);
    pushLink(links, 'Open downloaded HTML', row.htmlLink);
    return {
      id: `web-crawl:${row.runId}`,
      collection: 'web',
      title: `Crawl run ${row.runId.slice(0, 8)}`,
      summary: `Captured ${row.pages} page snapshot(s) across ${row.domains.size || 1} domain(s).`,
      freshness: row.latestAt,
      tags: ['crawl', ...Array.from(row.discoveredBy)],
      evidenceLabel: `Crawl • ${row.pages} pages`,
      ...(row.link ? { evidenceHref: row.link } : {}),
      ...(links.length ? { links } : {}),
      ...(row.textLink || row.htmlLink ? { downloadHref: row.textLink || row.htmlLink } : {}),
      details: [
        `Domains: ${Array.from(row.domains).filter(Boolean).join(', ') || 'n/a'}`,
        `Snapshots with text: ${row.textSnapshots}/${row.pages}`,
        `Snapshots with HTML: ${row.htmlSnapshots}/${row.pages}`,
      ],
    };
  });

  const extractionItems: PortalLibraryItem[] = webExtractionRuns.map((run) => {
    const extracted = isRecord(run.extracted) ? run.extracted : null;
    const extractedJson = extracted ? JSON.stringify(extracted) : '';
    const extractedFieldCount = extracted ? Object.keys(extracted).length : 0;
    const warningsCount = Array.isArray(run.warnings) ? run.warnings.length : 0;
    const sourceUrl = run.snapshot.finalUrl || run.snapshot.webSource.url;
    const domain = run.recipe.targetDomain || run.snapshot.webSource.domain || titleFromUrl(sourceUrl);
    const textHref = toStorageHref(run.snapshot.textPath);
    const htmlHref = toStorageHref(run.snapshot.htmlPath);
    const links: Array<{ label: string; href: string }> = [];
    pushLink(links, 'Open source page', sourceUrl);
    pushLink(links, 'Open extracted text', textHref);
    pushLink(links, 'Open extracted HTML', htmlHref);

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
      ...(links.length ? { links } : {}),
      ...(textHref || htmlHref ? { downloadHref: textHref || htmlHref } : {}),
      ...(extractedJson ? { previewText: compactInline(extractedJson, 520) } : {}),
      details: [
        `Recipe: ${run.recipe.name}`,
        `Fields extracted: ${extractedFieldCount}`,
        `Warnings: ${warningsCount}`,
        `Snapshot: ${run.snapshotId.slice(0, 8)}`,
      ],
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
    const permalink = normalizeSocialPostHref({
      platform,
      handle,
      externalId: post.externalId,
      url: post.url,
      metadata: post.metadata,
    });
    const metrics = [
      typeof post.likesCount === 'number' ? `${post.likesCount} likes` : null,
      typeof post.commentsCount === 'number' ? `${post.commentsCount} comments` : null,
      typeof post.viewsCount === 'number' ? `${post.viewsCount} views` : null,
      typeof post.sharesCount === 'number' ? `${post.sharesCount} shares` : null,
    ].filter((value): value is string => Boolean(value));
    const downloadedAssets = post.mediaAssets.filter((asset) => asset.isDownloaded && asset.blobStoragePath);
    const links: Array<{ label: string; href: string }> = [];
    pushLink(links, 'Open exact post', permalink);
    pushLink(links, 'Open profile', toHttpHref(post.socialProfile.url));
    for (const [index, asset] of downloadedAssets.slice(0, 3).entries()) {
      pushLink(links, `Downloaded media ${index + 1}`, toStorageHref(asset.blobStoragePath));
      pushLink(links, `Media thumbnail ${index + 1}`, toStorageHref(asset.thumbnailPath));
    }
    const readableSizes = downloadedAssets
      .map((asset) => readableBytes(asset.fileSizeBytes))
      .filter((value): value is string => Boolean(value));
    return {
      id: `social:${post.id}`,
      collection: 'social',
      title: `@${handle} • ${platform} ${post.postedAt ? `• ${toIso(post.postedAt).slice(0, 10)}` : ''}`.slice(0, 140),
      summary: compactText(post.caption || `Captured ${type || 'post'} from ${platform}.`, 280),
      freshness: toIso(post.postedAt || post.scrapedAt),
      tags: [platform, type || 'post'].filter(Boolean),
      evidenceLabel: metrics.length ? metrics.slice(0, 2).join(' • ') : 'Social post',
      ...(permalink ? { evidenceHref: permalink } : {}),
      ...(links.length ? { links } : {}),
      ...(downloadedAssets[0]?.blobStoragePath ? { downloadHref: toStorageHref(downloadedAssets[0].blobStoragePath) } : {}),
      details: [
        `Post id: ${post.id.slice(0, 8)}`,
        `External id: ${post.externalId}`,
        metrics.length ? `Metrics: ${metrics.join(' • ')}` : 'Metrics: not available',
        `Downloaded assets: ${downloadedAssets.length}/${post.mediaAssets.length}`,
        readableSizes.length ? `Downloaded size(s): ${readableSizes.slice(0, 3).join(', ')}` : 'Downloaded size(s): n/a',
      ],
      ...(post.caption ? { previewText: compactInline(post.caption, 460) } : {}),
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
      ...(toStorageHref(file.storagePath) ? { evidenceHref: toStorageHref(file.storagePath) } : {}),
      ...(toStorageHref(file.storagePath) ? { downloadHref: toStorageHref(file.storagePath) } : {}),
      ...(toStorageHref(file.storagePath)
        ? {
            links: [
              {
                label: 'Download attachment',
                href: toStorageHref(file.storagePath)!,
              },
            ],
          }
        : {}),
      details: [
        `Path: ${String(file.storagePath || '').slice(0, 160) || 'n/a'}`,
        `Size: ${readableBytes(file.fileSizeBytes) || 'n/a'}`,
      ],
    })),
    ...clientDocuments.map((document) => ({
      id: `deliverable:client-document:${document.id}`,
      collection: 'deliverables' as const,
      title: compactText(document.fileName || 'Client document', 140),
      summary: compactText(
        `${String(document.docType || 'DOCUMENT').replace(/_/g, ' ').toLowerCase()}${document.fileSizeBytes ? ` • ${document.fileSizeBytes} bytes` : ''}`,
        240
      ),
      freshness: toIso(document.uploadedAt),
      tags: ['client-document', String(document.docType || '').toLowerCase()].filter(Boolean),
      evidenceLabel: String(document.mimeType || 'document'),
      ...(toStorageHref(document.filePath) ? { evidenceHref: toStorageHref(document.filePath) } : {}),
      ...(toStorageHref(document.filePath) ? { downloadHref: toStorageHref(document.filePath) } : {}),
      ...(toStorageHref(document.filePath)
        ? {
            links: [
              {
                label: 'Download document',
                href: toStorageHref(document.filePath)!,
              },
            ],
          }
        : {}),
      ...(document.extractedText ? { previewText: compactInline(document.extractedText, 420) } : {}),
      details: [
        `Doc type: ${String(document.docType || '').replace(/_/g, ' ') || 'n/a'}`,
        `Size: ${readableBytes(document.fileSizeBytes) || 'n/a'}`,
        `Processed: ${document.isProcessed ? 'yes' : 'no'}`,
      ],
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
      details: [
        `Model: ${String(analysis.modelUsed || 'unknown')}`,
        `Tokens: ${typeof analysis.tokensUsed === 'number' ? analysis.tokensUsed : 'n/a'}`,
      ],
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
