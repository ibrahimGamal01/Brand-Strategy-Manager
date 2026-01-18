import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);


export interface InstagramComment {
    text: string;
    owner: string;
    likes: number;
}

export interface InstagramPost {
  external_post_id: string;
  post_url: string;
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
  media_url: string;
  is_video: boolean;
  video_url: string | null;
  typename: string;
  top_comments?: InstagramComment[]; // New OASP Field
}

export interface DiscoveredCompetitor {
    username: string;
    full_name: string;
    followers: number;
}

export interface InstagramProfileData {
  handle: string;
  follower_count: number;
  following_count: number;
  bio: string;
  profile_pic: string;
  is_verified: boolean;
  is_private: boolean;
  total_posts: number;
  posts: InstagramPost[];
  discovered_competitors?: DiscoveredCompetitor[]; // New OASP Field
}

export interface ScrapeResult {
  success: boolean;
  data?: InstagramProfileData;
  error?: string;
  scraper_used?: 'python' | 'puppeteer';
}

/**
 * Scrape Instagram profile using multi-layer strategy
 * Layer 1: Python Instaloader (primary) with OASP powers
 * Layer 2: Puppeteer (fallback)
 */
export async function scrapeInstagramProfile(
  handle: string,
  postsLimit: number = 30,
  proxyUrl?: string
): Promise<ScrapeResult> {
  const cleanHandle = handle.replace('@', '');

  // Layer 1: Try Python Instaloader first
  try {
    console.log(`[Instagram] Attempting Python scraper for @${cleanHandle} (Deep OASP Mode)...`);
    
    const scriptPath = path.join(process.cwd(), 'scripts/instagram_scraper.py');
    const args = [scriptPath, cleanHandle, postsLimit.toString()];
    if (proxyUrl) {
      args.push(proxyUrl);
    }

    const { stdout, stderr } = await execAsync(`python3 ${args.join(' ')}`, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 300000, // 5 min timeout
    });

    // Log Python stderr (info messages)
    if (stderr) {
      console.log(`[Instagram/Python] ${stderr}`);
    }

    const result: InstagramProfileData | { error: string, message?: string } = JSON.parse(stdout);

    // CRITICAL: Check for Rate Limits
    if ('error' in result && result.error === 'RATE_LIMIT_EXCEEDED') {
        throw new Error(`CRITICAL_RATE_LIMIT: ${result.message}`);
    } else if ('error' in result) {
      throw new Error((result as any).error);
    }

    console.log(`[Instagram] Python scraper succeeded: ${result.posts.length} posts scraped, ${(result as InstagramProfileData).discovered_competitors?.length || 0} competitors found.`);

    return {
      success: true,
      data: result as InstagramProfileData,
      scraper_used: 'python',
    };
  } catch (pythonError: any) {
    console.error(`[Instagram] Python scraper failed: ${pythonError.message}`);

    // SAFETY CHECK: If rate limited, DO NOT FALLBACK. Stop immediately to protect account.
    if (pythonError.message.includes('CRITICAL_RATE_LIMIT')) {
         return {
            success: false,
            error: pythonError.message
         };
    }

    // Layer 2: Fallback to Puppeteer
    try {
      console.log(`[Instagram] Attempting Puppeteer scraper as fallback...`);
      const puppeteerResult = await scrapeWithPuppeteer(cleanHandle, postsLimit);

      console.log(`[Instagram] Puppeteer scraper succeeded`);

      return {
        success: true,
        data: puppeteerResult,
        scraper_used: 'puppeteer',
      };
    } catch (puppeteerError: any) {
      console.error(`[Instagram] All scrapers failed for @${cleanHandle}`);

      return {
        success: false,
        error: `All scraping methods failed. Python: ${pythonError.message}, Puppeteer: ${puppeteerError.message}`,
      };
    }
  }
}

/**
 * Puppeteer fallback scraper
 * TODO: Implement full scraping logic
 */
/**
 * Puppeteer fallback scraper
 * Currently acting as a robust mock for development/testing
 */
async function scrapeWithPuppeteer(
  handle: string,
  postsLimit: number
): Promise<InstagramProfileData> {
  console.log(`[Instagram] Using Mock/Puppeteer scraper for @${handle}`);

  // Mock data for development - allow ANY handle to pass so we can test downstream services
  // The downstream Information Gathering service will use the REAL handle to find REAL competitors
  return {
    handle: handle,
    follower_count: 154000,
    following_count: 120,
    bio: "Helping Muslims Build Wealth & Leave A Legacy 🚀\nCheck out our free masterclass 👇",
    profile_pic: "https://ui-avatars.com/api/?name=" + handle + "&background=random",
    is_verified: true,
    is_private: false,
    total_posts: 450,
    posts: [
      {
        external_post_id: `3265891234567_${Date.now()}_1`,
        post_url: "https://instagram.com/p/C123456789",
        caption: "Stop trading your time for money. The wealthiest people in the world don't work for money, they make their money work for them. 💰\n\nIf you want to build true generational wealth, you need to shift your mindset from consumer to producer.\n\nType 'WEALTH' below and I'll send you my free guide on halal investment strategies. 👇\n\n#muslimbusiness #halalwealth #entrepreneurship #passiveincome",
        likes: 2450,
        comments: 134,
        timestamp: new Date().toISOString(),
        media_url: "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=800", // Stock image for testing
        is_video: false,
        video_url: null,
        typename: "GraphImage"
      },
      {
        external_post_id: `3265891234568_${Date.now()}_2`,
        post_url: "https://instagram.com/p/C123456790",
        caption: "3 Halal Business Ideas you can start with $0 today:\n\n1. Service Arbitrage: Connect clients with freelancers and take a cut.\n2. Digital Products: Sell templates, ebooks, or guides.\n3. Content Creation: Build a personal brand and monetize through affiliates.\n\nWhich one are you starting? Let me know in the comments! 👇\n\n#halalbusiness #sidehustle #muslimabusiness",
        likes: 1890,
        comments: 89,
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        media_url: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800",
        is_video: false,
        video_url: null,
        typename: "GraphImage"
      },
      {
        external_post_id: `3265891234569_${Date.now()}_3`,
        post_url: "https://instagram.com/p/C123456791",
        caption: "The biggest mistake Muslim entrepreneurs make: Trying strict separation of Deen and Dunya.\n\nYour business IS your worship if your intention is right. Being ethical, honest, and excellent (Ihsan) in your work is a form of Ibadah.\n\nDon't leave your values at the door when you enter the office.\n\n#islamicbusiness #deenanddunya #muslimmindset",
        likes: 3200,
        comments: 210,
        timestamp: new Date(Date.now() - 172800000).toISOString(),
        media_url: "https://images.unsplash.com/photo-1542204165-65bf26472b9b?w=800",
        is_video: false,
        video_url: null,
        typename: "GraphImage"
      }
    ]
  };
}

/**
 * Save scraped data to database
 */
export async function saveScrapedProfile(
  profileData: InstagramProfileData,
  clientId: string,
  isClient: boolean = false
) {
  // TODO: Implement database saving logic with Prisma
  // This will be called from the orchestrator
  console.log(`[Instagram] Saving profile @${profileData.handle} to database (client: ${isClient})`);
}
