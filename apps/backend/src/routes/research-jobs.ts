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
import {
  emitResearchJobEvent,
  listResearchJobEvents,
  serializeResearchJobEventSse,
  subscribeResearchJobEvents,
} from '../services/social/research-job-events';

// ... (imports)

import { visualAggregationService } from '../services/analytics/visual-aggregation';
import { fileManager } from '../services/storage/file-manager';

const router = Router();

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
                    mediaAssets: true,
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
                mediaAssets: true
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
        include: { posts: { include: { mediaAssets: true } }, clientProfile: true },
        orderBy: { scrapedAt: 'desc' }
    });

    const competitorProfileSnapshots = await prisma.competitorProfileSnapshot.findMany({
        where: { researchJobId: { in: clientJobIds } },
        include: { posts: { include: { mediaAssets: true } }, competitorProfile: true },
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

    const transformedSocialProfiles = job.socialProfiles?.map((profile: any) => ({
        ...profile,
        followerCount: profile.followers ?? 0,
        followingCount: profile.following ?? 0,
        followers: profile.followers ?? 0,
        following: profile.following ?? 0,
        posts: profile.posts?.map((post: any) => {
            const mediaAssets = (post.mediaAssets || []).map((m: any) => ({
                ...m,
                url: pathToUrl(m.blobStoragePath),
                thumbnailUrl: pathToUrl(m.thumbnailPath) || pathToUrl(m.blobStoragePath) || m.originalUrl,
            }));
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
        }) || []
    })) || [];

    // Merge aggregated data into the job response object
    // This makes the frontend show ALL historical data for this client
    const transformSnapshotPosts = (posts: any[]) => posts.map(p => {
        const mediaAssets = (p.mediaAssets || []).map((m: any) => ({
            ...m,
            url: pathToUrl(m.blobStoragePath),
            thumbnailUrl: pathToUrl(m.thumbnailPath) || pathToUrl(m.blobStoragePath) || m.originalUrl,
        }));
        return { ...p, mediaAssets };
    });

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
        brainProfile: job.client?.brainProfile || null,
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
    };

    res.json(responseJob);
  } catch (error: any) {
    console.error('[API] Error fetching research job:', error);
    res.status(500).json({ error: 'Failed to fetch research job', details: error.message });
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

function inferBrainCommandType(instruction: string): any {
  const text = instruction.toLowerCase();
  if (/(remove|delete).*(competitor)/i.test(text)) return 'REMOVE_COMPETITOR';
  if (/(add|insert|include).*(competitor)/i.test(text)) return 'ADD_COMPETITOR';
  if (/(goal|kpi|target)/i.test(text)) return 'UPDATE_GOAL';
  if (/(run|execute|refresh).*(section|module)/i.test(text)) return 'RUN_SECTION';
  if (/(update|edit|change).*(context|profile|business)/i.test(text)) return 'UPDATE_CONTEXT';
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
 * GET /api/research-jobs/:id/brain
 * Fetch editable brain context for a research job.
 */
router.get('/:id/brain', async (req: Request, res: Response) => {
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
        brainCommands: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    const latestRun = await prisma.competitorOrchestrationRun.findFirst({
      where: { researchJobId: id },
      orderBy: { createdAt: 'desc' },
    });

    const [topPicks, shortlisted, approved, filtered] = await Promise.all([
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'TOP_PICK' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'SHORTLISTED' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'APPROVED' } }),
      prisma.competitorCandidateProfile.count({ where: { researchJobId: id, state: 'FILTERED_OUT' } }),
    ]);

    return res.json({
      success: true,
      researchJobId: id,
      client: {
        id: job.client.id,
        name: job.client.name,
        accounts: job.client.clientAccounts,
      },
      brainProfile: job.client.brainProfile,
      commandHistory: job.brainCommands,
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

    const command = await prisma.brainCommand.create({
      data: {
        researchJobId: id,
        section,
        commandType,
        instruction,
        proposedPatch: proposedPatch as any,
        status: dryRun ? 'PENDING' : requiresApproval ? 'PENDING' : 'APPLIED',
        createdBy,
      },
    });

    return res.json({
      success: true,
      commandId: command.id,
      proposedPatch,
      requiresApproval,
      dryRun,
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
    const command = await prisma.brainCommand.findFirst({
      where: { id: commandId, researchJobId: id },
      include: { researchJob: true },
    });

    if (!command) {
      return res.status(404).json({ success: false, error: 'Brain command not found' });
    }

    const patch = (command.proposedPatch || {}) as Record<string, unknown>;
    let appliedPatch: Record<string, unknown> = { ...patch };

    if (command.commandType === 'ADD_COMPETITOR') {
      const handle = String(patch.handle || '').trim().replace(/^@+/, '');
      const platform = String(patch.platform || 'instagram').trim().toLowerCase();
      if (!handle) {
        throw new Error('ADD_COMPETITOR command missing handle');
      }

      await prisma.discoveredCompetitor.upsert({
        where: {
          researchJobId_platform_handle: {
            researchJobId: id,
            platform,
            handle,
          },
        },
        update: {
          selectionState: 'APPROVED',
          status: 'SUGGESTED',
          availabilityStatus: 'UNVERIFIED',
          selectionReason: 'Manually added from Brain command',
          discoveryReason: command.instruction,
        },
        create: {
          researchJobId: id,
          platform,
          handle,
          selectionState: 'APPROVED',
          status: 'SUGGESTED',
          availabilityStatus: 'UNVERIFIED',
          selectionReason: 'Manually added from Brain command',
          discoveryReason: command.instruction,
        },
      });
      appliedPatch.action = 'competitor_added';
    } else if (command.commandType === 'REMOVE_COMPETITOR') {
      const handle = String(patch.handle || '').trim().replace(/^@+/, '');
      const platform = String(patch.platform || 'instagram').trim().toLowerCase();
      if (!handle) {
        throw new Error('REMOVE_COMPETITOR command missing handle');
      }

      await prisma.discoveredCompetitor.updateMany({
        where: { researchJobId: id, platform, handle },
        data: {
          selectionState: 'REJECTED',
          status: 'REJECTED',
          selectionReason: `Removed via Brain command: ${command.instruction}`,
        },
      });
      appliedPatch.action = 'competitor_removed';
    } else if (command.commandType === 'RUN_SECTION') {
      const moduleGuess = String(command.section || '').toLowerCase();
      const moduleKey = isModuleKey(moduleGuess) ? moduleGuess : 'competitors';
      const result = await performResearchModuleAction(id, moduleKey, 'continue');
      appliedPatch = {
        ...appliedPatch,
        action: 'module_run',
        module: moduleKey,
        result,
      };
    }

    const updated = await prisma.brainCommand.update({
      where: { id: command.id },
      data: {
        status: 'APPLIED',
        appliedPatch: appliedPatch as any,
        appliedAt: new Date(),
        error: null,
      },
    });

    return res.json({ success: true, command: updated });
  } catch (error: any) {
    console.error('[API] Error applying brain command:', error);
    const message = error?.message || 'Failed to apply brain command';
    if (req.params.commandId) {
      await prisma.brainCommand
        .update({
          where: { id: req.params.commandId },
          data: { status: 'FAILED', error: message },
        })
        .catch(() => undefined);
    }
    return res.status(500).json({ success: false, error: message });
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
 * POST /api/research-jobs/:id/rerun/:scraper
 * Re-run a specific scraper for a research job
 */
router.post('/:id/rerun/:scraper', async (req: Request, res: Response) => {
  try {
    const { id, scraper } = req.params;
    
    // Get job to find input data
    const job = await prisma.researchJob.findUnique({
      where: { id },
      include: { client: true }
    });

    if (!job) {
      return res.status(404).json({ error: 'Research job not found' });
    }

    const { handle, brandName, niche } = job.inputData as any;
    
    console.log(`[API] Re-running ${scraper} for job ${id} (@${handle})`);

    // Run scraper asynchronously (fire and forget from API perspective, but could block if needed)
    // For now we'll await it to simpler feedback, or we could run in background
    
    let result;

    switch (scraper) {
      case 'instagram':
        // Run in background (Fire & Forget)
        scrapeProfileSafe(id, 'instagram', handle).then(res => {
            console.log(`[Background] Instagram scrape finished:`, res);
        });
        result = { status: 'started_background', message: 'Instagram scrape started in background' };
        break;

      case 'tiktok':
         // Run in background (Fire & Forget)
        scrapeProfileSafe(id, 'tiktok', handle).then(res => {
            console.log(`[Background] TikTok scrape finished:`, res);
        });
        result = { status: 'started_background', message: 'TikTok scrape started in background' };
        break;
        
      case 'scrape_social_images':
      case 'social_images':
        // Scrape images from Instagram/TikTok using site-limited search
        // This populates ddgImageResult collection
        try {
          const { scrapeSocialContent } = await import('../services/discovery/duckduckgo-search');
          const clientAccounts = await prisma.clientAccount.findMany({
            where: { clientId: job.clientId },
          });
          
          const handles: Record<string, string> = {};
          clientAccounts.forEach(acc => {
            if (acc.handle) {
              handles[acc.platform] = acc.handle;
            }
          });
          
          if (Object.keys(handles).length === 0) {
            // Fallback to input handle
            handles.instagram = handle;
          }
          
          console.log(`[API] Scraping social images for: ${Object.entries(handles).map(([p, h]) => `${p}:@${h}`).join(', ')}`);
          result = await scrapeSocialContent(handles, 30, id);
        } catch (error: any) {
          result = { error: error.message };
        }
        break;
        
      case 'ddg_search':
      case 'ddg_images': 
      case 'ddg_videos':
      case 'ddg_news':
        // All DDG types run together in gatherAllDDG for efficiency
        result = await gatherAllDDG(brandName || handle, niche || 'General', id);
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

