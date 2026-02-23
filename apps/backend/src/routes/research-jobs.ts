import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { gatherAllDDG, searchCompetitorsDDG, performDirectCompetitorSearch } from '../services/discovery/duckduckgo-search';
import { askAllDeepQuestions } from '../services/ai/deep-questions';
import { runTrendOrchestrator } from '../services/discovery/trends-orchestrator';
import { scrapeProfileIncrementally, scrapeProfileSafe } from '../services/social/scraper';
import { suggestCompetitorsWithAI } from '../services/ai/competitor-discovery';
import { evaluateCompetitorRelevance } from '../services/ai/competitor-evaluation';
import { validateCompetitorBatch, filterValidatedCompetitors } from '../services/discovery/instagram-validator';
import {
  approveAndScrapeCompetitors,
  continueCompetitorScrape as continueCompetitorScrapeBulk,
  getOrchestrationRunDiagnostics,
  getCompetitorShortlist,
  orchestrateCompetitorsForJob,
  recheckCompetitorAvailability,
} from '../services/discovery/competitor-orchestrator-v2';
import { materializeAndShortlistCandidate } from '../services/discovery/competitor-materializer';
import {
  isModuleKey,
  ModuleAction,
  performResearchModuleAction,
  resumeResearchJob,
} from '../services/social/research-resume';
import { orchestrateBrandIntelligenceForJob } from '../services/brand-intelligence/orchestrator';
import {
  continueResearchJob,
  configureResearchJobContinuity,
  researchContinuity,
} from '../services/social/research-continuity';
import { normalizeHandle as normalizeHandleFromUrl } from '../services/intake/brain-intake-utils';
import { forceQueueAllMediaDownloads } from '../services/orchestration/media-completeness';
import {
  emitResearchJobEvent,
  listResearchJobEvents,
  serializeResearchJobEventSse,
  subscribeResearchJobEvents,
} from '../services/social/research-job-events';

// ... (imports)

import { visualAggregationService } from '../services/analytics/visual-aggregation';
import { fileManager } from '../services/storage/file-manager';
import { isOpenAiConfiguredForRealMode } from '../lib/runtime-preflight';
import OpenAI from 'openai';
import { applyBrainCommand } from '../services/brain/apply-brain-command';
import {
  syncInputDataToBrainProfile,
  isBrainProfileEmpty,
  hasMeaningfulInputData,
  getInputDataKeysFound,
} from '../services/intake/sync-input-to-brain-profile';
import { syncBrainGoals } from '../services/intake/brain-intake-utils';
import { runAiAnalysisForJob } from '../services/orchestration/run-job-media-analysis';
import { getLatestMediaAnalysisRunSummary } from '../services/orchestration/media-analysis-runs';
import { resolveModelForTask } from '../services/ai/model-router';

const router = Router();
let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}
const BRAIN_COMMAND_REPLY_ENABLED = process.env.BRAIN_COMMAND_REPLY_ENABLED === 'true';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function parseCompetitorSurfaces(
  value: unknown
): Array<'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'facebook' | 'website'> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('surfaces must be a non-empty array when provided');
  }

  const normalized = value.map((entry) => String(entry).trim().toLowerCase());
  const unique = Array.from(new Set(normalized));
  const allowed = new Set(['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'facebook', 'website']);
  if (!unique.every((entry) => allowed.has(entry))) {
    throw new Error(
      'surfaces must only contain instagram,tiktok,youtube,linkedin,x,facebook,website'
    );
  }

  return unique as Array<'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'facebook' | 'website'>;
}

function parseOrchestrationMode(value: unknown): 'append' | 'replace' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'append' && normalized !== 'replace') {
    throw new Error('mode must be append or replace');
  }
  return normalized as 'append' | 'replace';
}

function parseTargetCount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('targetCount must be a number');
  }
  const rounded = Math.floor(parsed);
  if (rounded < 5 || rounded > 10) {
    throw new Error('targetCount must be between 5 and 10');
  }
  return rounded;
}

function parseDiscoveryPrecision(value: unknown): 'high' | 'balanced' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'high' && normalized !== 'balanced') {
    throw new Error('precision must be high or balanced');
  }
  return normalized as 'high' | 'balanced';
}

function parseConnectorPolicy(value: unknown): 'ddg_first_pluggable' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim();
  if (normalized !== 'ddg_first_pluggable') {
    throw new Error('connectorPolicy must be ddg_first_pluggable');
  }
  return 'ddg_first_pluggable';
}

function parseRunId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim();
  if (!isUuid(normalized)) {
    throw new Error('runId must be a valid UUID');
  }
  return normalized;
}

function parseCompetitorIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('competitorIds must be an array');
  }
  const normalized = Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
    )
  );
  if (!normalized.every((entry) => isUuid(entry))) {
    throw new Error('competitorIds must contain valid UUID values');
  }
  return normalized;
}

type CandidateStateValue = 'TOP_PICK' | 'SHORTLISTED' | 'APPROVED' | 'FILTERED_OUT' | 'REJECTED';

function parseCandidateState(value: unknown): CandidateStateValue {
  const normalized = String(value || '').trim().toUpperCase();
  const validStates: CandidateStateValue[] = [
    'TOP_PICK',
    'SHORTLISTED',
    'APPROVED',
    'FILTERED_OUT',
    'REJECTED',
  ];
  if (!validStates.includes(normalized as CandidateStateValue)) {
    throw new Error(`state must be one of: ${validStates.join(', ')}`);
  }
  return normalized as CandidateStateValue;
}

// Helper function
async function saveCompetitors(
    clientId: string, 
    jobId: string, 
    items: { handleOrUrl: string, platform: string, relevanceScore: number, reasoning?: string, title?: string }[], 
    defaultReason: string
) {
    for (const item of items) {
        try {
            // Treat handle as unique identifier (could be URL)
            const handle = item.handleOrUrl;
            const platform = item.platform || 'unknown';

            const competitor = await prisma.competitor.upsert({
                where: { clientId_platform_handle: { clientId, platform, handle } },
                update: {},
                create: { clientId, handle, platform }
            });

            // Prevent duplicates in the SAME research job
            const existingDiscovery = await prisma.discoveredCompetitor.findFirst({
                where: {
                    researchJobId: jobId,
                    competitorId: competitor.id
                }
            });

            if (existingDiscovery) {
                console.log(`[API] Competitor ${handle} already discovered for job ${jobId}, skipping duplicate.`);
                continue;
            }

            await prisma.discoveredCompetitor.create({
                data: {
                    researchJobId: jobId,
                    competitorId: competitor.id,
                    handle, // Display handle/url
                    platform,
                    relevanceScore: item.relevanceScore,
                    discoveryReason: item.reasoning ? `${defaultReason}: ${item.reasoning}` : defaultReason,
                    status: 'SUGGESTED'
                }
            }).catch(() => {}); // Ignore duplicates
        } catch (e) {
            console.error(`[API] Failed to save competitor ${item.handleOrUrl} for client ${clientId}:`, e);
            // silent fail -> continue to next item
        }
    }
}

// ... (routes)




/**
 * GET /api/research-jobs/:id
 * Get research job status and progress
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: {
        client: {
          include: {
                clientAccounts: {
                  include: {
                    clientPosts: {
                      include: {
                        mediaAssets: {
                          include: {
                            aiAnalyses: true,
                          },
                        },
                        aiAnalyses: true,
                      },
                      orderBy: { postedAt: 'desc' },
                    },
              },
            },
            brandMentions: {
              include: {
                aiAnalyses: true,
              },
            },
            clientDocuments: true,
            personas: true,
            brainProfile: {
              include: {
                goals: true,
              },
            },
          },
        },
        discoveredCompetitors: {
          include: {
            competitor: true,
          },
        },
        searchTrends: true,
        communityInsights: true,
        socialTrends: true,
        aiQuestions: true,
        rawSearchResults: {
          take: 50
        },
        ddgImageResults: {
          take: 30
        },
        ddgVideoResults: {
          take: 20
        },
        ddgNewsResults: {
          take: 20
        },
        socialProfiles: {
          include: {
            posts: {
              take: 30, // Increased to show full batch
              orderBy: { postedAt: 'desc' }, // Show recent scrapes first
              include: {
                mediaAssets: {
                  include: {
                    aiAnalyses: true,
                  },
                },
              }
            }
          }
        },
        brainCommands: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }

    // CONTINUITY FIX: Fetch aggregated data from ALL jobs for this client
    // This allows "stacking" of research results over time
    const clientJobIds = (await prisma.researchJob.findMany({
        where: { clientId: job.clientId },
        select: { id: true }
    })).map(j => j.id);

    const aggregatedCompetitorsRaw = await prisma.discoveredCompetitor.findMany({
        where: { researchJobId: { in: clientJobIds } },
        include: { competitor: true },
        orderBy: { discoveredAt: 'desc' }
    });

    const selectionPriority: Record<string, number> = {
        APPROVED: 5,
        TOP_PICK: 4,
        SHORTLISTED: 3,
        FILTERED_OUT: 2,
        REJECTED: 1,
    };
    const statusPriority: Record<string, number> = {
        CONFIRMED: 6,
        SCRAPED: 5,
        SCRAPING: 4,
        SUGGESTED: 3,
        FAILED: 2,
        REJECTED: 1,
    };

    const mergedCompetitorsByKey = new Map<string, (typeof aggregatedCompetitorsRaw)[number]>();
    for (const competitor of aggregatedCompetitorsRaw) {
        const key = `${competitor.platform}:${competitor.handle}`.toLowerCase();
        const existing = mergedCompetitorsByKey.get(key);
        if (!existing) {
            mergedCompetitorsByKey.set(key, competitor);
            continue;
        }

        const existingSelection = selectionPriority[String(existing.selectionState || '')] || 0;
        const incomingSelection = selectionPriority[String(competitor.selectionState || '')] || 0;
        const existingStatus = statusPriority[String(existing.status || '')] || 0;
        const incomingStatus = statusPriority[String(competitor.status || '')] || 0;
        const existingScore = Number(existing.relevanceScore || 0);
        const incomingScore = Number(competitor.relevanceScore || 0);
        const existingDiscoveredAt = new Date(existing.discoveredAt || 0).getTime();
        const incomingDiscoveredAt = new Date(competitor.discoveredAt || 0).getTime();

        // Single source of truth: the most recent orchestration state wins for each platform+handle.
        // This prevents stale "SHORTLISTED" rows from older runs overriding newer "FILTERED_OUT" decisions.
        const shouldReplace =
            incomingDiscoveredAt > existingDiscoveredAt ||
            (incomingDiscoveredAt === existingDiscoveredAt && incomingSelection > existingSelection) ||
            (incomingDiscoveredAt === existingDiscoveredAt &&
                incomingSelection === existingSelection &&
                incomingStatus > existingStatus) ||
            (incomingDiscoveredAt === existingDiscoveredAt &&
                incomingSelection === existingSelection &&
                incomingStatus === existingStatus &&
                incomingScore > existingScore);

        if (shouldReplace) {
            mergedCompetitorsByKey.set(key, competitor);
        }
    }

    const mergedCompetitors = Array.from(mergedCompetitorsByKey.values());
    const filteredCap = Math.max(
        10,
        Math.min(40, Number(process.env.RESEARCH_COMPETITOR_FILTERED_CAP || 20))
    );
    const prioritizedCompetitors = mergedCompetitors
        .sort((a, b) => {
            const selectionA = selectionPriority[String(a.selectionState || '')] || 0;
            const selectionB = selectionPriority[String(b.selectionState || '')] || 0;
            if (selectionB !== selectionA) return selectionB - selectionA;

            const statusA = statusPriority[String(a.status || '')] || 0;
            const statusB = statusPriority[String(b.status || '')] || 0;
            if (statusB !== statusA) return statusB - statusA;

            const scoreA = Number(a.relevanceScore || 0);
            const scoreB = Number(b.relevanceScore || 0);
            if (scoreB !== scoreA) return scoreB - scoreA;

            return new Date(b.discoveredAt || 0).getTime() - new Date(a.discoveredAt || 0).getTime();
        });

    const activeCompetitors = prioritizedCompetitors.filter((item) => {
        const state = String(item.selectionState || '').toUpperCase();
        return state !== 'FILTERED_OUT' && state !== 'REJECTED';
    });
    const filteredCompetitors = prioritizedCompetitors
        .filter((item) => {
            const state = String(item.selectionState || '').toUpperCase();
            return state === 'FILTERED_OUT' || state === 'REJECTED';
        })
        .slice(0, filteredCap);

    const aggregatedCompetitors = [...activeCompetitors, ...filteredCompetitors];

    const aggregatedTrends = await prisma.searchTrend.findMany({
        where: { researchJobId: { in: clientJobIds } },
        orderBy: { createdAt: 'desc' }
    });

    const aggregatedInsights = await prisma.communityInsight.findMany({
        where: { researchJobId: { in: clientJobIds } },
        orderBy: { createdAt: 'desc' }
    });

    const aggregatedQuestions = await prisma.aiQuestion.findMany({
        where: { researchJobId: { in: clientJobIds } },
        orderBy: { createdAt: 'desc' }
    });

    const aggregatedSocialTrends = await prisma.socialTrend.findMany({
        where: { researchJobId: { in: clientJobIds } },
        orderBy: { firstSeenAt: 'desc' }
    });

    const clientProfileSnapshots = await prisma.clientProfileSnapshot.findMany({
        where: { researchJobId: { in: clientJobIds } },
        include: {
          posts: {
            include: {
              mediaAssets: {
                include: {
                  aiAnalyses: true,
                },
              },
            },
          },
          clientProfile: true,
        },
        orderBy: { scrapedAt: 'desc' }
    });

    const competitorProfileSnapshots = await prisma.competitorProfileSnapshot.findMany({
        where: { researchJobId: { in: clientJobIds } },
        include: {
          posts: {
            include: {
              mediaAssets: {
                include: {
                  aiAnalyses: true,
                },
              },
            },
          },
          competitorProfile: true,
        },
        orderBy: { scrapedAt: 'desc' }
    });

    // Aggregated raw results (deduplicated by href effectively via latest)
    const aggregatedRawResults = await prisma.rawSearchResult.findMany({
        where: { researchJobId: { in: clientJobIds } },
        orderBy: { createdAt: 'desc' },
        take: 100
    });

    const latestRun = await prisma.competitorOrchestrationRun.findFirst({
      where: { researchJobId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const latestMediaAnalysisRun = await getLatestMediaAnalysisRunSummary(id);

    const [topPicks, shortlisted, approved, filtered] = await Promise.all([
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'TOP_PICK' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'SHORTLISTED' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'APPROVED' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'FILTERED_OUT' } }),
    ]);
    
    // Transform socialProfiles posts to match frontend expectations
    // Database uses: likesCount, commentsCount, followers, following, etc.
    // Frontend expects: likes, comments, followerCount, followingCount, etc.
    const pathToUrl = (p?: string | null) => {
        if (!p) return undefined;
        if (p.startsWith('http://') || p.startsWith('https://')) return p;
        return fileManager.toUrl(p);
    };

    const normalizeAiResponse = (value: unknown): Record<string, unknown> | null => {
      if (!value) return null;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value };
        } catch {
          return { value };
        }
      }
      if (typeof value === 'object') return value as Record<string, unknown>;
      return { value: String(value) };
    };

    const hydrateMediaAsset = (mediaAsset: any) => {
      const analyses = Array.isArray(mediaAsset?.aiAnalyses) ? mediaAsset.aiAnalyses : [];
      const latestByType = (analysisType: string) =>
        analyses
          .filter((row: any) => String(row?.analysisType || '').toUpperCase() === analysisType)
          .sort(
            (a: any, b: any) =>
              new Date(b?.analyzedAt || 0).getTime() - new Date(a?.analyzedAt || 0).getTime()
          )[0];
      const visual = latestByType('VISUAL');
      const transcript = latestByType('AUDIO');
      const overall = latestByType('OVERALL');
      const { aiAnalyses, ...rest } = mediaAsset || {};
      return {
        ...rest,
        url: pathToUrl(mediaAsset?.blobStoragePath),
        thumbnailUrl:
          pathToUrl(mediaAsset?.thumbnailPath) ||
          pathToUrl(mediaAsset?.blobStoragePath) ||
          mediaAsset?.originalUrl,
        analysisVisual: normalizeAiResponse(visual?.fullResponse),
        analysisTranscript: normalizeAiResponse(transcript?.fullResponse),
        analysisOverall: normalizeAiResponse(overall?.fullResponse),
      };
    };

    const clientAccounts = job.client?.clientAccounts || [];
    // Use URL-aware normalize so "https://www.instagram.com/ummahpreneur" matches account "ummahpreneur"
    const normalizeHandle = (h: string) => normalizeHandleFromUrl(h) || String(h ?? '').replace(/^@+/, '').trim().toLowerCase();

    const transformedSocialProfiles = job.socialProfiles?.map((profile: any) => {
        const followers = profile.followers ?? 0;
        const following = profile.following ?? 0;
        const acc = clientAccounts.find(
            (a: any) =>
                a.platform === profile.platform &&
                normalizeHandle(a.handle) === normalizeHandle(profile.handle)
        );
        let followerCount = followers;
        let followingCount = following;
        let bio = profile.bio;
        if (acc) {
            if ((followers == null || followers === 0) && acc.followerCount != null && acc.followerCount > 0) {
                followerCount = acc.followerCount;
            }
            if ((following == null || following === 0) && acc.followingCount != null) {
                followingCount = acc.followingCount;
            }
            if ((!bio || String(bio).trim() === '') && acc.bio) {
                bio = acc.bio;
            }
        }
        const displayHandle = normalizeHandle(profile.handle) || profile.handle;
        return {
            ...profile,
            handle: displayHandle,
            followerCount: followerCount ?? 0,
            followingCount: followingCount ?? 0,
            followers: followerCount ?? 0,
            following: followingCount ?? 0,
            bio: bio ?? profile.bio,
            posts: profile.posts?.map((post: any) => {
                const mediaAssets = (post.mediaAssets || []).map((m: any) => hydrateMediaAsset(m));
                const firstMediaThumb = mediaAssets[0]?.thumbnailUrl;
                return {
                    ...post,
                    likes: post.likesCount ?? 0,
                    comments: post.commentsCount ?? 0,
                    shares: post.sharesCount ?? 0,
                    views: post.viewsCount ?? 0,
                    plays: post.playsCount ?? 0,
                    id: post.id,
                    caption: post.caption || '',
                    postUrl: post.url,
                    url: post.url,
                    postedAt: post.postedAt,
                    thumbnailUrl: pathToUrl(post.thumbnailUrl) || firstMediaThumb,
                    mediaAssets,
                };
            }) || [],
        };
    }) || [];

    // Ensure every client target (inputData.handles + clientAccounts) has a profile so none "disappear"
    const clientTargets: Array<{ platform: string; handle: string }> = [];
    const inputHandles = ((job.inputData as any)?.handles || {}) as Record<string, string>;
    for (const [platform, handle] of Object.entries(inputHandles)) {
        const p = String(platform).toLowerCase();
        if ((p !== 'instagram' && p !== 'tiktok') || !handle || typeof handle !== 'string') continue;
        const h = normalizeHandle(handle);
        if (h) clientTargets.push({ platform: p, handle: h });
    }
    for (const acc of clientAccounts) {
        const p = String(acc.platform || '').toLowerCase();
        if ((p !== 'instagram' && p !== 'tiktok') || !acc.handle) continue;
        const h = normalizeHandle(acc.handle);
        if (h) clientTargets.push({ platform: p, handle: h });
    }
    // Legacy fallback: primary handle + platform (matches research-continuity collectClientTargets)
    const inputData = (job.inputData || {}) as any;
    if (inputData.handle && inputData.platform) {
        const p = String(inputData.platform).toLowerCase();
        if ((p === 'instagram' || p === 'tiktok') && typeof inputData.handle === 'string') {
            const h = normalizeHandle(inputData.handle);
            if (h) clientTargets.push({ platform: p, handle: h });
        }
    }
    const seenKey = (p: string, h: string) => `${p}:${h}`;
    const targetKeys = new Set<string>();
    const dedupedTargets = clientTargets.filter((t) => {
        const k = seenKey(t.platform, t.handle);
        if (targetKeys.has(k)) return false;
        targetKeys.add(k);
        return true;
    });
    // Infer other platform from same handle so both Instagram and TikTok show when user has one handle
    const targetsWithBoth: Array<{ platform: string; handle: string }> = [];
    for (const t of dedupedTargets) {
        targetsWithBoth.push(t);
        const other = t.platform === 'instagram' ? 'tiktok' : 'instagram';
        if (t.platform === 'tiktok' || t.platform === 'instagram') {
            const kOther = seenKey(other, t.handle);
            if (!targetKeys.has(kOther)) {
                targetKeys.add(kOther);
                targetsWithBoth.push({ platform: other, handle: t.handle });
            }
        }
    }
    const existingKeys = new Set(
        transformedSocialProfiles.map((p: any) => seenKey(p.platform, normalizeHandle(p.handle)))
    );
    for (const target of targetsWithBoth) {
        if (existingKeys.has(seenKey(target.platform, target.handle))) continue;
        const acc = clientAccounts.find(
            (a: any) => a.platform === target.platform && normalizeHandle(a.handle) === target.handle
        );
        transformedSocialProfiles.push({
            id: `placeholder-${target.platform}-${target.handle}`,
            researchJobId: job.id,
            platform: target.platform,
            handle: target.handle,
            url: null,
            followers: acc?.followerCount ?? 0,
            following: acc?.followingCount ?? 0,
            followerCount: acc?.followerCount ?? 0,
            followingCount: acc?.followingCount ?? 0,
            bio: acc?.bio ?? null,
            posts: [],
        });
    }

    // Merge aggregated data into the job response object
    // This makes the frontend show ALL historical data for this client
    const transformSnapshotPosts = (posts: any[]) => posts.map(p => {
        const mediaAssets = (p.mediaAssets || []).map((m: any) => hydrateMediaAsset(m));
        return { ...p, mediaAssets };
    });

    // Sync inputData to BrainProfile when profile is missing or empty (same logic as GET /brain)
    let jobBrainProfile = job.client?.brainProfile ?? null;
    if (job.client && isBrainProfileEmpty(jobBrainProfile)) {
      let inputData = (job.inputData || {}) as Record<string, unknown>;
      if (Object.keys(inputData).length < 3) {
        const otherJobs = await prisma.researchJob.findMany({
          where: { clientId: job.client.id, id: { not: id } },
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: { inputData: true },
        });
        for (const j of otherJobs) {
          const od = (j.inputData || {}) as Record<string, unknown>;
          if (od && typeof od === 'object' && Object.keys(od).length > Object.keys(inputData).length) {
            inputData = od;
            break;
          }
        }
      }
      const clientFallbacks = {
        businessOverview: job.client.businessOverview ?? undefined,
        goalsKpis: job.client.goalsKpis ?? undefined,
        clientAccounts: (job.client.clientAccounts || []).map((a: { platform: string; handle: string }) => ({ platform: a.platform, handle: a.handle })),
      };
      const synced = await syncInputDataToBrainProfile(job.client.id, inputData, clientFallbacks);
      if (synced) {
        jobBrainProfile = await prisma.brainProfile.findUnique({
          where: { clientId: job.client.id },
          include: { goals: true },
        });
      } else if (!jobBrainProfile) {
        jobBrainProfile = await prisma.brainProfile.create({
          data: { clientId: job.client.id },
          include: { goals: true },
        });
      }
    }

    const responseJob = {
        ...job,
        discoveredCompetitors: aggregatedCompetitors,
        searchTrends: aggregatedTrends,
        socialTrends: aggregatedSocialTrends,
        communityInsights: aggregatedInsights,
        aiQuestions: aggregatedQuestions,
        rawSearchResults: aggregatedRawResults,
        clientProfileSnapshots: clientProfileSnapshots.map(s => ({
          ...s,
          posts: transformSnapshotPosts(s.posts || [])
        })),
        competitorProfileSnapshots: competitorProfileSnapshots.map(s => ({
          ...s,
          posts: transformSnapshotPosts(s.posts || [])
        })),
        socialProfiles: transformedSocialProfiles, // Use transformed profiles
        brainProfile: jobBrainProfile ?? job.client?.brainProfile ?? null,
        brainCommands: job.brainCommands || [],
        competitorSummary: {
          runId: latestRun?.id || null,
          topPicks,
          shortlisted,
          approved,
          filtered,
        },
        continuity: {
          enabled: Boolean(job.continuityEnabled),
          intervalHours: Math.max(2, Number(job.continuityIntervalHours || 2)),
          running: Boolean(job.continuityRunning),
          lastRunAt: job.continuityLastRunAt || null,
          nextRunAt: job.continuityNextRunAt || null,
          errorMessage: job.continuityErrorMessage || null,
        },
        analysisScope: latestMediaAnalysisRun,
    };

    res.json(responseJob);
  } catch (error: any) {
    console.error('[API] Error fetching research job:', error);
    res.status(500).json({ error: 'Failed to fetch research job', details: error.message });
  }
});

/**
 * POST /api/research-jobs/:id/analyze-media
 * Run OpenAI content analysis (vision + Whisper/transcript) on downloaded media for this job.
 */
router.post('/:id/analyze-media', async (req: Request, res: Response) => {
  try {
    const { id: jobId } = req.params;
    const skipAlreadyAnalyzed = req.body?.skipAlreadyAnalyzed !== false;
    const allowDegraded = req.body?.allowDegraded === true;
    const limit = Math.max(1, Math.min(200, Number(req.body?.limit || 200)));
    const maxEligibleAssets = req.body?.maxEligibleAssets
      ? Math.max(20, Math.min(240, Number(req.body.maxEligibleAssets)))
      : undefined;
    const maxEligiblePosts = req.body?.maxEligiblePosts
      ? Math.max(30, Math.min(300, Number(req.body.maxEligiblePosts)))
      : undefined;

    if (!isUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }
    if (!isOpenAiConfiguredForRealMode()) {
      return res.status(400).json({
        error: 'OpenAI not configured',
        message: 'OPENAI_API_KEY is required to run media analysis.',
      });
    }
    const result = await runAiAnalysisForJob(jobId, {
      allowDegraded,
      skipAlreadyAnalyzed,
      limit,
      maxEligibleAssets,
      maxEligiblePosts,
    });

    res.json({
      success: true,
      runId: result.runId,
      requested: result.ran,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      reason: result.reason,
      analysisScope: result.analysisScope,
      errors: result.errors?.length ? result.errors : undefined,
    });
  } catch (error: any) {
    console.error('[API] analyze-media error:', error);
    res.status(500).json({
      error: 'Analyze media failed',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/research-jobs/:id/download-media
 * Force-queue all missing media downloads for this job, bypassing the 1-hour throttle.
 * Useful to manually re-trigger downloads after Railway restarts wipe the local storage.
 */
router.post('/:id/download-media', async (req: Request, res: Response) => {
  try {
    const { id: jobId } = req.params;
    if (!isUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }
    const result = await forceQueueAllMediaDownloads(jobId);
    return res.json({
      success: true,
      queued: result.queued,
      snapshotsClient: result.snapshotsClient,
      snapshotsCompetitor: result.snapshotsCompetitor,
      socialProfiles: result.socialProfiles,
      message: result.queued > 0
        ? `Queued ${result.queued} download tasks (${result.snapshotsClient} client, ${result.snapshotsCompetitor} competitor, ${result.socialProfiles} social profiles)`
        : 'No missing media found - all assets appear to be downloaded',
    });
  } catch (error: any) {
    console.error('[API] download-media error:', error);
    return res.status(500).json({ error: 'Download trigger failed', message: error.message || 'Unknown error' });
  }
});

/**
 * POST /api/research-jobs/:id/repair-media
 * Find ghost assets (isDownloaded=true but file missing from local disk / R2 not configured)
 * and reset them so they can be re-downloaded on the next queue cycle.
 */
router.post('/:id/repair-media', async (req: Request, res: Response) => {
  try {
    const { id: jobId } = req.params;
    if (!isUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }

    // Collect all MediaAssets for this job's social profiles and snapshots.
    // We look for assets where: isDownloaded=true BUT blobStoragePath is a local absolute path
    // and the file no longer exists on disk (ephemeral Railway filesystem wiped it).
    const r2Active = process.env.USE_R2_STORAGE === 'true';
    let ghostsRepaired = 0;

    if (!r2Active) {
      // Find all media assets linked to this job, where blobStoragePath is an absolute path
      const allAssets = await prisma.mediaAsset.findMany({
        where: {
          isDownloaded: true,
          blobStoragePath: { not: null },
          OR: [
            { socialPost: { socialProfile: { researchJobId: jobId } } },
            { clientPostSnapshot: { clientProfileSnapshot: { researchJobId: jobId } } },
            { competitorPostSnapshot: { competitorProfileSnapshot: { researchJobId: jobId } } },
            { clientPost: { clientAccount: { client: { researchJobs: { some: { id: jobId } } } } } },
          ],
        },
        select: { id: true, blobStoragePath: true },
      });

      const ghostIds: string[] = [];
      for (const asset of allAssets) {
        const p = asset.blobStoragePath || '';
        // A ghost is: absolute path that no longer exists on disk
        const isLocalAbsolute = p.startsWith('/');
        if (isLocalAbsolute) {
          const exists = require('fs').existsSync(p);
          if (!exists) ghostIds.push(asset.id);
        }
        // R2 keys (no leading slash, no http) stored when R2 was active but is now disabled
        const isOrphanedR2Key = !p.startsWith('/') && !p.startsWith('http') && p.length > 0;
        if (isOrphanedR2Key) ghostIds.push(asset.id);
      }

      if (ghostIds.length > 0) {
        await prisma.mediaAsset.updateMany({
          where: { id: { in: ghostIds } },
          data: {
            isDownloaded: false,
            downloadError: 'repaired_ghost_asset',
          },
        });
        ghostsRepaired = ghostIds.length;
        console.log(`[RepairMedia] Marked ${ghostsRepaired} ghost assets for re-download (job: ${jobId})`);
      }
    }

    // Now force-queue downloads for everything missing
    const downloadResult = await forceQueueAllMediaDownloads(jobId);

    return res.json({
      success: true,
      ghostsRepaired,
      queued: downloadResult.queued,
      message: `Repaired ${ghostsRepaired} ghost assets, queued ${downloadResult.queued} downloads`,
    });
  } catch (error: any) {
    console.error('[API] repair-media error:', error);
    return res.status(500).json({ error: 'Media repair failed', message: error.message || 'Unknown error' });
  }
});


type ResearchModuleName =
  | 'competitors'
  | 'trends'
  | 'community'
  | 'ai-questions'
  | 'social-profiles'
  | 'raw-search'
  | 'events'
  | 'snapshots';

const SUPPORTED_MODULES = new Set<ResearchModuleName>([
  'competitors',
  'trends',
  'community',
  'ai-questions',
  'social-profiles',
  'raw-search',
  'events',
  'snapshots',
]);

function parsePagination(req: Request): { limit: number; cursor?: string } {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 25;
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim().length > 0
    ? req.query.cursor.trim()
    : undefined;
  return { limit, cursor };
}

const MUTABLE_BRAIN_PROFILE_FIELDS = new Set([
  'businessType',
  'offerModel',
  'primaryGoal',
  'targetMarket',
  'geoScope',
  'websiteDomain',
  'secondaryGoals',
  'channels',
  'constraints',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toStringList(value: unknown, max = 12): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, max);
  }
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeChannelsFromSuggestion(value: unknown): Array<{ platform: string; handle: string }> {
  const out: Array<{ platform: string; handle: string }> = [];
  const seen = new Set<string>();

  const push = (platformRaw: unknown, handleRaw: unknown) => {
    const platform = String(platformRaw || '').trim().toLowerCase();
    const handle = String(handleRaw || '').trim().replace(/^@+/, '').toLowerCase();
    if (!platform || !handle) return;
    const key = `${platform}:${handle}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ platform, handle });
  };

  if (Array.isArray(value)) {
    for (const row of value) {
      if (row && typeof row === 'object') {
        push((row as Record<string, unknown>).platform, (row as Record<string, unknown>).handle);
      } else if (typeof row === 'string') {
        const pair = row.match(
          /^(instagram|tiktok|youtube|linkedin|facebook|x|twitter)\s*[:=\-]?\s*@?([a-z0-9._-]{1,80})$/i
        );
        if (pair) push(pair[1] === 'twitter' ? 'x' : pair[1], pair[2]);
      }
    }
    return out;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return out;
  for (const token of raw.split(/[\n,]+/)) {
    const pair = token
      .trim()
      .match(/^(instagram|tiktok|youtube|linkedin|facebook|x|twitter)\s*[:=\-]?\s*@?([a-z0-9._-]{1,80})$/i);
    if (pair) push(pair[1] === 'twitter' ? 'x' : pair[1], pair[2]);
  }
  return out;
}

function buildSuggestionProfileUpdate(
  profile: { constraints?: unknown },
  field: string,
  value: unknown
): Record<string, unknown> {
  if (!MUTABLE_BRAIN_PROFILE_FIELDS.has(field)) {
    throw new Error(`Unsupported brain profile field: ${field}`);
  }

  if (field === 'secondaryGoals') {
    return { secondaryGoals: toStringList(value, 12) };
  }

  if (field === 'channels') {
    return { channels: normalizeChannelsFromSuggestion(value) };
  }

  if (field === 'constraints') {
    const existing = asRecord(profile.constraints) || {};
    const incoming = asRecord(value);
    return { constraints: incoming ? { ...existing, ...incoming } : existing };
  }

  const textValue =
    typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim();
  return { [field]: textValue || null };
}

function extractGoalSyncValues(profile: { primaryGoal?: string | null; secondaryGoals?: unknown }): {
  primaryGoal: string | null;
  secondaryGoals: string[];
} {
  return {
    primaryGoal: profile.primaryGoal ? String(profile.primaryGoal).trim() || null : null,
    secondaryGoals: toStringList(profile.secondaryGoals, 12),
  };
}

function inferBrainCommandType(instruction: string): any {
  const text = instruction.toLowerCase();
  if (/(remove|delete).*(competitor)/i.test(text)) return 'REMOVE_COMPETITOR';
  if (/(add|insert|include).*(competitor)/i.test(text)) return 'ADD_COMPETITOR';
  if (
    /(update|edit|change).*(context|profile|business|target market|target audience|audience|website|domain|geo scope|channel|constraint)/i.test(
      text
    )
  ) {
    return 'UPDATE_CONTEXT';
  }
  if (/\b(goal|kpi|objective|north star)\b/i.test(text)) return 'UPDATE_GOAL';
  if (/\btarget\b(?!\s*(market|audience|persona|geo|location))/i.test(text)) return 'UPDATE_GOAL';
  if (/(run|execute|refresh).*(section|module)/i.test(text)) return 'RUN_SECTION';
  return 'UPDATE_SECTION_DATA';
}

function buildCommandPatch(instruction: string): Record<string, unknown> {
  const text = instruction.trim();
  const handleMatch = text.match(/@([a-zA-Z0-9._]+)/);
  const platformMatch = text.match(/\b(instagram|tiktok|youtube|linkedin|x|facebook|website)\b/i);
  return {
    instruction: text,
    handle: handleMatch ? handleMatch[1].toLowerCase() : null,
    platform: platformMatch ? platformMatch[1].toLowerCase() : 'instagram',
    createdAt: new Date().toISOString(),
  };
}

async function generateBrainCommandReply(instruction: string, commandType: string): Promise<string | null> {
  const openai = getOpenAiClient();
  if (!BRAIN_COMMAND_REPLY_ENABLED || !openai) return null;
  try {
    const response = await openai.chat.completions.create({
      model: resolveModelForTask('brain_command'),
      messages: [
        {
          role: 'system',
          content:
            'You are BAT Brain. Reply in one or two short, friendly sentences to the user. Acknowledge what they asked and what you will do (e.g. add a competitor, run a section, update context). Be concise.',
        },
        {
          role: 'user',
          content: `User instruction: "${instruction}" (command type: ${commandType}). Reply briefly.`,
        },
      ],
      max_tokens: 120,
      temperature: 0.4,
    });
    const text = response.choices[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/research-jobs/:id/overview
 * Lightweight overview payload to avoid heavy page bootstrap responses.
 */
router.get('/:id/overview', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: {
        client: {
          include: {
            clientAccounts: true,
            brainProfile: {
              include: { goals: true },
            },
          },
        },
      },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    const [topPicks, shortlisted, filtered, scraped, failed] = await Promise.all([
      prisma.discoveredCompetitor.count({ where: { researchJobId: id, selectionState: 'TOP_PICK' } }),
      prisma.discoveredCompetitor.count({ where: { researchJobId: id, selectionState: 'SHORTLISTED' } }),
      prisma.discoveredCompetitor.count({ where: { researchJobId: id, selectionState: 'FILTERED_OUT' } }),
      prisma.discoveredCompetitor.count({ where: { researchJobId: id, status: 'SCRAPED' } }),
      prisma.discoveredCompetitor.count({ where: { researchJobId: id, status: 'FAILED' } }),
    ]);

    return res.json({
      success: true,
      id: job.id,
      status: job.status,
      continuity: {
        enabled: job.continuityEnabled,
        intervalHours: job.continuityIntervalHours,
        running: job.continuityRunning,
        lastRunAt: job.continuityLastRunAt,
        nextRunAt: job.continuityNextRunAt,
      },
      client: {
        id: job.client.id,
        name: job.client.name,
        accounts: job.client.clientAccounts.map((account) => ({
          id: account.id,
          platform: account.platform,
          handle: account.handle,
          profileUrl: account.profileUrl,
        })),
        brainProfile: job.client.brainProfile,
      },
      metrics: {
        topPicks,
        shortlisted,
        filtered,
        scraped,
        failed,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching research overview:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to fetch overview' });
  }
});

/**
 * GET /api/research-jobs/:id/modules/:module
 * Paginated module payloads for heavy research sections.
 */
router.get('/:id/modules/:module', async (req: Request, res: Response) => {
  try {
    const { id, module } = req.params;
    if (!SUPPORTED_MODULES.has(module as ResearchModuleName)) {
      return res.status(400).json({ success: false, error: 'Unsupported module' });
    }

    const { limit, cursor } = parsePagination(req);
    const moduleName = module as ResearchModuleName;

    if (moduleName === 'competitors') {
      const items = await prisma.discoveredCompetitor.findMany({
        where: { researchJobId: id },
        include: { competitor: true, candidateProfile: true },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ discoveredAt: 'desc' }, { id: 'desc' }],
      });
      return res.json({ success: true, module: moduleName, items, nextCursor: items.at(-1)?.id || null });
    }

    if (moduleName === 'trends') {
      const items = await prisma.searchTrend.findMany({
        where: { researchJobId: id },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return res.json({ success: true, module: moduleName, items, nextCursor: items.at(-1)?.id || null });
    }

    if (moduleName === 'community') {
      const items = await prisma.communityInsight.findMany({
        where: { researchJobId: id },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return res.json({ success: true, module: moduleName, items, nextCursor: items.at(-1)?.id || null });
    }

    if (moduleName === 'ai-questions') {
      const items = await prisma.aiQuestion.findMany({
        where: { researchJobId: id },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return res.json({ success: true, module: moduleName, items, nextCursor: items.at(-1)?.id || null });
    }

    if (moduleName === 'social-profiles') {
      const items = await prisma.socialProfile.findMany({
        where: { researchJobId: id },
        include: {
          posts: {
            take: 20,
            orderBy: { postedAt: 'desc' },
            include: { mediaAssets: true },
          },
        },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      });
      return res.json({ success: true, module: moduleName, items, nextCursor: items.at(-1)?.id || null });
    }

    if (moduleName === 'raw-search') {
      const items = await prisma.rawSearchResult.findMany({
        where: { researchJobId: id },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return res.json({ success: true, module: moduleName, items, nextCursor: items.at(-1)?.id || null });
    }

    if (moduleName === 'events') {
      const afterId = cursor ? Number.parseInt(cursor, 10) : undefined;
      const events = await listResearchJobEvents(id, {
        afterId: Number.isFinite(afterId as number) ? (afterId as number) : undefined,
        limit,
      });
      return res.json({
        success: true,
        module: moduleName,
        items: events,
        nextCursor: events.length ? String(events[events.length - 1].id) : null,
      });
    }

    const snapshots = await prisma.competitorProfileSnapshot.findMany({
      where: { researchJobId: id },
      include: {
        competitorProfile: true,
        posts: { include: { mediaAssets: true }, orderBy: { postedAt: 'desc' }, take: 20 },
      },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ scrapedAt: 'desc' }, { id: 'desc' }],
    });
    return res.json({
      success: true,
      module: moduleName,
      items: snapshots,
      nextCursor: snapshots.at(-1)?.id || null,
    });
  } catch (error: any) {
    console.error('[API] Error fetching research module:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to fetch module data' });
  }
});

/**
 * GET /api/research-jobs/:id/debug-brain
 * Diagnostic: return raw inputData, brainProfile, client fallbacks, and sync readiness.
 */
router.get('/:id/debug-brain', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: {
        client: {
          include: {
            brainProfile: { include: { goals: true } },
            clientAccounts: true,
          },
        },
      },
    });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }
    const inputData = (job.inputData || {}) as Record<string, unknown>;
    const clientFallbacks = job.client
      ? {
          businessOverview: job.client.businessOverview ?? null,
          goalsKpis: job.client.goalsKpis ?? null,
          clientAccounts: (job.client.clientAccounts || []).map((a: { platform: string; handle: string }) => ({
            platform: a.platform,
            handle: a.handle,
          })),
        }
      : null;
    const merged = { ...inputData } as Record<string, unknown>;
    if (clientFallbacks) {
      if (!merged.primaryGoal && clientFallbacks.goalsKpis) merged.primaryGoal = clientFallbacks.goalsKpis;
      if (!merged.description && !merged.businessOverview && clientFallbacks.businessOverview) {
        merged.description = clientFallbacks.businessOverview;
        merged.businessOverview = clientFallbacks.businessOverview;
      }
      if ((!merged.channels || (Array.isArray(merged.channels) && merged.channels.length === 0)) && clientFallbacks.clientAccounts?.length) {
        merged.channels = clientFallbacks.clientAccounts;
      }
    }
    return res.json({
      success: true,
      researchJobId: id,
      inputData,
      brainProfile: job.client?.brainProfile ?? null,
      clientFallbacks,
      syncWouldRun: hasMeaningfulInputData(merged),
      keysFound: getInputDataKeysFound(merged),
      inputDataKeys: Object.keys(inputData),
    });
  } catch (error: any) {
    console.error('[API] debug-brain error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'debug-brain failed' });
  }
});

/**
 * GET /api/research-jobs/:id/brain
 * Fetch editable brain context for a research job.
 */
router.get('/:id/brain', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const forceResync = req.query.resync === '1' || req.query.resync === 'true';
    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: {
        client: {
          include: {
            brainProfile: { include: { goals: true } },
            clientAccounts: true,
          },
        },
        brainCommands: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    // Sync inputData to BrainProfile when profile is missing or empty (e.g. client created via import)
    // ?resync=1 forces sync from inputData + client fallbacks even when profile exists
    let brainProfile = job.client?.brainProfile;
    if (job.client && (forceResync || isBrainProfileEmpty(brainProfile))) {
      let inputData = (job.inputData || {}) as Record<string, unknown>;
      // If current job's inputData is empty, try other jobs for this client (data may be in a different job)
      if (Object.keys(inputData).length < 3) {
        const otherJobs = await prisma.researchJob.findMany({
          where: { clientId: job.client.id, id: { not: id } },
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: { inputData: true },
        });
        for (const j of otherJobs) {
          const od = (j.inputData || {}) as Record<string, unknown>;
          if (od && typeof od === 'object' && Object.keys(od).length > Object.keys(inputData).length) {
            inputData = od;
            break;
          }
        }
      }
      const clientFallbacks = {
        businessOverview: job.client.businessOverview ?? undefined,
        goalsKpis: job.client.goalsKpis ?? undefined,
        clientAccounts: (job.client.clientAccounts || []).map((a: { platform: string; handle: string }) => ({ platform: a.platform, handle: a.handle })),
      };
      const synced = await syncInputDataToBrainProfile(job.client.id, inputData, clientFallbacks);
      if (synced) {
        brainProfile = await prisma.brainProfile.findUnique({
          where: { clientId: job.client.id },
          include: { goals: true },
        });
      } else if (!brainProfile) {
        brainProfile = await prisma.brainProfile.create({
          data: { clientId: job.client.id },
          include: { goals: true },
        });
      }
    }

    const latestRun = await prisma.competitorOrchestrationRun.findFirst({
      where: { researchJobId: id },
      orderBy: { createdAt: 'desc' },
    });

    const [topPicks, shortlisted, approved, filtered, suggestions] = await Promise.all([
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'TOP_PICK' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'SHORTLISTED' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'APPROVED' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'FILTERED_OUT' } }),
      job.client?.id
        ? prisma.brainProfileSuggestion.findMany({
            where: {
              clientId: job.client.id,
              status: { in: ['PENDING', 'APPROVED'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          })
        : [],
    ]);

    return res.json({
      success: true,
      researchJobId: id,
      client: {
        id: job.client.id,
        name: job.client.name,
        accounts: job.client.clientAccounts,
      },
      brainProfile: brainProfile ?? job.client?.brainProfile,
      commandHistory: job.brainCommands,
      suggestions: (suggestions || []).map((suggestion: any) => ({
        ...suggestion,
        source: suggestion.source || 'bat',
      })),
      competitorSummary: {
        runId: latestRun?.id || null,
        topPicks,
        shortlisted,
        approved,
        filtered,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching brain context:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to fetch brain context' });
  }
});

/**
 * POST /api/research-jobs/:id/brain/commands
 * Create a section-scoped brain command (dry run by default).
 */
router.post('/:id/brain/commands', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const section = String(req.body?.section || '').trim();
    const instruction = String(req.body?.instruction || '').trim();
    const dryRun = req.body?.dryRun !== false;
    const createdBy = String(req.body?.createdBy || 'user').trim();

    if (!section || !instruction) {
      return res.status(400).json({ success: false, error: 'section and instruction are required' });
    }

    const job = await prisma.researchJob.findUnique({ where: { id }, select: { id: true } });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    const commandType = inferBrainCommandType(instruction);
    const proposedPatch = buildCommandPatch(instruction);
    const requiresApproval =
      commandType === 'REMOVE_COMPETITOR' || commandType === 'UPDATE_SECTION_DATA' || commandType === 'UPDATE_CONTEXT';
    const generatedReply = await generateBrainCommandReply(instruction, commandType);

    const command = await prisma.brainCommand.create({
      data: {
        researchJobId: id,
        section,
        commandType,
        instruction,
        proposedPatch: proposedPatch as any,
        replyText: generatedReply || null,
        status: 'PENDING',
        createdBy,
      },
    });

    let autoApplied = false;
    if (!dryRun && !requiresApproval) {
      const applyResult = await applyBrainCommand(id, command.id);
      if (!applyResult.success) {
        return res.status(500).json({
          success: false,
          error: applyResult.error || 'Failed to auto-apply command',
          commandId: command.id,
        });
      }
      autoApplied = true;
    }

    const latestCommand = await prisma.brainCommand.findUnique({ where: { id: command.id } });

    return res.json({
      success: true,
      commandId: command.id,
      proposedPatch,
      requiresApproval,
      dryRun,
      autoApplied,
      command: latestCommand,
      replyText: generatedReply ?? undefined,
    });
  } catch (error: any) {
    console.error('[API] Error creating brain command:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to create brain command' });
  }
});

/**
 * POST /api/research-jobs/:id/brain/commands/:commandId/apply
 * Apply a previously proposed command.
 */
router.post('/:id/brain/commands/:commandId/apply', async (req: Request, res: Response) => {
  try {
    const { id, commandId } = req.params;
    const result = await applyBrainCommand(id, commandId);
    if (!result.success) {
      return res.status(result.error === 'Brain command not found' ? 404 : 500).json({
        success: false,
        error: result.error || 'Failed to apply brain command',
      });
    }
    const command = await prisma.brainCommand.findFirst({
      where: { id: commandId, researchJobId: id },
    });
    return res.json({ success: true, command });
  } catch (error: any) {
    console.error('[API] Error applying brain command:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to apply brain command',
    });
  }
});

/**
 * GET /api/research-jobs/:id/brain/commands
 * List brain command history.
 */
router.get('/:id/brain/commands', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const commands = await prisma.brainCommand.findMany({
      where: { researchJobId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return res.json({ success: true, commands });
  } catch (error: any) {
    console.error('[API] Error listing brain commands:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to list brain commands' });
  }
});

/**
 * POST /api/research-jobs/:id/brain/suggestions/:suggestionId/accept
 * Apply a brain profile suggestion and mark it accepted.
 */
router.post('/:id/brain/suggestions/:suggestionId/accept', async (req: Request, res: Response) => {
  try {
    const { id: jobId, suggestionId } = req.params;
    const job = await prisma.researchJob.findUnique({
      where: { id: jobId },
      select: { clientId: true },
    });
    if (!job?.clientId) {
      return res.status(404).json({ success: false, error: 'Research job or client not found' });
    }
    const suggestion = await prisma.brainProfileSuggestion.findFirst({
      where: { id: suggestionId, clientId: job.clientId, status: { in: ['PENDING', 'APPROVED'] } },
    });
    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found or already resolved' });
    }

    let profile = await prisma.brainProfile.findUnique({ where: { clientId: job.clientId } });
    if (!profile) {
      profile = await prisma.brainProfile.create({
        data: { clientId: job.clientId },
      });
    }

    const valueToApply = suggestion.approvedValue ?? suggestion.proposedValue;
    const updateData = buildSuggestionProfileUpdate(profile, suggestion.field, valueToApply);
    const now = new Date();
    await prisma.$transaction([
      prisma.brainProfile.update({
        where: { id: profile.id },
        data: updateData as any,
      }),
      prisma.brainProfileSuggestion.update({
        where: { id: suggestionId },
          data: { status: 'ACCEPTED', resolvedAt: now, resolvedBy: 'user' },
      }),
    ]);

    let updated = await prisma.brainProfile.findUnique({
      where: { id: profile.id },
      include: { goals: true },
    });
    if (updated && (suggestion.field === 'primaryGoal' || suggestion.field === 'secondaryGoals')) {
      const { primaryGoal, secondaryGoals } = extractGoalSyncValues(updated);
      await syncBrainGoals(updated.id, primaryGoal, secondaryGoals);
      updated = await prisma.brainProfile.findUnique({
        where: { id: profile.id },
        include: { goals: true },
      });
    }

    return res.json({ success: true, brainProfile: updated });
  } catch (error: any) {
    console.error('[API] Error accepting brain suggestion:', error);
    if (String(error?.message || '').startsWith('Unsupported brain profile field')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error?.message || 'Failed to accept suggestion' });
  }
});

/**
 * POST /api/research-jobs/:id/brain/suggestions/:suggestionId/reject
 * Mark a brain profile suggestion as rejected.
 */
router.post('/:id/brain/suggestions/:suggestionId/reject', async (req: Request, res: Response) => {
  try {
    const { id: jobId, suggestionId } = req.params;
    const job = await prisma.researchJob.findUnique({
      where: { id: jobId },
      select: { clientId: true },
    });
    if (!job?.clientId) {
      return res.status(404).json({ success: false, error: 'Research job or client not found' });
    }
    const suggestion = await prisma.brainProfileSuggestion.findFirst({
      where: { id: suggestionId, clientId: job.clientId, status: 'PENDING' },
    });
    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found or already resolved' });
    }
    const now = new Date();
    await prisma.brainProfileSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'REJECTED', resolvedAt: now, resolvedBy: 'user' },
    });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[API] Error rejecting brain suggestion:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to reject suggestion' });
  }
});

/**
 * POST /api/research-jobs/:id/brain/suggestions/:suggestionId/approve
 * Approve a brain profile suggestion.
 */
router.post('/:id/brain/suggestions/:suggestionId/approve', async (req: Request, res: Response) => {
  try {
    const { id: jobId, suggestionId } = req.params;
    const approvedValue = req.body?.approvedValue;
    const applyNow = req.body?.apply === true;

    const job = await prisma.researchJob.findUnique({
      where: { id: jobId },
      select: { clientId: true },
    });
    if (!job?.clientId) {
      return res.status(404).json({ success: false, error: 'Research job or client not found' });
    }

    const suggestion = await prisma.brainProfileSuggestion.findFirst({
      where: { id: suggestionId, clientId: job.clientId, status: 'PENDING' },
    });
    if (!suggestion) return res.status(404).json({ success: false, error: 'Suggestion not found' });

    const resolvedApprovedValue = approvedValue ?? suggestion.proposedValue;
    if (!applyNow) {
      const updatedSuggestion = await prisma.brainProfileSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'APPROVED',
          approvedValue: resolvedApprovedValue as any,
        },
      });
      return res.json({ success: true, suggestion: updatedSuggestion, applied: false });
    }

    let profile = await prisma.brainProfile.findUnique({ where: { clientId: job.clientId } });
    if (!profile) {
      profile = await prisma.brainProfile.create({ data: { clientId: job.clientId } });
    }

    const updateData = buildSuggestionProfileUpdate(profile, suggestion.field, resolvedApprovedValue);
    const now = new Date();
    await prisma.$transaction([
      prisma.brainProfile.update({
        where: { id: profile.id },
        data: updateData as any,
      }),
      prisma.brainProfileSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'ACCEPTED',
          approvedValue: resolvedApprovedValue as any,
          resolvedAt: now,
          resolvedBy: 'user',
        },
      }),
    ]);

    let updatedProfile = await prisma.brainProfile.findUnique({
      where: { id: profile.id },
      include: { goals: true },
    });
    if (updatedProfile && (suggestion.field === 'primaryGoal' || suggestion.field === 'secondaryGoals')) {
      const { primaryGoal, secondaryGoals } = extractGoalSyncValues(updatedProfile);
      await syncBrainGoals(updatedProfile.id, primaryGoal, secondaryGoals);
      updatedProfile = await prisma.brainProfile.findUnique({
        where: { id: profile.id },
        include: { goals: true },
      });
    }

    return res.json({ success: true, applied: true, brainProfile: updatedProfile });
  } catch (error: any) {
    console.error('[API] Error approving suggestion:', error);
    if (String(error?.message || '').startsWith('Unsupported brain profile field')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * GET /api/research-jobs/:id/events
 * List persisted timeline events for a job (incremental with afterId).
 */
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const afterIdRaw = Array.isArray(req.query.afterId) ? req.query.afterId[0] : req.query.afterId;
    const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const afterIdParsed = afterIdRaw ? Number.parseInt(String(afterIdRaw), 10) : undefined;
    const limitParsed = limitRaw ? Number.parseInt(String(limitRaw), 10) : undefined;
    const afterId = Number.isFinite(afterIdParsed as number) ? (afterIdParsed as number) : undefined;
    const limit = Number.isFinite(limitParsed as number) ? (limitParsed as number) : undefined;

    const events = await listResearchJobEvents(id, { afterId, limit });
    const nextAfterId = events.length > 0 ? events[events.length - 1].id : afterId ?? null;

    res.json({
      events,
      nextAfterId,
    });
  } catch (error: any) {
    console.error('[API] Failed to list research job events:', error);
    res.status(500).json({ error: error.message || 'Failed to list research job events' });
  }
});

/**
 * GET /api/research-jobs/:id/events/stream
 * SSE stream for live research job timeline events.
 */
router.get('/:id/events/stream', async (req: Request, res: Response) => {
  const { id } = req.params;
  const afterIdRaw =
    (Array.isArray(req.query.afterId) ? req.query.afterId[0] : req.query.afterId) ||
    req.header('last-event-id') ||
    undefined;
  const afterIdParsed = afterIdRaw ? Number.parseInt(String(afterIdRaw), 10) : undefined;
  const afterId = Number.isFinite(afterIdParsed as number) ? (afterIdParsed as number) : undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  try {
    const backlog = await listResearchJobEvents(id, { afterId, limit: 500 });
    for (const event of backlog) {
      res.write(serializeResearchJobEventSse(event));
    }
  } catch (error: any) {
    console.error('[API] Failed to send SSE backlog:', error);
  }

  const unsubscribe = subscribeResearchJobEvents(id, (event) => {
    res.write(serializeResearchJobEventSse(event));
  });

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: {"time":"${new Date().toISOString()}"}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

/**
 * POST /api/research-jobs/:id/competitors/orchestrate
 * Run AI-orchestrated competitor discovery + filtering + ranking.
 */
router.post('/:id/competitors/orchestrate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const mode = parseOrchestrationMode(req.body?.mode);
    const surfaces = parseCompetitorSurfaces(req.body?.surfaces ?? req.body?.platforms);
    const targetCount = parseTargetCount(req.body?.targetCount);
    const precision = parseDiscoveryPrecision(req.body?.precision);
    const connectorPolicy = parseConnectorPolicy(req.body?.connectorPolicy);
    const runningHint = await prisma.competitorOrchestrationRun.findFirst({
      where: { researchJobId: id, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        summary: true,
        startedAt: true,
        phase: true,
        platforms: true,
      },
    });
    if (runningHint) {
      const staleMinutes = Math.max(2, Number(process.env.COMPETITOR_ORCHESTRATION_STALE_MINUTES || 10));
      const staleMs = staleMinutes * 60 * 1000;
      const bootstrapStaleMs = 2 * 60 * 1000;
      const collectingStaleMs = 3 * 60 * 1000;
      const ageMs = Date.now() - runningHint.startedAt.getTime();
      const runningSummary = (runningHint.summary || {}) as Record<string, unknown>;
      const hasProgress =
        Number(runningSummary.candidatesDiscovered || 0) > 0 ||
        Number(runningSummary.candidatesFiltered || 0) > 0 ||
        Number(runningSummary.shortlisted || 0) > 0 ||
        Number(runningSummary.topPicks || 0) > 0;
      const effectiveStaleMs =
        runningHint.phase === 'started' || !runningHint.phase
          ? Math.min(staleMs, bootstrapStaleMs)
          : runningHint.phase === 'collecting' && !hasProgress
            ? Math.min(staleMs, collectingStaleMs)
            : staleMs;
      if (ageMs < effectiveStaleMs) {
        return res.status(202).json({
          success: true,
          alreadyRunning: true,
          runId: runningHint.id,
          summary: {
            candidatesDiscovered: Number(runningSummary.candidatesDiscovered || 0),
            candidatesFiltered: Number(runningSummary.candidatesFiltered || 0),
            shortlisted: Number(runningSummary.shortlisted || 0),
            topPicks: Number(runningSummary.topPicks || 0),
            profileUnavailableCount: Number(runningSummary.profileUnavailableCount || 0),
          },
          platformMatrix: (runningHint.platforms as Record<string, unknown> | null) || null,
          diagnostics: null,
          message: `Orchestration already running (${runningHint.phase || 'started'})`,
        });
      }

      await prisma.competitorOrchestrationRun.update({
        where: { id: runningHint.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorCode: 'STALE_REPLACED',
          summary: {
            reason: 'Stale run replaced by a fresh orchestration request',
          },
        },
      });
    }
    const syncTimeoutMs = Math.max(
      3000,
      Number(process.env.COMPETITOR_ORCHESTRATE_SYNC_TIMEOUT_MS || 15000)
    );
    const orchestrationPromise = orchestrateCompetitorsForJob(id, {
      mode,
      surfaces,
      targetCount,
      precision,
      connectorPolicy,
    });
    const raceResult = await Promise.race<
      | { kind: 'result'; value: Awaited<ReturnType<typeof orchestrateCompetitorsForJob>> }
      | { kind: 'error'; error: unknown }
      | { kind: 'timeout' }
    >([
      orchestrationPromise
        .then((value) => ({ kind: 'result' as const, value }))
        .catch((error) => ({ kind: 'error' as const, error })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), syncTimeoutMs)
      ),
    ]);

    if (raceResult.kind === 'result') {
      return res.json({
        success: true,
        runId: raceResult.value.runId,
        summary: raceResult.value.summary,
        platformMatrix: raceResult.value.platformMatrix,
        diagnostics: raceResult.value.diagnostics,
      });
    }

    if (raceResult.kind === 'error') {
      throw raceResult.error;
    }

    void orchestrationPromise.catch((error) => {
      console.error('[API] Async competitor orchestration failed after timeout handoff:', error);
    });
    const running = await prisma.competitorOrchestrationRun.findFirst({
      where: { researchJobId: id, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        summary: true,
        phase: true,
        platforms: true,
      },
    });
    const runningSummary = (running?.summary || {}) as Record<string, unknown>;
    return res.status(202).json({
      success: true,
      started: true,
      runId: running?.id || null,
      summary: {
        candidatesDiscovered: Number(runningSummary.candidatesDiscovered || 0),
        candidatesFiltered: Number(runningSummary.candidatesFiltered || 0),
        shortlisted: Number(runningSummary.shortlisted || 0),
        topPicks: Number(runningSummary.topPicks || 0),
        profileUnavailableCount: Number(runningSummary.profileUnavailableCount || 0),
      },
      platformMatrix: (running?.platforms as Record<string, unknown> | null) || null,
      diagnostics: null,
      message: `Discovery continues in background (phase: ${running?.phase || 'collecting'})`,
    });
  } catch (error: any) {
    console.error('[API] Competitor orchestration failed:', error);
    if (
      error?.message?.includes('must be') ||
      error?.message?.includes('required') ||
      error?.message?.includes('between')
    ) {
      return res.status(400).json({ success: false, error: error.message });
    }
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (status === 409 && error?.code === 'ORCHESTRATION_ALREADY_RUNNING') {
      const running = await prisma.competitorOrchestrationRun.findFirst({
        where: { researchJobId: req.params.id, status: 'RUNNING' },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          summary: true,
          startedAt: true,
          phase: true,
          platforms: true,
        },
      });
      const rawSummary = (running?.summary || {}) as Record<string, unknown>;
      const runPlatforms = (running as any)?.platforms as Record<string, unknown> | undefined;
      return res.status(202).json({
        success: true,
        alreadyRunning: true,
        runId: running?.id || null,
        summary: {
          candidatesDiscovered: Number(rawSummary.candidatesDiscovered || 0),
          candidatesFiltered: Number(rawSummary.candidatesFiltered || 0),
          shortlisted: Number(rawSummary.shortlisted || 0),
          topPicks: Number(rawSummary.topPicks || 0),
          profileUnavailableCount: Number(rawSummary.profileUnavailableCount || 0),
        },
        platformMatrix: runPlatforms || null,
        diagnostics: null,
        message: running
          ? `Orchestration is already running (${running.phase || 'started'})`
          : 'Orchestration is already running',
      });
    }
    if (status === 404 || error?.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message || 'Research job not found' });
    }
    res.status(status).json({ success: false, error: error.message || 'Competitor orchestration failed' });
  }
});

/**
 * GET /api/research-jobs/:id/competitors/shortlist
 * Fetch latest (or specific run) competitor shortlist for review UI.
 */
router.get('/:id/competitors/shortlist', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const runIdRaw = Array.isArray(req.query.runId) ? req.query.runId[0] : req.query.runId;
    const runId = parseRunId(runIdRaw);

    const payload = await getCompetitorShortlist(id, runId);
    res.json({ success: true, ...payload });
  } catch (error: any) {
    console.error('[API] Failed to fetch competitor shortlist:', error);
    if (error?.message?.includes('runId')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch competitor shortlist' });
  }
});

/**
 * POST /api/research-jobs/:id/competitors/seed-from-intake
 * Backfill top picks from job inputData.competitorInspirationLinks when none exist yet.
 */
router.post('/:id/competitors/seed-from-intake', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const forceRaw = Array.isArray(req.query.force) ? req.query.force[0] : req.query.force;
    const force =
      String(forceRaw ?? req.body?.force ?? '')
        .trim()
        .toLowerCase() === 'true';
    const job = await prisma.researchJob.findUnique({
      where: { id },
      select: { inputData: true },
    });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }
    const inputData = (job.inputData || {}) as Record<string, unknown>;
    const links = Array.isArray(inputData.competitorInspirationLinks)
      ? (inputData.competitorInspirationLinks as string[]).filter((u) => typeof u === 'string' && u.trim())
      : [];
    if (links.length === 0) {
      return res.json({ success: true, topPicks: 0, message: 'No inspiration links in intake' });
    }
    const existing = await prisma.competitorCandidateProfile.count({
      where: { researchJobId: id, source: 'client_inspiration' },
    });
    if (existing > 0 && !force) {
      return res.json({ success: true, topPicks: existing, message: 'Already seeded' });
    }
    const { seedTopPicksFromInspirationLinks } = await import('../services/discovery/seed-intake-competitors');
    const { topPicks } = await seedTopPicksFromInspirationLinks(id, links);
    res.json({
      success: true,
      topPicks,
      message: force
        ? `Resynced ${topPicks} top picks from inspiration links`
        : `Seeded ${topPicks} top picks from inspiration links`,
    });
  } catch (error: any) {
    console.error('[API] Seed from intake failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Seed from intake failed' });
  }
});

/**
 * POST /api/research-jobs/:id/competitors/shortlist
 * Materialize a filtered candidate and add to shortlist (enables scrape).
 */
router.post('/:id/competitors/shortlist', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const runId = parseRunId(req.body?.runId);
    const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId.trim() : null;
    if (!runId) {
      return res.status(400).json({ success: false, error: 'runId is required' });
    }
    if (!profileId) {
      return res.status(400).json({ success: false, error: 'profileId is required' });
    }

    const result = await materializeAndShortlistCandidate(id, runId, profileId);
    if (!result.success) {
      return res.status(404).json({ success: false, error: 'Candidate not found or could not be materialized' });
    }

    res.json({
      success: true,
      discoveredCompetitorId: result.discoveredCompetitorId,
      message: 'Candidate added to shortlist',
    });
  } catch (error: any) {
    console.error('[API] Failed to shortlist competitor:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to shortlist competitor' });
  }
});

/**
 * POST /api/research-jobs/:id/competitors/approve-and-scrape
 * Approve selected shortlisted competitors and queue scraping.
 */
router.post('/:id/competitors/approve-and-scrape', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const runId = parseRunId(req.body?.runId);
    const candidateProfileIds =
      parseCompetitorIds(req.body?.candidateProfileIds) ||
      parseCompetitorIds(req.body?.competitorIds);
    if (!runId) {
      return res.status(400).json({ success: false, error: 'runId is required' });
    }
    if (!candidateProfileIds || candidateProfileIds.length === 0) {
      return res.status(400).json({ success: false, error: 'candidateProfileIds is required' });
    }

    const result = await approveAndScrapeCompetitors(id, runId, candidateProfileIds);

    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[API] Failed to approve competitors for scrape:', error);
    if (error?.message?.includes('runId') || error?.message?.includes('competitorIds')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    res.status(status).json({ success: false, error: error.message || 'Approve and scrape failed' });
  }
});

/**
 * POST /api/research-jobs/:id/competitors/continue-scrape
 * Bulk continue scraping for selected or pending competitors.
 */
router.post('/:id/competitors/continue-scrape', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const candidateProfileIds =
      parseCompetitorIds(req.body?.candidateProfileIds) ||
      parseCompetitorIds(req.body?.competitorIds);
    const runId = parseRunId(req.body?.runId);
    const onlyPendingRaw = req.body?.onlyPending;
    const forceUnavailableRaw = req.body?.forceUnavailable;
    const forceMaterializeRaw = req.body?.forceMaterialize;
    if (onlyPendingRaw !== undefined && typeof onlyPendingRaw !== 'boolean') {
      return res.status(400).json({ success: false, error: 'onlyPending must be a boolean when provided' });
    }
    if (forceUnavailableRaw !== undefined && typeof forceUnavailableRaw !== 'boolean') {
      return res.status(400).json({ success: false, error: 'forceUnavailable must be a boolean when provided' });
    }
    if (forceMaterializeRaw !== undefined && typeof forceMaterializeRaw !== 'boolean') {
      return res.status(400).json({ success: false, error: 'forceMaterialize must be a boolean when provided' });
    }

    const result = await continueCompetitorScrapeBulk(id, {
      candidateProfileIds,
      onlyPending: Boolean(onlyPendingRaw),
      runId,
      forceUnavailable: Boolean(forceUnavailableRaw),
      forceMaterialize: Boolean(forceMaterializeRaw),
    });

    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[API] Failed to continue competitor scrape:', error);
    if (
      error?.message?.includes('competitorIds') ||
      error?.message?.includes('runId') ||
      error?.message?.includes('onlyPending')
    ) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message || 'Continue scrape failed' });
  }
});

/**
 * PATCH /api/research-jobs/:id/competitors/candidate-state
 * Update candidate profile state directly (works even before discovered competitor materialization).
 */
router.patch('/:id/competitors/candidate-state', async (req: Request, res: Response) => {
  try {
    const { id: researchJobId } = req.params;
    const candidateProfileId = String(req.body?.candidateProfileId || '').trim();
    const reasonRaw = String(req.body?.reason || '').trim();
    const nextState = parseCandidateState(req.body?.state);
    const reason = reasonRaw || `Manually changed to ${nextState}`;

    if (!candidateProfileId) {
      return res.status(400).json({ success: false, error: 'candidateProfileId is required' });
    }

    const candidate = await prisma.competitorCandidateProfile.findFirst({
      where: { id: candidateProfileId, researchJobId },
      select: {
        id: true,
        platform: true,
        handle: true,
        state: true,
      },
    });

    if (!candidate) {
      return res.status(404).json({ success: false, error: 'Candidate profile not found' });
    }

    const updatedCandidate = await prisma.competitorCandidateProfile.update({
      where: { id: candidateProfileId },
      data: {
        state: nextState,
        stateReason: reason,
      },
    });

    const discoveredRows = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId,
        OR: [
          { candidateProfileId },
          {
            platform: candidate.platform,
            handle: candidate.handle,
          },
        ],
      },
      select: { id: true },
    });

    if (discoveredRows.length > 0) {
      await prisma.discoveredCompetitor.updateMany({
        where: { id: { in: discoveredRows.map((row) => row.id) } },
        data: {
          selectionState: nextState,
          selectionReason: reason,
          manuallyModified: true,
          lastModifiedBy: 'user',
          lastModifiedAt: new Date(),
        },
      });
    }

    emitResearchJobEvent({
      researchJobId,
      source: 'competitor-orchestrator-v2',
      code: 'competitor.candidate.state.manual_update',
      level: 'info',
      message: `Candidate state updated for ${candidate.platform} @${candidate.handle}`,
      platform: candidate.platform,
      handle: candidate.handle,
      entityType: 'competitor_candidate_profile',
      entityId: candidateProfileId,
      metadata: {
        oldState: candidate.state,
        newState: nextState,
        reason,
        discoveredUpdatedCount: discoveredRows.length,
      },
    });

    return res.json({
      success: true,
      candidateProfile: updatedCandidate,
      discoveredUpdatedCount: discoveredRows.length,
    });
  } catch (error: any) {
    console.error('[API] Failed to update candidate state:', error);
    if (error?.message?.includes('state must be one of')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update candidate state',
    });
  }
});

/**
 * POST /api/research-jobs/:id/competitors/recheck-availability
 * Re-validate a candidate profile availability (manual operator action).
 */
router.post('/:id/competitors/recheck-availability', async (req: Request, res: Response) => {
  try {
    const { id: researchJobId } = req.params;
    const candidateProfileId = String(req.body?.candidateProfileId || '').trim();
    if (!candidateProfileId) {
      return res.status(400).json({ success: false, error: 'candidateProfileId is required' });
    }

    const result = await recheckCompetitorAvailability(researchJobId, candidateProfileId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[API] Recheck availability failed:', error);
    const status = Number(error?.statusCode || 500);
    res.status(status).json({
      success: false,
      error: error?.message || 'Failed to recheck competitor availability',
      code: error?.code,
    });
  }
});

/**
 * GET /api/research-jobs/:id/competitors/runs/:runId/diagnostics
 * Fetch run diagnostics for troubleshooting orchestration quality.
 */
router.get('/:id/competitors/runs/:runId/diagnostics', async (req: Request, res: Response) => {
  try {
    const { id, runId } = req.params;
    const parsedRunId = parseRunId(runId);
    if (!parsedRunId) {
      return res.status(400).json({ success: false, error: 'runId is required' });
    }

    const diagnostics = await getOrchestrationRunDiagnostics(id, parsedRunId);
    res.json({ success: true, diagnostics });
  } catch (error: any) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    res.status(status).json({ success: false, error: error?.message || 'Failed to fetch diagnostics' });
  }
});

/**
 * GET /api/research-jobs
 * List all research jobs
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const jobs = await prisma.researchJob.findMany({
      include: {
        client: true,
      },
      orderBy: { startedAt: 'desc' },
    }); // End of map

    // The instruction implies a transformation to jobsWithStatus, but the transformation logic is not provided.
    // To maintain syntactical correctness and faithfulness to the instruction,
    // we'll assume jobsWithStatus is derived from jobs, and for now, just return jobs.
    // If the user intended a specific transformation, it should be provided.
    const jobsWithStatus = jobs; // Placeholder for the missing transformation logic

    res.json(jobsWithStatus);
  } catch (error) {
    console.error('[API] Failed to fetch research jobs:', error);
    res.status(500).json({ error: 'Failed to fetch research jobs' });
  }
});

/**
 * DELETE /api/research-jobs/:id/clear-competitors
 * Clear all discovered competitors for a research job
 */
router.delete('/:id/clear-competitors', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    console.log(`[API] Clearing all competitors for job ${id}...`);
    
    // Delete all discovered competitors for this job
    const result = await prisma.discoveredCompetitor.deleteMany({
      where: { researchJobId: id }
    });
    
    console.log(`[API] Deleted ${result.count} competitors`);
    
    res.json({ 
      success: true, 
      message: `Cleared ${result.count} competitors`,
      deletedCount: result.count
    });
  } catch (error: any) {
    console.error('[API] Failed to clear competitors:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/research-jobs/:id/scrape-client-profile
 * Scrape a client profile by platform + handle (creates SocialProfile if missing, e.g. placeholder)
 */
router.post('/:id/scrape-client-profile', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { platform, handle } = req.body || {};
    if (!platform || !handle) {
      return res.status(400).json({ error: 'platform and handle are required' });
    }
    const p = String(platform).toLowerCase();
    if (p !== 'instagram' && p !== 'tiktok') {
      return res.status(400).json({ error: 'platform must be instagram or tiktok' });
    }
    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!job) return res.status(404).json({ error: 'Research job not found' });
    const normalizedHandle = normalizeHandleFromUrl(handle) || String(handle).replace(/^@+/, '').trim().toLowerCase();
    const profile = await prisma.socialProfile.upsert({
      where: {
        researchJobId_platform_handle: {
          researchJobId: id,
          platform: p,
          handle: normalizedHandle,
        },
      },
      update: {},
      create: {
        researchJobId: id,
        platform: p,
        handle: normalizedHandle,
        url: p === 'instagram' ? `https://www.instagram.com/${normalizedHandle}/` : `https://www.tiktok.com/@${normalizedHandle}`,
      },
    });
    scrapeProfileSafe(id, p, normalizedHandle).then(() => {
      console.log(`[API] Scrape finished for ${p}:@${normalizedHandle}`);
    });
    return res.json({ success: true, profileId: profile.id, message: `Scraping ${p} @${normalizedHandle}` });
  } catch (error: any) {
    console.error('[API] scrape-client-profile error:', error);
    return res.status(500).json({ error: error?.message || 'Scrape failed' });
  }
});

/** Build client-only scrape targets from job (inputData + clientAccounts). Never use DDG or other discovered handles for client scrapes. */
function getRerunClientTargets(job: any): Array<{ platform: string; handle: string }> {
  const normalize = (h: string) => normalizeHandleFromUrl(h) || String(h ?? '').replace(/^@+/, '').trim().toLowerCase();
  const targets: Array<{ platform: string; handle: string }> = [];
  const inputData = (job.inputData || {}) as any;
  const accounts = job.client?.clientAccounts || [];

  if (inputData.handles && typeof inputData.handles === 'object') {
    for (const [platform, raw] of Object.entries(inputData.handles)) {
      const p = String(platform).toLowerCase();
      if ((p !== 'instagram' && p !== 'tiktok') || !raw || typeof raw !== 'string') continue;
      const h = normalize(raw);
      if (h) targets.push({ platform: p, handle: h });
    }
  }
  for (const acc of accounts) {
    const p = String(acc.platform || '').toLowerCase();
    if ((p !== 'instagram' && p !== 'tiktok') || !acc.handle) continue;
    const h = normalize(acc.handle);
    if (h) targets.push({ platform: p, handle: h });
  }
  if (targets.length === 0 && inputData.handle && typeof inputData.handle === 'string') {
    const p = String((inputData.platform as string) || 'instagram').toLowerCase();
    if (p === 'instagram' || p === 'tiktok') {
      const h = normalize(inputData.handle);
      if (h) targets.push({ platform: p, handle: h });
    }
  }
  const seen = new Set<string>();
  return targets.filter((t) => {
    const k = `${t.platform}:${t.handle}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * POST /api/research-jobs/:id/rerun/:scraper
 * Re-run a specific scraper for a research job.
 * Client scrapes (instagram, tiktok, social_images) use ONLY job/client-defined handles—never DDG-discovered or other sources.
 */
router.post('/:id/rerun/:scraper', async (req: Request, res: Response) => {
  try {
    const { id, scraper } = req.params;
    
    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: { client: { include: { clientAccounts: true } } },
    });

    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }

    const { brandName, niche } = (job.inputData as any) || {};
    const clientTargets = getRerunClientTargets(job);
    const handle = clientTargets[0]?.handle;
    
    console.log(`[API] Re-running ${scraper} for job ${id} (${clientTargets.length} client targets)`);

    let result: any;

    switch (scraper) {
      case 'instagram': {
        const instagramTargets = clientTargets.filter((t) => t.platform === 'instagram');
        if (instagramTargets.length === 0) {
          return res.status(400).json({ error: 'No client Instagram handle defined for this job. Add one in inputData or client accounts.' });
        }
        for (const t of instagramTargets) {
          scrapeProfileSafe(id, 'instagram', t.handle).then((res) => {
            console.log(`[Background] Instagram @${t.handle} scrape finished:`, res);
          });
        }
        result = { status: 'started_background', message: `Instagram scrape started for ${instagramTargets.map((t) => `@${t.handle}`).join(', ')}` };
        break;
      }

      case 'tiktok': {
        const tiktokTargets = clientTargets.filter((t) => t.platform === 'tiktok');
        if (tiktokTargets.length === 0) {
          return res.status(400).json({ error: 'No client TikTok handle defined for this job. Add one in inputData or client accounts.' });
        }
        for (const t of tiktokTargets) {
          scrapeProfileSafe(id, 'tiktok', t.handle).then((res) => {
            console.log(`[Background] TikTok @${t.handle} scrape finished:`, res);
          });
        }
        result = { status: 'started_background', message: `TikTok scrape started for ${tiktokTargets.map((t) => `@${t.handle}`).join(', ')}` };
        break;
      }
        
      case 'scrape_social_images':
      case 'social_images': {
        if (clientTargets.length === 0) {
          return res.status(400).json({ error: 'No client Instagram/TikTok handles defined for this job. Add handles in inputData or client accounts.' });
        }
        const handles: Record<string, string> = {};
        for (const t of clientTargets) {
          if (t.platform === 'instagram' || t.platform === 'tiktok') handles[t.platform] = t.handle;
        }
        try {
          const { scrapeSocialContent } = await import('../services/discovery/duckduckgo-search');
          console.log(`[API] Scraping social images for client handles only: ${Object.entries(handles).map(([p, h]) => `${p}:@${h}`).join(', ')}`);
          result = await scrapeSocialContent(handles, 30, id);
        } catch (error: any) {
          result = { error: error.message };
        }
        break;
      }
        
      case 'ddg_search':
      case 'ddg_images': 
      case 'ddg_videos':
      case 'ddg_news':
        result = await gatherAllDDG(brandName || (clientTargets[0]?.handle ?? ''), niche || 'General', id);
        break;
        


      case 'competitors':
      case 'competitors_code':
      case 'competitors_direct':
      case 'competitors_ai': {
        const legacySurfaces = parseCompetitorSurfaces(req.body?.surfaces ?? req.body?.platforms);
        const sources =
          scraper === 'competitors_code'
            ? ['algorithmic']
            : scraper === 'competitors_direct'
              ? ['direct']
              : scraper === 'competitors_ai'
                ? ['ai']
                : ['algorithmic', 'direct', 'ai'];

        const orchestration = await orchestrateCompetitorsForJob(id, {
          mode: 'append',
          surfaces: legacySurfaces,
          targetCount: Math.max((job as any)?.competitorsToFind || 10, 5),
          sources: sources as Array<'algorithmic' | 'direct' | 'ai'>,
        });

        result = {
          orchestrationRunId: orchestration.runId,
          summary: orchestration.summary,
          sources,
        };
        break;
      }

      case 'community_insights':
        result = await orchestrateBrandIntelligenceForJob(id, {
          mode: 'append',
          modules: ['community_insights'],
          runReason: 'manual',
        });
        break;

      case 'brand_mentions':
        result = await orchestrateBrandIntelligenceForJob(id, {
          mode: 'append',
          modules: ['brand_mentions'],
          runReason: 'manual',
        });
        break;
        
      case 'trends':
        result = await runTrendOrchestrator({
          researchJobId: id,
          brandName: brandName || handle,
          handle,
          niche,
          bio: (job as any)?.client?.businessOverview || undefined,
          businessOverview: (job as any)?.client?.businessOverview || undefined,
        });
        break;
        
      case 'ai_analysis': {
         // We need bio and context for deep questions
         const clientFn = await prisma.clientAccount.findFirst({
            where: { clientId: job.clientId }
         });
         
         result = await askAllDeepQuestions(id, {
             brandName: brandName || handle,
             handle: handle,
             bio: clientFn?.bio || undefined,
             niche: niche || undefined
         });
         break;
      }
         
      default:
        return res.status(400).json({ error: 'Invalid scraper type' });
    }

    res.json({ success: true, message: `Re-run ${scraper} completed`, result });

  } catch (error: any) {
    console.error(`[API] Re-run failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/research-jobs/:id/modules/:module/action
 * Module-scoped actions:
 * - delete
 * - continue (missing-only)
 * - run_from_start (delete + continue)
 */
router.post('/:id/modules/:module/action', async (req: Request, res: Response) => {
  try {
    const { id, module } = req.params;
    const { action } = req.body || {};

    if (!isModuleKey(module)) {
      return res.status(400).json({ error: `Invalid module key: ${module}` });
    }

    if (action !== 'delete' && action !== 'continue' && action !== 'run_from_start') {
      return res.status(400).json({
        error: 'Invalid action. Expected one of: delete, continue, run_from_start',
      });
    }

    const result = await performResearchModuleAction(id, module, action as ModuleAction);
    const status = result.success ? 200 : 500;
    res.status(status).json(result);
  } catch (error: any) {
    console.error('[API] Module action failed:', error);
    res.status(500).json({ error: error.message || 'Module action failed' });
  }
});

/**
 * POST /api/research-jobs/:id/resume
 * Resume/recover a stale or partial job by running missing modules in order.
 */
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await resumeResearchJob(id);

    if (result.errors.includes('Research job not found')) {
      return res.status(404).json(result);
    }

    const status = result.success || result.partial ? 200 : 500;
    res.status(status).json(result);
  } catch (error: any) {
    console.error('[API] Resume failed:', error);
    res.status(500).json({ error: error.message || 'Resume failed' });
  }
});

/**
 * PATCH /api/research-jobs/:id/continuity
 * Configure continuity mode for this research job.
 *
 * Body:
 * {
 *   "enabled": true|false,        // optional
 *   "intervalHours": number >= 2  // optional
 * }
 */
router.patch('/:id/settings', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const controlMode = req.body?.controlMode;
    if (controlMode !== undefined && controlMode !== 'auto' && controlMode !== 'manual') {
      return res.status(400).json({ success: false, error: 'controlMode must be "auto" or "manual"' });
    }

    const job = await prisma.researchJob.findUnique({
      where: { id },
      select: { inputData: true },
    });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    const inputData = (job.inputData as Record<string, unknown>) || {};
    const updated = { ...inputData };
    if (controlMode !== undefined) updated.controlMode = controlMode;

    await prisma.researchJob.update({
      where: { id },
      data: { inputData: updated as object },
    });

    res.json({ success: true, controlMode: updated.controlMode ?? 'auto' });
  } catch (error: any) {
    console.error('[API] Failed to update job settings:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update settings' });
  }
});

router.patch('/:id/continuity', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled, intervalHours } = req.body || {};

    if (enabled === undefined && intervalHours === undefined) {
      return res.status(400).json({
        error: 'No continuity update provided. Send `enabled` and/or `intervalHours`.',
      });
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '`enabled` must be a boolean' });
    }

    if (intervalHours !== undefined) {
      const interval = Number(intervalHours);
      if (!Number.isFinite(interval)) {
        return res.status(400).json({ error: '`intervalHours` must be a number' });
      }
      if (interval < researchContinuity.minIntervalHours) {
        return res.status(400).json({
          error: `Minimum continuity interval is ${researchContinuity.minIntervalHours} hours`,
        });
      }
    }

    const config = await configureResearchJobContinuity(id, {
      enabled,
      intervalHours,
    });

    res.json({ success: true, config });
  } catch (error: any) {
    console.error('[API] Failed to configure continuity:', error);
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to configure continuity' });
  }
});

/**
 * POST /api/research-jobs/:id/continuity/continue
 * Manually trigger a continuity scrape cycle immediately.
 */
router.post('/:id/continuity/continue', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await continueResearchJob(id, 'manual');

    if (result.errors.includes('Research job not found')) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    // Return 200 even when partial so frontend can surface granular errors.
    res.json({ success: result.success || result.partial, result });
  } catch (error: any) {
    console.error('[API] Failed to run continuity continue:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to continue research job' });
  }
});

/**
 * POST /api/research-jobs/:id/stop
 * Stop/Cancel a running research job
 */
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const job = await prisma.researchJob.findUnique({ where: { id } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    // Set status to FAILED with specific message which workers should look for
    await prisma.researchJob.update({
        where: { id },
        data: { 
          status: 'FAILED',
          errorMessage: 'Cancelled by user request'
        }
    });

    emitResearchJobEvent({
      researchJobId: id,
      source: 'system',
      code: 'job.status.changed',
      level: 'warn',
      message: 'Research job marked FAILED (cancelled by user)',
      metrics: {
        fromStatus: job.status,
        toStatus: 'FAILED',
      },
      metadata: {
        reason: 'Cancelled by user request',
      },
    });
    
    console.log(`[API] Job ${id} cancelled by user`);
    res.json({ success: true, message: 'Job cancellation requested' });

  } catch (error: any) {
    console.error('[API] Failed to stop job:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/research-jobs/:id/visual-comparison
 * Get top performing visual assets for comparison
 */
router.get('/:id/visual-comparison', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit as string) || 4;
        
        const assets = await visualAggregationService.getTopPerformingAssets(id, limit);
        res.json(assets);
    } catch (error: any) {
        console.error('[API] Failed to get visual comparison:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /:id/discover-tiktok
 * Discover TikTok competitors for a research job
 * Progressive: Returns discovered competitors immediately, scraping happens in background
 */
router.post('/:id/discover-tiktok', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        
        console.log(`[API] TikTok discovery triggered for job ${id}`);
        
        // Get research job and client info
        const job = await prisma.researchJob.findUnique({
            where: { id },
            include: {
                client: {
                    include: {
                        clientAccounts: true
                    }
                }
            }
        });
        
        if (!job) {
            return res.status(404).json({ error: 'Research job not found' });
        }
        
        const client = job.client;
        const inputData = job.inputData as any || {};
        const brandName = client.name || inputData.brandName || '';
        const niche = inputData.niche || 'business';
        
        console.log(`[API] Discovering TikTok competitors for "${brandName}" in "${niche}"`);
        
        // 1. Call AI to suggest TikTok competitors
        const { suggestTikTokCompetitors } = await import('../services/ai/competitor-discovery');
        const aiSuggestions = await suggestTikTokCompetitors(brandName, niche, inputData.description);
        
        console.log(`[API] AI suggested ${aiSuggestions.length} TikTok competitors`);
        
        if (aiSuggestions.length === 0) {
            return res.json({
                success: true,
                discovered: 0,
                competitors: [],
                message: 'No TikTok competitors found'
            });
        }
        
        // 2. Save discovered competitors to database
        const savedCompetitors = [];
        
        for (const suggestion of aiSuggestions) {
            try {
                // Create competitor record
                const competitor = await prisma.competitor.upsert({
                    where: {
                        clientId_platform_handle: {
                            clientId: client.id,
                            platform: 'tiktok',
                            handle: suggestion.handle
                        }
                    },
                    update: {},
                    create: {
                        clientId: client.id,
                        handle: suggestion.handle,
                        platform: 'tiktok'
                    }
                });
                
                // Create discovered competitor record
                const discovered = await prisma.discoveredCompetitor.create({
                    data: {
                        researchJobId: id,
                        competitorId: competitor.id,
                        handle: suggestion.handle,
                        platform: 'tiktok',
                        relevanceScore: suggestion.relevanceScore,
                        discoveryReason: 'ai_suggestion_tiktok',
                        status: 'SUGGESTED'
                    }
                });
                
                savedCompetitors.push({
                    id: discovered.id,
                    handle: suggestion.handle,
                    platform: 'tiktok',
                    relevanceScore: suggestion.relevanceScore,
                    status: 'SUGGESTED',
                    reasoning: suggestion.reasoning
                });
                
                console.log(`[API] Saved TikTok competitor: @${suggestion.handle} (${Math.round(suggestion.relevanceScore * 100)}%)`);
                
            } catch (error: any) {
                console.error(`[API] Failed to save TikTok competitor ${suggestion.handle}:`, error.message);
            }
        }
        
        // 3. Queue background scraping for discovered competitors (don't wait)
        console.log(`[API] Queuing background scraping for ${savedCompetitors.length} TikTok competitors...`);
        
        // Import scraper and scrape in background
        (async () => {
            const { scrapeCompetitorsIncremental } = await import('../services/discovery/competitor-scraper');
            
            // Small delay before starting to ensure response is sent first
            await new Promise(resolve => setTimeout(resolve, 500));
            
            console.log(`[Background] Starting TikTok competitor scraping for job ${id}`);
            
            // Fetch TikTok competitors for this job to pass to scraper
            const tiktokCompetitors = await prisma.discoveredCompetitor.findMany({
                where: {
                    researchJobId: id,
                    platform: 'tiktok',
                    status: 'SUGGESTED'
                },
                select: {
                    id: true,
                    handle: true,
                    platform: true
                }
            });
            
            await scrapeCompetitorsIncremental(id, tiktokCompetitors);
            console.log(`[Background] Completed TikTok competitor scraping for job ${id}`);
        })().catch(err => {
            console.error(`[Background] TikTok scraping failed:`, err);
        });
        
        // 4. Return immediately with discovered competitors
        res.json({
            success: true,
            discovered: savedCompetitors.length,
            competitors: savedCompetitors,
            message: `Discovered ${savedCompetitors.length} TikTok competitors. Scraping in background...`
        });
        
    } catch (error: any) {
        console.error('[API] TikTok discovery failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/research-jobs/:id/scrape-client
 * Manually trigger client profile scraping (Instagram + TikTok)
 */
router.post('/:id/scrape-client', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: {
        client: {
          include: {
            clientAccounts: true
          }
        }
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    // Import auto-scraper
    const { autoScrapeClientProfiles } = await import('../services/social/auto-scraper');

    // Trigger scraping in background
    (async () => {
      console.log(`[API] Starting client profile scraping for job ${id}...`);
      const result = await autoScrapeClientProfiles(id);
      console.log(`[API] Client scraping complete:`, result);
      
      // Emit event
      await emitResearchJobEvent({
        researchJobId: id,
        source: 'api',
        code: 'client.scraping.complete',
        level: 'info',
        message: `Client scraping complete: ${result.scraped.length} scraped, ${result.skipped.length} skipped, ${result.errors.length} errors`,
        metrics: result,
      });
    })().catch(err => {
      console.error(`[API] Client scraping failed:`, err);
    });

    res.json({
      success: true,
      message: 'Client scraping started in background',
      platforms: ['instagram', 'tiktok']
    });

  } catch (error: any) {
    console.error('[API] Client scraping trigger failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
