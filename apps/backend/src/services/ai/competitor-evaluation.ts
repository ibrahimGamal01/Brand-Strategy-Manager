import OpenAI from 'openai';
import { resolveModelForTask } from './model-router';

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const COMPETITOR_EVALUATION_MODEL = resolveModelForTask('analysis_quality');

export interface CompetitorCandidate {
    handleOrUrl: string;
    source: string; // 'search_code' | 'direct_query'
    snippet?: string; // Optional context from search result
}

export interface ScoredCompetitor {
    handleOrUrl: string;
    relevanceScore: number; // 0.0 to 1.0
    reasoning: string;
    platform: string; // 'instagram', 'website', 'youtube', etc.
    title?: string;
}

export async function evaluateCompetitorRelevance(
    brandName: string, 
    niche: string, 
    candidates: CompetitorCandidate[]
): Promise<ScoredCompetitor[]> {
    if (!candidates || candidates.length === 0) return [];

    const prompt = `
    You are a strategic brand analyst. I will provide a brand name, niche, and a list of potential competitors found via search.
    
    Your task is to:
    1. Analyze each candidate to determine if they are a relevant competitor.
    2. Assign a relevance score (0.0 to 1.0).
    3. Identify the platform (e.g., 'instagram', 'twitter', 'website', 'youtube').
    4. Provide a brief reasoning (max 1 sentence).
    5. Clean up the handle/URL and extract a display title if possible.

    Brand: "${brandName}"
    Niche: "${niche}"

    Candidates:
    ${JSON.stringify(candidates, null, 2)}

    Return ONLY a raw JSON array of objects with these fields:
    - handleOrUrl: string (cleaned URL or handle)
    - relevanceScore: number
    - reasoning: string
    - platform: string
    - title: string (name of the competitor)
    `;

    try {
        const openai = getOpenAiClient();
        if (!openai) {
          throw new Error('OPENAI_API_KEY not configured');
        }
        const completion = await openai.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: COMPETITOR_EVALUATION_MODEL,
            response_format: { type: "json_object" },
        });

        const content = completion.choices[0].message.content;
        if (!content) return [];

        const parsed = JSON.parse(content);
        // Handle cases where GPT wraps result in a key like "competitors"
        const results = Array.isArray(parsed) ? parsed : (parsed.competitors || parsed.results || []);
        
        return results.map((r: any) => ({
             handleOrUrl: r.handleOrUrl,
             relevanceScore: r.relevanceScore || 0,
             reasoning: r.reasoning || 'No reasoning provided',
             platform: r.platform?.toLowerCase() || 'other',
             title: r.title || r.handleOrUrl
        }));

    } catch (error) {
        console.error('Error evaluating competitors with AI:', error);
        // Fallback: return candidates with 0.5 score
        return candidates.map(c => ({
            handleOrUrl: c.handleOrUrl,
            relevanceScore: 0.5,
            reasoning: 'AI evaluation failed, defaulting to medium confidence',
            platform: 'unknown',
            title: c.handleOrUrl
        }));
    }
}
