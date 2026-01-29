/**
 * Industry-Specific Prompt Modifiers
 * 
 * These modifiers adapt the base system prompts to different industries
 * by adding industry-specific frameworks, language, and analysis methods
 */

export interface IndustryContext {
  industry: string;  // e.g., "SaaS", "ecommerce", "healthcare", "professional_services"
  businessModel: string;  // "B2B", "B2C", "D2C", "B2B2C"
  niche?: string;  // e.g., "B2B Marketing Automation", "D2C Fashion"
}

/**
 * Industry-specific additions to system prompts
 */
export const INDUSTRY_MODIFIERS = {
  saas_b2b: {
    general: `
INDUSTRY CONTEXT: B2B SaaS

Apply the following frameworks and language conventions:

**Content Strategy Framework**:
- Thought Leadership: Industry trends, innovation, future of work
- Product Education: Feature deep-dives, use cases, ROI calculators, integration guides
- Customer Success: Implementation guides, case studies, best practices, onboarding
- Integration Ecosystem: Partner content, workflow automation, tech stack discussions

**Buyer Persona Framework**:
- Economic Buyer (Decision Maker): VP/C-level, budget authority, ROI focus
- User Buyer (Champion): Day-to-day user, pain points, adoption concerns
- Technical Buyer (Influencer): IT/Security, integration requirements, compliance

**Language Conventions**:
- Emphasize data-driven decision making
- Use industry metrics: MRR, CAC, LTV, Churn Rate, NRR
- Focus on productivity, efficiency, scalability
- Technical but accessible - avoid jargon unless industry-standard

**Analysis Methods**:
- Jobs-to-be-Done Framework
- Value Proposition Canvas
- Customer Success Maturity Model
- B2B Buying Committee Analysis
`,
    targetAudience: `
For B2B SaaS personas, structure EACH persona as:
- **Role in Organization**: Specific job title and department
- **Decision Influence**: Economic/User/Technical buyer
- **Budget Authority**: Level of spending power
- **Procurement Process**: How they evaluate and approve vendors
- **Success Metrics**: KPIs they're measured on
- **Integration Needs**: How tool fits in tech stack
`,
    contentAnalysis: `
For B2B SaaS content analysis, prioritize:
- **Thought Leadership Content**: Industry insights, data reports, trend analysis
- **Product Education**: Demo videos, feature walkthroughs, use case breakdowns
- **Social Proof**: Case studies, testimonials, ROI statistics
- **Community Building**: User groups, webinars, knowledge sharing
`
  },

  ecommerce_d2c: {
    general: `
INDUSTRY CONTEXT: Direct-to-Consumer E-commerce

Apply the following frameworks and language conventions:

**Content Strategy Framework**:
- Product Discovery: New arrivals, collections, seasonal drops, trends
- Lifestyle & Aspiration: Brand values, customer stories, inspiration, aesthetics
- Social Proof: UGC (user-generated content), reviews, testimonials, social validation
- Urgency & Scarcity: Limited editions, flash sales, exclusivity, FOMO

**Buyer Psychology**:
- Impulse buying behavior
- Visual decision-making
- Social influence and trends
- Emotional connection to brand identity

**Language Conventions**:
- Conversational, relatable, aspirational
- Benefit-driven (not feature-focused)
- Sensory and emotional language
- Trend-aware and culturally relevant

**Analysis Methods**:
- AIDA Framework (Attention → Interest → Desire → Action)
- Customer Journey Mapping (Discovery → Comparison → Purchase → Advocacy)
- Conversion Funnel Optimization
- Social Commerce Analysis
`,
    targetAudience: `
For D2C E-commerce personas:
- **Shopping Behavior**: Impulse vs. research-driven, platform preferences
- **Style Profile**: Fashion sense, aesthetic preferences, trend adoption
- **Price Sensitivity**: Budget consciousness, deal-seeking behavior
- **Social Influence**: Influencer following, peer recommendations
- **Purchase Triggers**: What drives them to buy (FOMO, sales, new arrivals)
`,
    contentAnalysis: `
For D2C content analysis, prioritize:
- **Visual Content**: High-quality product photography, lifestyle imagery, UGC
- **Influencer Collaborations**: Partnerships, sponsored content, brand ambassadors
- **Trend-Driven Content**: What's trending, seasonal content, cultural moments
- **Urgency Tactics**: Limited stock, flash sales, countdown timers
`
  },

  healthcare_wellness: {
    general: `
INDUSTRY CONTEXT: Healthcare & Wellness

Apply the following frameworks and language conventions:

**Content Strategy Framework**:
- Education: Condition awareness, treatment options, prevention, health literacy
- Trust-Building: Credentials, clinical evidence, patient outcomes, safety
- Patient Experience: Testimonials, care journey, support resources, empathy
- Innovation: Research, new treatments, technology advancements

**Language Conventions**:
- Empathetic, authoritative, reassuring tone
- Clear and accessible (health literacy level 6-8)
- Evidence-based claims with citations
- HIPAA-compliant, ethical, responsible

**Compliance Requirements**:
- Medical disclaimers required
- Evidence-based claims only
- Patient privacy considerations
- Regulatory compliance (FDA, etc.)

**Analysis Methods**:
- Patient Journey Mapping
- Health Belief Model
- Clinical Evidence Hierarchy
- Patient Experience Framework
`,
    targetAudience: `
For Healthcare personas:
- **Health Condition Stage**: Newly diagnosed, managing chronic, preventive
- **Health Literacy**: Ability to understand medical information
- **Care Decision-Making**: Individual vs. family involvement, insurance constraints
- **Provider Selection Criteria**: Credentials, accessibility, bedside manner, outcomes
- **Information Needs**: Educational depth, emotional support, peer community
`,
    contentAnalysis: `
For Healthcare content analysis:
- **Educational Content**: Explainer videos, condition guides, treatment comparisons
- **Trust Signals**: Doctor credentials, patient testimonials, clinical evidence
- **Support Resources**: FAQs, support groups, care guides
- **Empathy & Compassion**: Patient stories, emotional support, understanding
`
  },

  professional_services: {
    general: `
INDUSTRY CONTEXT: Professional Services (Consulting, Legal, Financial)

Apply the following frameworks and language conventions:

**Content Strategy Framework**:
- Expertise Demonstration: Insights, analysis, thought pieces, market commentary
- Case Studies: Client success, problem-solving, outcomes, transformations
- Relationship-Building: Personal brand, networking, trust, credibility
- Industry Trends: Market analysis, regulatory changes, forecasts, implications

**Language Conventions**:
- Authoritative, confident, nuanced
- Professional but personable
- Industry-specific terminology
- Evidence of deep expertise

**Trust Factors**:
- Credentials and experience
- Client testimonials and referrals
- Industry recognition
- Thought leadership

**Analysis Methods**:
- Trust Equation (Credibility + Reliability + Intimacy / Self-Orientation)
- Expertise Positioning Matrix
- Client Lifetime Value Analysis
- Relationship Funnel
`,
    targetAudience: `
For Professional Services personas:
- **Decision Process**: High-trust, relationship-driven, long sales cycles
- **Risk Tolerance**: Risk-averse, credibility-focused, peer-validated
- **Budget Considerations**: Large investments, ROI expectations, payment terms
- **Engagement Model**: Ongoing vs. project-based, retainer preferences
- **Referral Sources**: How they find and vet service providers
`,
    contentAnalysis: `
For Professional Services content:
- **Thought Leadership**: Market insights, trend analysis, expert commentary
- **Case Studies**: Detailed client stories, problem-solving approaches
- **Credentials**: Professional achievements, certifications, recognition
- **Personal Brand**: Individual expertise, speaking engagements, publications
`
  }
};

/**
 * Detect industry from business context
 */
export function detectIndustry(businessContext: any): IndustryContext {
  const description = (businessContext.description || '').toLowerCase();
  const name = (businessContext.name || '').toLowerCase();
  const combined = `${description} ${name}`;

  // SaaS/B2B indicators
  if (
    combined.match(/\b(saas|software|b2b|enterprise|platform|cloud|api|tool|solution)\b/) ||
    combined.match(/\b(automation|productivity|collaboration|crm|analytics)\b/)
  ) {
    return {
      industry: 'saas_b2b',
      businessModel: 'B2B',
      niche: extractNiche(combined, 'saas')
    };
  }

  // E-commerce/D2C indicators
  if (
    combined.match(/\b(ecommerce|e-commerce|store|shop|retail|fashion|apparel|beauty)\b/) ||
    combined.match(/\b(d2c|dtc|online store|products|merchandise)\b/)
  ) {
    return {
      industry: 'ecommerce_d2c',
      businessModel: 'D2C',
      niche: extractNiche(combined, 'ecommerce')
    };
  }

  // Healthcare/Wellness indicators
  if (
    combined.match(/\b(health|healthcare|medical|wellness|fitness|therapy|clinic)\b/) ||
    combined.match(/\b(doctor|physician|mental health|nutrition|medicine)\b/)
  ) {
    return {
      industry: 'healthcare_wellness',
      businessModel: 'B2C',
      niche: extractNiche(combined, 'healthcare')
    };
  }

  // Professional Services indicators
  if (
    combined.match(/\b(consulting|consultant|advisory|legal|law|accounting|financial|coaching)\b/) ||
    combined.match(/\b(services|professional|expert|specialist)\b/)
  ) {
    return {
      industry: 'professional_services',
      businessModel: 'B2B',
      niche: extractNiche(combined, 'services')
    };
  }

  // Default to general
  return {
    industry: 'general',
    businessModel: 'B2C'
  };
}

/**
 * Extract niche from description (helper)
 */
function extractNiche(text: string, industry: string): string {
  // Simple keyword extraction - can be enhanced
  if (industry === 'saas') {
    if (text.includes('marketing')) return 'B2B Marketing Automation';
    if (text.includes('sales')) return 'Sales Enablement';
    if (text.includes('hr') || text.includes('human resource')) return 'HR Tech';
  }
  if (industry === 'ecommerce') {
    if (text.includes('fashion') || text.includes('apparel')) return 'Fashion & Apparel';
    if (text.includes('beauty') || text.includes('cosmetic')) return 'Beauty & Cosmetics';
  }
  return 'General';
}

/**
 * Apply industry modifier to system prompt
 */
export function applyIndustryModifier(
  basePrompt: string,
  industry: IndustryContext,
  generatorType: string
): string {
  const industryKey = industry.industry as keyof typeof INDUSTRY_MODIFIERS;
  const modifiers = INDUSTRY_MODIFIERS[industryKey];

  if (!modifiers) {
    return basePrompt;  // No industry-specific modifier available
  }

  // Get general industry context
  let modifier = modifiers.general;

  // Add generator-specific modifier if available
  const generatorKey = generatorType.toLowerCase().replace(/_/g, '');
  if (modifiers[generatorKey as keyof typeof modifiers]) {
    modifier += '\n\n' + modifiers[generatorKey as keyof typeof modifiers];
  }

  // Inject modifier into prompt (after task description, before critical rules)
  const modifiedPrompt = basePrompt.replace(
    /CRITICAL RULES:/,
    `${modifier}\n\nCRITICAL RULES:`
  );

  return modifiedPrompt;
}
