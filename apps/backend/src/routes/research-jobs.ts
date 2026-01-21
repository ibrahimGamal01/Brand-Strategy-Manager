import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { gatherAllDDG, searchCompetitorsDDG, performDirectCompetitorSearch } from '../services/discovery/duckduckgo-search';
import { runCommunityDetective } from '../services/social/community-detective';
import { askAllDeepQuestions } from '../services/ai/deep-questions';
import { analyzeSearchTrends } from '../services/discovery/google-trends';
import { scrapeProfileIncrementally, scrapeProfileSafe } from '../services/social/scraper';
import { suggestCompetitorsWithAI } from '../services/ai/competitor-discovery';
import { evaluateCompetitorRelevance } from '../services/ai/competitor-evaluation';

// ... (imports)

const router = Router();

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

    const aggregatedCompetitors = await prisma.discoveredCompetitor.findMany({
        where: { researchJobId: { in: clientJobIds } },
        include: { competitor: true },
        orderBy: { discoveredAt: 'desc' }
    });

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

    // Aggregated raw results (deduplicated by href effectively via latest)
    const aggregatedRawResults = await prisma.rawSearchResult.findMany({
        where: { researchJobId: { in: clientJobIds } },
        orderBy: { createdAt: 'desc' },
        take: 100
    });
    
    // Merge aggregated data into the job response object
    // This makes the frontend show ALL historical data for this client
    const responseJob = {
        ...job,
        discoveredCompetitors: aggregatedCompetitors,
        searchTrends: aggregatedTrends,
        socialTrends: aggregatedSocialTrends,
        communityInsights: aggregatedInsights,
        aiQuestions: aggregatedQuestions,
        rawSearchResults: aggregatedRawResults,
    };

    res.json(responseJob);
  } catch (error: any) {
    console.error('[API] Error fetching research job:', error);
    res.status(500).json({ error: 'Failed to fetch research job', details: error.message });
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
        const results = [];
        
        // SOURCE 1: Search Code (Algorithmic / Existing Logic)
        if (scraper === 'competitors' || scraper === 'competitors_code') {
            console.log('[Competitors] Source 1: Running Algorithmic Search Code...');
            try {
                const rawHandles = await searchCompetitorsDDG(handle, niche || 'General', 50, id);
                
                // NO AI as per user request. Map to generic structure.
                const formatted = rawHandles.map(h => ({
                    handleOrUrl: h,
                    platform: 'unknown',
                    relevanceScore: 0.5,
                    reasoning: 'Algorithmic Search Result',
                    title: h
                }));
                
                results.push({ source: 'search_code', count: formatted.length });
                await saveCompetitors(job.clientId, id, formatted, 'search_code');
            } catch (e) {
                console.error('[Competitors] Search Code failed:', e);
            }
        }

        // SOURCE 2: Direct Direct Query ("Brand competitors")
        if (scraper === 'competitors' || scraper === 'competitors_direct') {
            console.log('[Competitors] Source 2: Running Direct Query Search...');
            try {
                const query = `${brandName || handle} competitors instagram`;
                const directHandles = await performDirectCompetitorSearch(query);
                
                // NO AI as per user request. Map to generic structure.
                const formatted = directHandles.map(h => ({
                    handleOrUrl: h,
                    platform: 'unknown',
                    relevanceScore: 0.5,
                    reasoning: 'Direct Search Query Result',
                    title: h
                }));

                results.push({ source: 'direct_query', count: formatted.length });
                await saveCompetitors(job.clientId, id, formatted, 'direct_query');
            } catch (e) {
                 console.error('[Competitors] Direct Query failed:', e);
            }
        }


    // SOURCE 3: AI Suggestions (Already clean)
        if (scraper === 'competitors' || scraper === 'competitors_ai') {
            console.log(`[Competitors] Source 3: Running AI Suggestions for brand "${brandName}" in niche "${niche}"...`);
            try {
                const aiSuggestions = await suggestCompetitorsWithAI(brandName || handle, niche || 'General');
                console.log(`[Competitors] Received ${aiSuggestions.length} suggestions from AI`);
                
                const formatted = aiSuggestions.map(s => ({
                    handleOrUrl: s.handle,
                    platform: s.platform,
                    relevanceScore: s.relevanceScore,
                    reasoning: s.reasoning,
                    title: s.name
                }));
                
                results.push({ source: 'ai_suggestion', count: formatted.length });
                await saveCompetitors(job.clientId, id, formatted, 'ai_suggestion');
                console.log('[Competitors] AI suggestions saved to database');
            } catch (e) {
                console.error('[Competitors] AI Suggestion failed:', e);
            }
        }
        
        result = { sources: results };
        break;


      }

      case 'community_insights':
        result = await runCommunityDetective(id, handle, brandName || handle);
        break;
        
      case 'trends':
        result = await analyzeSearchTrends(id, [brandName || handle]);
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
    
    console.log(`[API] Job ${id} cancelled by user`);
    res.json({ success: true, message: 'Job cancellation requested' });

  } catch (error: any) {
    console.error('[API] Failed to stop job:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
