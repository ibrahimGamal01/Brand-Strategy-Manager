import OpenAI from 'openai';
import { isOpenAiConfiguredForRealMode } from '../../lib/runtime-preflight';

let openaiClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

export interface AICompetitorSuggestion {
  name: string;
  handle: string;
  platform: 'instagram' | 'tiktok' | 'twitter' | 'linkedin' | 'youtube';
  reasoning: string;
  relevanceScore: number; // 0.0 to 1.0
}

export interface CompetitorSuggestionContext {
  searchInstructions?: string[];
  nicheKeywords?: string[];
  excludeHandles?: string[];
  priorCompetitors?: string[];
  audienceSummary?: string;
  maxPerPlatform?: number;
  minRelevanceScore?: number;
}

type DiscoveryPlatform = 'instagram' | 'tiktok';

const GENERIC_OR_BROAD_HANDLES = new Set([
  'google',
  'nike',
  'netflix',
  'ibm',
  'entrepreneur',
  'creators',
  'business',
  'marketing',
  'startup',
  'quotes',
  'motivation',
  'success',
  'viral',
  'garyvee',
  'imangadzhi',
]);

function looksLowSignalHandle(handle: string): boolean {
  if (!handle) return true;
  if (handle.length < 3 || handle.length > 30) return true;
  if (!/^[a-z0-9._]+$/.test(handle)) return true;
  if (!/[a-z]/.test(handle)) return true;
  if (/^\d{6,}$/.test(handle)) return true;
  if (GENERIC_OR_BROAD_HANDLES.has(handle)) return true;
  if (/(coupon|deal|discount|giveaway|meme|fanpage|fan_page|quotes|motivation)/i.test(handle)) {
    return true;
  }
  return false;
}

function parsePriorHandles(values: string[]): string[] {
  const handles = new Set<string>();
  for (const value of values || []) {
    const [left, right] = String(value || '').split(':');
    const rawHandle = right ? right : left;
    const handle = normalizeHandle(rawHandle);
    if (!handle || looksLowSignalHandle(handle)) continue;
    handles.add(handle);
    if (handles.size >= 16) break;
  }
  return Array.from(handles);
}

function normalizeHandle(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]/g, '');
}

function dedupeSuggestions(suggestions: AICompetitorSuggestion[]): AICompetitorSuggestion[] {
  const seen = new Set<string>();
  const result: AICompetitorSuggestion[] = [];

  for (const suggestion of suggestions) {
    const handle = normalizeHandle(suggestion.handle);
    if (!handle) continue;
    const key = `${suggestion.platform}:${handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...suggestion,
      handle,
      relevanceScore: Math.max(0, Math.min(1, suggestion.relevanceScore)),
    });
  }

  return result;
}

async function requestPlatformCompetitors(
  platform: DiscoveryPlatform,
  brandName: string,
  niche: string,
  description?: string,
  context: CompetitorSuggestionContext = {}
): Promise<AICompetitorSuggestion[]> {
  const openai = getOpenAiClient();
  if (!openai || !isOpenAiConfiguredForRealMode()) {
    return [];
  }

  const targetCount = Math.max(4, Math.min(12, Number(context.maxPerPlatform || 8)));
  const minScore = Math.max(0.4, Math.min(0.95, Number(context.minRelevanceScore || 0.6)));
  const keywordHints = (context.nicheKeywords || []).filter(Boolean).slice(0, 10);
  const instructionHints = (context.searchInstructions || []).filter(Boolean).slice(0, 8);
  const priorCompetitors = parsePriorHandles((context.priorCompetitors || []).filter(Boolean)).slice(0, 12);
  const excludedHandles = (context.excludeHandles || []).map(normalizeHandle).filter(Boolean).slice(0, 20);

  const platformLabel = platform === 'instagram' ? 'Instagram' : 'TikTok';
  const handlePattern = platform === 'instagram' ? '[a-z0-9._]{3,30}' : '[a-z0-9._]{2,24}';
  const model = process.env.OPENAI_COMPETITOR_MODEL || 'gpt-4o-mini';

  const prompt = `
You are a competitor finder for ${platformLabel} direct peers.

Target business:
- Brand: ${brandName}
- Niche: ${niche}
- Description: ${description || 'Not provided'}
- Audience summary: ${context.audienceSummary || 'Not provided'}

RAG hints:
- Niche keywords: ${keywordHints.join(', ') || 'n/a'}
- Search instructions: ${instructionHints.join(' | ') || 'n/a'}
- Prior accepted competitors: ${priorCompetitors.join(', ') || 'n/a'}

Exclusions:
- Never include these handles: ${excludedHandles.join(', ') || 'n/a'}
- Never include the target brand/account itself.
- Avoid global mega brands unless they are true direct peers.

Requirements:
1. Suggest ${targetCount} or fewer REAL ${platformLabel} accounts.
2. Only direct or near-direct peers in the same business problem space and audience.
3. If uncertain that a handle exists, omit it.
4. Use handle format regex: ${handlePattern}
5. Exclude generic quote/coupon/news/fan/celebrity accounts.
6. Return JSON only.

Response schema:
{
  "competitors": [
    {
      "name": "Brand Name",
      "handle": "account_handle_without_at",
      "relevance": 0.0,
      "reasoning": "One sentence with evidence"
    }
  ]
}
`;

  try {
  const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1200,
    });

    const content = response.choices[0]?.message?.content || '{"competitors": []}';
    const parsed = JSON.parse(content) as {
      competitors?: Array<{
        name?: string;
        handle?: string;
        relevance?: number;
        reasoning?: string;
      }>;
    };

    const results = Array.isArray(parsed.competitors) ? parsed.competitors : [];
    const normalized = results
      .map((item) => {
        const handle = normalizeHandle(item.handle || '');
        if (!handle) return null;
        if (excludedHandles.includes(handle)) return null;
        if (looksLowSignalHandle(handle)) return null;

        return {
          name: String(item.name || handle),
          handle,
          platform,
          reasoning: String(item.reasoning || 'AI direct-peer suggestion').slice(0, 280),
          relevanceScore: Math.max(0, Math.min(1, Number(item.relevance ?? 0.6))),
        } as AICompetitorSuggestion;
      })
      .filter((item): item is AICompetitorSuggestion => Boolean(item))
      .filter((item) => item.relevanceScore >= minScore);

    return dedupeSuggestions(normalized).slice(0, targetCount);
  } catch (error) {
    console.error(`[AI] ${platformLabel} competitor suggestion failed:`, error);
    return [];
  }
}

/**
 * Suggests Instagram competitors using AI based on brand profile and niche.
 */
export async function suggestInstagramCompetitors(
  brandName: string,
  niche: string,
  description?: string,
  context: CompetitorSuggestionContext = {}
): Promise<AICompetitorSuggestion[]> {
  console.log(`[AI] Suggesting Instagram competitors for ${brandName} (${niche})`);
  return requestPlatformCompetitors('instagram', brandName, niche, description, context);
}

/**
 * Suggests TikTok competitors using AI based on brand profile and niche.
 */
export async function suggestTikTokCompetitors(
  brandName: string,
  niche: string,
  description?: string,
  context: CompetitorSuggestionContext = {}
): Promise<AICompetitorSuggestion[]> {
  console.log(`[AI] Suggesting TikTok competitors for ${brandName} (${niche})`);
  return requestPlatformCompetitors('tiktok', brandName, niche, description, context);
}

/**
 * Suggests competitors across multiple platforms (Instagram + TikTok)
 */
export async function suggestCompetitorsMultiPlatform(
  brandName: string,
  niche: string,
  description?: string,
  context: CompetitorSuggestionContext = {}
): Promise<AICompetitorSuggestion[]> {
  console.log(`[AI] Suggesting multi-platform competitors for ${brandName}`);
  const [instagramCompetitors, tiktokCompetitors] = await Promise.all([
    suggestInstagramCompetitors(brandName, niche, description, context),
    suggestTikTokCompetitors(brandName, niche, description, context),
  ]);

  const total = instagramCompetitors.length + tiktokCompetitors.length;
  console.log(`[AI] Found ${instagramCompetitors.length} Instagram + ${tiktokCompetitors.length} TikTok = ${total} total competitors`);

  return dedupeSuggestions([...instagramCompetitors, ...tiktokCompetitors]);
}

/**
 * Legacy function - now delegates to Instagram-specific discovery
 * @deprecated Use suggestInstagramCompetitors or suggestCompetitorsMultiPlatform instead
 */
export async function suggestCompetitorsWithAI(
  brandName: string,
  niche: string,
  description?: string
): Promise<AICompetitorSuggestion[]> {
  return suggestInstagramCompetitors(brandName, niche, description, {});
}
