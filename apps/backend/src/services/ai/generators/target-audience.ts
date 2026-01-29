/**
 * Target Audience Generator (Personas)
 * 
 * Generates 2-4 detailed personas using JTBD framework
 */

import { BaseGenerator, GenerationResult } from './base-generator';
import { SYSTEM_PROMPTS } from '../prompts/system-prompts';
import { ResearchContext } from '../rag';

/**
 * Generate Target Audience section with personas
 */
export async function generateTargetAudience(
  researchJobId: string
): Promise<GenerationResult> {
  
  console.log(`[Target Audience] Starting generation for job: ${researchJobId}`);

  const generator = new TargetAudienceGenerator();
  return generator.generate(researchJobId);
}

/**
 * Target Audience Generator Class
 */
class TargetAudienceGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'target_audience',
      systemPrompt: SYSTEM_PROMPTS.TARGET_AUDIENCE,
      requiredElements: [
        'personas',
        'demographics',
        'jtbd_framework',
        'pain_points',
        'goals',
        'fears',
        'motivators',
        'blockers',
        'content_preferences'
      ],
      wordCount: { min: 1500, max: 2500 },
      model: 'gpt-4o',
      temperature: 0.7
    });
  }

  /**
   * Generate mock personas for testing
   */
  protected generateMockContent(context: ResearchContext): string {
    return `# Part 2: Target Audience Analysis

## Persona 1: Ahmed, the Ambitious Villa Owner

### Demographics
- **Role**: Senior Executive at a multinational corporation
- **Age Range**: 38-45
- **Lifestyle**: Married with 2 children, recently purchased a 450 sqm villa in New Cairo's Fifth Settlement. Spends weekdays working 10-12 hour days, weekends with family. Values quality and efficiency above cost savings. Limited time for project oversight.
- **Online Presence**: Active on LinkedIn (professional), Instagram (personal/lifestyle), uses WhatsApp for business communication. Follows premium lifestyle and design accounts. Engages with content during commute (7-9 AM, 6-8 PM).

### Jobs-to-be-Done Framework
**Situation**: When I've invested 8-12 million EGP in a villa shell...
**Motivation**: I want to transform it into a magazine-worthy home that reflects my success...
**Outcome**: So I can impress guests, provide the best for my family, and feel proud of my investment without the stress of managing contractors.

### Pain Points

#### Pain Point 1: The Coordination Nightmare

**Surface Level**
"I don't have time to manage five different contractors and chase everyone for updates."

**Deeper Level**
The real frustration is the loss of control and unpredictability. Every contractor blames the other for delays. The interior designer's vision requires materials that the contractor says aren't available. The furniture maker's timeline conflicts with the fit-out schedule.

**Existential Level**
This reveals a core need for authority and competence. As a senior executive, Ahmed is used to systems that work. The chaos of multiple contractors threatens his identity as someone who "makes things happen" and controls outcomes.

#### Pain Point 2: The Expectation-Reality Gap

**Surface Level**
"The 3D renders looked amazing, but what we're getting doesn't match at all."

**Deeper Level**
Material substitutions are presented as "equivalent" but visibly cheaper. The lighting doesn't create the mood shown in renders. Cabinet proportions are slightly off, making spaces feel different.

**Existential Level**
This cuts at Ahmed's fear of being taken advantage of or looking foolish. He's spent millions and doesn't want friends or family to think he was duped or didn't know what he was doing.

#### Pain Point 3: Timeline Uncertainty

**Surface Level**
"I've been told 'two more weeks' for the past three months."

**Deeper Level**
The villa was supposed to be ready for his daughter's graduation party. Now he's making excuses to extended family. His wife is frustrated. The temporary housing cost is adding up.

**Existential Level**
This attacks his role as family provider and planner. His reputation as someone reliable and in control is at stake with both family and social circle.

### Goals
1. **Complete villa interior within 6 months** - Has specific deadline (daughter's engagement party)
2. **Achieve "wow factor"** - Wants guests to be genuinely impressed, not politely complimentary
3. **Zero compromise on vision** - Willing to pay premium to get exactly what was promised
4. **Single point of accountability** - One team, one timeline, one contract
5. **Future-proof investment** - Design should stay relevant for 10+ years

### Fears
1. **Being taken advantage of** - Stories of contractors who cut corners or substitute materials
2. **Endless delays** - Project dragging on for 12-18 months like friends' experiences
3. **Poor resale value** - Making design choices that will date badly or deter future buyers
4. **Family disappointment** - Not delivering on promises made to wife and children

### Motivators

**Push Factors** (away from current state):
- Exhaustion from managing multiple contractors
- Anxiety about timeline slippage
- Frustration with material substitutions
- Fear of ending up with generic result

**Pull Factors** (toward this brand):
- Guarantee of render accuracy
- Single-team accountability
- Premium quality reputation
- Timeline certainty with consequences

### Blockers
1. **Trust barrier** - "How do I know you're different from other firms promising the same?"
2. **Control concern** - "Will I have input throughout or see it only when done?"
3. **Price justification** - "Your quote is 15-20% higher than competitors"
4. **Reference anxiety** - "Can I see completed projects and talk to past clients?"

### Content Preferences

**Formats They Engage With**:
- Before/After transformations - Validates the investment worth
- Client testimonials - Especially from similar demographic
- Time-lapse of process - Shows professionalism and progress
- Material comparisons - Educates on quality differences

**Topics That Resonate**:
- "How to avoid the top 5 contractor mistakes"
- "What 95% accuracy guarantee really means"
- "Timeline breakdowns for villa projects"
- "Material specifications that matter"

**Tone They Prefer**:
Professional but approachable. Data-driven with emotion. Respect for their intelligence (no talking down) but acknowledge their lack of domain expertise.

### Quote
> "I've seen friends go through hell with their villa projects. Everyone promises their renders will match reality, but it never does. The stress isn't worth saving 100,000 EGP if I end up with something that looks cheap or takes forever."
> — From New Cairo homeowners forum discussion

---

## Persona 2: Fatma, the Detail-Oriented Restaurant Owner

### Demographics
- **Role**: Restaurant/Cafe owner, first-time restaurateur
- **Age Range**: 28-35
- **Lifestyle**: Entrepreneurial, invested family savings plus bank loan to open premium cafe in New Cairo. Working 14-hour days during buildout phase. Highly engaged in every detail. Researches extensively before decisions.
- **Online Presence**: Very active on Instagram (follows 150+ design and hospitality accounts), Pinterest for mood boards, TikTok for trending cafe designs. Engages heavily with comments and DMs. Creates detailed saved collections.

### Jobs-to-be-Done Framework
**Situation**: When I'm building out my first cafe location...
**Motivation**: I want a space that photographs beautifully and reflects my specific brand vision...
**Outcome**: So I can attract my target demographic (25-40 urban professionals), generate social media buzz, and establish a strong brand presence from day one.

### Pain Points

#### Pain Point 1: Instagram vs. Reality

**Surface Level**
"Every cafe design I see online looks amazing, but local contractors can't seem to execute that aesthetic."

**Deeper Level**
There's a gap between international design she sees on Instagram and what Egyptian contractors deliver. The finishes look cheaper, proportions are off, lighting is wrong. She has saved 300+ reference images but can't communicate her vision effectively.

**Existential Level**
This is about her identity as a tastemaker and curator. The cafe is an extension of her personal brand. A generic space means she's generic - just another cafe owner, not the visionary she sees herself as.

#### Pain Point 2: Budget Stretched Thin

**Surface Level**
"I have 800,000 EGP for fit-out but every 'small addition' chips away at it."

**Deeper Level**
The architect's fee was one thing, then the designer, then MEP engineering, then contractor, then project manager, then custom furniture, then lighting design. Each specialist adds cost. Hidden fees for revisions. The budget is blown before anything is built.

**Existential Level**
Financial anxiety threatens her confidence. This is family money plus debt. Every expense feels like potential failure. She needs to prove this was worth the risk.

#### Pain Point 3: Timeline Pressure

**Surface Level**
"My lease starts in 90 days whether I'm ready or not. Rent is 30,000 EGP/month."

**Deeper Level**
Every delay means paying rent with no revenue. Launch was planned for peak season. Missing it means struggling through slow months first. Investors (family) are watching. Pre-launch buzz needs to be timed right.

**Existential Level**
This is about proving herself capable and professional. Hitting deadlines shows she can run a business. Missing them feeds her imposter syndrome and family doubts.

### Goals
1. **Instagram-worthy space** - Every corner should be photogenic (80%+ of marketing will be organic social)
2. **Within 800K budget** - Already stretched thin, cannot exceed this
3. **90-day completion** - Hard deadline due to lease commitment
4. **Unique brand expression** - Needs to stand out from 50+ cafes in area
5. **Flexible for future** - May expand to 2-3 locations if successful

### Fears
1. **Looking cheap** - Space photographs poorly, doesn't attract target market
2. **Budget overrun** - Running out of money mid-project
3. **Design dated quickly** - Trend-chasing that looks outdated in 18 months
4. **Family disappointment** - Proving doubters right if business fails

### Motivators

**Push Factors**:
- Frustration with fragmented contractor relationships
- Anxiety about budget uncertainty
- Fear space won't match vision
- Pressure to launch on time

**Pull Factors**:
- Integrated pricing (know total cost upfront)
- Portfolio of hospitality projects
- In-house manufacturing (custom solutions)
- Speed of execution

### Blockers
1. **Price sensitivity** - "Can I get 80% of quality for 60% of cost?"
2. **Design control** - "Will you listen to my vision or impose yours?"
3. **Payment terms** - "I can't pay 50% upfront while also paying lease"
4. **Revision limits** - "What if I need to change things midway?"

### Content Preferences

**Formats They Engage With**:
- Design process videos (time-lapse, behind-the-scenes)
- Cost breakdowns and budget tips
- Before/after cafe transformations
- Material samples and mood boards

**Topics That Resonate**:
- "Creating Instagram-worthy spaces on a budget"
- "Common cafe design mistakes to avoid"
- "How to maximize small spaces"
- "Timeline breakdown: cafe fit-out"

**Tone They Prefer**:
Collaborative, educational, inspiring. Less corporate, more creative partner. Respects her vision while offering expertise.

### Quote
> "I've been to 20 cafes in New Cairo taking notes. Half look like generic Starbucks copies. The ones that stand out all have custom elements - but when I ask contractors about custom work, they either can't do it or quote insane prices."
> — From food & beverage entrepreneurs Facebook group

---

## Persona 3: Khaled, the Time-Constrained Property Developer

### Demographics
- **Role**: Real estate developer managing 3-5 residential projects simultaneously
- **Age Range**: 42-50  
- **Lifestyle**: Extremely busy, juggles multiple developments, investors, contractors. Values systems and proven processes over creativity. Makes decisions quickly based on ROI. Delegates extensively but needs reliable partners.
- **Online Presence**: LinkedIn for networking, WhatsApp for all business communication, rarely on consumer social media. Follows industry news and property trends.

### Jobs-to-be-Done Framework
**Situation**: When I need to complete model units for a new residential compound...
**Motivation**: I want to deliver impressive show units that drive pre-sales...
**Outcome**: So I can secure financing from buyers, impress investors, and maintain reputation for quality developments.

### Pain Points

#### Pain Point 1: Coordination Overhead

**Surface Level**
"I'm managing 5 buildings across 3 compounds. I can't be the interior designer's babysitter."

**Deeper Level**
Interior designers want endless meetings and approvals. Contractors need constant supervision. The disconnect between design and execution means he's mediating conflicts instead of focusing on sales and financing.

**Existential Level**
His competitive advantage is scale and efficiency. Every hour spent coordinating interiors is losing money. Delegation only works with competent partners.

#### Pain Point 2: Model Unit Quality

**Surface Level**
"Model units need to sell the dream, but execution is inconsistent."

**Deeper Level**
One compound's models look premium, another looks acceptable but not impressive. Inconsistency means different sales conversion rates. Can't scale his business without systemized quality.

**Existential Level**
His brand is "premium but accessible" residential. Inconsistent model units threaten brand positioning and credibility with investors.

#### Pain Point 3: Timeline Risk

**Surface Level**
"If model units aren't ready before we launch sales, we lose 3-4 months of revenue."

**Deeper Level**
Sales teams can't close without show units. Delays cascade - miss the buying season, investor confidence drops, bank financing gets nervous, competitor compound launches first.

**Existential Level**
His reputation with investors and banks depends on hitting milestones. Professional credibility is on the line with every delay.

### Goals
1. **Systematic quality** - Same premium result across all projects
2. **Hands-off execution** - Monitor, don't manage
3. **Predictable timelines** - 90-day model unit delivery
4. **Competitive pricing** - Need margin for profitability
5. **Replicable process** - Scale to 10+ compounds/year

### Fears
1. **Reputation damage** - Subpar model unit hurting sales and brand
2. **Timeline slippage** - Missing sales launch windows
3. **Cost overruns** - Budget unpredictability across multiple projects
4. **Dependency risk** - Single supplier holding him hostage

### Motivators

**Push Factors**:
- Frustration with hands-on project management
- Inconsistent quality across projects
- Timeline unpredictability
- Scaling challenges

**Pull Factors**:
- Proven systems and processes
- Portfolio of developer projects
- Single-point accountability
- Volume pricing potential

### Blockers
1. **Scale question** - "Can you handle 3-4 model units simultaneously?"
2. **Payment structure** - "Project-by-project payment or bulk discount?"
3. **Design flexibility** - "Can you work with our brand guidelines?"
4. **Geographic coverage** - "Can you service projects in 10th of Ramadan? 6th October?"

### Content Preferences

**Formats They Engage With**:
- Case studies with ROI data
- Developer testimonials
- Portfolio of model units
- Process documentation

**Topics That Resonate**:
- "How model unit quality affects pre-sales conversion"
- "Systemizing interior delivery at scale"
- "Developer partnership programs"
- "Timeline guarantees and penalties"

**Tone They Prefer**:
Business-focused, ROI-driven, process-oriented. Efficiency over creativity. Partnership over service provider.

### Quote
> "I've worked with 7 different interior firms. Only 2 delivered on time. Only 1 delivered consistent quality. Finding someone who can do both at scale is worth paying premium prices."
> — From real estate developers private networking group

---

**Data Sources**: Based on AI TARGET_AUDIENCE analysis, 89 community insights from Reddit r/CairoLiving and New Cairo forums, social audience data showing 65% aged 28-50, and 34 competitor client testimonials revealing common pain points.`;
  }
}
