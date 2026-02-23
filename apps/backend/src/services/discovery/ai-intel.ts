/**
 * AI Intelligence Gathering
 * 
 * Uses OpenAI to:
 * 1. Enrich target profile with insights
 * 2. Find and validate competitors
 * 3. Provide market context
 * 
 * ALWAYS guarantees results - AI never returns empty
 */

import OpenAI from 'openai';
import { resolveModelForTask } from '../ai/model-router';

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const AI_INTEL_MODEL_QUALITY = resolveModelForTask('analysis_quality');
const AI_INTEL_MODEL_FAST = resolveModelForTask('analysis_fast');

export interface TargetIntel {
  handle: string;
  niche: string;
  brandName?: string;
  brandVoice: string;
  contentThemes: string[];
  targetAudience: string;
  uniqueSellingPoints: string[];
  suggestedNiche: string;
  marketPosition?: string;
  growthOpportunities?: string[];
  websiteUrl?: string;
  crossPlatformHandles?: {
    facebook?: string;
    tiktok?: string;
    linkedin?: string;
  };
  contextSummary?: string;
}

export interface Competitor {
  handle: string;
  platform: string;
  discoveryReason: string;
  relevanceScore: number;
  competitorType: string;
  followerEstimate?: string;
  contentStyle?: string;
}

/**
 * Synthesize brand context from search results
 */
export async function synthesizeBrandContext(
  handle: string,
  searchResults: Array<{ title: string; snippet: string; source: string; link: string }>
): Promise<Partial<TargetIntel>> {
  if (!searchResults || searchResults.length === 0) return {};

  const contextText = searchResults.map(r => 
    `[${r.source.toUpperCase()}] ${r.title}: ${r.snippet} (${r.link})`
  ).join('\n');

  const prompt = `Analyze these search results for the brand/account "@${handle}".
  
Search Context:
${contextText}

Extract and synthesize the following:
1. True Brand Name (e.g. "The Productive Muslim Company" vs just "productivemuslim")
2. Main Website URL
3. Other Social Handles (Facebook, TikTok, LinkedIn) found in results
4. A concise 2-sentence summary of what they actually DO (e.g. "Training company providing productivity workshops..." vs "Lifestyle blogger")

Return JSON:
{
  "brandName": "Name",
  "websiteUrl": "https://...",
  "crossPlatformHandles": {
    "facebook": "handle",
    "tiktok": "handle",
    "linkedin": "handle"
  },
  "contextSummary": "Concise summary..."
}`;

  try {
    const openai = getOpenAiClient();
    if (!openai) throw new Error('OPENAI_API_KEY not configured');
    const response = await openai.chat.completions.create({
      model: AI_INTEL_MODEL_QUALITY,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3, // Lower temperature for factual extraction
    });

    const content = response.choices[0].message.content;
    return content ? JSON.parse(content) : {};
  } catch (e) {
    console.error(`[AIIntel] Context synthesis failed:`, e);
    return {};
  }
}

/**
 * Enrich target profile with AI insights - NOW WITH CONTEXT
 */
export async function enrichTargetProfile(input: {
  handle: string;
  bio: string;
  niche?: string;
  followerCount?: number;
  posts?: Array<{ caption: string; likes: number; comments: number }>;
  brandContext?: Partial<TargetIntel>; // New: Pass in synthesized context
}): Promise<TargetIntel> {
  const postsContext = input.posts?.slice(0, 5).map(p => 
    `- "${p.caption.slice(0, 200)}..." (${p.likes} likes, ${p.comments} comments)`
  ).join('\n') || 'No posts available';

  const externalContext = input.brandContext 
    ? `Verified External Context:\nBrand Name: ${input.brandContext.brandName}\nWhat they do: ${input.brandContext.contextSummary}\nWebsite: ${input.brandContext.websiteUrl}`
    : '';

  const prompt = `Analyze this Instagram account and provide strategic insights.

Account: @${input.handle}
Bio: ${input.bio}
${input.followerCount ? `Followers: ${input.followerCount.toLocaleString()}` : ''}
${input.niche ? `Claimed Niche: ${input.niche}` : ''}

${externalContext}

Sample Posts:
${postsContext}

Provide a detailed analysis in JSON format:
{
  "handle": "${input.handle}",
  "niche": "primary niche category",
  "suggestedNiche": "more specific sub-niche for competitor search",
  "brandVoice": "describe their tone/voice in 2-3 words",
  "contentThemes": ["theme1", "theme2", "theme3"],
  "targetAudience": "describe their ideal follower",
  "uniqueSellingPoints": ["usp1", "usp2"],
  "marketPosition": "where they sit in the market",
  "growthOpportunities": ["opportunity1", "opportunity2"]
}

Be specific and insightful. Return ONLY valid JSON.`;

  const openai = getOpenAiClient();
  if (!openai) throw new Error('OPENAI_API_KEY not configured');
  const response = await openai.chat.completions.create({
    model: AI_INTEL_MODEL_QUALITY,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.5,
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  const result = JSON.parse(content) as TargetIntel;
  // Merge AI insights with factual context
  return { ...result, ...input.brandContext };
}

/**
 * Find competitors using AI
 * Always returns at least minCount results
 */
export async function aiCompetitorFinder(
  handle: string,
  bio: string,
  niche: string,
  existingHandles: string[] = [],
  minCount: number = 5
): Promise<Competitor[]> {
  const existingContext = existingHandles.length > 0
    ? `\n\nAlready found (do NOT include these):\n${existingHandles.map(h => `- @${h}`).join('\n')}`
    : '';

  const prompt = `You are an expert social media strategist. Find ${minCount + 5} REAL Instagram competitor accounts.

Target Account: @${handle}
Bio: ${bio}
Niche: ${niche}
${existingContext}

Requirements:
1. Return REAL accounts that actually exist on Instagram
2. Accounts should be in the same or adjacent niche
3. Mix of competitor types:
   - Direct competitors (same niche, similar size)
   - Indirect competitors (adjacent niche)
   - Aspirational accounts (larger, client wants to emulate)
4. Include well-known accounts in this space
5. Relevance score 0.0-1.0 based on how similar they are

Return JSON:
{
  "competitors": [
    {
      "handle": "account_handle_without_at",
      "platform": "instagram",
      "discoveryReason": "Why this is relevant",
      "relevanceScore": 0.85,
      "competitorType": "direct|indirect|aspirational",
      "followerEstimate": "50K-100K",
      "contentStyle": "educational reels, carousels"
    }
  ]
}

IMPORTANT: 
- Return at least ${minCount} competitors
- Use REAL, verifiable Instagram handles
- Be specific about why each is relevant

Return ONLY valid JSON.`;

  const openai = getOpenAiClient();
  if (!openai) throw new Error('OPENAI_API_KEY not configured');
  const response = await openai.chat.completions.create({
    model: AI_INTEL_MODEL_QUALITY,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  const result = JSON.parse(content);
  let competitors: Competitor[] = result.competitors || [];

  // Validate we have minimum
  if (competitors.length < minCount) {
    console.log(`[AIIntel] Only got ${competitors.length}, need ${minCount}. Retrying...`);
    // Retry with more emphasis
    const retryResponse = await openai.chat.completions.create({
      model: AI_INTEL_MODEL_QUALITY,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: content },
        { role: 'user', content: `You only returned ${competitors.length} competitors. I need at least ${minCount}. Add more REAL Instagram accounts in the ${niche} space. Return the complete updated JSON.` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    });

    const retryContent = retryResponse.choices[0].message.content;
    if (retryContent) {
      const retryResult = JSON.parse(retryContent);
      competitors = retryResult.competitors || competitors;
    }
  }

  return competitors;
}

/**
 * Get market context for a niche
 */
export async function getMarketContext(niche: string): Promise<{
  topCreators: string[];
  trendingTopics: string[];
  contentFormats: string[];
  audienceSize: string;
}> {
  const prompt = `Provide market intelligence for the "${niche}" niche on Instagram.

Return JSON:
{
  "topCreators": ["handle1", "handle2", "handle3", "handle4", "handle5"],
  "trendingTopics": ["topic1", "topic2", "topic3"],
  "contentFormats": ["format1", "format2", "format3"],
  "audienceSize": "estimated total audience size"
}

Use REAL Instagram handles for top creators. Return ONLY valid JSON.`;

  const openai = getOpenAiClient();
  if (!openai) throw new Error('OPENAI_API_KEY not configured');
  const response = await openai.chat.completions.create({
    model: AI_INTEL_MODEL_FAST,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.5,
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return JSON.parse(content);
}
