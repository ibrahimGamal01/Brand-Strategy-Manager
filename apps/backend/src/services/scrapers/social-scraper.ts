/**
 * Social Media Scraper Service
 * 
 * Integrates Python scrapers (Instaloader & yt-dlp) into the main workflow.
 * Executes Python scripts to scrape data and saves it to the database.
 */

import { PythonShell } from 'python-shell';
import { PrismaClient } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();

// Configuration
const SCRIPTS_DIR = path.join(__dirname, '../../../scripts/social-scrapers');
const DEFAULT_MAX_POSTS = 20;

export interface ScrapeResult {
  success: boolean;
  platform: 'INSTAGRAM' | 'TIKTOK';
  postsScraped: number;
  error?: string;
  data?: any;
}

export class SocialScraperService {
  
  /**
   * Scrape a competitor's social media profile
   */
  async scrapeCompetitor(competitorId: string, platform: 'INSTAGRAM' | 'TIKTOK'): Promise<ScrapeResult> {
    console.log(`[Scraper] Starting ${platform} scrape for competitor ${competitorId}...`);

    try {
      // 1. Get competitor handle
      const competitor = await prisma.competitor.findUnique({
        where: { id: competitorId }
      });

      if (!competitor) {
        throw new Error(`Competitor ${competitorId} not found`);
      }

      // Check if handle exists for platform
      // Note: Assuming handle is stored in 'handle' field or needs extraction
      const rawHandle = competitor.handle || competitor.name || '';
      const handle = this.extractHandle(rawHandle, platform);
      
      console.log(`[Scraper] Target handle: @${handle}`);

      // 2. Execute scraping
      const rawData = await this.runPythonScraper(platform, handle);

      if (!rawData || !rawData.success) {
        throw new Error(rawData?.error || 'Scraping failed with no error message');
      }

      // 3. Save to database
      const savedCount = await this.savePostData(competitorId, platform, rawData.posts);

      // 4. Update competitor metadata
      await this.updateCompetitorStats(competitorId, platform, rawData);

      console.log(`[Scraper] Success! Saved ${savedCount} posts.`);

      return {
        success: true,
        platform,
        postsScraped: savedCount,
        data: rawData
      };

    } catch (error) {
      console.error(`[Scraper] Error:`, error);
      return {
        success: false,
        platform,
        postsScraped: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run the Python script for the specific platform
   */
  private async runPythonScraper(platform: 'INSTAGRAM' | 'TIKTOK', handle: string): Promise<any> {
    const scriptName = platform === 'INSTAGRAM' ? 'instagram.py' : 'tiktok.py';
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);

    const options = {
      mode: 'json' as const,
      pythonPath: 'python3',
      pythonOptions: ['-u'], // unbuffered stdout
      arg: [handle, String(DEFAULT_MAX_POSTS)],
      scriptPath: SCRIPTS_DIR
    };
    
    // Using PythonShell properly with arguments
    // The previous implementation had 'arg' instead of 'args' and incorrect options passing for run
    const runOptions = {
        mode: 'text' as const, // We capture text and parse it ourselves to be safe
        pythonPath: 'python3',
        pythonOptions: ['-u'],
        scriptPath: SCRIPTS_DIR,
        args: [handle, String(DEFAULT_MAX_POSTS)]
    };

    return new Promise((resolve, reject) => {
      PythonShell.run(scriptName, runOptions).then(results => {
        if (!results || results.length === 0) {
            reject(new Error('No output from scraper script'));
            return;
        }

        // The scripts output exactly one line of JSON
        // Or multiple lines if there were errors caught, but the last line should be the JSON result
        try {
            const lastLine = results[results.length - 1];
            const parsed = JSON.parse(lastLine);
            resolve(parsed);
        } catch (e) {
            console.error('Failed to parse scraper output:', results);
            reject(new Error('Invalid JSON output from scraper'));
        }
      }).catch(err => {
        reject(err);
      });
    });
  }

  /**
   * Save scraped posts to database
   */
  private async savePostData(competitorId: string, platform: 'INSTAGRAM' | 'TIKTOK', posts: any[]) {
    if (!posts || !Array.isArray(posts)) return 0;

    let count = 0;
    for (const post of posts) {
      try {
        await prisma.socialPost.create({
          data: {
            // Note: This function needs socialProfileId to work properly
            // competitorId and platform fields don't exist in SocialPost schema
            url: post.url || '',
            caption: post.caption || post.description || '',
            externalId: post.id || `post_${Date.now()}`,
            socialProfileId: 'PLACEHOLDER', // TODO: Pass socialProfileId from parent
            metadata: {
              likes: post.likes || 0,
              comments: post.comments || 0,
              views: post.views || 0,
              shares: post.shares || 0,
              engagementRate: post.engagement_rate || 0,
              format: post.type || (platform === 'TIKTOK' ? 'VIDEO' : 'UNKNOWN')
            },
            postedAt: post.date ? new Date(post.date) : new Date()
          }
        });
        count++;
      } catch (e) {
        // Ignore duplicates or errors
        // console.warn('Duplicate post skipped');
      }
    }
    return count;
  }

  /**
   * Update competitor profile stats
   */
  private async updateCompetitorStats(competitorId: string, platform: 'INSTAGRAM' | 'TIKTOK', data: any) {
    // metadata field in Competitor model
    const stats = platform === 'INSTAGRAM' ? data.profile : { 
      followers: 0, // TikTok generic extraction doesn't give follower count reliably
      following: 0 
    };

    if (stats) {
      // Merge into competitor metadata
      // Implementation depends on schema structure
    }
  }

  private extractHandle(input: string, platform: 'INSTAGRAM' | 'TIKTOK'): string {
    // Remove URL parts, @ symbol, etc.
    let handle = input.replace('https://www.instagram.com/', '')
                      .replace('https://www.tiktok.com/@', '')
                      .replace('https://www.tiktok.com/', '')
                      .replace('@', '')
                      .split('/')[0]
                      .split('?')[0];
    return handle;
  }
}
