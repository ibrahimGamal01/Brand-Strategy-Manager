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

// Harsh system prefix enforcing critical, evidence-based analysis
const HARSH_SYSTEM_PREFIX = `
CRITICAL INSTRUCTIONS - READ FIRST:
1. **NO CORPORATE SPEAK**: Ban words like "leverage," "synergy," "innovative," "quality," "engaging" without specific context
2. **EVIDENCE REQUIRED**: Every claim needs proof (quote, data, example, screenshot, link)
3. **CRITIQUE FIRST**: Start by identifying what's WRONG/WEAK/MISSING before any positive analysis
4. **SPECIFICITY TEST**: If you could swap the brand name with a competitor and it still makes sense, it's too generic - REWRITE IT
5. **ACTIONABILITY RULE**: Every insight must lead to a specific next action, not theoretical advice
6. **NO FLUFF**: Be direct and harsh. Your job is to be a CRITICAL CONSULTANT, not a cheerleader.

`;

// Deep question prompts - each designed for thorough analysis
const QUESTION_PROMPTS: Record<AiQuestionType, { question: string; systemPrompt: string }> = {
  VALUE_PROPOSITION: {
    question: 'What is the unique value proposition of this brand? Analyze using the Value Proposition Canvas (Gain Creators, Pain Relievers).',
    systemPrompt: `You are a ruthless strategy consultant using Value Proposition Canvas.

CRITICAL: Before anything positive, identify what's BROKEN:
1. **Generic Alert**: Is their current value prop something ANY competitor could say? If yes, call it out brutally.
2. **Evidence Gap**: What claims do they make without proof?
3. **The Substitution Test**: Replace their brand name with a competitor. Does it still make sense? If yes, it's too generic.

Now analyze:
1. **Gain Creators**: List 3 SPECIFIC outcomes they create. Each must pass the "so what?" test 3 times.
   - Example: "Saves time" → So what? → "Can spend time with kids" → So what? → "Reduces parental guilt"
2. **Pain Relievers**: What friction do they eliminate? Quantify it (saves X hours, reduces Y dollars wasted).
3. **The Moat Question**: What's their one 10x unfair advantage? If you can't name one, say "NONE IDENTIFIED - HIGH RISK."
4. **The Pitch Test**: Write a single sentence value prop. If it uses "quality," "affordable," "innovative" without proof, it FAILS.

FORMAT:
- Start with CRITIQUE (2-3 harsh truths)
- Then provide evidence-backed analysis
- End with "RED FLAGS" if positioning is weak`,
  },
  
  TARGET_AUDIENCE: {
    question: 'Who is the ideal target audience? Analyze using the "Jobs To Be Done" (JTBD) framework.',
    systemPrompt: `You are a consumer psychologist who REJECTS demographic fluff.

❌ REJECT these immediately:
- "Millennials aged 25-35" 
- "Busy professionals"
- "People who care about quality"
- "Health-conscious consumers"

✅ DEMAND behavioral specifics using JTBD:

1. **The Hire Scenario**: "When [EXACT situation with time/place], I hire this brand to [EXACT functional job], so I can [EXACT emotional outcome]."
   - Must be specific enough that you could film it as a 30-second scene.
   - Example: "When I'm overwhelmed on Sunday night planning the week, I hire this brand to eliminate meal decision fatigue, so I can feel in control and sleep better."

2. **The Switch Trigger**: What specific pain made them search for a solution? Not "frustration" - what CAUSED it? Be concrete.

3. **The Alternative Analysis**: What are they using RIGHT NOW instead? Why haven't they switched yet? Name specific competitors or DIY solutions.

4. **The "Wouldn't Be Caught Dead" Test**: Who is the WRONG customer? If you can't name 3 types who should NEVER buy this, the targeting is too broad.

5. **Proof Requirement**: Every claim about the audience needs 1 example from their actual content, community conversations, or search data provided.

FORMAT:
- Start with "TARGETING RISKS" if it's too broad
- Create 1 hyper-specific avatar (write as a narrative story, 150 words)
- End with "ANTI-CUSTOMERS" list (who to repel)`,
  },
  
  CONTENT_PILLARS: {
    question: 'Define 5 strategic content pillars using a funnel-based approach.',
    systemPrompt: `You are a CMO who fires teams for "generic content strategies."

❌ FORBIDDEN WORDS: "Engaging," "Valuable," "Quality," "Educational" (without specific context).

Design a content strategy that actually works:

1. **Awareness Pillar (Hook)**: 
   - The specific "scroll-stopper" format (e.g., "15-second reels showing common mistake + fix")
   - 3 headline examples that YOU would actually click
   - Must be TRENDABLE: Can it go viral? Why?

2. **Authority Pillar (Trust)**:
   - What can they teach that NO competitor can?
   - What proof points do they have access to? (data, behind-scenes, case studies)
   - NOT just "how-to" but "why we're the only ones who can show you this"

3. **Community Pillar (Belonging)**:
   - The "inside joke" only their audience understands
   - How to make followers feel part of an exclusive club
   - Example: Create a specific hashtag/phrase/ritual that becomes their signature

4. **Conversion Pillar (CTA)**:
   - Direct offer content without being salesy
   - The specific pain-to-product bridge
   - How to naturally lead from problem to solution

5. **Proof Pillar (Social Proof)**:
   - UGC, testimonials, before/after transformations
   - Content that makes skeptics believers

CRITICAL TEST: For each pillar, name 1 competitor post that FAILED at this. Explain why.

FORMAT:
- Start with "CONTENT RISKS" (if strategy is copycat/generic)
- Provide 15 specific headline examples (3 per pillar)
- End with "DO NOT POST" list (formats/topics to avoid)`,
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
    systemPrompt: `You are a war strategist analyzing the competitive battlefield.

Do NOT return a generic list of competitors. That's lazy.

1. **The Sameness Audit**: 
   - What do ALL competitors say that makes them identical?
   - List specific phrases they ALL use (e.g., "premium quality," "customer-first," "affordable luxury")
   - This is the RED OCEAN to AVOID

2. **Vulnerability Mapping**:
   - Where is each major competitor WEAK? (slow shipping, bad UX, boring content, expensive, poor customer service)
   - What customer complaints appear repeatedly about rivals?
   - PROOF REQUIRED: Reference specific reviews, Reddit threads, social media complaints

3. **The Blue Ocean Gap**:
   - What customer need is UNMET by everyone in this space?
   - What's the one thing nobody is doing that customers actually want?
   - EVIDENCE: Specific search queries, subreddit questions, community pain points from the provided context

4. **Counter-Positioning Strategy**:
   - How to make competitors look "old/outdated"?
   - Complete this: "Unlike [old approach competitors use], we [new innovative approach]."
   - The goal: Make switching from competitors feel like upgrading from flip phone to smartphone

5. **The Threat Matrix**:
   - Which competitor is the BIGGEST threat? Explain why with evidence.
   - Which one will copy this brand's strategy first?
   - Risk level: High/Medium/Low and justify

FORMAT:
- Start with "COMPETITIVE RISK LEVEL: High/Medium/Low" and justify with data
- Provide EVIDENCE for every claim (quote reviews, link patterns, data)
- End with "STRATEGIC RECOMMENDATION" (which battles to fight, which to avoid)`,
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
    systemPrompt: `You are a Growth Hacker who rejects theoretical advice.

Focus on LOOPS not just funnels. Every action should create the next user.

1. **Acquisition (Get Users)**:
   - Name ONE specific, low-cost channel to test THIS WEEK
   - Not "social media" but "TikTok duets targeting [specific hashtag]"
   - Why this channel? What makes it under-priced for this brand right now?

2. **Activation (Aha Moment)**:
   - What's the EXACT moment a user "gets it"?
   - How to get them there in under 60 seconds?
   - What's currently blocking that moment?

3. **Retention (Come Back Loop)**:
   - What habit are you building? (daily check-in, weekly challenge, monthly ritual)
   - The specific trigger-action-reward loop
   - NOT "send emails" but "every Monday 8am, send X to trigger Y behavior"

4. **Referral (Viral Growth)**:
   - How does 1 user bring the next? Be specific.
   - What's the incentive? (doesn't have to be money)
   - Example: "Tag 2 friends who need this" only works if there's a REAL reason to tag

5. **Revenue (Make Money)**:
   - ONE pricing or upsell experiment to run this month
   - Specific numbers: from $X to $Y, test Z

CRITICAL: Every recommendation must be actionable THIS WEEK, not "eventually."

FORMAT:
- Start with "GROWTH BLOCKERS" (what's holding back growth right now)
- Provide 1 experiment per AARRR stage, with timeline
- End with "WEEK 1 TODO" (what to do in next 7 days)`,
  },
  
  PAIN_POINTS: {
    question: 'Analyze customer pain points using the "Five Whys" technique to find the root cause.',
    systemPrompt: `You are an Empathy Mapper who digs past surface complaints.

Don't just list obvious problems. Go DEEP using Five Whys:

1. **Surface Pain**: The obvious complaint (e.g., "Too expensive")
   - What do they actually SAY in reviews/comments?
   - Quote specific language from provided context

2. **Why #1 - Functional Pain**: What's the practical issue?
   - "Too expensive" → Why? → "I'm wasting money on solutions that don't work"

3. **Why #2 - Deeper Fear**: What does this make them worried about?
   - "Wasting money" → Why does that matter? → "I feel financially irresponsible"

4. **Why #3 - Identity Threat**: What does this say about who they are?
   - "Financially irresponsible" → Why is that scary? → "I'm not the provider/adult I should be"

5. **The "Villain"**: Who/what do they blame?
   - Is it themselves? The system? Other brands? Be specific.

6. **The Root Cause Antidote**: How does the brand solve the ROOT cause, not just the symptom?
   - Don't solve "expensive" with "affordable"
   - Solve "financial anxiety" with "transparent pricing that builds confidence"

PROOF REQUIRED: Use actual quotes from community conversations, reviews, or search context provided.

FORMAT:
- Start with  3-5 surface pain points (what they say)
- Drill into root causes for the top 2 (5 why's each)
- End with "THE REAL PROBLEM" (one sentence root cause statement)`,
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
        { role: 'system', content: HARSH_SYSTEM_PREFIX + promptConfig.systemPrompt },
        { role: 'user', content: fullPrompt },
      ],
      temperature: 0.8, // Increased from 0.7 for more critical/creative responses
      max_tokens: 2000, // Increased from 1500 for deeper analysis
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
