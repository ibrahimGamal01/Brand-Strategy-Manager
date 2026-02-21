
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

function resolveProxyConfig() {
    const raw = (process.env.SCRAPER_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim();
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
        if (!Number.isFinite(port)) return null;
        return {
            browserServer: `${parsed.protocol}//${parsed.hostname}:${port}`,
            auth: parsed.username || parsed.password
                ? {
                    username: decodeURIComponent(parsed.username || ''),
                    password: decodeURIComponent(parsed.password || ''),
                }
                : null,
            axiosProxy: {
                protocol: parsed.protocol.replace(':', ''),
                host: parsed.hostname,
                port,
                auth: parsed.username || parsed.password
                    ? {
                        username: decodeURIComponent(parsed.username || ''),
                        password: decodeURIComponent(parsed.password || ''),
                    }
                    : undefined,
            },
        };
    } catch {
        return null;
    }
}

async function downloadTikTokVideo(videoUrl: string, outputPath: string) {
    let browser;
    try {
        const proxyConfig = resolveProxyConfig();

        // Launch browser
        const launchArgs = [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ];
        if (proxyConfig?.browserServer) {
            launchArgs.push(`--proxy-server=${proxyConfig.browserServer}`);
        }

        browser = await puppeteer.launch({
            headless: 'new',
            args: launchArgs
        });

        const page = await browser.newPage();

        if (proxyConfig?.auth) {
            await page.authenticate(proxyConfig.auth);
        }
        
        // Set a realistic User Agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Enable request interception to find the video file
        let videoSourceUrl: string | null = null;

        await page.setRequestInterception(true);
        
        page.on('request', (request) => {
            request.continue();
        });

        page.on('response', (response) => {
            const url = response.url();
            const headers = response.headers();
            const contentType = headers['content-type'] || '';
            
            // Filter out known background/login videos or small assets
            if (url.includes('playback1.mp4') || url.includes('website-login')) {
                return;
            }

            // Look for video content types
            if ((contentType.includes('video/mp4') || contentType.includes('video/webm')) && !url.includes('blob:')) {
                const size = parseInt(headers['content-length'] || '0');
                
                // Real videos are usually > 500KB. 
                if (size > 500000) { 
                    // Prefer longer URLs which usually contain full tokens/signatures
                    if (!videoSourceUrl || url.length > videoSourceUrl.length) {
                        videoSourceUrl = url;
                    }
                }
            }
        });

        // Navigate to the video page
        await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait specifically for the video element to be present or for our intercepted URL
        // Also wait a bit to ensure the high-quality stream loads
        await new Promise(r => setTimeout(r, 5000));

        if (videoSourceUrl) {
            
            // Create directory if it doesn't exist
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            console.log(`Downloading from: ${videoSourceUrl}`);

            // Get cookies to pass to the downloader
            const cookies = await page.cookies();
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            // Use axios to download stream with proper headers
            // We need 'axios' which is already in package.json
            const axios = require('axios');
            
            const response = await axios({
                method: 'GET',
                url: videoSourceUrl,
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': await page.browser().userAgent(),
                    'Cookie': cookieString,
                    'Referer': 'https://www.tiktok.com/',
                    'Origin': 'https://www.tiktok.com'
                },
                proxy: proxyConfig?.axiosProxy || false
            });

            fs.writeFileSync(outputPath, response.data);
            
            console.log(JSON.stringify({ success: true, path: outputPath }));
        } else {
            throw new Error('No video stream URL detected (CAPTCHA or Login Wall?)');
        }

    } catch (error: any) {
        // Detailed error logging
        const msg = error.response ? `HTTP ${error.response.status}: ${error.response.statusText}` : error.message;
        console.log(JSON.stringify({ success: false, error: msg }));
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// CLI Entry point
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: tsx tiktok_downloader.ts <videoUrl> <outputPath>');
    process.exit(1);
}

const [url, output] = args;
downloadTikTokVideo(url, output);
