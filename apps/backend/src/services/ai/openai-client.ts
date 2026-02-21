
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { APIPromise } from 'openai/core';
import { ChatCompletion, ChatCompletionCreateParams, ChatCompletionChunk } from 'openai/resources/chat/completions';

// Ensure env vars are loaded
dotenv.config();

const MAX_429_RETRIES_PRIMARY = 2; // wait+retry up to 2 times with primary (3 total attempts)
const RETRY_AFTER_CAP_SEC = 120;

function getRetryAfterMs(error: any): number | null {
  const headers = error?.headers;
  if (!headers) return null;
  const msRaw = headers['retry-after-ms'];
  if (msRaw != null) {
    const ms = typeof msRaw === 'string' ? parseInt(msRaw, 10) : Number(msRaw);
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, RETRY_AFTER_CAP_SEC * 1000);
  }
  const secRaw = headers['retry-after'];
  if (secRaw != null) {
    const sec = typeof secRaw === 'string' ? parseFloat(secRaw) : Number(secRaw);
    if (Number.isFinite(sec) && sec > 0) return Math.min(Math.ceil(sec * 1000), RETRY_AFTER_CAP_SEC * 1000);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Enhanced OpenAI Client with Fallback Mechanism
 *
 * - 429: Waits for retry-after then retries with same key; after max retries, tries fallback if configured.
 * - 401 / insufficient_quota: Switches to fallback key.
 */
class EnhancedOpenAIClient {
  private primaryClient: OpenAI | undefined;
  private fallbackClient: OpenAI | null | undefined;
  private useFallback: boolean = false;

  constructor() {
    // Lazy initialization handled in getPrimaryClient/getFallbackClient
  }

  private getPrimaryClient(): OpenAI {
    if (!this.primaryClient) {
      if (!process.env.OPENAI_API_KEY) {
        console.warn('[OpenAI] OPENAI_API_KEY is missing');
      }
      this.primaryClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
    return this.primaryClient;
  }

  private getFallbackClient(): OpenAI | null {
    if (this.fallbackClient === undefined) {
      if (process.env.OPENAI_API_KEY_FALLBACK) {
        this.fallbackClient = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY_FALLBACK
        });
        console.log('[OpenAI] Fallback client initialized');
      } else {
        console.warn('[OpenAI] No fallback key found (OPENAI_API_KEY_FALLBACK)');
        this.fallbackClient = null;
      }
    }
    return this.fallbackClient;
  }

  public chat = {
    completions: {
      create: (params: ChatCompletionCreateParams): APIPromise<ChatCompletion | ChatCompletionChunk> => {
        return this.createChatCompletion(params) as APIPromise<ChatCompletion | ChatCompletionChunk>;
      }
    }
  };

  private async createChatCompletion(params: ChatCompletionCreateParams): Promise<ChatCompletion | ChatCompletionChunk> {
    const fallback = this.getFallbackClient();
    if (this.useFallback && fallback) {
      return fallback.chat.completions.create(params) as any;
    }

    let lastError: any;
    for (let attempt = 0; attempt <= MAX_429_RETRIES_PRIMARY; attempt++) {
      try {
        return await this.getPrimaryClient().chat.completions.create(params) as any;
      } catch (error: any) {
        lastError = error;
        const isRateLimit = error?.status === 429;
        if (!isRateLimit) break;

        const waitMs = getRetryAfterMs(error);
        if (waitMs != null && attempt < MAX_429_RETRIES_PRIMARY) {
          console.warn(`[OpenAI] 429: waiting ${Math.round(waitMs / 1000)}s before retry (${attempt + 1}/${MAX_429_RETRIES_PRIMARY})`);
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }

    const isQuotaError = lastError?.code === 'insufficient_quota';
    const isRateLimit = lastError?.status === 429;
    const isAuthError = lastError?.status === 401;

    if ((isQuotaError || isRateLimit || isAuthError) && fallback) {
      const waitMs = isRateLimit ? getRetryAfterMs(lastError) : null;
      if (waitMs != null) {
        console.warn(`[OpenAI] 429: waiting ${Math.round(waitMs / 1000)}s then trying fallback...`);
        await sleep(waitMs);
      } else {
        console.warn(`[OpenAI] Primary key failed (${lastError?.code || lastError?.status}). Switching to fallback...`);
      }
      this.useFallback = true;
      return fallback.chat.completions.create(params) as any;
    }

    throw lastError;
  }
}

// Export singleton instance and types
export const openai = new EnhancedOpenAIClient();
export { OpenAI }; // Re-export OpenAI constructor and types if needed by consumers
