
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function testSearch(query: string) {
  console.log(`Testing search for: ${query}`);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
    });
    
    // DuckDuckGo HTML search (lighter, less blocking)
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle2',
    });

    const pageTitle = await page.title();
    console.log(`Page Title: ${pageTitle}`);

    const searchResults = await page.evaluate(() => {
        const results: any[] = [];
        // DDG HTML selectors
        const items = document.querySelectorAll('.result');
        items.forEach(item => {
            const titleEl = item.querySelector('.result__title a');
            const snippetEl = item.querySelector('.result__snippet');
            const linkEl = item.querySelector('.result__url');
            
            // Extract clean link from DDG redirect if possible, otherwise use href
            let link = (titleEl as HTMLAnchorElement)?.getAttribute('href') || '';
            // /l/?kh=-1&uddg=https%3A%2F%2Fwww.instagram.com%2Fproductivemuslim%2F
            if (link.includes('uddg=')) {
                try {
                    const urlParams = new URLSearchParams(link.split('?')[1]);
                    link = decodeURIComponent(urlParams.get('uddg') || link);
                } catch (e) {}
            }

            if (titleEl) {
                results.push({
                    title: (titleEl as HTMLElement).innerText.trim(),
                    link: link,
                    snippet: (snippetEl as HTMLElement)?.innerText.trim() || '',
                    source: 'DuckDuckGo'
                });
            }
        });
        return results;
    });

    console.log(`Found ${searchResults.length} results`);
    searchResults.forEach((r, i) => {
        console.log(`[${i}] ${r.title} (${r.link}) \n    Snippet: ${r.snippet?.slice(0, 50)}...`);
    });

  } catch (error) {
    console.error('Search failed:', error);
  } finally {
    await browser.close();
  }
}

testSearch('site:instagram.com "The Productive Muslim Company"');
