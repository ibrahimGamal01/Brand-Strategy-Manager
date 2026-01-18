import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { scrapeInstagramProfile } from '../services/scraper/instagram-service';
import { aiValidator } from '../services/ai/validator';

const router = Router();

/**
 * GET /api/clients
 * List all clients
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        clientAccounts: true,
        personas: true,
        researchJobs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
    res.json(clients);
  } catch (error: any) {
    console.error('[API] Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients', details: error.message });
  }
});

/**
 * POST /api/clients
 * Create new client and start research job
 * 
 * Body:
 * {
 *   "name": "Client Name",
 *   "handle": "@ummahpreneur",
 *   "platform": "instagram"
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, handle, platform = 'instagram' } = req.body;

    if (!name || !handle) {
      return res.status(400).json({ error: 'Name and handle are required' });
    }

    const cleanHandle = handle.replace(/^@+/, '').toLowerCase().trim();

    // Check if client with this handle already exists (continuity mode)
    const existingAccount = await prisma.clientAccount.findFirst({
      where: {
        handle: cleanHandle,
        platform: platform,
      },
      include: {
        client: true,
      },
    });

    let client;
    if (existingAccount?.client) {
      // Reuse existing client for continuous info gathering
      client = existingAccount.client;
      console.log(`[API] Found existing client for @${cleanHandle}: ${client.id} (${client.name})`);
    } else {
      // Create new client
      console.log(`[API] Creating new client: ${name} (@${cleanHandle})`);
      client = await prisma.client.create({
        data: {
          name,
        },
      });
      console.log(`[API] Client created: ${client.id}`);
    }

    // Step 2: Create research job
    const researchJob = await prisma.researchJob.create({
      data: {
        clientId: client.id,
        status: 'PENDING',
        startedAt: new Date(),
        inputData: {
          handle: cleanHandle,
          platform,
        },
      },
    });

    console.log(`[API] Research job created: ${researchJob.id}`);

    // Step 3: Start scraping process asynchronously
    // Don't await this - let it run in background
    scrapeAndSaveClientData(researchJob.id, client.id, cleanHandle, platform)
      .catch(error => {
        console.error(`[API] Scraping failed for job ${researchJob.id}:`, error);
      });

    // Return immediately with job ID
    res.json({
      success: true,
      client,
      researchJob: {
        id: researchJob.id,
        status: researchJob.status,
      },
      message: 'Research job started. Check status at /api/research-jobs/' + researchJob.id,
    });
  } catch (error: any) {
    console.error('[API] Error creating client:', error);
    res.status(500).json({ error: 'Failed to create client', details: error.message });
  }
});

/**
 * Background function: Complete 7-step research pipeline
 * 1-2: Scrape + validate ✅
 * 3: Download media
 * 4: AI analyze posts
 * 5: Discover competitors
 * 6: Scrape brand mentions
 * 7: Analyze brand mentions
 */
async function scrapeAndSaveClientData(
  jobId: string,
  clientId: string,
  handle: string,
  platform: string
) {
  try {
    // ==== STEP 1-2: Scrape + Validate ====
    await updateJobStatus(jobId, 'SCRAPING_CLIENT');
    console.log(`[Job ${jobId}] Step 1-2: Scraping profile for @${handle}`);

    const scrapeResult = await scrapeInstagramProfile(handle, 30);

    if (!scrapeResult.success || !scrapeResult.data) {
      throw new Error(scrapeResult.error || 'Scraping failed');
    }

    const profileData = scrapeResult.data;

    // AI validation
    const profileValidation = await aiValidator.validateProfileData(profileData);
    const cleanedProfile = profileValidation.cleanedData;

    // Save or update client account (upsert for continuity)
    const clientAccount = await prisma.clientAccount.upsert({
      where: {
        clientId_platform_handle: {
          clientId,
          platform,
          handle: cleanedProfile.handle,
        },
      },
      update: {
        followerCount: cleanedProfile.follower_count,
        followingCount: cleanedProfile.following_count,
        bio: cleanedProfile.bio,
        profileImageUrl: cleanedProfile.profile_pic,
        lastScrapedAt: new Date(),
      },
      create: {
        clientId,
        platform,
        handle: cleanedProfile.handle,
        profileUrl: `https://instagram.com/${cleanedProfile.handle}/`,
        followerCount: cleanedProfile.follower_count,
        followingCount: cleanedProfile.following_count,
        bio: cleanedProfile.bio,
        profileImageUrl: cleanedProfile.profile_pic,
        lastScrapedAt: new Date(),
      },
    });

    // Validate and save posts
    const postsValidation = await aiValidator.validatePostData(cleanedProfile.posts);
    const cleanedPosts = postsValidation.cleanedData || cleanedProfile.posts;

    for (const post of cleanedPosts) {
      try {
        await prisma.clientPost.create({
          data: {
            clientAccountId: clientAccount.id,
            externalPostId: post.external_post_id,
            postUrl: post.post_url,
            caption: post.caption || '',
            format: detectFormat(post),
            likes: post.likes || 0,
            comments: post.comments || 0,
            engagementRate: calculateEngagementRate(
              post.likes + post.comments,
              cleanedProfile.follower_count
            ),
            rawApiResponse: post,
            postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
            scrapedAt: new Date(),
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          console.log(`[Job ${jobId}] Post ${post.external_post_id} already exists, skipping`);
        } else {
          throw err;
        }
      }
    }

    console.log(`[Job ${jobId}] ✅ Step 1-2 complete: ${cleanedPosts.length} posts saved`);

    // ==== STEP 1.5 (NEW): Update Client Bio if empty ====
    // Use scraped bio for better context in subsequent steps
    let currentBio = '';
    const currentClient = await prisma.client.findUnique({ where: { id: clientId } });
    if (currentClient && !currentClient.businessOverview && cleanedProfile.bio) {
       console.log(`[Job ${jobId}] updating client bio from Instagram...`);
       await prisma.client.update({
         where: { id: clientId },
         data: { businessOverview: cleanedProfile.bio }
       });
       currentBio = cleanedProfile.bio;
    } else if (currentClient?.businessOverview) {
      currentBio = currentClient.businessOverview;
    }

    // ==== STEP 3: Download Media ====
    console.log(`[Job ${jobId}] Step 3: Downloading media...`);
    const { mediaDownloader } = await import('../services/media/downloader');
    await mediaDownloader.downloadAllClientMedia(clientId);
    console.log(`[Job ${jobId}] ✅ Step 3 complete: Media downloaded`);

    // ==== STEP 4: AI Analyze Posts (SKIPPED - run later to save AI costs) ====
    console.log(`[Job ${jobId}] Step 4: Skipping AI media analysis (can be run later)`);
    // NOTE: To run AI analysis later, call contentAnalyzer.analyzePost for each post
    // const { contentAnalyzer } = await import('../services/ai/content-analyzer');
    // const posts = await prisma.clientPost.findMany({ where: { clientAccountId: clientAccount.id } });
    // for (const post of posts) {
    //   const mediaAssets = await prisma.mediaAsset.findMany({ where: { clientPostId: post.id } });
    //   await contentAnalyzer.analyzePost(post, mediaAssets[0]?.blobStoragePath);
    // }
    
    const posts = await prisma.clientPost.findMany({
      where: { clientAccountId: clientAccount.id },
    });
    console.log(`[Job ${jobId}] ✅ Step 4 skipped: ${posts.length} posts ready for later analysis`);

    // ==== STEP 5: Information Gathering (Competitors + Target Intel) ====
    await updateJobStatus(jobId, 'DISCOVERING_COMPETITORS');
    console.log(`[Job ${jobId}] Step 5: Information Gathering (multi-layer fallback)...`);

    // Import the new robust discovery service
    const { gatherInformation } = await import('../services/discovery');
    
    // Gather sample posts for context
    const samplePosts = posts.slice(0, 5).map(p => ({
      caption: p.caption || '',
      likes: p.likes || 0,
      comments: p.comments || 0,
    }));

    // Run the multi-layer information gathering
    const infoResult = await gatherInformation({
      handle,
      bio: currentBio || cleanedProfile.bio || '',
      niche: 'business', // TODO: derive from content analysis
      followerCount: cleanedProfile.follower_count,
      posts: samplePosts,
      researchJobId: jobId, // CRITICAL: Link all gathered data to this job
    });

    console.log(`[Job ${jobId}] Info gathering used layers: ${infoResult.layersUsed.join(', ')}`);
    if (infoResult.errors.length > 0) {
      console.log(`[Job ${jobId}] Info gathering errors: ${infoResult.errors.join('; ')}`);
    }

    // Save target intel to client
    if (infoResult.targetIntel) {
      const intel = infoResult.targetIntel;
      
      // Format social presence string
      const socialPresence = intel.crossPlatformHandles 
        ? Object.entries(intel.crossPlatformHandles)
            .map(([platform, handle]) => `${platform}: ${handle}`)
            .join(', ')
        : '';

      await prisma.client.update({
        where: { id: clientId },
        data: {
          businessOverview: currentBio || intel.niche,
          // Store website in brandStory for now (schema limitation) - or just append to businessOverview
          brandStory: intel.websiteUrl ? `Website: ${intel.websiteUrl}\n\n${intel.contextSummary || ''}` : intel.contextSummary,
          toneOfVoice: intel.brandVoice,
          brandPersonality: intel.targetAudience,
          keySellingPoints: intel.uniqueSellingPoints?.join(', '),
          currentSocialPresence: socialPresence,
        },
      });
      console.log(`[Job ${jobId}] Updated client with target intel (Context: ${intel.brandName})`);
    }

    // Save discovered competitors
    for (const comp of infoResult.competitors) {
      await prisma.discoveredCompetitor.create({
        data: {
          researchJobId: jobId,
          handle: comp.handle,
          platform: comp.platform || platform,
          discoveryReason: comp.discoveryReason || 'AI suggested',
          relevanceScore: comp.relevanceScore || 0.5,
          status: 'SUGGESTED',
        },
      });
    }

    console.log(`[Job ${jobId}] ✅ Step 5 complete: ${infoResult.competitors.length} competitors found (guaranteed minimum 5)`);

    // ==== STEP 6: Scrape Brand Mentions ====
    console.log(`[Job ${jobId}] Step 6: Searching for brand mentions...`);
    
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    const mentions = await scrapeBrandMentions(client?.name || handle);

    for (const mention of mentions) {
      await prisma.brandMention.create({
        data: {
          clientId,
          url: mention.url,
          title: mention.title,
          snippet: mention.snippet,
          fullText: mention.full_text,
          sourceType: mention.source_type,
        },
      });
    }

    console.log(`[Job ${jobId}] ✅ Step 6 complete: ${mentions.length} brand mentions found`);

    // ==== STEP 7: Analyze Brand Mentions ====
    console.log(`[Job ${jobId}] Step 7: Analyzing brand mentions...`);
    const { brandAnalyzer } = await import('../services/ai/brand-analyzer');
    
    const savedMentions = await prisma.brandMention.findMany({
      where: { clientId },
    });

    if (savedMentions.length > 0) {
      await brandAnalyzer.analyzeBrandMentions(clientId, savedMentions as any);
    }

    console.log(`[Job ${jobId}] ✅ Step 7 complete: Brand analysis done`);

    // ==== COMPLETE ====
    await updateJobStatus(jobId, 'COMPLETE');
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { completedAt: new Date() },
    });

    console.log(`[Job ${jobId}] 🎉 All 7 steps complete! Research finished.`);

  } catch (error: any) {
    console.error(`[Job ${jobId}] Error:`, error);
    await updateJobStatus(jobId, 'FAILED', error.message);
  }
}

/**
 * Helper: Update job status
 */
async function updateJobStatus(jobId: string, status: any, errorMessage?: string) {
  await prisma.researchJob.update({
    where: { id: jobId },
    data: { status, errorMessage },
  });
}

/**
 * Helper: Discover competitors using Python script
 */
async function discoverCompetitors(handle: string, bio: string, niche: string) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const path = require('path');

  try {
    const scriptPath = path.join(process.cwd(), 'scripts/competitor_discovery.py');
    const { stdout } = await execAsync(
      `python3 ${scriptPath} "${handle}" "${bio}" "${niche}" 10`,
      { env: { ...process.env } }
    );

    const result = JSON.parse(stdout);
    return result.competitors || [];
  } catch (error: any) {
    console.error('[Competitors] Discovery error:', error);
    return [];
  }
}

/**
 * Helper: Scrape brand mentions using Python script
 */
async function scrapeBrandMentions(brandName: string) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const path = require('path');

  try {
    const scriptPath = path.join(process.cwd(), 'scripts/web_search_scraper.py');
    const { stdout } = await execAsync(
      `python3 ${scriptPath} "${brandName}"`,
      { env: { ...process.env }, timeout: 60000 } // 60 second timeout
    );

    const result = JSON.parse(stdout);
    return result.mentions || [];
  } catch (error: any) {
    console.error('[Brand Mentions] Scraping error:', error);
    return [];
  }
}

/**
 * Helper: Detect post format from post data
 */
function detectFormat(post: any): string {
  if (post.is_video) return 'reel';
  if (post.typename === 'GraphSidecar') return 'carousel';
  return 'single_image';
}

/**
 * Helper: Calculate engagement rate
 */
function calculateEngagementRate(totalEngagement: number, followers: number): number {
  if (followers === 0) return 0;
  return (totalEngagement / followers) * 100;
}

export default router;
