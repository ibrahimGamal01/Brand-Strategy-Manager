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
 * Suggests Instagram competitors using AI based on brand profile and niche.
 */
export async function suggestInstagramCompetitors(
  brandName: string,
  niche: string,
  description?: string
): Promise<AICompetitorSuggestion[]> {
    console.log(`[AI] Suggesting Instagram competitors for ${brandName} (${niche})`);

  const prompt = `You are a strategic brand consultant specialized in ${niche}. Find 3-5 REAL, ACTIVE Instagram competitors for "${brandName}".  
  ${description ? `Brand Description: ${description}` : ''}

  CRITICAL REQUIREMENTS:
  1. ✅ ONLY suggest accounts that ACTUALLY EXIST on Instagram right now
  2. ✅ Accounts MUST be in the ${niche} niche or closely related
  3. ✅ Accounts must be ACTIVE (posting within last 3 months)
  4. ✅ Minimum 5,000 followers (no micro or inactive accounts)
  5. ❌ DO NOT suggest mega-celebrities (>5M followers) - they're not real competitors
  6. ❌ DO NOT suggest accounts outside the ${niche} niche
  7. ❌ DO NOT make up handles - if you can't find real ones, return fewer results
  8. ❌ DO NOT suggest: ${brandName} itself, generic accounts, personal blogs, or dead pages

  BEFORE suggesting each account, ask yourself:
  - "Does this account actually exist on Instagram?"
  - "Is it in the ${niche} niche?"
  - "Would ${brandName} actually consider this a competitor?"
  
  If the answer to ANY question is "no" or "unsure", DO NOT include it.

  For each competitor, provide:
  1. Name (actual brand/business name)
  2. Handle (Instagram username without @)
  3. Relevance (0-100%) - Only give >70% to true competitors in same niche
  4. Reasoning (brief explanation why this is a real competitor)

  Return valid JSON:
  {
    "competitors": [
      {
        "name": "Competitor Name",
        "handle": "actual_ig_handle",
        "relevance": 85,
        "reasoning": "Brief explanation of why this is a competitor"
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
      platform: 'instagram' as const,
      reasoning: c.reasoning || `${c.relevance}% relevance`,
      relevanceScore: (c.relevance || 70) / 100 // Convert percentage to 0-1 score
    })).filter(c => c.relevanceScore >= 0.7); // Only return high-confidence suggestions

  } catch (error) {
    console.error('[AI] Instagram competitor suggestion failed:', error);
    return [];
  }
}

/**
 * Suggests TikTok competitors using AI based on brand profile and niche.
 */
export async function suggestTikTokCompetitors(
  brandName: string,
  niche: string,
  description?: string
): Promise<AICompetitorSuggestion[]> {
  console.log(`[AI] Suggesting TikTok competitors for ${brandName} (${niche})`);

  const prompt = `You are a strategic brand consultant specialized in ${niche}. Find 3-5 REAL, ACTIVE TikTok creators/brands for "${brandName}".
  ${description ? `Brand Description: ${description}` : ''}

  CRITICAL REQUIREMENTS:
  1. ✅ ONLY suggest accounts that ACTUALLY EXIST on TikTok right now
  2. ✅ Accounts MUST be in the ${niche} niche or closely related
  3. ✅ Accounts must be ACTIVE (posting within last month)
  4. ✅ Minimum 10,000 followers on TikTok
  5. ❌ DO NOT suggest mega-influencers (>5M followers) - they're not real competitors
  6. ❌ DO NOT suggest accounts outside the ${niche} niche
  7. ❌ DO NOT make up handles - if you can't find real ones, return fewer results
  8. ❌ DO NOT suggest: ${brandName} itself, generic accounts, or inactive pages

  BEFORE suggesting each account, ask yourself:
  - "Does this account actually exist on TikTok?"
  - "Is it in the ${niche} niche?"
  - "Would ${brandName} actually consider this a competitor?"
  
  If the answer to ANY question is "no" or "unsure", DO NOT include it.

  For each competitor, provide:
  1. Name (actual brand/creator name)
  2. Handle (TikTok username without @)
  3. Relevance (0-100%) - Only give >70% to true competitors in same niche
  4. Reasoning (brief explanation why this is a real competitor)

  Return valid JSON:
  {
    "competitors": [
      {
        "name": "Competitor Name",
        "handle": "actual_tiktok_handle",
        "relevance": 85,
        "reasoning": "Brief explanation of why this is a competitor"
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
    console.log(`[AI] Raw TikTok response for ${brandName}:`, content.substring(0, 100) + '...');
    
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        console.error('[AI] TikTok JSON Parse error:', e);
        return [];
    }
    
    const results = Array.isArray(parsed) ? parsed : (parsed.competitors || []);

    if (!Array.isArray(results)) {
        console.error('[AI] TikTok parsed result is not an array:', parsed);
        return [];
    }

    return results.map((c: any) => ({
      name: c.name,
      handle: c.handle,
      platform: 'tiktok' as const,
      reasoning: c.reasoning || `${c.relevance}% relevance`,
      relevanceScore: (c.relevance || 70) / 100
    })).filter(c => c.relevanceScore >= 0.7);

  } catch (error) {
    console.error('[AI] TikTok competitor suggestion failed:', error);
    return [];
  }
}

/**
 * Suggests competitors across multiple platforms (Instagram + TikTok)
 */
export async function suggestCompetitorsMultiPlatform(
  brandName: string,
  niche: string,
  description?: string
): Promise<AICompetitorSuggestion[]> {
  console.log(`[AI] Suggesting multi-platform competitors for ${brandName}`);
  
  const [instagramCompetitors, tiktokCompetitors] = await Promise.all([
    suggestInstagramCompetitors(brandName, niche, description),
    suggestTikTokCompetitors(brandName, niche, description)
  ]);
  
  const total = instagramCompetitors.length + tiktokCompetitors.length;
  console.log(`[AI] Found ${instagramCompetitors.length} Instagram + ${tiktokCompetitors.length} TikTok = ${total} total competitors`);
  
  return [...instagramCompetitors, ...tiktokCompetitors];
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
  return suggestInstagramCompetitors(brandName, niche, description);
}
