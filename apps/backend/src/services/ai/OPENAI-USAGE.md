# OpenAI Key Usage & Template Locations

## Yes, We ARE Using the OpenAI API

The OpenAI key is used in **two places** with full cost protection:

### 1. AI-Powered Validation (`validation/ai-validator.ts`)

```typescript
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// But with cost protection:
if (COST_PROTECTION.mockMode) {
  // Returns mock response - NO API CALL
  return getMockAIResponse(content);
}

// Real API call only in production
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: Math.min(800, COST_PROTECTION.maxTokensPerCall),
  // ...
});
```

**Cost Protection**:
- ✅ Mock mode enabled by default in development (`NODE_ENV=development`)
- ✅ Budget tracking for all real API calls
- ✅ Token limits enforced
- ✅ Monthly budget cap

### 2. Content Generators (Coming in Week 2)

Will use OpenAI to generate brand strategy sections using RAG context.

---

## Template Interfaces Location

All template TypeScript interfaces are in:

```
apps/backend/src/services/ai/types/templates.ts (372 lines)
```

### What's Defined:

#### 1. Business Understanding Template
- `BusinessUnderstandingTemplate` interface
- Sections: business_overview, value_proposition, brand_story, brand_voice_personality, current_presence
- Total: ~2000-3000 words

#### 2. Target Audience Template
- `TargetAudienceTemplate` interface
- `Persona` interface with demographics, JTBD framework, pain points, goals, fears
- 2-4 personas per document
- Total: ~1500-2500 words

#### 3. Industry Overview Template
- `IndustryOverviewTemplate` interface
- Competitor table for all 10 competitors
- Landscape analysis, pattern identification, strategic implications
- Total: ~1000-1500 words

#### 4. Priority Competitor Template
- `PriorityCompetitorTemplate` interface
- Deep analysis of 3 priority competitors
- Blue Ocean synthesis
- Total: ~2500-4000 words

#### 5. Content Analysis Template
- `ContentAnalysisTemplate` interface
- Post breakdown, pattern identification, content playbook
- Total: ~2000-3000 words

### Validation Types
- `ValidationResult` - Validation output structure
- `ValidationFeedback` - Feedback format
- `ValidationImprovement` - Improvement suggestions
- `GenericPhraseDetection` - Generic phrase with alternatives

---

## Current State Summary

### ✅ Completed (Week 1)
1. Template interfaces defined (`templates.ts`)
2. RAG retrieval system (6 modules with data quality checks)
3. Validation system (5 modules with cost protection)
4. Test files created

### 🔒 Cost Protection Status
- Development: **MOCK MODE (no costs)**
- Testing: **MOCK MODE (no costs)**
- Production: **Real API calls with budget limits**

### 📍 Next Steps
1. Test RAG with real database data
2. Verify validator works (already tested with mock)
3. Build first template generator (Business Understanding)

---

## File Structure

```
apps/backend/src/services/ai/
├── types/
│   └── templates.ts              ← ALL TEMPLATE INTERFACES HERE
├── rag/
│   ├── data-quality.ts
│   ├── business-context.ts
│   ├── ai-insights.ts
│   ├── competitor-context.ts
│   ├── social-community-context.ts
│   └── index.ts
├── validation/
│   ├── cost-protection.ts        ← OpenAI cost limits here
│   ├── generic-detection.ts
│   ├── quality-checks.ts
│   ├── ai-validator.ts           ← OpenAI API used here
│   └── index.ts
├── __tests__/
│   ├── test-rag.ts
│   ├── test-validator.ts
│   └── rag-validator.test.ts
└── README.md
```

---

## To Enable Real API Calls

Only when you want to test with real OpenAI API:

```bash
# In apps/backend/.env
AI_FALLBACK_MODE=off
NODE_ENV=production
OPENAI_API_KEY=OPENAI_API_KEY_FROM_SECRET_MANAGER
```

**WARNING**: This will use real API credits. Only do this when ready for production testing.
