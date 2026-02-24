type AiFallbackMode = 'off' | 'mock';

type RuntimePreflightReport = {
  profile: 'production' | 'non-production';
  aiFallbackMode: AiFallbackMode;
  providers: {
    openai: boolean;
    apifyApi: boolean;
    apifyMediaDownloader: boolean;
    scraplingWorker: boolean;
  };
  warnings: string[];
};

function isProductionProfile(): boolean {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function getAiFallbackMode(): AiFallbackMode {
  const raw = String(process.env.AI_FALLBACK_MODE || 'off').trim().toLowerCase();
  if (raw === 'off' || raw === 'mock') return raw;
  throw new Error(
    `[Preflight] Invalid AI_FALLBACK_MODE "${raw}". Expected "off" or "mock".`
  );
}

function isOpenAiKeyValid(key: string): boolean {
  const value = String(key || '').trim();
  if (!value) return false;
  return /^sk-[A-Za-z0-9\-_]{20,}$/.test(value);
}

function isApifyTokenValid(token: string): boolean {
  const value = String(token || '').trim();
  if (!value) return false;
  const prefix = 'apify' + '_api_';
  if (!value.startsWith(prefix)) return false;
  return /^[A-Za-z0-9]{20,}$/.test(value.slice(prefix.length));
}

export function validateRuntimePreflight(): RuntimePreflightReport {
  const production = isProductionProfile();
  const aiFallbackMode = getAiFallbackMode();
  const openAiValid = isOpenAiKeyValid(process.env.OPENAI_API_KEY || '');
  const apifyApiValid = isApifyTokenValid(process.env.APIFY_API_TOKEN || '');
  const apifyMediaValid = isApifyTokenValid(process.env.APIFY_MEDIA_DOWNLOADER_TOKEN || '');
  const scraplingWorker = String(process.env.SCRAPLING_WORKER_URL || '').trim().length > 0;

  const warnings: string[] = [];
  const errors: string[] = [];

  if (production && aiFallbackMode === 'mock') {
    errors.push('AI_FALLBACK_MODE=mock is not allowed in production.');
  }

  if (aiFallbackMode === 'off') {
    if (!openAiValid) {
      const message =
        'OPENAI_API_KEY is missing or invalid while AI_FALLBACK_MODE=off (real AI mode).';
      errors.push(message);
    }
  }

  // Scraper stack uses Apify as primary path in this project.
  if (!apifyApiValid) {
    const message = 'APIFY_API_TOKEN is missing or invalid.';
    if (production) errors.push(message);
    else warnings.push(message);
  }

  if (!apifyMediaValid) {
    const message = 'APIFY_MEDIA_DOWNLOADER_TOKEN is missing or invalid.';
    if (production) errors.push(message);
    else warnings.push(message);
  }

  if (!scraplingWorker) {
    warnings.push('SCRAPLING_WORKER_URL is not set. Web intelligence deep fetch/crawl tools will use lightweight fallback mode.');
  }

  if (errors.length > 0) {
    throw new Error(`[Preflight] Runtime validation failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    profile: production ? 'production' : 'non-production',
    aiFallbackMode,
    providers: {
      openai: openAiValid,
      apifyApi: apifyApiValid,
      apifyMediaDownloader: apifyMediaValid,
      scraplingWorker,
    },
    warnings,
  };
}

export function isAiFallbackEnabled(): boolean {
  return getAiFallbackMode() === 'mock' && !isProductionProfile();
}

export function isOpenAiConfiguredForRealMode(): boolean {
  return isOpenAiKeyValid(process.env.OPENAI_API_KEY || '');
}
