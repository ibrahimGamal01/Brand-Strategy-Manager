import { exec } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileManager, STORAGE_PATHS } from '../storage/file-manager';
import { prisma } from '../../lib/prisma';
import { tiktokService } from '../scraper/tiktok-service';
import { resolveInstagramMediaViaApify } from '../scraper/apify-instagram-media-downloader';

const execAsync = promisify(exec);

async function resolveInstagramMediaViaCamoufox(sourceUrl: string): Promise<{
  success: boolean;
  mediaUrls: string[];
  thumbnailUrl?: string;
  error?: string;
}> {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'scripts/camoufox_insta_downloader.py'),
    path.join(cwd, 'apps/backend/scripts/camoufox_insta_downloader.py'),
  ];
  const scriptPath = candidates.find((p) => existsSync(p));
  if (!scriptPath) {
    return { success: false, mediaUrls: [], error: 'camoufox_insta_downloader.py not found' };
  }
  try {
    const { stdout } = await execAsync(
      `python3 "${scriptPath}" "${sourceUrl}"`,
      { cwd, timeout: 90000 }
    );
    const result = JSON.parse(stdout.trim());
    if (result.success && Array.isArray(result.mediaUrls) && result.mediaUrls.length > 0) {
      return {
        success: true,
        mediaUrls: result.mediaUrls,
        thumbnailUrl: result.thumbnailUrl,
      };
    }
    return { success: false, mediaUrls: [], error: result.error || 'No media URLs' };
  } catch (e: any) {
    return { success: false, mediaUrls: [], error: e.message || 'Camoufox resolve failed' };
  }
}
import { extractMediaUrls, extractImageMetadata, generateVideoThumbnail } from './download-helpers';
import { downloadGenericMedia } from './download-generic';
import { emitResearchJobEvent } from '../social/research-job-events';

type EntityType = 'CLIENT' | 'COMPETITOR' | 'SOCIAL';

type MediaSourceOpts = {
  sourceType?: 'CLIENT_POST_SNAPSHOT' | 'COMPETITOR_POST_SNAPSHOT';
  sourceId?: string;
  clientPostSnapshotId?: string;
  competitorPostSnapshotId?: string;
  eventContext?: DownloadEventContext;
};

type DownloadEventContext = {
  researchJobId?: string;
  runId?: string;
  source?: string;
  platform?: string;
  handle?: string;
  entityType?: string;
  entityId?: string;
};

const DEFAULT_SOCIAL_MEDIA_POST_LIMIT = Number.parseInt(
  process.env.SOCIAL_MEDIA_DOWNLOAD_POST_LIMIT || '8',
  10
);
const DEFAULT_SOCIAL_MEDIA_MAX_FAILURES = Number.parseInt(
  process.env.SOCIAL_MEDIA_MAX_FAILURES || '3',
  10
);
const DEFAULT_SOCIAL_MEDIA_FAILURE_COOLDOWN_MS = Number.parseInt(
  process.env.SOCIAL_MEDIA_FAILURE_COOLDOWN_MS || String(12 * 60 * 60 * 1000),
  10
);
const ENABLE_TIKTOK_PAGE_DOWNLOAD = String(process.env.ENABLE_TIKTOK_PAGE_DOWNLOAD || '').toLowerCase() === 'true';

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function isInstagramPageUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv|stories)\//i.test(url);
}

function isInstagramProfileUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|tv\/|stories\/|explore\/|accounts\/|api\/|graphql\/|reels\/)[^/?#]+\/?$/i.test(
    url
  );
}

function isTikTokPageUrl(url: string): boolean {
  return (
    /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i.test(url) ||
    /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/photo\/\d+/i.test(url)
  );
}

function isObjectRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPostDownloadFailureState(metadata: unknown): {
  failureCount: number;
  lastFailureAt: Date | null;
} {
  if (!isObjectRecord(metadata)) {
    return { failureCount: 0, lastFailureAt: null };
  }

  const failureCount = Number.parseInt(String(metadata.downloadFailures || 0), 10) || 0;
  const lastFailureRaw = metadata.lastDownloadFailureAt;
  const lastFailureAt =
    typeof lastFailureRaw === 'string' || lastFailureRaw instanceof Date
      ? new Date(lastFailureRaw as any)
      : null;

  return {
    failureCount,
    lastFailureAt: lastFailureAt && !Number.isNaN(lastFailureAt.getTime()) ? lastFailureAt : null,
  };
}

// Core downloader
export async function downloadPostMedia(
  postId: string,
  mediaUrls: string[],
  entityType: EntityType,
  entityId: string,
  opts: MediaSourceOpts = {}
): Promise<string[]> {
  const mediaAssetIds: string[] = [];
  const preparedUrls: string[] = [];
  const resolvedPageCache = new Map<string, string[]>();
  const eventContext = opts.eventContext;

  for (const sourceUrl of mediaUrls.filter(Boolean)) {
    if (sourceUrl.includes('lookaside.instagram.com/seo/google_widget/crawler')) {
      console.warn('[Downloader] Skipping lookaside URL (HTML fallback):', sourceUrl);
      continue;
    }

    if (isInstagramProfileUrl(sourceUrl)) {
      console.warn('[Downloader] Skipping Instagram profile URL (not media):', sourceUrl);
      continue;
    }

    if (!isInstagramPageUrl(sourceUrl)) {
      preparedUrls.push(sourceUrl);
      continue;
    }

    if (resolvedPageCache.has(sourceUrl)) {
      preparedUrls.push(...(resolvedPageCache.get(sourceUrl) || []));
      continue;
    }

    let resolved = await resolveInstagramMediaViaApify(sourceUrl, {
      researchJobId: eventContext?.researchJobId,
      runId: eventContext?.runId,
      source: eventContext?.source,
      platform: eventContext?.platform,
      handle: eventContext?.handle,
      entityType: eventContext?.entityType || 'social_post',
      entityId: eventContext?.entityId || postId,
    });
    if (!resolved.success || resolved.mediaUrls.length === 0) {
      resolved = await resolveInstagramMediaViaCamoufox(sourceUrl);
      if (resolved.success) {
        console.log(
          `[Downloader] Resolved ${resolved.mediaUrls.length} media URLs via Camoufox for ${sourceUrl}`
        );
      }
    } else {
      console.log(
        `[Downloader] Resolved ${resolved.mediaUrls.length} media URLs via Apify for ${sourceUrl}`
      );
    }
    if (resolved.success && resolved.mediaUrls.length > 0) {
      resolvedPageCache.set(sourceUrl, resolved.mediaUrls);
      preparedUrls.push(...resolved.mediaUrls);
      continue;
    }

    console.warn(
      `[Downloader] Could not resolve Instagram page URL: ${sourceUrl} (${resolved.error || 'unknown error'})`
    );
  }

  for (const url of Array.from(new Set(preparedUrls))) {
    if (!url) continue;

    try {
      const isTikTokPhoto = /\/photo\/\d+/i.test(url);
      const isVideo = isTikTokPhoto
        ? false
        : url.includes('.mp4') || url.includes('video') || url.includes('tiktok.com');
      const mediaType = isVideo ? 'VIDEO' : 'IMAGE';
      let extension = fileManager.getExtension(url) || (isVideo ? 'mp4' : 'jpg');
      if (isTikTokPhoto) extension = 'jpg';
      else if (isVideo) extension = 'mp4';

      const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
      let storagePath =
        entityType === 'CLIENT'
          ? path.join(STORAGE_PATHS.clientMedia(entityId, postId), filename)
          : path.join(STORAGE_PATHS.competitorMedia(entityId, postId), filename);

      if (isTikTokPageUrl(url)) {
        if (!ENABLE_TIKTOK_PAGE_DOWNLOAD) {
          console.warn(
            `[Downloader] Skipping TikTok page URL download (set ENABLE_TIKTOK_PAGE_DOWNLOAD=true to enable): ${url}`
          );
          continue;
        }

        const result = await tiktokService.downloadVideo(url, storagePath);
        if (!result.success) throw new Error(`TikTok download failed: ${result.error}`);
        if (result.path) storagePath = result.path;
      } else {
        const headers: Record<string, string> = {
          Referer: 'https://www.instagram.com/',
          Origin: 'https://www.instagram.com',
        };
        if (url.includes('instagram.com')) {
          const cookie = process.env.INSTAGRAM_SESSION_COOKIES || '';
          if (cookie) headers['Cookie'] = cookie;
          headers['User-Agent'] =
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
        }
        await fileManager.downloadAndSave(url, storagePath, headers);
      }

      const stats = fileManager.getStats(storagePath);
      const fileSizeBytes = stats?.size || 0;

      let width: number | undefined;
      let height: number | undefined;
      let durationSeconds: number | undefined;
      let thumbnailPath: string | undefined;

      if (mediaType === 'IMAGE') {
        const metadata = await extractImageMetadata(storagePath);
        width = metadata.width;
        height = metadata.height;
        thumbnailPath = fileManager.toUrl(storagePath);
      } else {
        thumbnailPath = await generateVideoThumbnail(storagePath);
      }

      const mediaAssetData: any = {
        mediaType,
        originalUrl: url,
        blobStoragePath: storagePath,
        fileSizeBytes,
        width,
        height,
        durationSeconds,
        thumbnailPath,
        isDownloaded: true,
        downloadedAt: new Date(),
      };

      const isClientSnapshot = opts.sourceType === 'CLIENT_POST_SNAPSHOT';
      const isCompetitorSnapshot = opts.sourceType === 'COMPETITOR_POST_SNAPSHOT';

      if (entityType === 'CLIENT' && !isClientSnapshot) mediaAssetData.clientPostId = postId;
      if (entityType === 'COMPETITOR' && !isCompetitorSnapshot) mediaAssetData.cleanedPostId = postId;
      if (entityType === 'SOCIAL') mediaAssetData.socialPostId = postId;

      if (opts.sourceType === 'CLIENT_POST_SNAPSHOT') {
        mediaAssetData.sourceType = 'CLIENT_POST_SNAPSHOT';
        mediaAssetData.sourceId = opts.sourceId || postId;
        mediaAssetData.clientPostSnapshotId = opts.clientPostSnapshotId || null;
      } else if (opts.sourceType === 'COMPETITOR_POST_SNAPSHOT') {
        mediaAssetData.sourceType = 'COMPETITOR_POST_SNAPSHOT';
        mediaAssetData.sourceId = opts.sourceId || postId;
        mediaAssetData.competitorPostSnapshotId = opts.competitorPostSnapshotId || null;
      }

      const mediaAsset = await prisma.mediaAsset.create({ data: mediaAssetData });
      mediaAssetIds.push(mediaAsset.id);

      if (eventContext?.researchJobId) {
        emitResearchJobEvent({
          researchJobId: eventContext.researchJobId,
          runId: eventContext.runId,
          source: 'downloader',
          code: 'download.file.saved',
          level: 'info',
          message: `Saved ${mediaType.toLowerCase()} media for ${eventContext.platform || 'social'} @${eventContext.handle || 'unknown'}`,
          platform: eventContext.platform || null,
          handle: eventContext.handle || null,
          entityType: eventContext.entityType || null,
          entityId: eventContext.entityId || postId,
          metrics: {
            fileSizeBytes,
            mediaType,
          },
          metadata: {
            originalUrl: url,
            storagePath,
          },
        });
      }
    } catch (error: any) {
      console.error(`[Downloader] Failed to download ${url}:`, error.message);
      if (eventContext?.researchJobId) {
        emitResearchJobEvent({
          researchJobId: eventContext.researchJobId,
          runId: eventContext.runId,
          source: 'downloader',
          code: 'download.file.failed',
          level: 'error',
          message: `Failed downloading media for ${eventContext.platform || 'social'} @${eventContext.handle || 'unknown'}`,
          platform: eventContext.platform || null,
          handle: eventContext.handle || null,
          entityType: eventContext.entityType || null,
          entityId: eventContext.entityId || postId,
          metadata: {
            originalUrl: url,
            error: error.message || 'Unknown download error',
          },
        });
      }
    }
  }

  return mediaAssetIds;
}

// Download all media for canonical client posts
export async function downloadAllClientMedia(clientId: string) {
  const posts = await prisma.clientPost.findMany({
    where: {
      clientAccount: { clientId },
      mediaAssets: { none: {} },
    },
  });

  let downloadedCount = 0;
  for (const post of posts) {
    const mediaUrls = extractMediaUrls(post.rawApiResponse);
    if (mediaUrls.length === 0) continue;
    const ids = await downloadPostMedia(post.id, mediaUrls, 'CLIENT', clientId);
    downloadedCount += ids.length;
  }
  return downloadedCount;
}

// Download media for research SocialPosts
export async function downloadSocialProfileMedia(
  profileId: string,
  options: { recentPostLimit?: number; runId?: string; source?: string } = {}
) {
  const recentPostLimit = normalizePositiveInt(
    Number(options.recentPostLimit || DEFAULT_SOCIAL_MEDIA_POST_LIMIT),
    normalizePositiveInt(DEFAULT_SOCIAL_MEDIA_POST_LIMIT, 8)
  );
  const maxFailures = normalizePositiveInt(DEFAULT_SOCIAL_MEDIA_MAX_FAILURES, 3);
  const failureCooldownMs = normalizePositiveInt(DEFAULT_SOCIAL_MEDIA_FAILURE_COOLDOWN_MS, 12 * 60 * 60 * 1000);
  const profile = await prisma.socialProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      researchJobId: true,
      platform: true,
      handle: true,
    },
  });

  if (!profile) {
    return 0;
  }

  const baseEventContext: DownloadEventContext = {
    researchJobId: profile.researchJobId,
    runId: options.runId,
    source: options.source || 'scraper',
    platform: profile.platform,
    handle: profile.handle,
    entityType: 'social_profile',
    entityId: profile.id,
  };

  const posts = await prisma.socialPost.findMany({
    where: { socialProfileId: profileId, mediaAssets: { none: {} } },
    orderBy: { scrapedAt: 'desc' },
    take: recentPostLimit,
  });

  let downloadedCount = 0;
  let postsAttempted = 0;
  let postsDownloaded = 0;
  const processedUrls = new Set<string>();

  for (const post of posts) {
    const postMetadata = isObjectRecord((post as any).metadata) ? ((post as any).metadata as Record<string, any>) : {};
    const { failureCount, lastFailureAt } = getPostDownloadFailureState(postMetadata);
    const hasCooldown =
      failureCount >= maxFailures &&
      lastFailureAt &&
      Date.now() - lastFailureAt.getTime() < failureCooldownMs;

    if (hasCooldown) {
      console.log(
        `[Downloader] Skipping post ${post.id} after ${failureCount} failures (cooldown active)`
      );
      continue;
    }

    const candidates: string[] = [];

    // Prefer thumbnail/media URLs before page URLs for faster/safer downloads.
    const preferred = [post.thumbnailUrl, (post as any).videoUrl, (post as any).mediaUrl].filter(
      (u): u is string => !!u
    );
    candidates.push(...preferred);

    // Prefer mediaUrl arrays if scraper provided them
    const mediaUrls = (post as any).metadata?.media_urls || (post as any).media_urls;
    if (Array.isArray(mediaUrls)) {
      candidates.push(...mediaUrls);
    }
    if (post.url) candidates.push(post.url);

    const dedupedCandidates: string[] = [];
    const seen = new Set<string>();
    for (const url of candidates) {
      if (!url || seen.has(url)) continue;
      dedupedCandidates.push(url);
      seen.add(url);
    }

    const isLikelyTikTokPost = dedupedCandidates.some((u) => u.includes('tiktok.com'));
    const nonTikTokPageUrls = dedupedCandidates.filter((u) => !isTikTokPageUrl(u));
    const perPostCandidates =
      isLikelyTikTokPost && nonTikTokPageUrls.length > 0
        ? nonTikTokPageUrls
        : dedupedCandidates;

    const perPostLimit = isLikelyTikTokPost ? 3 : 8;
    const urlsToDownload: string[] = [];

    for (const url of perPostCandidates.slice(0, perPostLimit)) {
      if (!processedUrls.has(url)) {
        urlsToDownload.push(url);
        processedUrls.add(url);
      }
    }

    if (urlsToDownload.length === 0) continue;
    postsAttempted++;
    const ids = await downloadPostMedia(post.id, urlsToDownload, 'SOCIAL', profileId, {
      eventContext: {
        ...baseEventContext,
        entityType: 'social_post',
        entityId: post.id,
      },
    });
    downloadedCount += ids.length;
    if (ids.length > 0) {
      postsDownloaded++;
    }

    if (ids.length === 0) {
      await prisma.socialPost.update({
        where: { id: post.id },
        data: {
          metadata: {
            ...postMetadata,
            downloadFailures: failureCount + 1,
            lastDownloadFailureAt: new Date().toISOString(),
          } as any,
        },
      });
    } else if (failureCount > 0 || postMetadata.lastDownloadFailureAt) {
      const nextMetadata = { ...postMetadata };
      delete nextMetadata.downloadFailures;
      delete nextMetadata.lastDownloadFailureAt;
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { metadata: nextMetadata as any },
      });
    }
  }

  emitResearchJobEvent({
    researchJobId: profile.researchJobId,
    runId: options.runId,
    source: 'downloader',
    code: 'download.summary',
    level: 'info',
    message: `Downloader completed for ${profile.platform} @${profile.handle}`,
    platform: profile.platform,
    handle: profile.handle,
    entityType: 'social_profile',
    entityId: profile.id,
    metrics: {
      postsSeen: posts.length,
      postsAttempted,
      postsDownloaded,
      filesSaved: downloadedCount,
    },
    metadata: {
      recentPostLimit,
      source: options.source || 'scraper',
    },
  });

  return downloadedCount;
}

// Snapshot download (client or competitor)
export async function downloadSnapshotMedia(snapshotType: 'client' | 'competitor', snapshotId: string) {
  if (snapshotType === 'client') {
    const posts = await prisma.clientPostSnapshot.findMany({
      where: { clientProfileSnapshotId: snapshotId, mediaAssets: { none: {} } },
    });
    let downloaded = 0;
    for (const post of posts) {
      let urls = extractMediaUrls(post as any);
      if (!urls.length) {
        // Fallback: reuse media_urls stored on SocialPost with same externalId
        const social = await prisma.socialPost.findFirst({
          where: { externalId: post.externalPostId },
        });
        if (social) {
          const mediaUrls = (social as any).metadata?.media_urls || (social as any).media_urls || [];
          const candidates = [
            ...mediaUrls,
            social.thumbnailUrl,
            social.url,
          ].filter(Boolean) as string[];
          urls = candidates;
        }
      }
      if (!urls.length && (post as any).thumbnailUrl) {
        urls = [(post as any).thumbnailUrl];
      }
      if (urls.length === 0) continue;
      const ids = await downloadPostMedia(post.id, urls, 'CLIENT', snapshotId, {
        sourceType: 'CLIENT_POST_SNAPSHOT',
        sourceId: post.id,
        clientPostSnapshotId: post.id,
      });
      downloaded += ids.length;
    }
    return downloaded;
  }

  const posts = await prisma.competitorPostSnapshot.findMany({
    where: { competitorProfileSnapshotId: snapshotId, mediaAssets: { none: {} } },
  });
  let downloaded = 0;
  for (const post of posts) {
    let urls = extractMediaUrls(post as any);
    if (!urls.length) {
      const social = await prisma.socialPost.findFirst({
        where: { externalId: post.externalPostId },
      });
      if (social) {
        const mediaUrls = (social as any).metadata?.media_urls || (social as any).media_urls || [];
        const candidates = [
          ...mediaUrls,
          social.thumbnailUrl,
          social.url,
        ].filter(Boolean) as string[];
        urls = candidates;
      }
    }
    if (!urls.length && (post as any).thumbnailUrl) {
      urls = [(post as any).thumbnailUrl];
    }
    if (urls.length === 0) continue;
    const ids = await downloadPostMedia(post.id, urls, 'COMPETITOR', snapshotId, {
      sourceType: 'COMPETITOR_POST_SNAPSHOT',
      sourceId: post.id,
      competitorPostSnapshotId: post.id,
    });
    downloaded += ids.length;
  }
  return downloaded;
}

export const mediaDownloader = {
  downloadPostMedia,
  downloadAllClientMedia,
  downloadSocialProfileMedia,
  downloadSnapshotMedia,
  downloadGenericMedia,
  extractMediaUrls,
};
