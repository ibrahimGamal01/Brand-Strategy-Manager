import os from 'node:os';
import path from 'node:path';

const PDF_BROWSER_INSTALL_TIMEOUT_MS = 120_000;
const DEFAULT_PUPPETEER_CACHE_DIR = path.join(os.homedir(), '.cache', 'puppeteer');

let installRecoveryPromise: Promise<boolean> | null = null;

export class PdfRendererUnavailableError extends Error {
  readonly code = 'PDF_RENDERER_UNAVAILABLE';

  constructor(message = 'PDF generation is temporarily unavailable because the browser runtime is missing.') {
    super(message);
    this.name = 'PdfRendererUnavailableError';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isMissingBrowserError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('could not find chrome') ||
    message.includes('could not find chromium') ||
    message.includes('browser was not found') ||
    message.includes('failed to launch')
  );
}

function extractChromeVersionFromError(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  const match = message.match(/chrome\s*\(ver\.\s*([^)]+)\)/i);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function resolvePuppeteerCacheDir(): string {
  const explicit = String(process.env.PUPPETEER_CACHE_DIR || '').trim();
  return explicit || DEFAULT_PUPPETEER_CACHE_DIR;
}

function resolveLaunchOptions(executablePath?: string): Record<string, unknown> {
  const explicitPath =
    executablePath ||
    String(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '').trim() ||
    '';

  return {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(explicitPath ? { executablePath: explicitPath } : {}),
  };
}

async function tryInstallChromeBuild(preferredBuildId?: string | null): Promise<boolean> {
  try {
    const browsers = require('@puppeteer/browsers') as {
      install: (input: Record<string, unknown>) => Promise<unknown>;
      detectBrowserPlatform: () => string | undefined;
      resolveBuildId: (browser: string, platform: string, tag: string) => Promise<string>;
      Browser: Record<string, string>;
      ChromeReleaseChannel: Record<string, string>;
    };

    const platform = browsers.detectBrowserPlatform();
    if (!platform) {
      console.warn('[PDF] Could not detect browser platform for Puppeteer install.');
      return false;
    }

    const cacheDir = resolvePuppeteerCacheDir();
    const browser = browsers.Browser?.CHROME || 'chrome';
    const stableTag = browsers.ChromeReleaseChannel?.STABLE || 'stable';
    const buildId = preferredBuildId || (await browsers.resolveBuildId(browser, platform, stableTag));

    await withTimeout(
      browsers.install({
        browser,
        buildId,
        platform,
        cacheDir,
      }),
      PDF_BROWSER_INSTALL_TIMEOUT_MS,
      'Puppeteer browser install'
    );

    process.env.PUPPETEER_CACHE_DIR = cacheDir;
    return true;
  } catch (error: any) {
    console.warn('[PDF] Browser auto-install failed:', String(error?.message || error));
    return false;
  }
}

async function ensureChromeAvailable(preferredBuildId?: string | null): Promise<boolean> {
  if (!installRecoveryPromise) {
    installRecoveryPromise = tryInstallChromeBuild(preferredBuildId).finally(() => {
      installRecoveryPromise = null;
    });
  }
  return installRecoveryPromise;
}

async function launchBrowserWithRecovery(puppeteer: any): Promise<any> {
  try {
    return await puppeteer.launch(resolveLaunchOptions());
  } catch (error: any) {
    if (!isMissingBrowserError(error)) {
      throw error;
    }

    const preferredBuildId = extractChromeVersionFromError(error);
    const recovered = await ensureChromeAvailable(preferredBuildId);
    if (!recovered) {
      throw new PdfRendererUnavailableError();
    }

    try {
      return await puppeteer.launch(resolveLaunchOptions());
    } catch (retryError: any) {
      if (isMissingBrowserError(retryError)) {
        throw new PdfRendererUnavailableError();
      }
      throw retryError;
    }
  }
}

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  // Lazy-load puppeteer to keep startup light in API workers.
  const puppeteer = require('puppeteer');
  const browser = await launchBrowserWithRecovery(puppeteer);

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.6in',
        right: '0.6in',
        bottom: '0.6in',
        left: '0.6in',
      },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
