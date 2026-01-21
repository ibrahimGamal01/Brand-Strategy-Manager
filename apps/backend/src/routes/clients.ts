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
 * SMART BEHAVIOR:
 * - If ANY handle matches an existing ClientAccount, reuse that Client
 * - If that Client has a recent research job (< 24 hours), redirect to it
 * - Otherwise create new research job with resume logic (skips completed steps)
 * 
 * Body:
 * {
 *   "name": "Client Name",
 *   "handles": { "instagram": "ummahpreneur", "tiktok": "ummahpreneur" },
 *   "niche": "Islamic Finance",
 *   "forceNew": false  // Optional: force new job even if recent exists
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, handle, handles, niche, platform = 'instagram', forceNew = false } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Build handles map (support both old single-handle and new multi-handle)
    let platformHandles: Record<string, string> = {};
    
    if (handles && typeof handles === 'object') {
      Object.entries(handles).forEach(([p, h]) => {
        if (typeof h === 'string' && h.trim()) {
          platformHandles[p.toLowerCase()] = h.replace(/^@+/, '').toLowerCase().trim();
        }
      });
    }
    
    // Fallback to legacy single handle
    if (Object.keys(platformHandles).length === 0 && handle) {
      const cleanHandle = handle.replace(/^@+/, '').toLowerCase().trim();
      platformHandles[platform] = cleanHandle;
    }
    
    if (Object.keys(platformHandles).length === 0) {
      return res.status(400).json({ error: 'At least one social media handle is required' });
    }

    const primaryPlatform = Object.keys(platformHandles)[0];
    const primaryHandle = platformHandles[primaryPlatform];

    // === STEP 1: Check if client with any of these handles already exists ===
    let client;
    let isExistingClient = false;
    
    for (const [p, h] of Object.entries(platformHandles)) {
      const existingAccount = await prisma.clientAccount.findFirst({
        where: { handle: h, platform: p },
        include: { client: true },
      });
      if (existingAccount?.client) {
        client = existingAccount.client;
        isExistingClient = true;
        console.log(`[API] Found existing client for @${h} (${p}): ${client.id} (${client.name})`);
        break;
      }
    }

    // === STEP 2: For existing clients, check for recent research job ===
    let existingRecentJob = null;
    if (isExistingClient && client && !forceNew) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      existingRecentJob = await prisma.researchJob.findFirst({
        where: {
          clientId: client.id,
          startedAt: { gte: twentyFourHoursAgo },
          // Status is either running or complete (not failed)
          status: { in: ['PENDING', 'SCRAPING_CLIENT', 'DISCOVERING_COMPETITORS', 'COMPLETE'] },
        },
        orderBy: { startedAt: 'desc' },
      });

      if (existingRecentJob) {
        console.log(`[API] Found recent job for existing client: ${existingRecentJob.id} (${existingRecentJob.status})`);
        
        // Add any new handles that weren't in the original job
        for (const [p, h] of Object.entries(platformHandles)) {
          await prisma.clientAccount.upsert({
            where: { clientId_platform_handle: { clientId: client.id, platform: p, handle: h } },
            update: {},
            create: { clientId: client.id, platform: p, handle: h, profileUrl: getProfileUrl(p, h) },
          });
        }

        // Return the existing job - no need to create duplicate
        return res.json({
          success: true,
          client,
          researchJob: {
            id: existingRecentJob.id,
            status: existingRecentJob.status,
          },
          handles: platformHandles,
          isExisting: true,
          message: `Existing research found. Redirecting to job ${existingRecentJob.id}`,
        });
      }
    }

    // === STEP 3: Create new client if needed ===
    if (!client) {
      console.log(`[API] Creating new client: ${name}`);
      client = await prisma.client.create({
        data: { name },
      });
      console.log(`[API] Client created: ${client.id}`);
    }

    // === STEP 4: Create/update ClientAccounts for each platform handle ===
    for (const [p, h] of Object.entries(platformHandles)) {
      await prisma.clientAccount.upsert({
        where: { clientId_platform_handle: { clientId: client.id, platform: p, handle: h } },
        update: {},
        create: { clientId: client.id, platform: p, handle: h, profileUrl: getProfileUrl(p, h) },
      });
      console.log(`[API] ClientAccount ensured: @${h} on ${p}`);
    }

    // === STEP 5: Create new research job ===
    // The resume logic in gatherInformation will check what data already exists
    // and skip steps that have already been completed
    const researchJob = await prisma.researchJob.create({
      data: {
        clientId: client.id,
        status: 'PENDING',
        startedAt: new Date(),
        inputData: {
          handle: primaryHandle,
          platform: primaryPlatform,
          handles: platformHandles,
          brandName: name,
          niche: niche || '',
          isResumeJob: isExistingClient, // Flag to help pipeline know to check for existing data
        },
      },
    });

    console.log(`[API] Research job created: ${researchJob.id} (resume=${isExistingClient})`);

    // Start scraping process asynchronously
    scrapeAndSaveClientData(researchJob.id, client.id, primaryHandle, primaryPlatform, platformHandles, niche)
      .catch(error => {
        console.error(`[API] Scraping failed for job ${researchJob.id}:`, error);
      });

    res.json({
      success: true,
      client,
      researchJob: {
        id: researchJob.id,
        status: researchJob.status,
      },
      handles: platformHandles,
      isExisting: isExistingClient,
      message: isExistingClient 
        ? `Continuing research for existing client. New data will be added.`
        : `New research job started.`,
    });
  } catch (error: any) {
    console.error('[API] Error creating client:', error);
    res.status(500).json({ error: 'Failed to create client', details: error.message });
  }
});

// Helper to get profile URL for a platform
function getProfileUrl(platform: string, handle: string): string {
  const urls: Record<string, string> = {
    instagram: `https://instagram.com/${handle}/`,
    tiktok: `https://tiktok.com/@${handle}`,
    youtube: `https://youtube.com/@${handle}`,
    twitter: `https://twitter.com/${handle}`,
    linkedin: `https://linkedin.com/in/${handle}`,
    facebook: `https://facebook.com/${handle}`,
  };
  return urls[platform] || '';
}


/**
 * Background function: Complete 7-step research pipeline
 * 1-2: Scrape + validate
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
  platform: string,
  platformHandles: Record<string, string> = {},
  niche: string = 'business'
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

    console.log(`[Job ${jobId}] Step 1-2 complete: ${cleanedPosts.length} posts saved`);

    // ==== STEP 1.5 (NEW): Update Client Bio if empty ====
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
    console.log(`[Job ${jobId}] Step 3 complete: Media downloaded`);

    // ==== STEP 4: AI Analyze Posts (SKIPPED) ====
    console.log(`[Job ${jobId}] Step 4: Skipping AI media analysis (can be run later)`);
    
    const posts = await prisma.clientPost.findMany({
      where: { clientAccountId: clientAccount.id },
    });
    console.log(`[Job ${jobId}] Step 4 skipped: ${posts.length} posts ready for later analysis`);

    // ==== STEP 5: Information Gathering (Competitors + Target Intel) ====
    await updateJobStatus(jobId, 'DISCOVERING_COMPETITORS');
    console.log(`[Job ${jobId}] Step 5: Information Gathering (multi-layer fallback)...`);

    const { gatherInformation } = await import('../services/discovery');
    
    const samplePosts = posts.slice(0, 5).map(p => ({
      caption: p.caption || '',
      likes: p.likes || 0,
      comments: p.comments || 0,
    }));

    // Run the multi-layer information gathering with ALL platform handles
    const infoResult = await gatherInformation({
      handle,
      brandName: currentClient?.name || handle,
      bio: currentBio || cleanedProfile.bio || '',
      niche: niche || 'business',
      followerCount: cleanedProfile.follower_count,
      posts: samplePosts,
      researchJobId: jobId,
      handles: platformHandles, // Pass ALL platform handles for site-limited scraping
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
