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

  const prompt = `You are a strategic brand consultant. Identify exactly 3-5 top-tier, direct competitors for the brand "${brandName}" operating in the "${niche}" niche.
  ${description ? `Brand Description: ${description}` : ''}

  CRITICAL RULES:
  1. ONLY suggest active, high-quality businesses with populated Instagram profiles.
  2. DO NOT suggest "dead" accounts, personal blogs, or low-quality pages.
  3. Suggest specific BRANDS, not just generic accounts.
  4. If you cannot find 3 high-quality competitors, return fewer (e.g., 1 or 2) rather than making up bad ones.

  For each competitor, provide:
  1. Name (brand/account name)
  2. Handle (Instagram handle without @)
  3. Relevance (0-100%) - Be strict. Only give >80% to perfect matches.

  Return a valid JSON object with a "competitors" key containing the array.
  Format:
  {
    "competitors": [
      {
        "name": "Competitor Name",
        "handle": "competitor_handle",
        "relevance": 85
      }
    ]
  }`;

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
    console.log(`[AI] Raw response for ${brandName}:`, content.substring(0, 100) + '...'); // Log preview
    
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        console.error('[AI] JSON Parse error:', e);
        return [];
    }
    
    // Handle potential wrapper keys like "competitors": [...]
    const results = Array.isArray(parsed) ? parsed : (parsed.competitors || []);

    if (!Array.isArray(results)) {
        console.error('[AI] Parsed result is not an array:', parsed);
        return [];
    }

    return results.map((c: any) => ({
      name: c.name,
      handle: c.handle,
      platform: 'instagram', // Default to Instagram since we simplified prompt
      reasoning: `${c.relevance}% relevance`, // Use relevance as reasoning
      relevanceScore: (c.relevance || 80) / 100 // Convert percentage to 0-1 score
    }));

  } catch (error) {
    console.error('[AI] Competitor suggestion failed:', error);
    return [];
  }
}
