/**
 * AI Business Analysis Service
 * 
 * Asks AI key business questions and saves responses to DB.
 * Part of the 3-layer information gathering system:
 * - Layer 1: DDG Search (raw data)
 * - Layer 2: AI Analysis (this service)
 * - Layer 3: Instagram (later)
 */

import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { resolveModelForTask } from './model-router';

const prisma = new PrismaClient();

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const BUSINESS_ANALYZER_MODEL = resolveModelForTask('analysis_fast');

export interface BusinessAnalysisInput {
  researchJobId: string;
  brandName: string;
  bio?: string;
  handle?: string;
  rawSearchResults?: Array<{
    title: string;
    href: string;
    body: string;
  }>;
  existingData?: {
    website?: string;
    instagram?: string;
    niche?: string;
  };
}

export interface BusinessAnalysisResult {
  valueProposition: string;
  targetAudience: string;
  contentPillars: string[];
  brandVoice: string;
  brandPersonality: string;
  competitorAnalysis: string;
  nichePosition: string;
  uniqueStrengths: string[];
  contentOpportunities: string[];
}

/**
 * Main function: Analyze business and save to DB
 */
export async function analyzeBusinessWithAI(
  input: BusinessAnalysisInput
): Promise<BusinessAnalysisResult & { id: string }> {
  console.log(`[AIAnalysis] Starting business analysis for: ${input.brandName}`);
  
  // Build context from raw search results
  const searchContext = input.rawSearchResults
    ?.slice(0, 20) // Limit to 20 results for context
    ?.map(r => `- ${r.title}: ${r.body}`)
    ?.join('\n') || 'No search results available';
  
  const prompt = buildAnalysisPrompt(input, searchContext);
  
  try {
    console.log(`[AIAnalysis] Calling OpenAI...`);
    
    const openai = getOpenAiClient();
    if (!openai) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    const response = await openai.chat.completions.create({
      model: BUSINESS_ANALYZER_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a brand strategist analyzing businesses. Provide detailed, actionable insights in JSON format. Be specific and avoid generic statements.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2000,
    });
    
    const rawResponse = response.choices[0]?.message?.content || '{}';
    const tokensUsed = response.usage?.total_tokens || 0;
    
    console.log(`[AIAnalysis] Got response (${tokensUsed} tokens)`);
    
    // Parse AI response
    const parsed = JSON.parse(rawResponse) as BusinessAnalysisResult;
    
    // Save to database
    const saved = await prisma.aiBusinessAnalysis.create({
      data: {
        researchJobId: input.researchJobId,
        valueProposition: parsed.valueProposition || null,
        targetAudience: parsed.targetAudience || null,
        contentPillars: parsed.contentPillars || null,
        brandVoice: parsed.brandVoice || null,
        brandPersonality: parsed.brandPersonality || null,
        competitorAnalysis: parsed.competitorAnalysis || null,
        nichePosition: parsed.nichePosition || null,
        uniqueStrengths: parsed.uniqueStrengths || null,
        contentOpportunities: parsed.contentOpportunities || null,
        rawAiResponse: parsed as any,
        promptUsed: prompt,
        modelUsed: BUSINESS_ANALYZER_MODEL,
        tokensUsed,
      },
    });
    
    console.log(`[AIAnalysis] Saved analysis with ID: ${saved.id}`);
    
    return {
      id: saved.id,
      valueProposition: parsed.valueProposition || '',
      targetAudience: parsed.targetAudience || '',
      contentPillars: parsed.contentPillars || [],
      brandVoice: parsed.brandVoice || '',
      brandPersonality: parsed.brandPersonality || '',
      competitorAnalysis: parsed.competitorAnalysis || '',
      nichePosition: parsed.nichePosition || '',
      uniqueStrengths: parsed.uniqueStrengths || [],
      contentOpportunities: parsed.contentOpportunities || [],
    };
    
  } catch (error: any) {
    console.error(`[AIAnalysis] Error:`, error.message);
    throw error;
  }
}

/**
 * Build the analysis prompt with all available context
 */
function buildAnalysisPrompt(input: BusinessAnalysisInput, searchContext: string): string {
  return `Analyze this business/brand and answer the key strategic questions.

## Brand Information
- Name: ${input.brandName}
${input.handle ? `- Instagram Handle: @${input.handle}` : ''}
${input.bio ? `- Bio: ${input.bio}` : ''}
${input.existingData?.website ? `- Website: ${input.existingData.website}` : ''}
${input.existingData?.niche ? `- Niche: ${input.existingData.niche}` : ''}

## Web Search Results
${searchContext}

## Answer these questions in JSON format:

{
  "valueProposition": "What unique value does this brand offer? What problem do they solve?",
  "targetAudience": "Who is their ideal customer/follower? Be specific about demographics and psychographics.",
  "contentPillars": ["List 3-5 main content themes they should focus on"],
  "brandVoice": "Describe their communication style (formal/casual, serious/playful, etc.)",
  "brandPersonality": "If the brand were a person, what would their personality be?",
  "competitorAnalysis": "Based on the search results, who are their main competitors and how do they differ?",
  "nichePosition": "Where does this brand sit in the market? What makes them different?",
  "uniqueStrengths": ["List 3-5 unique advantages or strengths"],
  "contentOpportunities": ["List 3-5 content ideas or opportunities they could pursue"]
}

Respond ONLY with valid JSON.`;
}

/**
 * Get existing analysis for a research job
 */
export async function getBusinessAnalysis(researchJobId: string) {
  return prisma.aiBusinessAnalysis.findFirst({
    where: { researchJobId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get all analyses for a research job (could have multiple iterations)
 */
export async function getAllBusinessAnalyses(researchJobId: string) {
  return prisma.aiBusinessAnalysis.findMany({
    where: { researchJobId },
    orderBy: { createdAt: 'desc' },
  });
}
