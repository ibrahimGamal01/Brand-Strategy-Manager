
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { searchRawDDG, type RawSearchResult } from './duckduckgo-search.js';

const execAsync = promisify(exec);

export interface BrandMentionResult {
  url: string;
  title: string;
  snippet: string;
  full_text: string;
  source_type: string;
}

function classifySource(url: string): string {
  const lower = url.toLowerCase();
  if (['instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'tiktok.com'].some((s) => lower.includes(s))) {
    return 'social';
  }
  if (['reddit.com', 'quora.com', 'forum', 'discuss', 'community'].some((s) => lower.includes(s))) {
    return 'forum';
  }
  if (['review', 'rating', 'yelp', 'trustpilot'].some((s) => lower.includes(s))) {
    return 'review';
  }
  if (['blog', 'article', 'news', 'medium.com'].some((s) => lower.includes(s))) {
    return 'article';
  }
  return 'other';
}

function buildBrandMentionQueries(brandName: string): string[] {
  const name = String(brandName || '').trim();
  if (!name) return [];
  return [
    `"${name}" review`,
    `"${name}" about`,
    `"${name}" complaints`,
    `"${name}" customers`,
    `"${name}" reddit`,
    `"${name}" forum`,
  ];
}

async function scrapeBrandMentionsViaDDG(brandName: string): Promise<BrandMentionResult[]> {
  const queries = buildBrandMentionQueries(brandName);
  if (queries.length === 0) return [];
  const raw = await searchRawDDG(queries, { maxResults: 80 });
  return raw.map((row: RawSearchResult) => ({
    url: row.href,
    title: row.title,
    snippet: row.body,
    full_text: '',
    source_type: classifySource(row.href),
  }));
}

/**
 * Scrape brand mentions using Python script
 */
export async function scrapeBrandMentions(brandName: string): Promise<BrandMentionResult[]> {
  try {
    // __dirname = dist/services/discovery; climb to repo-level scripts folder
    const scriptPath = path.resolve(__dirname, '../../../scripts/web_search_scraper.py');
    const { stdout } = await execAsync(
      `python3 ${scriptPath} "${brandName}"`,
      { env: { ...process.env }, timeout: 60000 } // 60 second timeout
    );

    const result = JSON.parse(stdout);
    const mentions = result.mentions || [];
    if (mentions.length > 0) return mentions;
    console.warn('[Brand Mentions] No results from web_search_scraper.py, falling back to DDG.');
    return await scrapeBrandMentionsViaDDG(brandName);
  } catch (error: any) {
    console.error('[Brand Mentions] Scraping error:', error);
    return await scrapeBrandMentionsViaDDG(brandName);
  }
}
