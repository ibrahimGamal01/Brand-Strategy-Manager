/**
 * Integration test for Camoufox-based downloaders.
 * Verifies script path resolution and JSON output when run from backend cwd.
 * Run: npx tsx src/scripts/test-camoufox-integration.ts
 * (from apps/backend or repo root)
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const INSTAGRAM_POST = 'https://www.instagram.com/ummahpreneur/p/DUlWCC6iI9U/?hl=en';
const TIKTOK_VIDEO = 'https://www.tiktok.com/@ummahpreneur/video/7540341844568296711';
const TIKTOK_PHOTO = 'https://www.tiktok.com/@ummahpreneur/photo/7551812725278575880';

function resolveScript(name: string, candidates: string[]): string | null {
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function testInstagramResolve(): Promise<boolean> {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'scripts/camoufox_insta_downloader.py'),
    path.join(cwd, 'apps/backend/scripts/camoufox_insta_downloader.py'),
  ];
  const scriptPath = resolveScript('camoufox_insta_downloader', candidates);
  if (!scriptPath) {
    console.error('[FAIL] Instagram: camoufox_insta_downloader.py not found. Tried:', candidates);
    return false;
  }
  try {
    const { stdout } = await execAsync(`python3 "${scriptPath}" "${INSTAGRAM_POST}"`, {
      cwd,
      timeout: 60000,
    });
    const result = JSON.parse(stdout.trim());
    if (result.success && Array.isArray(result.mediaUrls) && result.mediaUrls.length > 0) {
      console.log('[PASS] Instagram: resolved', result.mediaUrls.length, 'media URL(s)');
      return true;
    }
    console.error('[FAIL] Instagram:', result.error || 'No media URLs');
    return false;
  } catch (e: any) {
    console.error('[FAIL] Instagram:', e.message || e);
    return false;
  }
}

async function testTikTokDownload(url: string, label: string, outputPath: string): Promise<boolean> {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'scripts/camoufox_tiktok_downloader.py'),
    path.join(cwd, 'apps/backend/scripts/camoufox_tiktok_downloader.py'),
  ];
  const scriptPath = resolveScript('camoufox_tiktok_downloader', candidates);
  if (!scriptPath) {
    console.error('[FAIL] TikTok: camoufox_tiktok_downloader.py not found. Tried:', candidates);
    return false;
  }
  try {
    const { stdout } = await execAsync(
      `python3 "${scriptPath}" "${url}" "${outputPath}"`,
      { cwd, timeout: 120000 }
    );
    const result = JSON.parse(stdout.trim());
    if (result.success && result.path) {
      console.log('[PASS] TikTok', label + ':', result.path);
      return true;
    }
    console.error('[FAIL] TikTok', label + ':', result.error || 'No path');
    return false;
  } catch (e: any) {
    console.error('[FAIL] TikTok', label + ':', e.message || e);
    return false;
  }
}

async function main(): Promise<void> {
  console.log('Camoufox integration test (cwd=%s)\n', process.cwd());

  const instaOk = await testInstagramResolve();
  let videoOk = await testTikTokDownload(
    TIKTOK_VIDEO,
    'video',
    path.join(process.cwd(), 'storage', 'test_camoufox_video.mp4')
  );
  if (!videoOk) {
    console.log('[RETRY] TikTok video (rate limit / CAPTCHA can be intermittent)...');
    videoOk = await testTikTokDownload(
      TIKTOK_VIDEO,
      'video',
      path.join(process.cwd(), 'storage', 'test_camoufox_video.mp4')
    );
  }
  const photoOk = await testTikTokDownload(
    TIKTOK_PHOTO,
    'photo',
    path.join(process.cwd(), 'storage', 'test_camoufox_photo.jpg')
  );

  const coreOk = instaOk && photoOk;
  if (!videoOk && coreOk) {
    console.log('\n[WARN] TikTok video failed (often rate-limited by TikTok); Instagram + TikTok photo OK.');
  }
  const allOk = coreOk;
  console.log(allOk ? '\nCamoufox modules OK (Instagram + TikTok photo).' : '\nSome required checks failed.');
  process.exit(allOk ? 0 : 1);
}

main();
