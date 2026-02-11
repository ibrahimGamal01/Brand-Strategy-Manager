import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { askAllDeepQuestions } from '../ai/deep-questions';
import {
  gatherAllDDG,
} from '../discovery/duckduckgo-search';
import { runTrendOrchestrator } from '../discovery/trends-orchestrator';
import {
  continueCompetitorScrape,
  orchestrateCompetitorsForJob,
} from '../discovery/competitor-orchestrator-v2';
import { ALL_COMPETITOR_SURFACES, CompetitorSurface } from '../discovery/competitor-platform-detector';
import { runCommunityDetective } from './community-detective';
import { scrapeProfileSafe } from './scraper';

export const MODULE_KEYS = [
  'client_profiles',
  'search_results',
  'images',
  'videos',
  'news',
  'search_trends',
  'competitors',
  'community_insights',
  'ai_questions',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleAction = 'delete' | 'continue' | 'run_from_start';

export interface ModuleActionResult {
  success: boolean;
  module: ModuleKey;
  action: ModuleAction;
  deletedCount: number;
  startedTasks: string[];
  skippedTasks: string[];
  errors: string[];
  warnings: string[];
  attemptedKeywords?: string[];
}

export interface ResumeResearchResult {
  success: boolean;
  partial: boolean;
  jobId: string;
  modulesRun: ModuleKey[];
  skippedModules: ModuleKey[];
  moduleResults: ModuleActionResult[];
  errors: string[];
  warnings: string[];
}

type JobContext = {
  id: string;
  inputData: Record<string, any>;
  clientId: string;
  status: string;
  client: {
    id: string;
    name: string;
    businessOverview: string | null;
    goalsKpis: string | null;
    clientAccounts: Array<{
      id: string;
      platform: string;
      handle: string;
      bio: string | null;
    }>;
    brainProfile: {
      id: string;
      primaryGoal: string | null;
      secondaryGoals: Prisma.JsonValue | null;
      offerModel: string | null;
      businessType: string | null;
      constraints: Prisma.JsonValue | null;
      goals: Array<{
        goalType: string;
        targetValue: string | null;
      }>;
    } | null;
  };
};

type ContinueResult = {
  startedTasks: string[];
  skippedTasks: string[];
  errors: string[];
  warnings: string[];
  attemptedKeywords?: string[];
};

interface CompetitorCandidate {
  handle: string;
  platform: string;
  relevanceScore: number;
  reasoning: string;
  title?: string;
}

const moduleActionLocks = new Set<string>();
const resumeLocks = new Set<string>();

export function isModuleKey(value: string): value is ModuleKey {
  return MODULE_KEYS.includes(value as ModuleKey);
}

function normalizeHandle(value: string): string {
  return value.replace(/^@+/, '').trim().toLowerCase();
}

function dedupeTargets(targets: Array<{ platform: string; handle: string }>) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.platform}:${target.handle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getJobCoreContext(job: JobContext) {
  const input = job.inputData || {};
  const instagramAccount = job.client.clientAccounts.find((acc) => acc.platform === 'instagram');
  const fallbackAccount = job.client.clientAccounts[0];

  const handle = normalizeHandle(
    String(input.handle || input.handles?.instagram || instagramAccount?.handle || fallbackAccount?.handle || '')
  );

  const brandName = String(input.brandName || job.client.name || handle).trim();
  const niche = String(input.niche || 'business').trim();
  const bio = instagramAccount?.bio || fallbackAccount?.bio || undefined;

  return {
    handle,
    brandName,
    niche,
    bio,
    businessOverview: job.client.businessOverview || undefined,
  };
}

function collectClientTargets(job: JobContext): Array<{ platform: string; handle: string }> {
  const inputHandles = (job.inputData?.handles || {}) as Record<string, string>;
  const targets: Array<{ platform: string; handle: string }> = [];

  for (const [platform, handle] of Object.entries(inputHandles)) {
    const normalizedPlatform = platform.toLowerCase();
    if (normalizedPlatform !== 'instagram' && normalizedPlatform !== 'tiktok') {
      continue;
    }

    if (!handle || typeof handle !== 'string') {
      continue;
    }

    targets.push({
      platform: normalizedPlatform,
      handle: normalizeHandle(handle),
    });
  }

  for (const account of job.client.clientAccounts) {
    const platform = account.platform.toLowerCase();
    if (platform !== 'instagram' && platform !== 'tiktok') {
      continue;
    }

    targets.push({
      platform,
      handle: normalizeHandle(account.handle),
    });
  }

  return dedupeTargets(targets);
}

async function getJobContext(jobId: string): Promise<JobContext | null> {
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    include: {
      client: {
        include: {
          clientAccounts: {
            select: {
              id: true,
              platform: true,
              handle: true,
              bio: true,
            },
          },
          brainProfile: {
            include: {
              goals: {
                select: {
                  goalType: true,
                  targetValue: true,
                },
                orderBy: { priority: 'asc' },
              },
            },
          },
        },
      },
    },
  });

  if (!job || !job.client) {
    return null;
  }

  return {
    id: job.id,
    inputData: (job.inputData || {}) as Record<string, any>,
    clientId: job.clientId,
    status: job.status,
    client: {
      id: job.client.id,
      name: job.client.name,
      businessOverview: job.client.businessOverview,
      goalsKpis: job.client.goalsKpis,
      clientAccounts: job.client.clientAccounts,
      brainProfile: job.client.brainProfile,
    },
  };
}

function keywordScore(text: string, keywords: string[]): number {
  const value = text.toLowerCase();
  return keywords.reduce((score, keyword) => (value.includes(keyword) ? score + 1 : score), 0);
}

function extractGoalSignals(job: JobContext): {
  sales: number;
  engagement: number;
  authority: number;
} {
  const brainGoals = job.client.brainProfile?.goals || [];
  const secondaryGoals = Array.isArray(job.client.brainProfile?.secondaryGoals)
    ? (job.client.brainProfile?.secondaryGoals as unknown[])
    : [];
  const goalText = [
    String(job.inputData?.primaryGoal || ''),
    String(job.inputData?.futureGoal || ''),
    String(job.client.goalsKpis || ''),
    String(job.client.brainProfile?.primaryGoal || ''),
    ...secondaryGoals.map((goal) => String(goal || '')),
    ...brainGoals.map((goal) => `${goal.goalType}:${goal.targetValue || ''}`),
  ]
    .join(' ')
    .toLowerCase();

  const sales = keywordScore(goalText, [
    'sale',
    'sales',
    'revenue',
    'lead',
    'conversion',
    'booked',
    'booking',
    'customer',
    'purchase',
    'checkout',
    'roas',
    'cac',
  ]);
  const engagement = keywordScore(goalText, [
    'engagement',
    'community',
    'followers',
    'reach',
    'views',
    'awareness',
    'retention',
    'audience',
    'growth',
    'viral',
  ]);
  const authority = keywordScore(goalText, [
    'authority',
    'positioning',
    'trust',
    'narrative',
    'brand',
    'thought leadership',
    'credibility',
    'premium',
    'expert',
  ]);

  return { sales, engagement, authority };
}

function getAutonomyModuleOrder(job: JobContext): ModuleKey[] {
  const baseOrder: ModuleKey[] = [
    'client_profiles',
    'search_results',
    'images',
    'videos',
    'news',
    'competitors',
    'community_insights',
    'search_trends',
    'ai_questions',
  ];

  const signals = extractGoalSignals(job);
  if (signals.sales >= signals.engagement && signals.sales >= signals.authority && signals.sales > 0) {
    return [
      'client_profiles',
      'competitors',
      'search_results',
      'images',
      'videos',
      'community_insights',
      'news',
      'search_trends',
      'ai_questions',
    ];
  }

  if (signals.engagement >= signals.sales && signals.engagement >= signals.authority && signals.engagement > 0) {
    return [
      'client_profiles',
      'search_results',
      'images',
      'videos',
      'community_insights',
      'competitors',
      'search_trends',
      'news',
      'ai_questions',
    ];
  }

  if (signals.authority > 0) {
    return [
      'client_profiles',
      'search_results',
      'news',
      'competitors',
      'community_insights',
      'images',
      'videos',
      'search_trends',
      'ai_questions',
    ];
  }

  return baseOrder;
}

async function saveCompetitorCandidates(job: JobContext, candidates: CompetitorCandidate[]) {
  let savedCount = 0;

  for (const candidate of candidates) {
    try {
      const competitor = await prisma.competitor.upsert({
        where: {
          clientId_platform_handle: {
            clientId: job.clientId,
            platform: candidate.platform,
            handle: candidate.handle,
          },
        },
        update: {},
        create: {
          clientId: job.clientId,
          platform: candidate.platform,
          handle: candidate.handle,
          name: candidate.title,
        },
      });

      const existing = await prisma.discoveredCompetitor.findFirst({
        where: {
          researchJobId: job.id,
          competitorId: competitor.id,
        },
      });

      if (existing) {
        continue;
      }

      await prisma.discoveredCompetitor.create({
        data: {
          researchJobId: job.id,
          competitorId: competitor.id,
          handle: candidate.handle,
          platform: candidate.platform,
          relevanceScore: candidate.relevanceScore,
          discoveryReason: candidate.reasoning,
          status: 'SUGGESTED',
        },
      });

      savedCount += 1;
    } catch (error) {
      console.error('[ResearchResume] Failed to save competitor candidate:', error);
    }
  }

  return savedCount;
}

async function discoverCompetitors(job: JobContext): Promise<{ savedCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  try {
    const allowedSurfaces = new Set<string>(ALL_COMPETITOR_SURFACES);
    const requestedSurfaces = Array.isArray(job.inputData?.surfaces)
      ? Array.from(
          new Set(
            (job.inputData.surfaces as unknown[])
              .map((entry) => String(entry || '').toLowerCase().trim())
              .filter((entry) => allowedSurfaces.has(entry))
          )
        ) as CompetitorSurface[]
      : undefined;

    const orchestration = await orchestrateCompetitorsForJob(job.id, {
      mode: 'append',
      surfaces: requestedSurfaces && requestedSurfaces.length > 0 ? requestedSurfaces : undefined,
      targetCount: Math.max(job.inputData?.competitorsToFind || 10, 5),
      precision: 'high',
      connectorPolicy: 'ddg_first_pluggable',
    });

    const savedCount = orchestration.summary.shortlisted;
    if (savedCount === 0) {
      warnings.push('Competitor orchestration completed but no shortlist was produced');
    }

    return { savedCount, warnings };
  } catch (error: any) {
    warnings.push(`Competitor orchestration failed: ${error?.message || String(error)}`);
    return { savedCount: 0, warnings };
  }
}

async function deleteModuleData(job: JobContext, module: ModuleKey): Promise<{ deletedCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  let deletedCount = 0;

  switch (module) {
    case 'client_profiles': {
      const targets = collectClientTargets(job);

      if (!targets.length) {
        warnings.push('No client profile targets found');
        break;
      }

      const profiles = await prisma.socialProfile.findMany({
        where: {
          researchJobId: job.id,
          OR: targets.map((target) => ({ platform: target.platform, handle: target.handle })),
        },
        select: { id: true },
      });

      const profileIds = profiles.map((profile) => profile.id);
      if (profileIds.length > 0) {
        const deletedPosts = await prisma.socialPost.deleteMany({
          where: { socialProfileId: { in: profileIds } },
        });
        deletedCount += deletedPosts.count;

        const deletedProfiles = await prisma.socialProfile.deleteMany({
          where: { id: { in: profileIds } },
        });
        deletedCount += deletedProfiles.count;
      }

      const deletedSnapshots = await prisma.clientProfileSnapshot.deleteMany({
        where: { researchJobId: job.id },
      });
      deletedCount += deletedSnapshots.count;

      break;
    }

    case 'search_results': {
      const deleted = await prisma.rawSearchResult.deleteMany({ where: { researchJobId: job.id } });
      deletedCount += deleted.count;
      break;
    }

    case 'images': {
      const deleted = await prisma.ddgImageResult.deleteMany({ where: { researchJobId: job.id } });
      deletedCount += deleted.count;
      break;
    }

    case 'videos': {
      const deleted = await prisma.ddgVideoResult.deleteMany({ where: { researchJobId: job.id } });
      deletedCount += deleted.count;
      break;
    }

    case 'news': {
      const deleted = await prisma.ddgNewsResult.deleteMany({ where: { researchJobId: job.id } });
      deletedCount += deleted.count;
      break;
    }

    case 'search_trends': {
      const deleted = await prisma.searchTrend.deleteMany({ where: { researchJobId: job.id } });
      deletedCount += deleted.count;
      break;
    }

    case 'competitors': {
      const discovered = await prisma.discoveredCompetitor.findMany({
        where: { researchJobId: job.id },
        select: {
          id: true,
          handle: true,
          platform: true,
        },
      });

      if (discovered.length > 0) {
        const deletedDiscovered = await prisma.discoveredCompetitor.deleteMany({
          where: { researchJobId: job.id },
        });
        deletedCount += deletedDiscovered.count;

        const competitorProfileFilters = dedupeTargets(
          discovered.map((item) => ({ platform: item.platform, handle: item.handle }))
        );

        if (competitorProfileFilters.length > 0) {
          const profiles = await prisma.socialProfile.findMany({
            where: {
              researchJobId: job.id,
              OR: competitorProfileFilters,
            },
            select: { id: true },
          });

          const profileIds = profiles.map((profile) => profile.id);
          if (profileIds.length > 0) {
            const deletedPosts = await prisma.socialPost.deleteMany({
              where: { socialProfileId: { in: profileIds } },
            });
            deletedCount += deletedPosts.count;

            const deletedProfiles = await prisma.socialProfile.deleteMany({
              where: { id: { in: profileIds } },
            });
            deletedCount += deletedProfiles.count;
          }
        }
      }

      const deletedSnapshots = await prisma.competitorProfileSnapshot.deleteMany({
        where: { researchJobId: job.id },
      });
      deletedCount += deletedSnapshots.count;

      break;
    }

    case 'community_insights': {
      const deleted = await prisma.communityInsight.deleteMany({ where: { researchJobId: job.id } });
      deletedCount += deleted.count;
      break;
    }

    case 'ai_questions': {
      const deleted = await prisma.aiQuestion.deleteMany({ where: { researchJobId: job.id } });
      deletedCount += deleted.count;
      break;
    }

    default:
      break;
  }

  return { deletedCount, warnings };
}

async function hasModuleData(jobId: string, module: ModuleKey): Promise<boolean> {
  switch (module) {
    case 'client_profiles': {
      const count = await prisma.socialProfile.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'search_results': {
      const count = await prisma.rawSearchResult.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'images': {
      const count = await prisma.ddgImageResult.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'videos': {
      const count = await prisma.ddgVideoResult.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'news': {
      const count = await prisma.ddgNewsResult.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'search_trends': {
      const count = await prisma.searchTrend.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'competitors': {
      const count = await prisma.discoveredCompetitor.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'community_insights': {
      const count = await prisma.communityInsight.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    case 'ai_questions': {
      const count = await prisma.aiQuestion.count({ where: { researchJobId: jobId } });
      return count > 0;
    }
    default:
      return false;
  }
}

async function continueModuleData(job: JobContext, module: ModuleKey): Promise<ContinueResult> {
  const startedTasks: string[] = [];
  const skippedTasks: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let attemptedKeywords: string[] | undefined;

  const coreContext = getJobCoreContext(job);

  switch (module) {
    case 'client_profiles': {
      const targets = collectClientTargets(job);

      if (!targets.length) {
        warnings.push('No Instagram/TikTok handles available to scrape');
        break;
      }

      for (const target of targets) {
        const existingProfile = await prisma.socialProfile.findUnique({
          where: {
            researchJobId_platform_handle: {
              researchJobId: job.id,
              platform: target.platform,
              handle: target.handle,
            },
          },
          select: { id: true },
        });

        if (existingProfile) {
          const postsCount = await prisma.socialPost.count({
            where: { socialProfileId: existingProfile.id },
          });

          if (postsCount > 0) {
            skippedTasks.push(`profile_has_data:${target.platform}:${target.handle}`);
            continue;
          }
        }

        startedTasks.push(`scrape:${target.platform}:${target.handle}`);

        const scrapeResult = await scrapeProfileSafe(job.id, target.platform, target.handle);
        if (!scrapeResult.success) {
          errors.push(`Failed to scrape ${target.platform}:@${target.handle} - ${scrapeResult.error}`);
        }
      }

      break;
    }

    case 'search_results':
    case 'images':
    case 'videos':
    case 'news': {
      const hasData = await hasModuleData(job.id, module);
      if (hasData) {
        skippedTasks.push('module_already_has_data');
        break;
      }

      if (!coreContext.brandName && !coreContext.handle) {
        errors.push('Missing brand/handle context for DDG search');
        break;
      }

      startedTasks.push('gather_all_ddg');

      try {
        await gatherAllDDG(coreContext.brandName || coreContext.handle, coreContext.niche || 'business', job.id);
      } catch (error) {
        errors.push(`DDG gather failed: ${(error as Error).message}`);
      }

      const nowHasData = await hasModuleData(job.id, module);
      if (!nowHasData) {
        warnings.push(`No data returned for module ${module}`);
      }
      break;
    }

    case 'search_trends': {
      const hasData = await hasModuleData(job.id, module);
      if (hasData) {
        skippedTasks.push('module_already_has_data');
        break;
      }

      startedTasks.push('run_trend_orchestrator');

      try {
        const trendResult = await runTrendOrchestrator({
          researchJobId: job.id,
          handle: coreContext.handle,
          brandName: coreContext.brandName,
          niche: coreContext.niche,
          bio: coreContext.bio,
          businessOverview: coreContext.businessOverview,
        });

        attemptedKeywords = trendResult.attemptedKeywords;

        if (trendResult.insertedCount === 0) {
          warnings.push('No trend rows were inserted by the orchestrator');
        }
      } catch (error) {
        errors.push(`Trends orchestrator failed: ${(error as Error).message}`);
      }

      break;
    }

    case 'competitors': {
      const discoveredCount = await prisma.discoveredCompetitor.count({
        where: {
          researchJobId: job.id,
          selectionState: { in: ['TOP_PICK', 'SHORTLISTED', 'APPROVED'] },
        },
      });

      if (discoveredCount === 0) {
        startedTasks.push('discover_competitors');

        const discovery = await discoverCompetitors(job);
        warnings.push(...discovery.warnings);

        if (discovery.savedCount === 0) {
          warnings.push('No competitors were discovered/saved during continue');
        }
      } else {
        skippedTasks.push('competitors_already_discovered');
      }

      const continueResult = await continueCompetitorScrape(job.id, {
        onlyPending: true,
      });
      if (continueResult.queuedCount > 0) {
        startedTasks.push('scrape_pending_competitors');
      } else {
        skippedTasks.push('no_pending_competitors_to_scrape');
      }

      break;
    }

    case 'community_insights': {
      const hasData = await hasModuleData(job.id, module);
      if (hasData) {
        skippedTasks.push('module_already_has_data');
        break;
      }

      startedTasks.push('run_community_detective');

      try {
        await runCommunityDetective(
          job.id,
          coreContext.brandName || coreContext.handle,
          coreContext.niche || 'business',
          coreContext.handle || undefined
        );
      } catch (error) {
        errors.push(`Community insights failed: ${(error as Error).message}`);
      }

      break;
    }

    case 'ai_questions': {
      const answeredCount = await prisma.aiQuestion.count({
        where: {
          researchJobId: job.id,
          isAnswered: true,
        },
      });

      if (answeredCount >= 13) {
        skippedTasks.push('ai_questions_already_answered');
        break;
      }

      startedTasks.push('ask_deep_questions');

      try {
        await askAllDeepQuestions(job.id, {
          brandName: coreContext.brandName || coreContext.handle,
          handle: coreContext.handle,
          bio: coreContext.bio,
          niche: coreContext.niche,
        });
      } catch (error) {
        errors.push(`AI questions failed: ${(error as Error).message}`);
      }

      break;
    }

    default:
      break;
  }

  return {
    startedTasks,
    skippedTasks,
    errors,
    warnings,
    attemptedKeywords,
  };
}

export async function performResearchModuleAction(
  jobId: string,
  module: ModuleKey,
  action: ModuleAction
): Promise<ModuleActionResult> {
  const lockKey = `${jobId}:${module}`;

  if (moduleActionLocks.has(lockKey)) {
    return {
      success: false,
      module,
      action,
      deletedCount: 0,
      startedTasks: [],
      skippedTasks: [],
      errors: ['Module action already running'],
      warnings: [],
    };
  }

  moduleActionLocks.add(lockKey);

  try {
    const job = await getJobContext(jobId);

    if (!job) {
      return {
        success: false,
        module,
        action,
        deletedCount: 0,
        startedTasks: [],
        skippedTasks: [],
        errors: ['Research job not found'],
        warnings: [],
      };
    }

    const startedTasks: string[] = [];
    const skippedTasks: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    let deletedCount = 0;
    let attemptedKeywords: string[] | undefined;

    if (action === 'delete' || action === 'run_from_start') {
      const deletion = await deleteModuleData(job, module);
      deletedCount += deletion.deletedCount;
      warnings.push(...deletion.warnings);
    }

    if (action === 'continue' || action === 'run_from_start') {
      const continuation = await continueModuleData(job, module);
      startedTasks.push(...continuation.startedTasks);
      skippedTasks.push(...continuation.skippedTasks);
      errors.push(...continuation.errors);
      warnings.push(...continuation.warnings);
      attemptedKeywords = continuation.attemptedKeywords;
    }

    return {
      success: errors.length === 0,
      module,
      action,
      deletedCount,
      startedTasks,
      skippedTasks,
      errors,
      warnings,
      attemptedKeywords,
    };
  } finally {
    moduleActionLocks.delete(lockKey);
  }
}

function getStatusForModule(module: ModuleKey): string {
  switch (module) {
    case 'client_profiles':
      return 'SCRAPING_CLIENT';
    case 'search_results':
    case 'images':
    case 'videos':
    case 'news':
    case 'competitors':
    case 'community_insights':
      return 'DISCOVERING_COMPETITORS';
    case 'search_trends':
    case 'ai_questions':
      return 'ANALYZING';
    default:
      return 'PENDING';
  }
}

export async function resumeResearchJob(jobId: string): Promise<ResumeResearchResult> {
  if (resumeLocks.has(jobId)) {
    return {
      success: false,
      partial: true,
      jobId,
      modulesRun: [],
      skippedModules: [],
      moduleResults: [],
      errors: ['Resume is already in progress for this job'],
      warnings: [],
    };
  }

  resumeLocks.add(jobId);

  const moduleResults: ModuleActionResult[] = [];
  const modulesRun: ModuleKey[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const job = await getJobContext(jobId);

    if (!job) {
      return {
        success: false,
        partial: false,
        jobId,
        modulesRun,
        skippedModules: [],
        moduleResults,
        errors: ['Research job not found'],
        warnings,
      };
    }

    await prisma.researchJob.update({
      where: { id: jobId },
      data: {
        status: 'SCRAPING_CLIENT' as any,
        errorMessage: null,
      },
    });

    const orderedModules = getAutonomyModuleOrder(job);

    for (const module of orderedModules) {
      await prisma.researchJob.update({
        where: { id: jobId },
        data: {
          status: getStatusForModule(module) as any,
        },
      });

      const result = await performResearchModuleAction(jobId, module, 'continue');
      modulesRun.push(module);
      moduleResults.push(result);

      if (result.errors.length > 0) {
        errors.push(...result.errors.map((error) => `${module}: ${error}`));
      }

      if (result.warnings.length > 0) {
        warnings.push(...result.warnings.map((warning) => `${module}: ${warning}`));
      }
    }

    const skippedModules = moduleResults
      .filter((result) => result.startedTasks.length === 0 && result.deletedCount === 0)
      .map((result) => result.module);

    const success = errors.length === 0;

    await prisma.researchJob.update({
      where: { id: jobId },
      data: success
        ? {
            status: 'COMPLETE' as any,
            completedAt: new Date(),
            errorMessage: null,
          }
        : {
            status: 'FAILED' as any,
            errorMessage: errors.slice(0, 5).join(' | '),
          },
    });

    return {
      success,
      partial: !success,
      jobId,
      modulesRun,
      skippedModules,
      moduleResults,
      errors,
      warnings,
    };
  } catch (error) {
    const message = (error as Error).message;

    try {
      await prisma.researchJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED' as any,
          errorMessage: message,
        },
      });
    } catch {
      // Ignore update errors on failure path.
    }

    return {
      success: false,
      partial: false,
      jobId,
      modulesRun,
      skippedModules: [],
      moduleResults,
      errors: [message],
      warnings,
    };
  } finally {
    resumeLocks.delete(jobId);
  }
}
