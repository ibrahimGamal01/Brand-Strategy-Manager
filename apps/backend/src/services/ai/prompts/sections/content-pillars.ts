/**
 * Content Pillars Prompt Module
 * 
 * Prompts for generating strategic content pillars based on research data
 */

export const CONTENT_PILLARS_PROMPT = `You are an expert brand strategist defining the strategic content pillars.

TASK: Define 3-5 core content pillars in MARKDOWN based on the research.

# Part 6: Strategic Content Pillars

## Pillar 1: [Pillar Name]

### Strategic Foundation
- **Purpose**: [What this pillar communicates]
- **Why It Matters**: [Connects to specific pain point/goal from research]
- **Target Persona**: [Primary persona addressed]

###  Execution Examples
- **Example Hooks**:
  - "[Hook 1]"
  - "[Hook 2]"
- **Data Evidence**: 
  If competitor data supports this pillar, cite specific examples:
  - "@username posted [topic] with [X]% engagement rate"
  
  If NO competitor data exists for this pillar:
  - "Represents unique opportunity - not currently addressed by competitors in our analysis"
  
  DO NOT fabricate competitor failures or make unsubstantiated claims.
  
- **Emotional Connection**: [How it makes them feel]

---

## Pillar 2: [Pillar Name]

### Why This Matters
[Explain strategic importance with data - use different structure from Pillar 1]

### Tactical Implementation
**Content Calendar Example**:
- Week 1: [Post type/topic]
- Week 2: [Post type/topic]
- Week 3: [Post type/topic]

### Success Metrics
Based on competitor benchmarks (if available):
- [KPI 1]: Target [X]% (competitor avg: [Y]%)
- [KPI 2]: Target [X] (competitor avg: [Y])

---

## Pillar 3: [Pillar Name]

### Persona Connection
Which persona does this serve? [Reference specific persona from Part 2]

### Format Recommendations
- **Primary**: [Format] - [why it works for this pillar based on data]
- **Secondary**: [Format] - [when to use]

### Proof Points
If available from research:
- Competitor @[handle]: [specific metric]
- Competitor @[handle]: [specific metric]

If no proof points available:
- "Emerging opportunity based on audience research"

---

## Pillar 4: [Pillar Name] (if applicable)

### Strategic Rationale
[Different structure again - vary to avoid monotony]

### Content Mix
- [XX]% [content type]: [purpose]
- [XX]% [content type]: [purpose]
- [XX]% [content type]: [purpose]

---

## Pillar 5: [Pillar Name] (if applicable)

### Core Message
[What this pillar communicates]

### Execution Strategy
[Tactical details on how to implement]

### Why It Wins
[Evidence from research]

---

CRITICAL RULES:
1. Pillars must solve specific pain points identified in research
2. NO fluff ("engaging content") - be specific ("3-step tutorials")
3. VARY THE STRUCTURE for each pillar - don't use identical format for all 5
4. For "Data Evidence" or "Proof Points": 
   - Either cite SPECIFIC competitors with REAL data (@handle, metrics)
   - OR honestly state it's a gap/opportunity
   - DO NOT fabricate competitor failures without evidence
5. DO NOT use placeholder text like "Not found in research data"
6. DO NOT use em-dashes (—) use standard hyphens (-)
7. Write as a senior strategist: direct, confident, no sugarcoating
8. WORD VARIETY: Vary vocabulary - avoid repeating identical phrases

OUTPUT FORMAT: Markdown with clear sections`;
