# System Architecture Summary

## How the AI Will Understand Structures

### 1. Template Interfaces (TypeScript)
**File**: `types/templates.ts`

Defines the **data structure** that code uses:
```typescript
interface BusinessUnderstandingTemplate {
  sections: {
    businessOverview: {
      wordCount: { min: 300, max: 400 }
      requiredElements: ['specific_products', 'customer_segments', ...]
    }
    // ...
  }
}
```

### 2. System Prompts (Natural Language)
**File**: `prompts/system-prompts.ts`

Explains the **exact structure** to the AI in detail:
```
You are generating "Business Understanding" section.

Follow this EXACT structure:

# Part 1: Understanding the Business

## Business Overview (300-400 words)
Write a comprehensive overview covering:
- What they do specifically (products/services with examples)
- Who they serve (customer segments with examples)
...

REQUIREMENTS:
- Use specific examples from research
- Include numbers and metrics
- NO generic phrases
```

### 3. How They Work Together

**Generation Flow**:
```
RAG Data → AI Generator (with system prompt) → Markdown Output → Validator → PDF
```

**Example**:
```typescript
// 1. Get research context
const context = await getFullResearchContext(jobId);
const contextString = formatContextForLLM(context);

// 2. Use system prompt + context
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    {
      role: 'system',
      content: SYSTEM_PROMPTS.BUSINESS_UNDERSTANDING // Full prompt with structure
    },
    {
      role: 'user',
      content: `Generate Business Understanding section using this research:\n\n${contextString}`
    }
  ],
  temperature: 0.7,
  max_tokens: 4000
});

// 3. AI returns markdown following the prompt structure
const markdown = response.choices[0].message.content;

// 4. Validate structure
const validation = await validateContent(
  markdown,
  'business_understanding',
  ['specific_products', 'customer_segments', 'business_model'], // From template
  { min: 300, max: 400 }, // From template
  context
);

// 5. If valid, save and convert to PDF
if (validation.passed) {
  await saveToDatabase(markdown);
  await generatePDF(markdown);
}
```

## PDF Conversion Structure

### Input (Markdown)
```markdown
# Part 1: Understanding the Business

## Business Overview

**Ghowiba** is a premium design-build firm in Cairo...

### Key Products
- 3D rendering
- MEP coordination
- Custom furniture manufacturing
```

### Output (PDF)
- Professional formatting with CSS styling
- Page breaks between sections
- Tables rendered properly
- Cover page with client name
- Table of contents
- Appendix with quality scores

## The Complete Flow

```
┌─────────────────┐
│  Research Data  │
│  (Database)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  RAG Retriever  │ ◄── Validates data quality
│  - Business     │     Flags hallucinations
│  - AI Insights  │
│  - Competitors  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Format for LLM  │ ◄── Structures data readably
│ (Markdown str)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AI Generator    │ ◄── Uses SYSTEM_PROMPT
│ + System Prompt │     Knows exact structure
│                 │     Outputs markdown
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Validator     │ ◄── Checks structure match
│ - Specificity   │     Validates quality
│ - Evidence      │     Provides feedback
│ - Structure     │
└────────┬────────┘
         │
         ├─────── Pass (85+) ────────┐
         │                           ▼
         │              ┌─────────────────┐
         │              │ Save to DB      │
         │              │  (Markdown)     │
         │              └────────┬────────┘
         │                       │
         │                       ▼
         │              ┌─────────────────┐
         │              │ PDF Generator   │
         │              │  (Puppeteer)    │
         │              └────────┬────────┘
         │                       │
         │                       ▼
         │              ┌─────────────────┐
         │              │  Final PDF      │
         │              │  Download       │
         │              └─────────────────┘
         │
         └─────── Fail (<85) ───────┐
                                    ▼
                       ┌─────────────────┐
                       │  Regenerate     │
                       │  with Feedback  │
                       └────────┬────────┘
                                │
                        (Loop max 3 times)
```

## Why This Works

1. **TypeScript Interfaces** = Code structure (type safety, validation)
2. **System Prompts** = AI instructions (what to generate)
3. **Markdown Output** = Flexible, PDF-ready format
4. **Validator** = Quality gate (ensures structure match)
5. **PDF Generator** = Professional deliverable

## AI Understanding Guarantee

The AI will understand the structure because:

✅ **Explicit Instructions**: System prompt is 1000+ words explaining exact structure
✅ **Examples Provided**: Each prompt includes format examples
✅ **Context Included**: RAG context shows real data to use
✅ **Clear Requirements**: "MUST include X", "Use format Y", "NO generic phrases"
✅ **Markdown Output**: Simple, structured format AI knows well
✅ **Validation Loop**: If structure wrong, regenerate with specific feedback

The combination of detailed prompts + validation + feedback loop ensures the AI produces correctly structured, high-quality markdown that converts perfectly to PDF.
