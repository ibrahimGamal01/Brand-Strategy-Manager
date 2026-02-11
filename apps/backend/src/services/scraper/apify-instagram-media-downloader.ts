import axios from 'axios';
import { emitResearchJobEvent } from '../social/research-job-events';

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const APIFY_MEDIA_DOWNLOADER_ACTOR_ID =
  process.env.APIFY_MEDIA_DOWNLOADER_ACTOR_ID || 'igview-owner~instagram-video-downloader';
const APIFY_MEDIA_DOWNLOADER_TOKEN =
  process.env.APIFY_MEDIA_DOWNLOADER_TOKEN || process.env.APIFY_API_TOKEN || '';

const INSTAGRAM_PAGE_URL_REGEX =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:[^/]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)/i;

type ResolveInstagramMediaResult = {
  success: boolean;
  mediaUrls: string[];
  thumbnailUrl?: string;
  error?: string;
  scraperUsed: 'apify_instagram_media_downloader';
};

type InstagramResolveEventContext = {
  researchJobId?: string;
  runId?: string;
  source?: string;
  platform?: string;
  handle?: string;
  entityType?: string;
  entityId?: string;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isInstagramPageUrl(value: string): boolean {
  return INSTAGRAM_PAGE_URL_REGEX.test(value);
}

function normalizeInstagramPageUrl(value: string): string {
  const match = value.match(INSTAGRAM_PAGE_URL_REGEX);
  if (!match) return value;
  const postType = match[1].toLowerCase();
  const shortcode = match[2];
  return `https://www.instagram.com/${postType}/${shortcode}/`;
}

function pushIfValid(out: string[], value: unknown) {
  if (typeof value === 'string' && isHttpUrl(value) && !isInstagramPageUrl(value)) {
    out.push(value);
  }
}

function collectStringUrls(
  node: unknown,
  depth = 0,
  out: string[] = [],
  parentKey = ''
): string[] {
  if (depth > 4 || node == null) return out;

  if (typeof node === 'string') {
    const k = parentKey.toLowerCase();
    const keyLooksLikeMedia =
      k.includes('download') ||
      k.includes('video') ||
      k.includes('image') ||
      k.includes('media') ||
      k.includes('carousel');

    if (keyLooksLikeMedia) {
      pushIfValid(out, node);
    }
    return out;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectStringUrls(item, depth + 1, out, parentKey);
    }
    return out;
  }

  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      collectStringUrls(value, depth + 1, out, key);
    }
  }

  return out;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export async function resolveInstagramMediaViaApify(
  inputUrl: string,
  eventContext: InstagramResolveEventContext = {}
): Promise<ResolveInstagramMediaResult> {
  const normalizedUrl = normalizeInstagramPageUrl(inputUrl);
  const shouldEmit = Boolean(eventContext.researchJobId);

  const emitResolveEvent = (
    code: 'download.resolve.started' | 'download.resolve.succeeded' | 'download.resolve.failed',
    level: 'info' | 'warn' | 'error',
    message: string,
    extra: {
      metrics?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } = {}
  ) => {
    if (!shouldEmit || !eventContext.researchJobId) return;
    emitResearchJobEvent({
      researchJobId: eventContext.researchJobId,
      runId: eventContext.runId,
      source: 'downloader',
      code,
      level,
      message,
      platform: eventContext.platform || null,
      handle: eventContext.handle || null,
      entityType: eventContext.entityType || null,
      entityId: eventContext.entityId || null,
      metrics: extra.metrics || null,
      metadata: extra.metadata || null,
    });
  };

  emitResolveEvent('download.resolve.started', 'info', 'Resolving Instagram media URL via Apify', {
    metadata: {
      source: eventContext.source || 'scraper',
      url: normalizedUrl,
      actorId: APIFY_MEDIA_DOWNLOADER_ACTOR_ID,
    },
  });

  if (!isInstagramPageUrl(normalizedUrl)) {
    emitResolveEvent('download.resolve.failed', 'warn', 'Unsupported Instagram page URL format', {
      metadata: { url: normalizedUrl },
    });
    return {
      success: false,
      mediaUrls: [],
      error: 'Unsupported Instagram page URL format',
      scraperUsed: 'apify_instagram_media_downloader',
    };
  }

  if (!APIFY_MEDIA_DOWNLOADER_TOKEN) {
    emitResolveEvent('download.resolve.failed', 'error', 'Missing Apify token for media downloader actor', {
      metadata: { actorId: APIFY_MEDIA_DOWNLOADER_ACTOR_ID },
    });
    return {
      success: false,
      mediaUrls: [],
      error: 'Missing Apify token for media downloader actor',
      scraperUsed: 'apify_instagram_media_downloader',
    };
  }

  try {
    const endpoint = `${APIFY_BASE_URL}/acts/${APIFY_MEDIA_DOWNLOADER_ACTOR_ID}/run-sync-get-dataset-items`;
    const payload = { instagram_urls: [normalizedUrl] };

    const response = await axios.post(endpoint, payload, {
      params: { token: APIFY_MEDIA_DOWNLOADER_TOKEN },
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    });

    const items = Array.isArray(response.data) ? response.data : [];
    if (items.length === 0) {
      emitResolveEvent('download.resolve.failed', 'warn', 'No items returned by Apify media downloader actor', {
        metadata: { url: normalizedUrl },
      });
      return {
        success: false,
        mediaUrls: [],
        error: 'No items returned by Apify media downloader actor',
        scraperUsed: 'apify_instagram_media_downloader',
      };
    }

    const firstItem = items[0] as Record<string, unknown>;
    const thumbnailUrl =
      typeof firstItem.thumbnail_url === 'string' && isHttpUrl(firstItem.thumbnail_url)
        ? firstItem.thumbnail_url
        : undefined;

    const knownMediaCandidates = [
      firstItem.download_url,
      firstItem.video_url,
      firstItem.image_url,
      firstItem.media_url,
      ...(Array.isArray(firstItem.download_urls) ? firstItem.download_urls : []),
      ...(Array.isArray(firstItem.carousel_download_urls) ? firstItem.carousel_download_urls : []),
      ...(Array.isArray(firstItem.media_urls) ? firstItem.media_urls : []),
      ...(Array.isArray(firstItem.images) ? firstItem.images : []),
      ...(Array.isArray(firstItem.videos) ? firstItem.videos : []),
    ];

    const directUrls = [
      ...knownMediaCandidates.filter((v): v is string => typeof v === 'string' && isHttpUrl(v)),
      ...collectStringUrls(firstItem),
    ];
    const mediaUrls = unique(directUrls);

    if (mediaUrls.length === 0 && thumbnailUrl) {
      mediaUrls.push(thumbnailUrl);
    }

    if (mediaUrls.length === 0) {
      emitResolveEvent('download.resolve.failed', 'warn', 'No direct media URLs found in Apify response', {
        metadata: { url: normalizedUrl },
      });
      return {
        success: false,
        mediaUrls: [],
        thumbnailUrl,
        error: 'No direct media URLs found in Apify response',
        scraperUsed: 'apify_instagram_media_downloader',
      };
    }

    emitResolveEvent('download.resolve.succeeded', 'info', `Resolved ${mediaUrls.length} media URL(s) via Apify`, {
      metrics: {
        resolvedCount: mediaUrls.length,
      },
      metadata: {
        url: normalizedUrl,
      },
    });

    return {
      success: true,
      mediaUrls,
      thumbnailUrl,
      scraperUsed: 'apify_instagram_media_downloader',
    };
  } catch (error: any) {
    emitResolveEvent('download.resolve.failed', 'error', 'Apify media resolve failed', {
      metadata: {
        url: normalizedUrl,
        error: error?.message || 'Unknown Apify media downloader error',
      },
    });
    return {
      success: false,
      mediaUrls: [],
      error: error?.message || 'Unknown Apify media downloader error',
      scraperUsed: 'apify_instagram_media_downloader',
    };
  }
}
