
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export interface BrandMentionResult {
  url: string;
  title: string;
  snippet: string;
  full_text: string;
  source_type: string;
}

/**
 * Scrape brand mentions using Python script
 */
export async function scrapeBrandMentions(brandName: string): Promise<BrandMentionResult[]> {
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
