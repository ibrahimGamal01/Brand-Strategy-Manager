import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getPortalSessionFromRequest } from './portal-auth';

const LINKEDIN_COOKIE_NAME = 'portal_linkedin_oauth';
const LINKEDIN_PROVIDER = 'linkedin';
const LINKEDIN_VERSION = String(process.env.LINKEDIN_API_VERSION || '202602').trim() || '202602';
const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts';
const LINKEDIN_MEMBER_POST_ANALYTICS_URL = 'https://api.linkedin.com/rest/memberCreatorPostAnalytics';
const LINKEDIN_MEMBER_FOLLOWERS_URL = 'https://api.linkedin.com/rest/memberFollowersCount';
const LINKEDIN_MEMBER_VIDEO_ANALYTICS_URL = 'https://api.linkedin.com/rest/memberCreatorVideoAnalytics';
const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;
const DAILY_SYNC_MS = 24 * 60 * 60 * 1000;
const INITIAL_SYNC_POST_LIMIT = 100;
const DEFAULT_LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'email',
  'r_member_social',
  'r_member_postAnalytics',
  'r_member_profileAnalytics',
];

type JsonRecord = Record<string, unknown>;

type LinkedInFeatureState = {
  featureEnabled: boolean;
  configured: boolean;
  available: boolean;
  reasonCode?: string;
  reasonMessage?: string;
  scopes: string[];
};

type LinkedInOauthCookiePayload = {
  state: string;
  codeVerifier: string;
  workspaceId: string;
  userId: string;
  createdAt: number;
};

type LinkedInIdentity = {
  memberId: string;
  memberUrn: string;
  displayName: string | null;
  email: string | null;
  profileImageUrl: string | null;
  headline: string | null;
  profileUrl: string | null;
  raw: JsonRecord;
};

type LinkedInPostMetricKey = 'IMPRESSION' | 'MEMBERS_REACHED' | 'REACTION' | 'COMMENT' | 'RESHARE';

type LinkedInVideoMetricKey = 'VIDEO_PLAY' | 'VIDEO_WATCH_TIME' | 'VIDEO_VIEWER';

type LinkedInPostAnalyticsSummary = {
  impressions: number | null;
  uniqueImpressions: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  videoViews: number | null;
  watchTimeMs: number | null;
  raw: JsonRecord;
};

type LinkedInSyncResult = {
  connectionId: string;
  connectionStatus: string;
  postsUpserted: number;
  postsUpdated: number;
  snapshotsWritten: number;
  lastSyncedAt: string;
};

type LinkedInStatusPayload = {
  available: boolean;
  featureEnabled: boolean;
  configured: boolean;
  status:
    | 'unavailable'
    | 'not_connected'
    | 'connected'
    | 'syncing'
    | 'action_required'
    | 'error'
    | 'disconnected';
  reasonCode?: string;
  reasonMessage?: string;
  profile?: {
    displayName: string | null;
    handle: string | null;
    profileUrl: string | null;
    profileImageUrl: string | null;
    headline: string | null;
    email: string | null;
  };
  sync?: {
    lastSyncedAt: string | null;
    nextSyncAt: string | null;
    importedPosts: number;
    latestSnapshotAt: string | null;
  };
};

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toInputJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function parseBoolean(value: unknown, defaultValue = false): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

function normalizeLinkedInScopes(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getLinkedInScopes(): string[] {
  const configured = safeString(process.env.LINKEDIN_SCOPES);
  return configured ? normalizeLinkedInScopes(configured) : [...DEFAULT_LINKEDIN_SCOPES];
}

function getLinkedInFeatureState(): LinkedInFeatureState {
  const featureEnabled = parseBoolean(process.env.LINKEDIN_FEATURE_ENABLED, false);
  const clientId = safeString(process.env.LINKEDIN_CLIENT_ID);
  const clientSecret = safeString(process.env.LINKEDIN_CLIENT_SECRET);
  const redirectUri = safeString(process.env.LINKEDIN_REDIRECT_URI);
  const encryptionKey = safeString(process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY);
  const scopes = getLinkedInScopes();

  if (!featureEnabled) {
    return {
      featureEnabled,
      configured: false,
      available: false,
      reasonCode: 'FEATURE_DISABLED',
      reasonMessage: 'LinkedIn integration is disabled in this environment.',
      scopes,
    };
  }

  const configured = Boolean(clientId && clientSecret && redirectUri && encryptionKey);
  if (!configured) {
    return {
      featureEnabled,
      configured,
      available: false,
      reasonCode: 'MISSING_CONFIG',
      reasonMessage: 'LinkedIn app configuration is missing on the server.',
      scopes,
    };
  }

  return {
    featureEnabled,
    configured,
    available: true,
    scopes,
  };
}

function resolvePortalBaseUrl(req?: Request): string {
  const configured = safeString(process.env.PORTAL_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');
  const originHeader = safeString(req?.headers.origin);
  if (/^https?:\/\//i.test(originHeader)) return originHeader.replace(/\/+$/, '');
  const host = safeString(req?.headers.host) || 'localhost:3000';
  const proto = safeString(req?.headers['x-forwarded-proto']) || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function getLinkedInConfigOrThrow() {
  const state = getLinkedInFeatureState();
  if (!state.available) {
    const error = new Error(state.reasonMessage || 'LinkedIn is unavailable.');
    (error as Error & { code?: string }).code = state.reasonCode;
    throw error;
  }
  return {
    clientId: safeString(process.env.LINKEDIN_CLIENT_ID),
    clientSecret: safeString(process.env.LINKEDIN_CLIENT_SECRET),
    redirectUri: safeString(process.env.LINKEDIN_REDIRECT_URI),
    scopes: state.scopes,
  };
}

function toBase64Url(value: Buffer): string {
  return value.toString('base64url');
}

function deriveEncryptionKey(): Buffer {
  const raw = safeString(process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY);
  if (!raw) {
    throw new Error('LINKEDIN_TOKEN_ENCRYPTION_KEY is required');
  }
  try {
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === 32) return base64;
  } catch {
    // fall through
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptValue(value: string): string {
  const iv = crypto.randomBytes(12);
  const key = deriveEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptValue(value: string): string {
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('Invalid encrypted value');
  }
  const key = deriveEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function encodeOauthCookie(payload: LinkedInOauthCookiePayload): string {
  return encryptValue(JSON.stringify(payload));
}

function decodeOauthCookie(value: string | undefined): LinkedInOauthCookiePayload | null {
  const raw = safeString(value);
  if (!raw) return null;
  try {
    const decoded = JSON.parse(decryptValue(raw)) as LinkedInOauthCookiePayload;
    if (!decoded?.state || !decoded?.codeVerifier || !decoded?.workspaceId || !decoded?.userId) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [name, ...rest] = part.split('=');
    const key = safeString(name);
    if (!key) continue;
    out[key] = decodeURIComponent(rest.join('=').trim());
  }
  return out;
}

function setOauthCookie(res: Response, payload: LinkedInOauthCookiePayload) {
  res.cookie(LINKEDIN_COOKIE_NAME, encodeOauthCookie(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/portal/integrations/linkedin',
    maxAge: OAUTH_MAX_AGE_MS,
  });
}

function clearOauthCookie(res: Response) {
  res.clearCookie(LINKEDIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/portal/integrations/linkedin',
  });
}

function buildCodeChallenge(verifier: string): string {
  return toBase64Url(crypto.createHash('sha256').update(verifier).digest());
}

async function linkedInFetchJson(
  url: string,
  accessToken: string,
  init?: RequestInit,
  options?: { includeRestHeaders?: boolean }
): Promise<any> {
  const includeRestHeaders = options?.includeRestHeaders !== false;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(includeRestHeaders
        ? {
            'Linkedin-Version': LINKEDIN_VERSION,
            'X-Restli-Protocol-Version': '2.0.0',
          }
        : {}),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new Error(`LinkedIn request failed (${response.status}): ${details || response.statusText}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return response.json().catch(() => ({}));
}

async function exchangeCodeForToken(input: { code: string; codeVerifier: string }): Promise<any> {
  const config = getLinkedInConfigOrThrow();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `LinkedIn token exchange failed (${response.status}): ${JSON.stringify(payload || {})}`
    );
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload;
}

async function refreshAccessToken(refreshToken: string): Promise<any> {
  const config = getLinkedInConfigOrThrow();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`LinkedIn token refresh failed (${response.status}): ${JSON.stringify(payload || {})}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload;
}

function addMilliseconds(base: Date, ms: number | undefined): Date | null {
  if (!Number.isFinite(ms || NaN)) return null;
  return new Date(base.getTime() + Number(ms) * 1000);
}

function parseLinkedInIdentityPayload(payload: any): LinkedInIdentity {
  const record = asRecord(payload);
  const sub = safeString(record.sub);
  const name = safeString(record.name) || [safeString(record.given_name), safeString(record.family_name)].filter(Boolean).join(' ') || null;
  const email = safeString(record.email) || null;
  const picture = safeString(record.picture) || null;
  const profileUrl = safeString(record.profile) || null;
  return {
    memberId: sub,
    memberUrn: sub ? `urn:li:person:${sub}` : '',
    displayName: name,
    email,
    profileImageUrl: picture,
    headline: safeString(record.headline) || null,
    profileUrl,
    raw: record,
  };
}

function extractLinkedInHandle(identity: LinkedInIdentity): string {
  const profileUrl = safeString(identity.profileUrl);
  const match = profileUrl.match(/linkedin\.com\/(?:in|company)\/([a-z0-9-_%]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return identity.memberId || crypto.createHash('sha1').update(identity.memberUrn).digest('hex').slice(0, 16);
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as JsonRecord;
  const candidate = safeString(record.text) || safeString(record.value) || safeString(record.commentary);
  if (candidate) return candidate;
  for (const nested of Object.values(record)) {
    const nestedText = extractText(nested);
    if (nestedText) return nestedText;
  }
  return '';
}

function inferPostType(post: JsonRecord): string {
  const content = asRecord(post.content);
  if (content.media) return 'media';
  if (content.article) return 'article';
  if (content.poll) return 'poll';
  if (content.multiImage) return 'multi_image';
  if (content.video) return 'video';
  if (content.document) return 'document';
  if (post.reshareContext) return 'reshare';
  return 'text';
}

function extractThumbnailUrl(post: JsonRecord): string | null {
  const content = asRecord(post.content);
  const candidates = [
    safeString(asRecord(content.media).thumbnail),
    safeString(asRecord(asRecord(content.article).thumbnail).url),
    safeString(asRecord(content.video).thumbnail),
    safeString(asRecord(content.document).thumbnail),
  ];
  return candidates.find(Boolean) || null;
}

function extractMediaUrn(post: JsonRecord): string | null {
  const content = asRecord(post.content);
  const candidates = [
    safeString(asRecord(content.video).id),
    safeString(asRecord(content.media).id),
    safeString(asRecord(content.document).id),
  ];
  return candidates.find(Boolean) || null;
}

function toLinkedInPostUrl(postId: string): string | null {
  const normalized = safeString(postId);
  if (!normalized) return null;
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(normalized)}/`;
}

function collectHashtags(text: string): string[] | null {
  const matches = Array.from(text.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)).map((match) => `#${match[2]}`);
  return matches.length ? Array.from(new Set(matches)).slice(0, 50) : null;
}

function collectMentions(text: string): string[] | null {
  const matches = Array.from(text.matchAll(/(^|\s)@([\p{L}\p{N}._-]+)/gu)).map((match) => `@${match[2]}`);
  return matches.length ? Array.from(new Set(matches)).slice(0, 50) : null;
}

function sumCounts(payload: any): number | null {
  const record = asRecord(payload);
  const elements = Array.isArray(record.elements) ? record.elements : [];
  if (!elements.length) return null;
  let total = 0;
  let saw = false;
  for (const element of elements) {
    const count = Number(asRecord(element).count);
    if (Number.isFinite(count)) {
      total += count;
      saw = true;
    }
  }
  return saw ? total : null;
}

async function fetchSinglePostMetric(accessToken: string, postUrn: string, metric: LinkedInPostMetricKey): Promise<any> {
  const entityType = postUrn.includes(':ugcPost:') ? 'ugc' : 'share';
  const entity = `(${entityType}:${postUrn})`;
  const params = new URLSearchParams({
    q: 'entity',
    entity,
    queryType: metric,
    aggregation: 'TOTAL',
  });
  return linkedInFetchJson(`${LINKEDIN_MEMBER_POST_ANALYTICS_URL}?${params.toString()}`, accessToken);
}

async function fetchSingleVideoMetric(accessToken: string, videoUrn: string, metric: LinkedInVideoMetricKey): Promise<any> {
  const params = new URLSearchParams({
    q: 'entity',
    entity: videoUrn,
    queryType: metric,
    aggregation: 'TOTAL',
  });
  return linkedInFetchJson(`${LINKEDIN_MEMBER_VIDEO_ANALYTICS_URL}?${params.toString()}`, accessToken);
}

async function fetchLinkedInIdentity(accessToken: string): Promise<LinkedInIdentity> {
  const payload = await linkedInFetchJson(LINKEDIN_USERINFO_URL, accessToken, undefined, {
    includeRestHeaders: false,
  });
  return parseLinkedInIdentityPayload(payload);
}

async function fetchLinkedInFollowerCount(accessToken: string): Promise<number | null> {
  try {
    const payload = await linkedInFetchJson(`${LINKEDIN_MEMBER_FOLLOWERS_URL}?q=me`, accessToken);
    const record = asRecord(payload);
    const elements = Array.isArray(record.elements) ? record.elements : [];
    const first = elements[0] && asRecord(elements[0]);
    const count = Number(first?.followerCounts || first?.count || record.count);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

async function fetchLinkedInPosts(accessToken: string, memberUrn: string, count = INITIAL_SYNC_POST_LIMIT): Promise<JsonRecord[]> {
  const params = new URLSearchParams({
    q: 'author',
    author: memberUrn,
    count: String(Math.max(1, Math.min(INITIAL_SYNC_POST_LIMIT, count))),
    sortBy: 'LAST_MODIFIED',
    viewContext: 'AUTHOR',
  });
  const payload = await linkedInFetchJson(`${LINKEDIN_POSTS_URL}?${params.toString()}`, accessToken);
  return Array.isArray(payload?.elements)
    ? payload.elements.map((item: unknown) => asRecord(item)).filter((item: JsonRecord) => Object.keys(item).length > 0)
    : [];
}

async function fetchLinkedInAnalytics(accessToken: string, post: JsonRecord): Promise<LinkedInPostAnalyticsSummary> {
  const postUrn = safeString(post.id);
  const metrics = await Promise.allSettled([
    fetchSinglePostMetric(accessToken, postUrn, 'IMPRESSION'),
    fetchSinglePostMetric(accessToken, postUrn, 'MEMBERS_REACHED'),
    fetchSinglePostMetric(accessToken, postUrn, 'REACTION'),
    fetchSinglePostMetric(accessToken, postUrn, 'COMMENT'),
    fetchSinglePostMetric(accessToken, postUrn, 'RESHARE'),
  ]);

  const raw: JsonRecord = {};
  const [impressions, uniqueImpressions, reactions, comments, shares] = metrics.map((result, index) => {
    const key = ['impressions', 'uniqueImpressions', 'reactions', 'comments', 'shares'][index] || `metric${index}`;
    if (result.status === 'fulfilled') {
      raw[key] = result.value;
      return sumCounts(result.value);
    }
    raw[`${key}Error`] = safeString(result.reason instanceof Error ? result.reason.message : String(result.reason));
    return null;
  });

  let videoViews: number | null = null;
  let watchTimeMs: number | null = null;
  const videoUrn = extractMediaUrn(post);
  if (videoUrn) {
    const videoMetrics = await Promise.allSettled([
      fetchSingleVideoMetric(accessToken, videoUrn, 'VIDEO_PLAY'),
      fetchSingleVideoMetric(accessToken, videoUrn, 'VIDEO_WATCH_TIME'),
    ]);
    const [videoPlay, videoWatchTime] = videoMetrics;
    if (videoPlay.status === 'fulfilled') {
      raw.videoViews = videoPlay.value;
      videoViews = sumCounts(videoPlay.value);
    } else {
      raw.videoViewsError = safeString(videoPlay.reason instanceof Error ? videoPlay.reason.message : String(videoPlay.reason));
    }
    if (videoWatchTime.status === 'fulfilled') {
      raw.watchTimeMs = videoWatchTime.value;
      watchTimeMs = sumCounts(videoWatchTime.value);
    } else {
      raw.watchTimeMsError = safeString(videoWatchTime.reason instanceof Error ? videoWatchTime.reason.message : String(videoWatchTime.reason));
    }
  }

  return {
    impressions,
    uniqueImpressions,
    reactions,
    comments,
    shares,
    clicks: null,
    videoViews,
    watchTimeMs,
    raw,
  };
}

async function logConnectorRun(input: {
  researchJobId: string;
  target: string;
  ok: boolean;
  error?: string | null;
  meta?: JsonRecord;
}) {
  await prisma.connectorRun.create({
    data: {
      researchJobId: input.researchJobId,
      platform: LINKEDIN_PROVIDER,
      provider: LINKEDIN_PROVIDER,
      target: input.target,
      ok: input.ok,
      confidence: input.ok ? 1 : 0,
      coverage: input.ok ? 1 : 0,
      error: input.error || null,
      meta: toInputJson(input.meta),
    },
  });
}

async function ensureActiveAccessToken(connection: any): Promise<{ accessToken: string; connection: any }> {
  const now = Date.now();
  const encrypted = safeString(connection.accessTokenCiphertext);
  if (!encrypted) {
    throw new Error('LinkedIn access token is missing.');
  }

  const accessTokenExpiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : null;
  if (!accessTokenExpiresAt || accessTokenExpiresAt > now + 60_000) {
    return { accessToken: decryptValue(encrypted), connection };
  }

  const refreshCiphertext = safeString(connection.refreshTokenCiphertext);
  if (!refreshCiphertext) {
    await prisma.portalLinkedInConnection.update({
      where: { id: connection.id },
      data: {
        status: 'action_required',
        lastSyncStatus: 'action_required',
        lastSyncError: 'LinkedIn access expired. Reconnect LinkedIn to continue syncing.',
      },
    });
    throw new Error('LinkedIn access expired. Reconnect LinkedIn to continue syncing.');
  }

  const refreshed = await refreshAccessToken(decryptValue(refreshCiphertext));
  const nextAccessToken = safeString(refreshed.access_token);
  const nextRefreshToken = safeString(refreshed.refresh_token) || decryptValue(refreshCiphertext);
  const updated = await prisma.portalLinkedInConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenCiphertext: encryptValue(nextAccessToken),
      refreshTokenCiphertext: nextRefreshToken ? encryptValue(nextRefreshToken) : null,
      accessTokenExpiresAt: addMilliseconds(new Date(), Number(refreshed.expires_in)) || connection.accessTokenExpiresAt,
      refreshTokenExpiresAt: addMilliseconds(new Date(), Number(refreshed.refresh_token_expires_in)) || connection.refreshTokenExpiresAt,
      status: 'active',
      lastSyncStatus: 'refreshed',
      lastSyncError: null,
    },
  });

  return { accessToken: nextAccessToken, connection: updated };
}

async function upsertLinkedInProfile(input: {
  connection: any;
  identity: LinkedInIdentity;
  followersCount: number | null;
}) {
  const handle = extractLinkedInHandle(input.identity);
  const socialProfile = await prisma.socialProfile.upsert({
    where: {
      researchJobId_platform_handle: {
        researchJobId: input.connection.researchJobId,
        platform: LINKEDIN_PROVIDER,
        handle,
      },
    },
    update: {
      displayName: input.identity.displayName,
      url: input.identity.profileUrl,
      profileImageUrl: input.identity.profileImageUrl,
      headline: input.identity.headline,
      externalUrn: input.identity.memberUrn,
      sourceType: 'portal_linkedin_connection',
      sourceConnectionId: input.connection.id,
      followers: input.followersCount,
      bio: input.identity.headline,
      lastScrapedAt: new Date(),
    },
    create: {
      researchJobId: input.connection.researchJobId,
      platform: LINKEDIN_PROVIDER,
      handle,
      displayName: input.identity.displayName,
      url: input.identity.profileUrl,
      profileImageUrl: input.identity.profileImageUrl,
      headline: input.identity.headline,
      externalUrn: input.identity.memberUrn,
      sourceType: 'portal_linkedin_connection',
      sourceConnectionId: input.connection.id,
      followers: input.followersCount,
      bio: input.identity.headline,
      lastScrapedAt: new Date(),
    },
  });

  await prisma.portalLinkedInConnection.update({
    where: { id: input.connection.id },
    data: {
      socialProfileId: socialProfile.id,
      displayName: input.identity.displayName,
      email: input.identity.email,
      profileUrl: input.identity.profileUrl,
      profileImageUrl: input.identity.profileImageUrl,
      headline: input.identity.headline,
      linkedinMemberId: input.identity.memberId,
      linkedinMemberUrn: input.identity.memberUrn,
    },
  });

  return socialProfile;
}

function normalizePostedAt(post: JsonRecord): Date | null {
  const raw = Number(post.publishedAt || post.createdAt || 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return new Date(raw);
}

async function upsertLinkedInPost(input: {
  socialProfileId: string;
  post: JsonRecord;
  analytics: LinkedInPostAnalyticsSummary;
}) {
  const commentary = extractText(input.post.commentary || input.post.content || input.post);
  const externalId = safeString(input.post.id);
  const metadata = {
    rawPost: input.post,
    analyticsRaw: input.analytics.raw,
    author: safeString(input.post.author) || null,
    visibility: safeString(input.post.visibility) || null,
    lifecycleState: safeString(input.post.lifecycleState) || null,
    distribution: asRecord(input.post.distribution),
    content: asRecord(input.post.content),
  };

  const existing = await prisma.socialPost.findUnique({
    where: {
      socialProfileId_externalId: {
        socialProfileId: input.socialProfileId,
        externalId,
      },
    },
    select: { id: true },
  });

  const socialPost = await prisma.socialPost.upsert({
    where: {
      socialProfileId_externalId: {
        socialProfileId: input.socialProfileId,
        externalId,
      },
    },
    update: {
      url: toLinkedInPostUrl(externalId),
      type: inferPostType(input.post),
      caption: commentary || null,
      hashtags: toInputJson(collectHashtags(commentary)),
      mentions: toInputJson(collectMentions(commentary)),
      thumbnailUrl: extractThumbnailUrl(input.post),
      likesCount: input.analytics.reactions,
      commentsCount: input.analytics.comments,
      sharesCount: input.analytics.shares,
      viewsCount: input.analytics.impressions,
      playsCount: input.analytics.videoViews,
      metadata: toInputJson(metadata),
      postedAt: normalizePostedAt(input.post),
      scrapedAt: new Date(),
    },
    create: {
      socialProfileId: input.socialProfileId,
      externalId,
      url: toLinkedInPostUrl(externalId),
      type: inferPostType(input.post),
      caption: commentary || null,
      hashtags: toInputJson(collectHashtags(commentary)),
      mentions: toInputJson(collectMentions(commentary)),
      thumbnailUrl: extractThumbnailUrl(input.post),
      likesCount: input.analytics.reactions,
      commentsCount: input.analytics.comments,
      sharesCount: input.analytics.shares,
      viewsCount: input.analytics.impressions,
      playsCount: input.analytics.videoViews,
      metadata: toInputJson(metadata),
      postedAt: normalizePostedAt(input.post),
      scrapedAt: new Date(),
    },
  });

  await prisma.linkedInPostAnalyticsCurrent.upsert({
    where: { socialPostId: socialPost.id },
    update: {
      impressions: input.analytics.impressions,
      uniqueImpressions: input.analytics.uniqueImpressions,
      clicks: input.analytics.clicks,
      reactions: input.analytics.reactions,
      comments: input.analytics.comments,
      shares: input.analytics.shares,
      videoViews: input.analytics.videoViews,
      watchTimeMs: input.analytics.watchTimeMs,
      rawStatsJson: toInputJson(input.analytics.raw),
      lastFetchedAt: new Date(),
    },
    create: {
      socialPostId: socialPost.id,
      impressions: input.analytics.impressions,
      uniqueImpressions: input.analytics.uniqueImpressions,
      clicks: input.analytics.clicks,
      reactions: input.analytics.reactions,
      comments: input.analytics.comments,
      shares: input.analytics.shares,
      videoViews: input.analytics.videoViews,
      watchTimeMs: input.analytics.watchTimeMs,
      rawStatsJson: toInputJson(input.analytics.raw),
      lastFetchedAt: new Date(),
    },
  });

  await prisma.linkedInPostAnalyticsSnapshot.create({
    data: {
      socialPostId: socialPost.id,
      impressions: input.analytics.impressions,
      uniqueImpressions: input.analytics.uniqueImpressions,
      clicks: input.analytics.clicks,
      reactions: input.analytics.reactions,
      comments: input.analytics.comments,
      shares: input.analytics.shares,
      videoViews: input.analytics.videoViews,
      watchTimeMs: input.analytics.watchTimeMs,
      rawStatsJson: toInputJson(input.analytics.raw),
      capturedAt: new Date(),
    },
  });

  return {
    socialPostId: socialPost.id,
    existed: Boolean(existing),
  };
}

export async function getLinkedInIntegrationStatus(input: {
  workspaceId: string;
  userId: string;
}): Promise<LinkedInStatusPayload> {
  const featureState = getLinkedInFeatureState();
  if (!featureState.available) {
    return {
      available: false,
      featureEnabled: featureState.featureEnabled,
      configured: featureState.configured,
      status: 'unavailable',
      reasonCode: featureState.reasonCode,
      reasonMessage: featureState.reasonMessage,
    };
  }

  const connection = await prisma.portalLinkedInConnection.findUnique({
    where: {
      userId_researchJobId_provider: {
        userId: input.userId,
        researchJobId: input.workspaceId,
        provider: LINKEDIN_PROVIDER,
      },
    },
    include: {
      socialProfile: true,
    },
  });

  if (!connection) {
    return {
      available: true,
      featureEnabled: featureState.featureEnabled,
      configured: featureState.configured,
      status: 'not_connected',
    };
  }

  const importedPosts = connection.socialProfileId
    ? await prisma.socialPost.count({ where: { socialProfileId: connection.socialProfileId } })
    : 0;
  const latestSnapshot = connection.socialProfileId
    ? await prisma.linkedInPostAnalyticsSnapshot.findFirst({
        where: { socialPost: { socialProfileId: connection.socialProfileId } },
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      })
    : null;

  return {
    available: true,
    featureEnabled: featureState.featureEnabled,
    configured: featureState.configured,
    status: (connection.status === 'active' ? 'connected' : connection.status) as LinkedInStatusPayload['status'],
    reasonMessage: connection.lastSyncError || undefined,
    profile: {
      displayName: connection.displayName,
      handle: connection.socialProfile?.handle || null,
      profileUrl: connection.profileUrl,
      profileImageUrl: connection.profileImageUrl,
      headline: connection.headline,
      email: connection.email,
    },
    sync: {
      lastSyncedAt: connection.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null,
      nextSyncAt: connection.nextSyncAt ? connection.nextSyncAt.toISOString() : null,
      importedPosts,
      latestSnapshotAt: latestSnapshot?.capturedAt ? latestSnapshot.capturedAt.toISOString() : null,
    },
  };
}

export async function startLinkedInOAuth(input: {
  req: Request;
  res: Response;
  workspaceId: string;
  userId: string;
}): Promise<{ authUrl: string }> {
  const config = getLinkedInConfigOrThrow();
  const state = crypto.randomBytes(24).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = buildCodeChallenge(codeVerifier);

  setOauthCookie(input.res, {
    state,
    codeVerifier,
    workspaceId: input.workspaceId,
    userId: input.userId,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    authUrl: `${LINKEDIN_AUTH_URL}?${params.toString()}`,
  };
}

function callbackRedirectUrl(req: Request, workspaceId: string, status: string, error?: string): string {
  const base = resolvePortalBaseUrl(req);
  const params = new URLSearchParams({ linkedin: status });
  if (error) params.set('linkedinError', error.slice(0, 180));
  return `${base}/app/w/${workspaceId}/settings?${params.toString()}`;
}

export async function completeLinkedInOAuthCallback(req: Request, res: Response): Promise<void> {
  const featureState = getLinkedInFeatureState();
  const cookies = parseCookies(req.headers.cookie);
  const oauthCookie = decodeOauthCookie(cookies[LINKEDIN_COOKIE_NAME]);
  const requestedState = safeString(req.query.state);
  const code = safeString(req.query.code);
  const oauthError = safeString(req.query.error) || safeString(req.query.error_description);
  const fallbackRedirect = `${resolvePortalBaseUrl(req)}/login?next=${encodeURIComponent('/app')}`;

  if (!featureState.available) {
    clearOauthCookie(res);
    res.redirect(fallbackRedirect);
    return;
  }

  if (!oauthCookie) {
    res.redirect(fallbackRedirect);
    return;
  }

  const session = await getPortalSessionFromRequest(req);
  if (!session || session.user.id !== oauthCookie.userId) {
    clearOauthCookie(res);
    res.redirect(`${resolvePortalBaseUrl(req)}/login?next=${encodeURIComponent(`/app/w/${oauthCookie.workspaceId}/settings`)}`);
    return;
  }

  if (oauthError) {
    clearOauthCookie(res);
    res.redirect(callbackRedirectUrl(req, oauthCookie.workspaceId, 'error', oauthError));
    return;
  }
  if (!requestedState || requestedState !== oauthCookie.state || !code) {
    clearOauthCookie(res);
    res.redirect(callbackRedirectUrl(req, oauthCookie.workspaceId, 'error', 'Invalid LinkedIn callback state.'));
    return;
  }
  if (Date.now() - oauthCookie.createdAt > OAUTH_MAX_AGE_MS) {
    clearOauthCookie(res);
    res.redirect(callbackRedirectUrl(req, oauthCookie.workspaceId, 'error', 'LinkedIn connection expired. Please try again.'));
    return;
  }

  try {
    const tokenPayload = await exchangeCodeForToken({ code, codeVerifier: oauthCookie.codeVerifier });
    const accessToken = safeString(tokenPayload.access_token);
    const refreshToken = safeString(tokenPayload.refresh_token);
    const identity = await fetchLinkedInIdentity(accessToken);
    const followersCount = await fetchLinkedInFollowerCount(accessToken);

    const connection = await prisma.portalLinkedInConnection.upsert({
      where: {
        userId_researchJobId_provider: {
          userId: oauthCookie.userId,
          researchJobId: oauthCookie.workspaceId,
          provider: LINKEDIN_PROVIDER,
        },
      },
      update: {
        status: 'active',
        linkedinMemberId: identity.memberId,
        linkedinMemberUrn: identity.memberUrn,
        email: identity.email,
        displayName: identity.displayName,
        profileUrl: identity.profileUrl,
        profileImageUrl: identity.profileImageUrl,
        headline: identity.headline,
        accessTokenCiphertext: encryptValue(accessToken),
        refreshTokenCiphertext: refreshToken ? encryptValue(refreshToken) : null,
        accessTokenExpiresAt: addMilliseconds(new Date(), Number(tokenPayload.expires_in)),
        refreshTokenExpiresAt: addMilliseconds(new Date(), Number(tokenPayload.refresh_token_expires_in)),
        scopesJson: getLinkedInScopes(),
        disconnectedAt: null,
        lastSyncStatus: 'connected',
        lastSyncError: null,
        nextSyncAt: new Date(Date.now() + DAILY_SYNC_MS),
      },
      create: {
        userId: oauthCookie.userId,
        researchJobId: oauthCookie.workspaceId,
        provider: LINKEDIN_PROVIDER,
        status: 'active',
        linkedinMemberId: identity.memberId,
        linkedinMemberUrn: identity.memberUrn,
        email: identity.email,
        displayName: identity.displayName,
        profileUrl: identity.profileUrl,
        profileImageUrl: identity.profileImageUrl,
        headline: identity.headline,
        accessTokenCiphertext: encryptValue(accessToken),
        refreshTokenCiphertext: refreshToken ? encryptValue(refreshToken) : null,
        accessTokenExpiresAt: addMilliseconds(new Date(), Number(tokenPayload.expires_in)),
        refreshTokenExpiresAt: addMilliseconds(new Date(), Number(tokenPayload.refresh_token_expires_in)),
        scopesJson: getLinkedInScopes(),
        lastSyncStatus: 'connected',
        nextSyncAt: new Date(Date.now() + DAILY_SYNC_MS),
      },
    });

    const socialProfile = await upsertLinkedInProfile({
      connection,
      identity,
      followersCount,
    });

    await prisma.portalLinkedInConnection.update({
      where: { id: connection.id },
      data: { socialProfileId: socialProfile.id },
    });

    try {
      await syncLinkedInConnection({ workspaceId: oauthCookie.workspaceId, userId: oauthCookie.userId });
    } catch (error) {
      console.warn('[LinkedIn] Initial sync after callback failed:', error);
    }

    clearOauthCookie(res);
    res.redirect(callbackRedirectUrl(req, oauthCookie.workspaceId, 'connected'));
  } catch (error) {
    clearOauthCookie(res);
    const message = error instanceof Error ? error.message : 'LinkedIn connection failed.';
    res.redirect(callbackRedirectUrl(req, oauthCookie.workspaceId, 'error', message));
  }
}

export async function syncLinkedInConnection(input: { workspaceId: string; userId: string }): Promise<LinkedInSyncResult> {
  const connection = await prisma.portalLinkedInConnection.findUnique({
    where: {
      userId_researchJobId_provider: {
        userId: input.userId,
        researchJobId: input.workspaceId,
        provider: LINKEDIN_PROVIDER,
      },
    },
    include: { socialProfile: true },
  });
  if (!connection) {
    throw new Error('LinkedIn connection not found.');
  }

  await prisma.portalLinkedInConnection.update({
    where: { id: connection.id },
    data: {
      status: 'syncing',
      lastSyncStatus: 'syncing',
      lastSyncError: null,
    },
  });

  try {
    const { accessToken, connection: refreshedConnection } = await ensureActiveAccessToken(connection);
    const identity = await fetchLinkedInIdentity(accessToken);
    const followersCount = await fetchLinkedInFollowerCount(accessToken);
    const socialProfile = await upsertLinkedInProfile({
      connection: refreshedConnection,
      identity,
      followersCount,
    });
    const posts = await fetchLinkedInPosts(accessToken, identity.memberUrn, INITIAL_SYNC_POST_LIMIT);

    let postsUpserted = 0;
    let postsUpdated = 0;
    let snapshotsWritten = 0;

    for (const post of posts) {
      const analytics = await fetchLinkedInAnalytics(accessToken, post);
      const result = await upsertLinkedInPost({
        socialProfileId: socialProfile.id,
        post,
        analytics,
      });
      if (result.existed) postsUpdated += 1;
      else postsUpserted += 1;
      snapshotsWritten += 1;
    }

    const now = new Date();
    await prisma.socialProfile.update({
      where: { id: socialProfile.id },
      data: {
        postsCount: posts.length,
        followers: followersCount,
        lastScrapedAt: now,
        lastPostId: posts[0] ? safeString(posts[0].id) || null : null,
      },
    });

    const updated = await prisma.portalLinkedInConnection.update({
      where: { id: connection.id },
      data: {
        status: 'active',
        socialProfileId: socialProfile.id,
        displayName: identity.displayName,
        profileUrl: identity.profileUrl,
        profileImageUrl: identity.profileImageUrl,
        headline: identity.headline,
        email: identity.email,
        linkedinMemberId: identity.memberId,
        linkedinMemberUrn: identity.memberUrn,
        lastSyncedAt: now,
        nextSyncAt: new Date(now.getTime() + DAILY_SYNC_MS),
        lastSyncStatus: 'success',
        lastSyncError: null,
      },
    });

    await logConnectorRun({
      researchJobId: input.workspaceId,
      target: identity.memberUrn,
      ok: true,
      meta: {
        postsFetched: posts.length,
        snapshotsWritten,
      },
    });

    return {
      connectionId: updated.id,
      connectionStatus: 'connected',
      postsUpserted,
      postsUpdated,
      snapshotsWritten,
      lastSyncedAt: now.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /scope|permission|unauthorized|forbidden|expired|reconnect/i.test(message) ? 'action_required' : 'error';
    await prisma.portalLinkedInConnection.update({
      where: { id: connection.id },
      data: {
        status,
        lastSyncStatus: 'failed',
        lastSyncError: message.slice(0, 500),
        nextSyncAt: new Date(Date.now() + DAILY_SYNC_MS),
      },
    });
    await logConnectorRun({
      researchJobId: input.workspaceId,
      target: connection.linkedinMemberUrn || connection.linkedinMemberId || connection.id,
      ok: false,
      error: message.slice(0, 300),
      meta: { connectionId: connection.id },
    });
    throw error;
  }
}

export async function disconnectLinkedInConnection(input: { workspaceId: string; userId: string }) {
  const connection = await prisma.portalLinkedInConnection.findUnique({
    where: {
      userId_researchJobId_provider: {
        userId: input.userId,
        researchJobId: input.workspaceId,
        provider: LINKEDIN_PROVIDER,
      },
    },
  });
  if (!connection) {
    return { ok: true, connectionStatus: 'disconnected', dataRetained: true };
  }
  await prisma.portalLinkedInConnection.update({
    where: { id: connection.id },
    data: {
      status: 'disconnected',
      accessTokenCiphertext: null,
      refreshTokenCiphertext: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      disconnectedAt: new Date(),
      nextSyncAt: null,
      lastSyncStatus: 'disconnected',
      lastSyncError: null,
    },
  });
  return { ok: true, connectionStatus: 'disconnected', dataRetained: true };
}

export async function syncDueLinkedInConnections(limit = 10): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const featureState = getLinkedInFeatureState();
  if (!featureState.available || !parseBoolean(process.env.LINKEDIN_SYNC_ENABLED, true)) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const due = await prisma.portalLinkedInConnection.findMany({
    where: {
      provider: LINKEDIN_PROVIDER,
      status: { in: ['active', 'error'] },
      nextSyncAt: { lte: new Date() },
      disconnectedAt: null,
    },
    orderBy: { nextSyncAt: 'asc' },
    take: Math.max(1, Math.min(25, limit)),
    select: { userId: true, researchJobId: true },
  });

  let succeeded = 0;
  let failed = 0;
  for (const connection of due) {
    try {
      await syncLinkedInConnection({ workspaceId: connection.researchJobId, userId: connection.userId });
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: due.length,
    succeeded,
    failed,
  };
}

export function getLinkedInStatusForTests(connection: {
  status: string;
  featureEnabled?: boolean;
  configured?: boolean;
}): LinkedInStatusPayload['status'] {
  if (!connection.featureEnabled || !connection.configured) return 'unavailable';
  if (connection.status === 'active') return 'connected';
  if (
    connection.status === 'syncing' ||
    connection.status === 'action_required' ||
    connection.status === 'error' ||
    connection.status === 'disconnected'
  ) {
    return connection.status as LinkedInStatusPayload['status'];
  }
  return 'not_connected';
}

export function buildLinkedInAuthUrlForTests(input: { clientId: string; redirectUri: string; state: string; verifier: string; scopes: string[] }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(' '),
    state: input.state,
    code_challenge: buildCodeChallenge(input.verifier),
    code_challenge_method: 'S256',
  });
  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

export function encodeLinkedInOauthCookieForTests(payload: LinkedInOauthCookiePayload): string {
  return encodeOauthCookie(payload);
}

export function decodeLinkedInOauthCookieForTests(value: string): LinkedInOauthCookiePayload | null {
  return decodeOauthCookie(value);
}
