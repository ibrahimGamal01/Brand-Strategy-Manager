/**
 * Business Understanding Generator
 * 
 * Generates the "Part 1: Understanding the Business" section
 * using RAG context and system prompts.
 */

import OpenAI from 'openai';
import { getFullResearchContext, formatContextForLLM } from '../rag';
import { SYSTEM_PROMPTS } from '../prompts/system-prompts';
import { validateContent } from '../validation';
import { COST_PROTECTION, costTracker, checkCostLimit } from '../validation/cost-protection';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GenerationResult {
  markdown: string;
  validationScore: number;
  passed: boolean;
  attempts: number;
  warnings: string[];
  costUSD: number;
}

interface GenerationAttempt {
  attemptNumber: number;
  markdown: string;
  validationScore: number;
  feedback: string[];
}

const MAX_ATTEMPTS = 3;

/**
 * Generate Business Understanding section with validation loop
 */
export async function generateBusinessUnderstanding(
  researchJobId: string
): Promise<GenerationResult> {
  
  console.log(`[Generator] Starting Business Understanding for job: ${researchJobId}`);

  // Check cost limits
  const costCheck = checkCostLimit();
  if (!costCheck.allowed) {
    throw new Error(`Cost limit reached: ${costCheck.reason}`);
  }

  // Get research context
  console.log('[Generator] Retrieving research context...');
  const context = await getFullResearchContext(researchJobId);
  const initialCost = costTracker.getStats().estimatedCostUSD;

  if (!context.overallQuality.isReliable) {
    console.warn(`[Generator] Data quality below threshold: ${context.overallQuality.score}/100`);
  }

  // Format for LLM
  const contextString = formatContextForLLM(context);

  const attempts: GenerationAttempt[] = [];
  let finalResult: GenerationResult | null = null;

  // Generation loop with validation
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[Generator] Attempt ${attempt}/${MAX_ATTEMPTS}`);

    try {
      // Generate content
      const markdown = await callOpenAI(
        contextString,
        attempt > 1 ? attempts[attempt - 2] : undefined
      );

      // Validate
      const validation = await validateContent(
        markdown,
        'business_understanding',
        [
          'specific_products_services',
          'customer_segments_with_examples',
          'business_model',
          'market_position',
          'value_proposition',
          'brand_voice'
        ],
        { min: 2000, max: 3000 },
        context
      );

      attempts.push({
        attemptNumber: attempt,
        markdown,
        validationScore: validation.score,
        feedback: validation.feedback.improvements.map(i => i.issue)
      });

      console.log(`[Generator] Validation score: ${validation.score}/100`);

      if (validation.passed) {
        console.log('[Generator] ✓ Content passed validation');
        const currentCost = costTracker.getStats().estimatedCostUSD;
        finalResult = {
          markdown,
          validationScore: validation.score,
          passed: true,
          attempts: attempt,
          warnings: context.warnings,
          costUSD: currentCost - initialCost
        };
        break;
      } else {
        console.log(`[Generator] Content needs improvement (${validation.feedback.improvements.length} issues)`);
        
        if (attempt === MAX_ATTEMPTS) {
          console.warn('[Generator] Max attempts reached, using best attempt');
          
          // Use best attempt
          const bestAttempt = attempts.reduce((best, current) => 
            current.validationScore > best.validationScore ? current : best
          );
          
          const currentCost = costTracker.getStats().estimatedCostUSD;

          finalResult = {
            markdown: bestAttempt.markdown,
            validationScore: bestAttempt.validationScore,
            passed: false,
            attempts: MAX_ATTEMPTS,
            warnings: [
              ...context.warnings,
              `Content did not pass validation after ${MAX_ATTEMPTS} attempts (score: ${bestAttempt.validationScore}/100)`
            ],
            costUSD: currentCost - initialCost
          };
        }
      }

    } catch (error) {
      console.error(`[Generator] Error on attempt ${attempt}:`, error);
      
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Failed to generate content after ${MAX_ATTEMPTS} attempts: ${error}`);
      }
    }
  }

  if (!finalResult) {
    throw new Error('Generation failed - no result produced');
  }

  // Log cost summary
  const costStats = costTracker.getStats();
  console.log(`[Generator] Total cost: $${costStats.estimatedCostUSD.toFixed(4)}`);

  return finalResult;
}

/**
 * Call OpenAI API to generate content
 */
async function callOpenAI(
  contextString: string,
  previousAttempt?: GenerationAttempt
): Promise<string> {
  
  // Use mock in development
  if (COST_PROTECTION.mockMode) {
    console.log('[Generator] Using MOCK mode (cost: $0)');
    return generateMockBusinessUnderstanding();
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: SYSTEM_PROMPTS.BUSINESS_UNDERSTANDING
    }
  ];

  // First attempt
  if (!previousAttempt) {
    messages.push({
      role: 'user',
      content: `Generate the Business Understanding section using this research data:\n\n${contextString}`
    });
  } 
  // Retry with feedback
  else {
    messages.push({
      role: 'user',
      content: `Generate the Business Understanding section using this research data:\n\n${contextString}`
    });
    messages.push({
      role: 'assistant',
      content: previousAttempt.markdown
    });
    messages.push({
      role: 'user',
      content: `The previous attempt scored ${previousAttempt.validationScore}/100. Issues found:\n${previousAttempt.feedback.join('\n')}\n\nPlease regenerate with improvements addressing these issues.`
    });
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.7,
    max_tokens: Math.min(4000, COST_PROTECTION.maxTokensPerCall)
  });

  // Track costs
  if (response.usage) {
    costTracker.addUsage(
      'gpt-4o',
      response.usage.prompt_tokens,
      response.usage.completion_tokens
    );
  }

  return response.choices[0].message.content || '';
}

/**
 * Generate mock content for testing (zero cost)
 */
function generateMockBusinessUnderstanding(): string {
  return `# Part 1: Understanding the Business

## Business Overview

**Ghowiba** is a premium design-build firm based in Cairo, Egypt, specializing in residential and commercial interior design with integrated construction management. Founded in 2018, they serve high-net-worth individuals and property developers in New Cairo and Sheikh Zayed seeking turnkey interior solutions.

### Key Products & Services
- **3D Rendering & Visualization**: Photorealistic renders that guarantee 95% accuracy to final delivery
- **MEP Coordination**: Full mechanical, electrical, and plumbing integration
- **Custom Furniture Manufacturing**: In-house production of bespoke furniture pieces
- **Project Management**: End-to-end oversight from concept to handover

### Customer Segments
The business primarily serves three distinct segments:
1. **Villa owners in New Cairo** (40% of revenue) - Families with 400-600 sqm properties seeking complete interior solutions
2. **Commercial developers** (35% of revenue) - Restaurant and retail space developers requiring design-build services
3. **Residential compound developers** (25% of revenue) - Large-scale residential projects requiring model unit design

### Business Model
Ghowiba operates on a design-build model with revenue streams from:
- Design fees (20-25% of project value)
- Construction and fit-out (60-65%)
- Custom furniture manufacturing (10-15%)

Average project value: 850,000 EGP
Projects completed in 2023: 47

### Market Position
Positioned in the premium segment competing against 4-5 boutique firms including @designstudiocairo (12.8K followers) and @modernegypt (45.2K followers). Differentiated by integrated manufacturing capacity and accuracy guarantee.

## Unique Value Proposition

### Gain Creators

**1. Render-to-Reality Accuracy Guarantee (95%)**
Unlike competitors who treat renders as "inspiration," Ghowiba guarantees 95% accuracy between visualization and delivered space. Based on 2023 data: only 2 material substitutions across 47 projects versus industry average of 12-15 per project.

**2. Single-Point Accountability**
Clients work with one team from design through handover, eliminating coordination overhead. Customer testimonials (from 127 Google reviews) mention "seamless coordination" in 78% of positive reviews.

**3. In-House Manufacturing Speed**
Custom furniture production in 3-4 weeks versus 8-12 weeks for competitors who outsource. This reduces overall project timeline by approximately 6 weeks.

### Pain Relievers

**1. Eliminates the "Expectation vs Reality" Gap**
Based on community insights from design forums, homeowners' #1 frustration is "it doesn't look like the pictures." Ghowiba's accuracy guarantee directly addresses this with contractual commitment and material samples matched to renders.

**2. Removes Contractor Coordination Stress**
Analysis of 89 Reddit discussions in r/CairoLiving reveals that managing multiple contractors is the top pain point. Integrated design-build model means one contract, one timeline, one point of contact.

**3. Solves the Premium Trim Problem**
Market research shows Egyptian suppliers often substitute imported finishes. In-house procurement and manufacturing eliminates this issue with direct sourcing relationships.

### The "Unfair Advantage"

**Integrated Manufacturing Facility (10x harder to copy)**

The 2,400 sqm manufacturing facility in 10th of Ramadan represents 4.2M EGP capital investment. This creates defensibility through:
- Proprietary CNC programs for custom joinery
- Established relationships with Italian veneer suppliers (3-year contracts)
- Skilled craftsman team (15 employees, avg 8 years experience)
- Quality control integration with design team

Competitors would need similar capital outlay plus 18-24 months to establish supplier relationships and build team expertise.

### Positioning Critique

**Current Positioning**: "Premium design-build firm"
**Critique**: Too broad, doesn't communicate the key differentiator
**Sharper Positioning**: "The only design-build firm in Cairo that guarantees your space will look exactly like the render - or we remake it"

This positions against the industry's core pain point and makes a bold, verifiable claim that competitors can't easily match.

## Brand Voice & Personality

### Tone Dimensions

**Funny ←→ Serious: 7/10 (Serious)**
Content analysis of 145 Instagram captions shows professional, authoritative tone. Only 3 posts used humor. Focus on expertise and craftsmanship aligns with premium positioning.

**Formal ←→ Casual: 6/10 (Leaning Formal)**  
Language uses industry terminology ("MEP integration," "material specifications") but avoids stuffiness. Second-person "you" used in 67% of posts creates approachability within professional frame.

**Respectful ←→ Irreverent: 8/10 (Respectful)**
Never challenges industry norms or pokes fun at competitors. Maintains respectful, collaborative tone even when discussing pain points.

**Enthusiastic ←→ Matter-of-fact: 5/10 (Balanced)**
Celebrates project completions with excitement but presents process information matter-of-factly. Example: "We're thrilled to reveal..." followed by technical breakdown.

### Jungian Archetypes

**Primary: The Creator (65%)** - Focus on craftsmanship, attention to detail, bringing visions to life. 89 of 145 posts showcase process, materials, or craftsmanship.

**Secondary: The Ruler (35%)** - Emphasis on control, precision, guarantees. Language around "mastery of space," "controlled outcomes," "precision execution."

### The "Enemy"

What Ghowiba stands against (evidenced in content and positioning):

1. **The "Good Enough" Mentality** - Explicitly positions against contractors who accept 80% match to renders
2. **Fragmented Execution** - Multiple posts criticize coordination issues from working with separate designers and contractors
3. **Material Substitution** - Strong stance against "similar alternative" culture in Egyptian construction
4. **Opacity in Pricing** - Transparent pricing mentioned in 68% of testimonials

### Do's and Don'ts

**Say This**:
- ✅ "95% accuracy guarantee between render and reality"
- ✅ "In-house manufacturing ensures timeline control"
- ✅ "Single team, single accountability"
- ✅ "Material specifications, not approximations"

**Never Say This**:
- ❌ "Luxury" or "high-end" (overused by competitors)
- ❌ "Similar material available locally" (exact opposite of positioning)
- ❌ "Approximate timeline" (precision is key differentiator)
- ❌ Generic phrases like "innovative solutions" or "customer-centric" (meaningless)

## Current Social Presence

### Platforms & Metrics

**Instagram** (@ghowiba.design)
- Followers: 8,342
- Posting Frequency: 4-5 posts/week
- Primary Formats: Carousel posts (45%), Single images (35%), Reels (20%)
- Engagement Rate: 2.8% (below industry average of 3.5-4%)

**Facebook** 
- Followers: 12,100
- Posting Frequency: 3 posts/week
- Primarily project showcases and client testimonials

### Content Formats

1. **Before/After Transformations** (30% of content) - Best performing format, avg 4.2% engagement
2. **Process Documentation** (25%) - Behind-the-scenes of manufacturing and installation
3. **Material Close-ups** (20%) - Detailed shots of finishes and craftsmanship
4. **Client Testimonials** (15%) - Video and text testimonials
5. **Design Tips** (10%) - Educational content about interior design

### Strengths

1. **Visual Quality**: Professional photography with consistent style and lighting (all posts professionally shot)
2. **Process Transparency**: Detailed documentation of manufacturing and installation builds trust
3. **Testimonial Integration**: 47 video testimonials across platforms provide strong social proof
4. **Niche Authority**: Recognized expertise in villa design evident from engaged follower base

### Weaknesses

1. **Posting Frequency Paradox**: Posts more frequently than competitors (@designstudiocairo posts 3x/week) but achieves 40% lower engagement, suggesting volume isn't the issue
2. **Hook Weakness**: Only 12% of captions use compelling hooks; most start with project descriptions
3. **Limited Video**: Reels represent only 20% of content despite being highest-performing format (5.1% engagement vs 2.3% for images)
4. **Engagement Gap**: Despite quality content, engagement rate of 2.8% trails competitors (average 3.5-4.2%)

---

**Data Quality Note**: This analysis is based on comprehensive research including 127 Google reviews, 145 Instagram posts, 89 Reddit discussions, and 47 completed project records from 2023.`;
}
