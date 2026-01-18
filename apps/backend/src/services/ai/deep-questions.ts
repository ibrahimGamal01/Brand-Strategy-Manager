/**
 * Deep AI Questions Service
 * 
 * Each question is a SEPARATE OpenAI request for deep, focused answers.
 * One answer per question type per research job (enforced by DB).
 * 
 * Question Types:
 * - VALUE_PROPOSITION
 * - TARGET_AUDIENCE
 * - CONTENT_PILLARS
 * - BRAND_VOICE
 * - BRAND_PERSONALITY
 * - COMPETITOR_ANALYSIS
 * - NICHE_POSITION
 * - UNIQUE_STRENGTHS
 * - CONTENT_OPPORTUNITIES
 * - GROWTH_STRATEGY
 * - PAIN_POINTS
 * - KEY_DIFFERENTIATORS
 */

import OpenAI from 'openai';
import { PrismaClient, AiQuestionType } from '@prisma/client';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Deep question prompts - each designed for thorough analysis
const QUESTION_PROMPTS: Record<AiQuestionType, { question: string; systemPrompt: string }> = {
  VALUE_PROPOSITION: {
    question: 'What is the unique value proposition of this brand? What problem do they solve that others cannot?',
    systemPrompt: `You are a brand strategist. Analyze deeply and provide:
1. Core value being delivered
2. The specific problem being solved
3. What makes it different from alternatives
4. The emotional and functional benefits
Be specific, avoid generic statements. Use evidence from the context provided.`,
  },
  
  TARGET_AUDIENCE: {
    question: 'Who is the ideal target audience for this brand? Be specific about demographics, psychographics, and behaviors.',
    systemPrompt: `You are a audience researcher. Provide a detailed analysis of:
1. Demographics (age, location, income, education)
2. Psychographics (values, beliefs, interests)
3. Behavioral patterns (online behavior, content consumption)
4. Pain points and desires
5. Where they spend time online
Be specific and avoid generic descriptions.`,
  },
  
  CONTENT_PILLARS: {
    question: 'What are the 5-7 main content pillars this brand should focus on for their content strategy?',
    systemPrompt: `You are a content strategist. Define:
1. 5-7 specific content pillars with explanations
2. Why each pillar resonates with their audience
3. Example topics under each pillar
4. The mix of educational, inspirational, and promotional content
Format as a structured list. Be specific to their niche.`,
  },
  
  BRAND_VOICE: {
    question: 'What is the ideal brand voice and communication style for this brand?',
    systemPrompt: `You are a brand communications expert. Analyze:
1. Tone of voice (formal/casual, serious/playful)
2. Language style (simple/complex, jargon usage)
3. Personality traits in communication
4. Words to use and words to avoid
5. Example phrases that capture the voice
Be specific to their audience and niche.`,
  },
  
  BRAND_PERSONALITY: {
    question: 'If this brand were a person, what would their personality be? Use archetypes and traits.',
    systemPrompt: `You are a brand psychologist. Define:
1. Primary brand archetype (e.g., Sage, Hero, Creator)
2. Secondary archetype traits
3. Key personality traits (3-5)
4. How this personality shows up in content
5. What kind of "friend" the brand is to customers
Be specific and avoid generic descriptions.`,
  },
  
  COMPETITOR_ANALYSIS: {
    question: 'Who are the main competitors and how does this brand differentiate from them?',
    systemPrompt: `You are a competitive analyst. Provide:
1. List of 5-10 direct competitors
2. Each competitor's strengths and weaknesses
3. Gaps in the market the brand can fill
4. Unique positioning opportunities
5. Content strategies competitors use
Be specific with competitor names and details.`,
  },
  
  NICHE_POSITION: {
    question: 'What is the brand\'s position in the market? How can they own a specific niche?',
    systemPrompt: `You are a market positioning expert. Analyze:
1. Current market position
2. Underserved niches they could own
3. Blue ocean opportunities
4. How to become the go-to authority
5. Key messages to reinforce position
Be specific to their industry and audience.`,
  },
  
  UNIQUE_STRENGTHS: {
    question: 'What are the unique strengths and competitive advantages of this brand?',
    systemPrompt: `You are a strategic analyst. Identify:
1. 5-7 unique strengths
2. Why each strength matters to the audience
3. How to leverage each strength in content
4. Strengths that are hard to replicate
5. Hidden strengths that could be amplified
Be specific and evidence-based.`,
  },
  
  CONTENT_OPPORTUNITIES: {
    question: 'What content opportunities exist for this brand? What formats, topics, and channels?',
    systemPrompt: `You are a content opportunities analyst. Identify:
1. Untapped content formats (video, podcast, etc.)
2. Trending topics in their niche
3. Underutilized channels
4. Collaboration opportunities
5. Seasonal and evergreen opportunities
6. Content gaps competitors are missing
Be specific and actionable.`,
  },
  
  GROWTH_STRATEGY: {
    question: 'What growth strategies would work best for this brand to increase their reach and engagement?',
    systemPrompt: `You are a growth strategist. Recommend:
1. Top 5 growth tactics for their niche
2. channels to prioritize
3. Collaboration and partnership opportunities
4. Community building strategies
5. Viral content opportunities
6. Paid vs organic balance
Be specific to their audience and resources.`,
  },
  
  PAIN_POINTS: {
    question: 'What are the main pain points and challenges that this brand\'s audience faces?',
    systemPrompt: `You are an audience empathy researcher. Identify:
1. Top 5-7 pain points
2. The emotional impact of each pain point
3. How the brand can address each one
4. Content topics that speak to these pains
5. The "before and after" transformation
Be specific and emotionally resonant.`,
  },
  
  KEY_DIFFERENTIATORS: {
    question: 'What makes this brand truly different from all competitors? What is their unfair advantage?',
    systemPrompt: `You are a differentiation expert. Analyze:
1. The one thing that makes them unique
2. Why this matters to customers
3. How to communicate this difference
4. What they can do that no one else can
5. Their "only we" statements
Be specific and bold.`,
  },
  
  CUSTOM: {
    question: '',
    systemPrompt: 'You are a strategic business analyst. Provide a thorough, evidence-based analysis.',
  },
};

export interface QuestionContext {
  brandName: string;
  handle?: string;
  bio?: string;
  niche?: string;
  websiteUrl?: string;
  rawSearchContext?: string; // Summary of DDG search results
}

export interface AskQuestionResult {
  id: string;
  questionType: AiQuestionType;
  question: string;
  answer: string;
  tokensUsed: number;
  durationMs: number;
  alreadyAnswered: boolean;
}

/**
 * Ask a single deep question
 * Returns existing answer if already answered for this job
 */
export async function askDeepQuestion(
  researchJobId: string,
  questionType: AiQuestionType,
  context: QuestionContext,
  customQuestion?: string
): Promise<AskQuestionResult> {
  // Check if already answered
  const existing = await prisma.aiQuestion.findUnique({
    where: {
      researchJobId_questionType: { researchJobId, questionType },
    },
  });
  
  if (existing?.isAnswered && existing.answer) {
    console.log(`[AIQuestions] Already answered: ${questionType}`);
    return {
      id: existing.id,
      questionType,
      question: existing.question,
      answer: existing.answer,
      tokensUsed: existing.tokensUsed || 0,
      durationMs: existing.durationMs || 0,
      alreadyAnswered: true,
    };
  }
  
  const promptConfig = QUESTION_PROMPTS[questionType];
  const question = questionType === 'CUSTOM' ? (customQuestion || '') : promptConfig.question;
  
  // Build context string
  const contextStr = `
Brand: ${context.brandName}
${context.handle ? `Handle: @${context.handle}` : ''}
${context.bio ? `Bio: ${context.bio}` : ''}
${context.niche ? `Niche: ${context.niche}` : ''}
${context.websiteUrl ? `Website: ${context.websiteUrl}` : ''}
${context.rawSearchContext ? `\nWeb Research:\n${context.rawSearchContext}` : ''}
`.trim();

  const fullPrompt = `${question}\n\nContext:\n${contextStr}`;
  
  console.log(`[AIQuestions] Asking: ${questionType}...`);
  const startTime = Date.now();
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: promptConfig.systemPrompt },
        { role: 'user', content: fullPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });
    
    const answer = response.choices[0]?.message?.content || '';
    const tokensUsed = response.usage?.total_tokens || 0;
    const durationMs = Date.now() - startTime;
    
    // Save to DB (upsert to handle race conditions)
    const saved = await prisma.aiQuestion.upsert({
      where: {
        researchJobId_questionType: { researchJobId, questionType },
      },
      update: {
        answer,
        tokensUsed,
        durationMs,
        isAnswered: true,
        answeredAt: new Date(),
      },
      create: {
        researchJobId,
        questionType,
        question,
        answer,
        contextUsed: contextStr.substring(0, 500),
        promptUsed: fullPrompt.substring(0, 1000),
        modelUsed: 'gpt-4o-mini',
        tokensUsed,
        durationMs,
        isAnswered: true,
        answeredAt: new Date(),
      },
    });
    
    console.log(`[AIQuestions] ${questionType}: ${tokensUsed} tokens, ${durationMs}ms`);
    
    return {
      id: saved.id,
      questionType,
      question,
      answer,
      tokensUsed,
      durationMs,
      alreadyAnswered: false,
    };
    
  } catch (error: any) {
    console.error(`[AIQuestions] Error for ${questionType}:`, error.message);
    throw error;
  }
}

/**
 * Ask all deep questions for a research job
 * Skips questions that are already answered
 */
export async function askAllDeepQuestions(
  researchJobId: string,
  context: QuestionContext
): Promise<AskQuestionResult[]> {
  const questionTypes: AiQuestionType[] = [
    'VALUE_PROPOSITION',
    'TARGET_AUDIENCE',
    'CONTENT_PILLARS',
    'BRAND_VOICE',
    'BRAND_PERSONALITY',
    'COMPETITOR_ANALYSIS',
    'NICHE_POSITION',
    'UNIQUE_STRENGTHS',
    'CONTENT_OPPORTUNITIES',
    'GROWTH_STRATEGY',
    'PAIN_POINTS',
    'KEY_DIFFERENTIATORS',
  ];
  
  console.log(`[AIQuestions] Starting ${questionTypes.length} deep questions for ${context.brandName}...`);
  
  const results: AskQuestionResult[] = [];
  
  for (const questionType of questionTypes) {
    try {
      const result = await askDeepQuestion(researchJobId, questionType, context);
      results.push(result);
    } catch (error: any) {
      console.error(`[AIQuestions] Failed: ${questionType} - ${error.message}`);
    }
  }
  
  const newAnswers = results.filter(r => !r.alreadyAnswered);
  const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  
  console.log(`[AIQuestions] Complete: ${newAnswers.length} new answers, ${totalTokens} total tokens`);
  
  return results;
}

/**
 * Get all answered questions for a research job
 */
export async function getAnsweredQuestions(researchJobId: string) {
  return prisma.aiQuestion.findMany({
    where: { researchJobId, isAnswered: true },
    orderBy: { createdAt: 'asc' },
  });
}
