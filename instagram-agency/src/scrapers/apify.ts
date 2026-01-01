import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface InstagramPost {
  id: string;
  type: string;
  caption: string;
  hashtags: string[];
  likesCount: number;
  commentsCount: number;
  timestamp: string;
  displayUrl: string;
  videoUrl?: string;
  ownerUsername: string;
  ownerFollowerCount?: number;
  childPosts?: unknown[];
}

interface ApifyResponse extends InstagramPost {}

export async function scrapeInstagramAccount(username: string, postsLimit = 12): Promise<InstagramPost[]> {
  logger.info(`Scraping Instagram: @${username} (limit: ${postsLimit})`);
  
  const url = 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items';
  
  try {
    const response = await axios.post<ApifyResponse[]>(
      url,
      {
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: 'posts',
        resultsLimit: postsLimit,
        addParentData: true,
      },
      {
        params: { token: config.apifyToken },
        timeout: 300000, // 5 minutes
      }
    );
    
    logger.success(`Scraped ${response.data.length} posts from @${username}`);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`Apify error for @${username}: ${error.message}`);
      throw new Error(`Failed to scrape @${username}: ${error.message}`);
    }
    throw error;
  }
}

export async function scrapeMultipleAccounts(usernames: string[], postsLimit = 12): Promise<InstagramPost[]> {
  logger.info(`Scraping ${usernames.length} accounts: ${usernames.join(', ')}`);
  
  const urls = usernames.map(u => `https://www.instagram.com/${u}/`);
  const url = 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items';
  
  try {
    const response = await axios.post<ApifyResponse[]>(
      url,
      {
        directUrls: urls,
        resultsType: 'posts',
        resultsLimit: postsLimit,
        addParentData: true,
      },
      {
        params: { token: config.apifyToken },
        timeout: 600000, // 10 minutes for multiple accounts
      }
    );
    
    logger.success(`Scraped ${response.data.length} total posts from ${usernames.length} accounts`);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`Apify error: ${error.message}`);
      throw new Error(`Failed to scrape accounts: ${error.message}`);
    }
    throw error;
  }
}
