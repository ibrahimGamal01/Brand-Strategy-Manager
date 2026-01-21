
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const https = require('https');

puppeteer.use(StealthPlugin());

(async () => {
    const videoUrl = 'https://www.tiktok.com/@6969541225033090049/video/7551812725278575880';
    const outputPath = '/tmp/tiktok_puppeteer_test.mp4';

    console.log(`Testing download for: ${videoUrl}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set a realistic User Agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Enable request interception to find the video file
    let videoSourceUrl = null;

    page.on('response', response => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        // Filter out known background/login videos
        if (url.includes('playback1.mp4') || url.includes('website-login')) {
            return;
        }

        // TikTok video streams often come from *.tiktokcdn.com and are mp4/video
        // But also check simply for video content type
        if ((contentType.includes('video/mp4') || contentType.includes('video/webm')) && !url.includes('blob:')) {
            const size = parseInt(response.headers()['content-length'] || '0');
            // Real videos are usually > 500KB. Login video was small but we filtered it by name.
            if (size > 500000) { 
                console.log('Found video candidate:', url);
                // Prefer longer URLs which usually contain tokens
                if (!videoSourceUrl || url.length > videoSourceUrl.length) {
                    videoSourceUrl = url;
                }
            }
        }
    });

    try {
        console.log('Navigating to page...');
        await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('Page loaded. waiting 5s...');
        await new Promise(r => setTimeout(r, 5000));
        
        // Take screenshot
        await page.screenshot({ path: 'debug_tiktok.png' });
        console.log('Screenshot saved to debug_tiktok.png');
        
        // Dump HTML title/body text
        const title = await page.title();
        console.log('Page Title:', title);
        
        // content
        const content = await page.content();
        fs.writeFileSync('debug_tiktok.html', content);

        if (videoSourceUrl) {
            console.log('Detected Video Source URL:', videoSourceUrl);
            
            // Download the file
            const file = fs.createWriteStream(outputPath);
            console.log('Downloading to:', outputPath);
            
            // Use built-in https or axios, but we need cookies usually.
            // Puppeteer can grab cookies.
            const cookies = await page.cookies();
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            
            // We can actually just fetch it inside the page context to be safe with cookies/headers
            const buffer = await page.evaluate(async (url) => {
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();
                return Array.from(new Uint8Array(buffer));
            }, videoSourceUrl);
            
            fs.writeFileSync(outputPath, Buffer.from(buffer));
            console.log('Download complete via page context!');
            
        } else {
            console.log('No video URL found in network traffic.');
            // Fallback: looking for <video> src
            const src = await page.evaluate(() => {
                const v = document.querySelector('video');
                return v ? v.src : null;
            });
            console.log('Video element src:', src);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
})();
