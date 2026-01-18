import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface AICompetitorSuggestion {
  name: string;
  handle: string;
  platform: 'instagram' | 'tiktok' | 'twitter' | 'linkedin' | 'youtube';
  reasoning: string;
  relevanceScore: number; // 0.0 to 1.0
}

/**
 * Suggests direct competitors using AI based on brand profile and niche.
 * Returns a JSON array of suggested competitors.
 */
export async function suggestCompetitorsWithAI(
  brandName: string,
  niche: string,
  description?: string
): Promise<AICompetitorSuggestion[]> {
  console.log(`[AI] Suggesting competitors for ${brandName} (${niche})`);

  const prompt = `You are a strategic brand consultant. Identify 5-7 direct competitors for the brand "${brandName}" operating in the "${niche}" niche.
  ${description ? `Brand Description: ${description}` : ''}

  Focus on finding active competitors on social media (prioritize Instagram).
  For each competitor, provide:
  1. Name
  2. Estimated Handle (without @)
  3. Platform (default to instagram)
  4. Specific Reasoning (why are they a competitor?)
  5. Relevance Score (0.0 - 1.0)

  Return ONLY a raw JSON array of objects. No markdown formatting.
  Format:
  [
    {
      "name": "Competitor Name",
      "handle": "competitor_handle",
      "platform": "instagram",
      "reasoning": "Direct overlap in target audience...",
      "relevanceScore": 0.95
    }
  ]`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    });

    const content = response.choices[0].message.content || '{"competitors": []}';
    const parsed = JSON.parse(content);
    
    // Handle potential wrapper keys like "competitors": [...]
    const results = Array.isArray(parsed) ? parsed : (parsed.competitors || []);

    return results.map((c: any) => ({
      name: c.name,
      handle: c.handle,
      platform: c.platform?.toLowerCase() || 'instagram',
      reasoning: c.reasoning,
      relevanceScore: c.relevanceScore || 0.8
    }));

  } catch (error) {
    console.error('[AI] Competitor suggestion failed:', error);
    return [];
  }
}
