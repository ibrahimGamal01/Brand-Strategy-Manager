/// <reference lib="dom" />
/**
 * Google Search Service
 * 
 * Capabilities:
 * 1. Competitor Discovery (finding similar accounts)
 * 2. Brand Context Search (finding website, other socials, real content)
 * 3. Handle Verification (validating if a handle belongs to a real business/creator)
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const COMPETITOR_QUERIES = [
  '{niche} instagram influencers',
  'instagram accounts like @{handle}',
  'best {niche} creators instagram 2024',
  '{niche} instagram accounts to follow',
];

const BRAND_CONTEXT_QUERIES = [
  'site:instagram.com "{brandName}"',
  'site:facebook.com "{brandName}"',
  'site:tiktok.com "{brandName}"',
  'site:linkedin.com "{brandName}"',
  '"{brandName}" official website',
  '"{brandName}" reviews',
];

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
  source: 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'website' | 'other';
}

/**
 * Advanced search to gather brand context and potential handles
 */
export async function searchBrandContext(brandName: string): Promise<SearchResult[]> {
  console.log(`[GoogleSearch] Deep searching for brand context: "${brandName}"`);
  
  const results: SearchResult[] = [];
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Combine queries to save time, or run parallel? 
    // For now, let's run a smart combined search for the brand
    const query = `"${brandName}" (site:instagram.com OR site:facebook.com OR site:linkedin.com OR "official site")`;
    
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });

    await page.waitForSelector('div#search', { timeout: 5000 }).catch(() => {});

    const searchResults = await page.evaluate((): Array<{ title: string; snippet: string; link: string }> => {
      const items = document.querySelectorAll('div.g');
      return Array.from(items).map((item) => {
        const titleEl = item.querySelector('h3');
        // Try multiple selectors for snippet
        const snippetEl = item.querySelector('div.VwiC3b') || 
                         item.querySelector('div[data-sncf="1"]') ||
                         item.querySelector('div[style*="-webkit-line-clamp"]');
                         
        const linkEl = item.querySelector('a');
        
        return {
          title: (titleEl as HTMLElement)?.innerText || '',
          snippet: (snippetEl as HTMLElement)?.innerText || '',
          link: (linkEl as HTMLAnchorElement)?.getAttribute('href') || '',
        };
      });
    });

    for (const res of searchResults) {
      if (!res.link) continue;
      
      let source: SearchResult['source'] = 'other';
      if (res.link.includes('instagram.com')) source = 'instagram';
      else if (res.link.includes('facebook.com')) source = 'facebook';
      else if (res.link.includes('tiktok.com')) source = 'tiktok';
      else if (res.link.includes('linkedin.com')) source = 'linkedin';
      else source = 'website';

      results.push({
        title: res.title,
        snippet: res.snippet,
        link: res.link,
        source,
      });
    }

  } catch (error: any) {
    console.error(`[GoogleSearch] Context search failed:`, error.message);
  } finally {
    if (browser) await browser.close();
  }

  return results;
}

/**
 * Validate a specific handle using Google Search signals
 * Checks if the handle appears to be a legitimate, active account
 */
export async function validateHandleViaSearch(handle: string, platform: string = 'instagram'): Promise<{ isValid: boolean; reason: string; meta?: any }> {
  // TODO: Implement deep validation
  return { isValid: true, reason: 'Pending implementation' }; 
}


/**
 * Search Google for competitor Instagram handles
 */
export async function googleSearchForCompetitors(
  handle: string,
  niche: string,
  maxResults: number = 15
): Promise<string[]> {
  console.log(`[GoogleSearch] Starting search for competitors of @${handle} in ${niche}`);
  
  const handles: Set<string> = new Set();
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    
    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Try each search query
    for (const queryTemplate of COMPETITOR_QUERIES) {
      if (handles.size >= maxResults) break;

      const query = queryTemplate
        .replace('{handle}', handle)
        .replace('{niche}', niche);

      console.log(`[GoogleSearch] Searching: "${query}"`);

      try {
        // Navigate to Google
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
          waitUntil: 'networkidle2',
          timeout: 15000,
        });

        // Wait for results
        await page.waitForSelector('div#search', { timeout: 5000 }).catch(() => {});

        // Extract Instagram handles from the page
        const pageHandles = await page.evaluate((): string[] => {
          const text = document.body.innerText;
          const handleRegex = /@([a-zA-Z0-9._]{1,30})/g;
          const matches = text.match(handleRegex) || [];
          return Array.from(new Set(matches.map(h => h.replace('@', ''))));
        });

        // Also extract from links
        const linkHandles = await page.evaluate((): string[] => {
          const links = Array.from(document.querySelectorAll('a[href*="instagram.com"]'));
          return links
            .map(link => {
              const href = (link as HTMLAnchorElement).getAttribute('href') || '';
              const match = href.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
              return match ? match[1] : null;
            })
            .filter((h): h is string => h !== null);
        });

        // Add all found handles
        for (const h of [...pageHandles, ...linkHandles]) {
          if (h && h.toLowerCase() !== handle.toLowerCase() && !['p', 'explore', 'reel', 'stories'].includes(h)) {
            handles.add(h);
          }
        }

        console.log(`[GoogleSearch] Found ${handles.size} unique handles so far`);

        // Small delay between searches
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

      } catch (searchError: any) {
        console.error(`[GoogleSearch] Query failed:`, searchError.message);
      }
    }

  } catch (error: any) {
    console.error(`[GoogleSearch] Browser error:`, error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const result = Array.from(handles).slice(0, maxResults);
  console.log(`[GoogleSearch] Returning ${result.length} handles:`, result.slice(0, 5).join(', '), '...');
  return result;
}
