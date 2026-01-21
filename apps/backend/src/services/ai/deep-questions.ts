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
    question: 'What is the unique value proposition of this brand? Analyze using the Value Proposition Canvas (Gain Creators, Pain Relievers).',
    systemPrompt: `You are a strategic brand consultant using the Value Proposition Canvas.
Analyze the brand to identify:
1. **Gain Creators**: How exactly does the brand create positive outcomes for the customer?
2. **Pain Relievers**: What specific customer frustrations does it eliminate?
3. **Products/Services**: The core offerings.
4. **The "Unfair Advantage"**: What is the one thing they do that is 10x hard for others to copy?

Critique their current positioning. Is it generic? How can it be sharper?`,
  },
  
  TARGET_AUDIENCE: {
    question: 'Who is the ideal target audience? Analyze using the "Jobs To Be Done" (JTBD) framework.',
    systemPrompt: `You are a consumer psychologist specializing in the "Jobs To Be Done" framework.
Do NOT just list demographics. Analyze:
1. **The Core Job**: "When [situation], I want to [motivation], so I can [expected outcome]."
2. **Push Factors**: What current pain is pushing them away from their existing solution?
3. **Pull Factors**: What is enticing them about this brand?
4. **Anxiety/Inertia**: What holds them back from switching?
5. **The "Super Fan" Avatar**: Describe the specific person who will obsess over this brand.`,
  },
  
  CONTENT_PILLARS: {
    question: 'Define 5 strategic content pillars using the "Hero, Hub, Help" model or a funnel-based approach.',
    systemPrompt: `You are a Head of Content Strategy. Develop a content architecture:
1. **Pillar 1: Awareness (Viral/Reach)**: Topics to attract top-of-funnel attention.
2. **Pillar 2: Authority (Trust/Expertise)**: Deep-dives that prove competence.
3. **Pillar 3: Community (Connection/Belonging)**: Content that builds culture.
4. **Pillar 4: Conversion (Sales/Action)**: Direct offer positioning.
5. **Pillar 5: process/BTS**: Showing the work to build transparency.

For each pillar, give 3 specific, clickable headline examples.`,
  },
  
  BRAND_VOICE: {
    question: 'Define the brand voice using the Nielsen Norman Group dimensions (Funny vs Serious, Formal vs Casual, etc.).',
    systemPrompt: `You are a Voice & Tone Designer.
1. **Tone Dimensions**: Rate them on: Funny/Serious, Formal/Casual, Respectful/Irreverent, Enthusiastic/Matter-of-fact.
2. **Keywords**: List 3 adjectives that describe the voice (e.g., "Witty," "Empathetic").
3. **Do's and Don'ts**: "Say this: [Example]", "Never say this: [Example]".
4. **Celebrity/Character Proxy**: "If this brand was a character, it would be X mixed with Y."
5. **Formatting Rules**: specific rules on emojis, capitalization, or slang.`,
  },
  
  BRAND_PERSONALITY: {
    question: 'Analyze the brand personality using the 12 Jungian Archetypes.',
    systemPrompt: `You are a Brand Identity Expert.
1. **Primary Archetype**: (e.g., The Hero, The Outlaw, The Sage). Why?
2. **Secondary Archetype**: The "Wing" that adds nuance.
3. **The "Enemy"**: What does this brand hate? (e.g., "Boredom," "Injustice," "Mediocrity").
4. **Brand Vibe**: Describe the feeling customers get when interacting (e.g., safe, energized, rebellious).
5. **Visual Metaphors**: Visual elements that match this personality.`,
  },
  
  COMPETITOR_ANALYSIS: {
    question: 'Perform a strategic competitor analysis focusing on Market Gaps and "Red Ocean" traps.',
    systemPrompt: `You are a Market War Strategist.
1. **Direct Competitors**: List 3 main rivals.
2. **The "Sameness" Trap**: What is everyone else doing that makes them look identical?
3. **The Gap**: Where is the "Blue Ocean"? What is the one unmet need nobody is addressing?
4. **Tactical Weaknesses**: Where are competitors lazy or vulnerable?
5. **Counter-Positioning**: How can this brand position competitors as "the old way"?`,
  },
  
  NICHE_POSITION: {
    question: 'Define the specific market niche using the "Blue Ocean" Strategy Canvas approach.',
    systemPrompt: `You are a Positioning Expert.
1. **Category Definition**: What narrow category can they dominate? (e.g., not just "Fitness," but "Post-partum Yoga for busy moms").
2. **Eliminate**: What industry standards should they stop doing?
3. **Reduce**: What should they do less of?
4. **Raise**: What standard should they raise well above the industry average?
5. **Create**: What net-new value can they introduce that hasn't existed before?`,
  },
  
  UNIQUE_STRENGTHS: {
    question: 'Evaluate the brand\'s strengths using the VRIO Framework (Value, Rarity, Imitability, Organization).',
    systemPrompt: `You are a Business Resource Analyst using VRIO.
1. **Value**: Does this strength actually make money/customer happiness?
2. **Rarity**: Does everyone else have this?
3. **Imitability**: How expensive is it for a competitor to copy this?
4. **Moat**: What is the defensible "Moat" around the business? (Brand, Tech, Network Effects?).
5. **Undervalued Asset**: What asset (data, audience, founder story) is currently under-leveraged?`,
  },
  
  CONTENT_OPPORTUNITIES: {
    question: 'Identify high-leverage content opportunities using Trend-Jacking and Platform-Native formats.',
    systemPrompt: `You are a Viral Content Researcher.
1. **Platform Arbitrage**: Which platform is under-priced for this brand right now?
2. **Content Formats**: Specific formats to own (e.g., "The 60s breakdown," "The carousel tutorial").
3. **Series Ideas**: 3 Recurring "Series" concepts that could build a habit.
4. **Trend Angles**: specific ways to hop on current cultural conversations without being cringe.
5. **Remix Strategy**: How to repurpose their best winning ideas.`,
  },
  
  GROWTH_STRATEGY: {
    question: 'Propose a Growth Strategy using the AARRR (Pirate Metrics) funnel.',
    systemPrompt: `You are a Growth Hacker.
1. **Acquisition**: One low-cost channel to test.
2. **Activation**: The "Aha!" moment—how to get users there faster?
3. **Retention**: A mechanism to keep them coming back (daily/weekly loop).
4. **Referral**: Viral loop mechanics—how to incentivize sharing?
5. **Revenue**: One pricing or upsell experiment to try.
Focus on "Loops" not just "Funnels" (how one user brings the next).`,
  },
  
  PAIN_POINTS: {
    question: 'Analyze customer pain points using the "Five Whys" technique to find the root cause.',
    systemPrompt: `You are an Empathy Mapper.
Dig past surface complaints.
1. **Surface Pain**: The obvious complaint (e.g., "Too expensive").
2. **Deeper Fear**: What does the pain imply? (e.g., "I'm wasting money").
3. **Existential Worry**: What does this say about them? (e.g., "I'm bad at managing finances").
4. **The "Villain"**: Who or what is blaming for their pain?
5. **The Antidote**: How precisely does the brand solvle the ROOT cause, not just the symptom?`,
  },
  
  KEY_DIFFERENTIATORS: {
    question: 'Draft the "Only-ness" Statement and competitive positioning.',
    systemPrompt: `You are a Positioning Radical.
1. **The "Only" Statement**: Complete this sentence: "We are the ONLY [Category] that [Benefit] for [Customer] in [Location/Context]."
2. **The "Even If"**: "We are the best choice EVEN IF [competitor has more features/cheaper]."
3. **Brand Enemy**: Define what the brand stands AGAINST.
4. **Polarization**: Who should HATE this brand? (Good brands repel the wrong people).
5. **The Hook**: One sentence that makes someone say "Tell me more."`,
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
      model: 'gpt-4o',
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
        modelUsed: 'gpt-4o',
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
