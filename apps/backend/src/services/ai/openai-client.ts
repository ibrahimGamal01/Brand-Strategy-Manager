import OpenAI from 'openai';
import dotenv from 'dotenv';
import { APIPromise } from 'openai/core';
import { ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import {
  isAiModelTask,
  resolveFallbackModelsForTask,
  resolveModelForTask,
  resolveModelFromLegacy,
  resolveProviderForTask,
  type AiModelTask,
  type AiProvider,
} from './model-router';

// Ensure env vars are loaded
dotenv.config();

const MAX_429_RETRIES_PRIMARY = 2;
const RETRY_AFTER_CAP_SEC = 120;

type SupportedProvider = 'openai' | 'openrouter';

type ProviderClients = {
  primary: OpenAI;
  fallback: OpenAI | null;
  provider: SupportedProvider;
};

type RoutedRequest = {
  params: ChatCompletionCreateParams;
  task: AiModelTask | null;
  provider: AiProvider;
  primaryModel: string;
  fallbackModels: string[];
};

type BatChatCompletionParams = Omit<ChatCompletionCreateParams, 'model'> & {
  model?: string;
};

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isModelFallbackCandidate(error: any): boolean {
  const status = Number(error?.status);
  const code = String(error?.code || '').toLowerCase();
  if (status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return code === 'insufficient_quota' || code === 'rate_limit_exceeded' || code === 'model_not_found';
}

function resolveOpenRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
}

function resolveOpenRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.OPENROUTER_HTTP_REFERER) headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
  if (process.env.OPENROUTER_APP_NAME) headers['X-Title'] = process.env.OPENROUTER_APP_NAME;
  return headers;
}

class EnhancedOpenAIClient {
  private primaryClient: OpenAI | undefined;
  private fallbackClient: OpenAI | null | undefined;
  private openRouterClient: OpenAI | undefined;
  private openRouterFallbackClient: OpenAI | null | undefined;

  private useFallbackByProvider: Record<SupportedProvider, boolean> = {
    openai: false,
    openrouter: false,
  };

  private getPrimaryClient(): OpenAI {
    if (!this.primaryClient) {
      if (!process.env.OPENAI_API_KEY) {
        console.warn('[OpenAI] OPENAI_API_KEY is missing');
      }
      this.primaryClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this.primaryClient;
  }

  private getFallbackClient(): OpenAI | null {
    if (this.fallbackClient === undefined) {
      if (process.env.OPENAI_API_KEY_FALLBACK) {
        this.fallbackClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_FALLBACK });
        console.log('[OpenAI] Fallback client initialized');
      } else {
        this.fallbackClient = null;
      }
    }
    return this.fallbackClient;
  }

  private getOpenRouterClient(): OpenAI {
    if (!this.openRouterClient) {
      if (!process.env.OPENROUTER_API_KEY) {
        console.warn('[OpenRouter] OPENROUTER_API_KEY is missing');
      }
      this.openRouterClient = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: resolveOpenRouterBaseUrl(),
        defaultHeaders: resolveOpenRouterHeaders(),
      });
    }
    return this.openRouterClient;
  }

  private getOpenRouterFallbackClient(): OpenAI | null {
    if (this.openRouterFallbackClient === undefined) {
      if (process.env.OPENROUTER_API_KEY_FALLBACK) {
        this.openRouterFallbackClient = new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY_FALLBACK,
          baseURL: resolveOpenRouterBaseUrl(),
          defaultHeaders: resolveOpenRouterHeaders(),
        });
        console.log('[OpenRouter] Fallback client initialized');
      } else {
        this.openRouterFallbackClient = null;
      }
    }
    return this.openRouterFallbackClient;
  }

  private getProviderClients(provider: AiProvider): ProviderClients {
    if (provider === 'openrouter') {
      return {
        provider: 'openrouter',
        primary: this.getOpenRouterClient(),
        fallback: this.getOpenRouterFallbackClient(),
      };
    }

    if (provider === 'bedrock') {
      console.warn('[AI] Bedrock provider requested but adapter is not wired yet; falling back to OpenAI provider.');
    }

    return {
      provider: 'openai',
      primary: this.getPrimaryClient(),
      fallback: this.getFallbackClient(),
    };
  }

  public chat = {
    completions: {
      create: (params: ChatCompletionCreateParams): APIPromise<ChatCompletion | ChatCompletionChunk> => {
        return this.createChatCompletion(params) as APIPromise<ChatCompletion | ChatCompletionChunk>;
      },
    },
  };

  public bat = {
    chatCompletion: (
      task: AiModelTask,
      params: BatChatCompletionParams,
    ): APIPromise<ChatCompletion | ChatCompletionChunk> => {
      const request = {
        ...(params as Record<string, unknown>),
        model: params.model || resolveModelForTask(task),
        batTask: task,
      } as unknown as ChatCompletionCreateParams;
      return this.createChatCompletion(request) as APIPromise<ChatCompletion | ChatCompletionChunk>;
    },
  };

  private readTaskHint(params: ChatCompletionCreateParams): AiModelTask | null {
    const direct = (params as any)?.batTask;
    const metadataTask = (params as any)?.metadata?.batTask;
    const raw = typeof direct === 'string' && direct.trim() ? direct : metadataTask;
    return isAiModelTask(raw) ? raw : null;
  }

  private applyModelRouting(params: ChatCompletionCreateParams): RoutedRequest {
    const requestedModel = String((params as any)?.model || '');
    const task = this.readTaskHint(params);
    const provider = task ? resolveProviderForTask(task) : 'openai';
    const primaryModel = task
      ? resolveModelForTask(task, requestedModel || undefined)
      : resolveModelFromLegacy(requestedModel);
    const fallbackModels = task ? resolveFallbackModelsForTask(task, primaryModel) : [];

    const { batTask, ...rest } = params as any;
    return {
      params: {
        ...rest,
        model: primaryModel,
      },
      task,
      provider,
      primaryModel,
      fallbackModels,
    };
  }

  private async executeWithProvider(
    provider: AiProvider,
    params: ChatCompletionCreateParams,
  ): Promise<ChatCompletion | ChatCompletionChunk> {
    const clients = this.getProviderClients(provider);
    const fallbackEnabled = this.useFallbackByProvider[clients.provider];

    if (fallbackEnabled && clients.fallback) {
      return clients.fallback.chat.completions.create(params) as any;
    }

    let lastError: any;
    for (let attempt = 0; attempt <= MAX_429_RETRIES_PRIMARY; attempt += 1) {
      try {
        return (await clients.primary.chat.completions.create(params)) as any;
      } catch (error: any) {
        lastError = error;
        const isRateLimit = error?.status === 429;
        if (!isRateLimit) break;

        const waitMs = getRetryAfterMs(error);
        if (waitMs != null && attempt < MAX_429_RETRIES_PRIMARY) {
          console.warn(
            `[AI:${clients.provider}] 429 waiting ${Math.round(waitMs / 1000)}s before retry (${attempt + 1}/${MAX_429_RETRIES_PRIMARY})`,
          );
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }

    const isQuotaError = String(lastError?.code || '').toLowerCase() === 'insufficient_quota';
    const isRateLimit = lastError?.status === 429;
    const isAuthError = lastError?.status === 401;

    if ((isQuotaError || isRateLimit || isAuthError) && clients.fallback) {
      const waitMs = isRateLimit ? getRetryAfterMs(lastError) : null;
      if (waitMs != null) {
        console.warn(`[AI:${clients.provider}] waiting ${Math.round(waitMs / 1000)}s then trying fallback key`);
        await sleep(waitMs);
      } else {
        console.warn(`[AI:${clients.provider}] switching to fallback key after ${lastError?.code || lastError?.status}`);
      }
      this.useFallbackByProvider[clients.provider] = true;
      return clients.fallback.chat.completions.create(params) as any;
    }

    throw lastError;
  }

  private async createChatCompletion(params: ChatCompletionCreateParams): Promise<ChatCompletion | ChatCompletionChunk> {
    const routed = this.applyModelRouting(params);
    const modelChain = [routed.primaryModel, ...routed.fallbackModels];

    let lastError: any;
    for (let index = 0; index < modelChain.length; index += 1) {
      const model = modelChain[index];
      try {
        if (index > 0) {
          console.warn(
            `[AI] Trying fallback model ${model} (task=${routed.task || 'legacy'}, provider=${routed.provider}, attempt=${index + 1}/${modelChain.length})`,
          );
        }
        return await this.executeWithProvider(routed.provider, {
          ...routed.params,
          model,
        });
      } catch (error: any) {
        lastError = error;
        const canFallback = index < modelChain.length - 1 && isModelFallbackCandidate(error);
        if (!canFallback) throw error;
      }
    }

    throw lastError || new Error('Model call failed without an error payload');
  }
}

// Export singleton instance and types
export const openai = new EnhancedOpenAIClient();
export { OpenAI };
