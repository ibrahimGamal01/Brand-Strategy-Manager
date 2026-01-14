import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';

const openai = new OpenAI({
  apiKey: config.openaiKey,
  // Using direct OpenAI API (no baseURL override needed)
});

// Direct file-based cache for AI responses
const RESPONSE_CACHE_DIR = path.join(__dirname, '..', '..', 'cache', 'responses');

// Ensure cache directory exists
if (!fs.existsSync(RESPONSE_CACHE_DIR)) {
  fs.mkdirSync(RESPONSE_CACHE_DIR, { recursive: true });
}

interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
  initialRetryDelayMs?: number;
  stepName: string; // REQUIRED - used for caching
}

const DEFAULT_OPTIONS = {
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 6000,
  retries: 5,
  initialRetryDelayMs: 120000, // 2 minutes for worst-tier safety
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCachePath(stepName: string): string {
  // Sanitize step name for filename
  const safeName = stepName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  return path.join(RESPONSE_CACHE_DIR, `${safeName}.json`);
}

function loadCachedResponse(stepName: string): unknown | null {
  const cachePath = getCachePath(stepName);
  
  if (fs.existsSync(cachePath)) {
    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(content);
      
      // Check if cache is still valid (48 hours)
      const cacheAgeMs = Date.now() - (data.timestamp || 0);
      const maxAgeMs = config.cacheHours * 60 * 60 * 1000;
      
      if (cacheAgeMs < maxAgeMs) {
        const ageHours = (cacheAgeMs / (1000 * 60 * 60)).toFixed(1);
        logger.success(`✅ CACHED: ${stepName} (${ageHours}h old) - SKIPPING API CALL`);
        return data.response;
      } else {
        logger.info(`Cache expired for ${stepName}, will re-fetch`);
      }
    } catch (e) {
      logger.warn(`Failed to read cache for ${stepName}`);
    }
  }
  return null;
}

function saveCachedResponse(stepName: string, response: unknown): void {
  const cachePath = getCachePath(stepName);
  const data = {
    timestamp: Date.now(),
    savedAt: new Date().toISOString(),
    stepName,
    response,
  };
  
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
  logger.success(`💾 SAVED: ${stepName} - Response cached for ${config.cacheHours}h`);
}

export async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions
): Promise<unknown> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // ALWAYS check cache first - this is the key to avoiding repeat calls
  const cached = loadCachedResponse(opts.stepName);
  if (cached !== null) {
    return cached;
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= opts.retries!; attempt++) {
    try {
      logger.info(`🔄 API Call: ${opts.stepName} (attempt ${attempt}/${opts.retries}) - ${opts.model}`);
      
      const response = await openai.chat.completions.create({
        model: opts.model!,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        response_format: { type: 'json_object' },
      });
      
      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }
      
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        logger.warn('JSON parse failed, saving raw content');
        parsed = { raw: content, parseError: true };
      }
      
      // IMMEDIATELY save successful response - this is critical!
      saveCachedResponse(opts.stepName, parsed);
      
      return parsed;
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;
      
      // Check for rate limit error (429)
      const isRateLimited = errorMessage.includes('429') || 
                           errorMessage.includes('rate limit') ||
                           errorMessage.includes('Rate limit') ||
                           errorMessage.includes('too many requests') ||
                           errorMessage.includes('Too Many Requests');
      
      if (isRateLimited) {
        // Exponential backoff: 120s, 240s, 480s, 960s, 1920s (32 min max!)
        const backoffMs = opts.initialRetryDelayMs! * Math.pow(2, attempt - 1);
        const backoffSec = Math.round(backoffMs / 1000);
        const backoffMin = (backoffMs / 60000).toFixed(1);
        
        logger.warn(`⚠️ RATE LIMITED (429) - Attempt ${attempt}/${opts.retries}`);
        logger.info(`⏳ Waiting ${backoffMin} minutes before retry...`);
        
        if (attempt < opts.retries!) {
          await sleep(backoffMs);
          continue;
        }
      } else if (attempt < opts.retries!) {
        logger.warn(`Error (attempt ${attempt}): ${errorMessage}`);
        await sleep(10000); // 10s for non-rate-limit errors
        continue;
      }
    }
  }
  
  logger.error(`❌ FAILED: ${opts.stepName} after ${opts.retries} attempts`);
  throw lastError || new Error('OpenAI call failed');
}

export async function callOpenAIMini(
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions
): Promise<unknown> {
  return callOpenAI(systemPrompt, userPrompt, {
    ...options,
    model: 'gpt-4o-mini',
    maxTokens: options.maxTokens || 4000,
    // gpt-4o-mini has higher rate limits, can use shorter delay
    initialRetryDelayMs: 60000,
  });
}

// List all cached responses
export function listCachedResponses(): string[] {
  if (!fs.existsSync(RESPONSE_CACHE_DIR)) return [];
  return fs.readdirSync(RESPONSE_CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

// Clear specific step cache
export function clearStepCache(stepName: string): void {
  const cachePath = getCachePath(stepName);
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    logger.info(`Cleared cache for: ${stepName}`);
  }
}

// Clear all response cache
export function clearAllResponseCache(): void {
  if (fs.existsSync(RESPONSE_CACHE_DIR)) {
    const files = fs.readdirSync(RESPONSE_CACHE_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(RESPONSE_CACHE_DIR, file));
    }
    logger.info('All response cache cleared');
  }
}
