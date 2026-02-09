import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { gatherAllDDG, searchCompetitorsDDG, performDirectCompetitorSearch } from '../services/discovery/duckduckgo-search';
import { runCommunityDetective } from '../services/social/community-detective';
import { askAllDeepQuestions } from '../services/ai/deep-questions';
import { analyzeSearchTrends } from '../services/discovery/google-trends';
import { scrapeProfileIncrementally, scrapeProfileSafe } from '../services/social/scraper';
import { suggestCompetitorsWithAI } from '../services/ai/competitor-discovery';
import { evaluateCompetitorRelevance } from '../services/ai/competitor-evaluation';
import { validateCompetitorBatch, filterValidatedCompetitors } from '../services/discovery/instagram-validator';

// ... (imports)

import { visualAggregationService } from '../services/analytics/visual-aggregation';

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
    
    // Transform socialProfiles posts to match frontend expectations
    // Database uses: likesCount, commentsCount, followers, following, etc.
    // Frontend expects: likes, comments, followerCount, followingCount, etc.
    const transformedSocialProfiles = job.socialProfiles?.map((profile: any) => ({
        ...profile,
        // Transform profile-level fields
        followerCount: profile.followers ?? 0,
        followingCount: profile.following ?? 0,
        // Keep original names for backwards compatibility
        followers: profile.followers ?? 0,
        following: profile.following ?? 0,
        posts: profile.posts?.map((post: any) => ({
            ...post,
            // Transform field names for frontend compatibility
            likes: post.likesCount ?? 0,
            comments: post.commentsCount ?? 0,
            shares: post.sharesCount ?? 0,
            views: post.viewsCount ?? 0,
            plays: post.playsCount ?? 0,
            // Map database fields to frontend Post interface
            id: post.id,
            caption: post.caption || '',
            postUrl: post.url,
            url: post.url,
            postedAt: post.postedAt,
            thumbnailUrl: post.thumbnailUrl,
            mediaAssets: post.mediaAssets || [],
        })) || []
    })) || [];

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
        socialProfiles: transformedSocialProfiles, // Use transformed profiles
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
        const results = [];
        const allCompetitors: Array<{ handle: string; handleOrUrl: string; platform: string; relevanceScore: number; reasoning: string; title: string }> = [];
        
        // SOURCE 1: Search Code (Algorithmic / Existing Logic)
        if (scraper === 'competitors' || scraper === 'competitors_code') {
            console.log('[Competitors] Source 1: Running Algorithmic Search Code...');
            try {
                const rawHandles = await searchCompetitorsDDG(handle, niche || 'General', 50, id);
                
                const formatted = rawHandles.map(h => ({
                    handle: h,
                    handleOrUrl: h,
                    platform: 'instagram',
                    relevanceScore: 0.5,
                    reasoning: 'Algorithmic Search Result',
                    title: h
                }));
                
                allCompetitors.push(...formatted);
                results.push({ source: 'search_code', count: formatted.length });
            } catch (e) {
                console.error('[Competitors] Search Code failed:', e);
            }
        }

        // SOURCE 2: Direct Query ("Brand competitors")
        if (scraper === 'competitors' || scraper === 'competitors_direct') {
            console.log('[Competitors] Source 2: Running Direct Query Search...');
            try {
                const query = `${brandName || handle} competitors instagram`;
                const directHandles = await performDirectCompetitorSearch(query);
                
                const formatted = directHandles.map(h => ({
                    handle: h,
                    handleOrUrl: h,
                    platform: 'instagram',
                    relevanceScore: 0.5,
                    reasoning: 'Direct Search Query Result',
                    title: h
                }));

                allCompetitors.push(...formatted);
                results.push({ source: 'direct_query', count: formatted.length });
            } catch (e) {
                 console.error('[Competitors] Direct Query failed:', e);
            }
        }

        // SOURCE 3: AI Suggestions (Multi-Platform: Instagram + TikTok)
        if (scraper === 'competitors' || scraper === 'competitors_ai') {
            console.log(`[Competitors] Source 3: Running AI Multi-Platform Discovery for brand "${brandName}" in niche "${niche}"...`);
            try {
                const { suggestCompetitorsMultiPlatform } = await import('../services/ai/competitor-discovery');
                const aiSuggestions = await suggestCompetitorsMultiPlatform(brandName || handle, niche || 'General');
                console.log(`[Competitors] Received ${aiSuggestions.length} multi-platform suggestions from AI`);
                
                const formatted = aiSuggestions.map(s => ({
                    handle: s.handle,
                    handleOrUrl: s.handle,
                    platform: s.platform,
                    relevanceScore: s.relevanceScore,
                    reasoning: s.reasoning,
                    title: s.name
                }));
                
                allCompetitors.push(...formatted);
                results.push({ source: 'ai_suggestion', count: formatted.length });
            } catch (e) {
                console.error('[Competitors] AI Suggestion failed:', e);
            }
        }
        
        // VALIDATION LAYER: Filter all collected competitors
        console.log(`[Competitors] Validating ${allCompetitors.length} total competitors...`);
        try {
            const validationResults = await validateCompetitorBatch(
                allCompetitors,
                niche || 'General',
                handle
            );
            
            const validatedCompetitors = filterValidatedCompetitors(
                allCompetitors,
                validationResults,
                0.75 // VERY strict minimum confidence (was 0.7, originally 0.5)
            );
            
            console.log(`[Competitors] Validation complete: ${validatedCompetitors.length}/${allCompetitors.length} passed validation`);
            
            // Save only validated competitors
            const toSave = validatedCompetitors.map(c => ({
                handleOrUrl: c.handle,
                platform: c.platform || 'instagram',
                relevanceScore: c.relevanceScore,
                reasoning: `${c.reasoning} (validated)`,
                title: c.title || c.handle,
            }));
            
            if (toSave.length > 0) {
                await saveCompetitors(job.clientId, id, toSave, 'validated_competitor');
            }
            
            results.push({ source: 'validation', verified: validatedCompetitors.length, rejected: allCompetitors.length - validatedCompetitors.length });
        } catch (validationError: any) {
            console.error('[Competitors] Validation failed, saving unvalidated:', validationError.message);
            // Fallback: save unvalidated competitors
            for (const comp of allCompetitors) {
                await saveCompetitors(job.clientId, id, [comp], 'unvalidated_competitor');
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

export default router;
