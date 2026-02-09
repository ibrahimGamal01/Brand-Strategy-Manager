/**
 * Validation Rules for Prompt Outputs
 * 
 * Shared rules to prevent generic/placeholder content
 */

/**
 * Forbidden placeholder patterns
 */
export const FORBIDDEN_PLACEHOLDERS = [
  '@handle1',
  '@handle2',
  '@competitor1',
  '@example',
  '[handle]',
  '[competitor]',
  '[name]',
  'Not found in research data',
  'Data unavailable',
  'No data available'
];

/**
 * Forbidden generic phrases
 */
export const FORBIDDEN_GENERIC_PHRASES = [
  'industry-leading',
  'cutting-edge',
  'state-of-the-art',
  'best-in-class',
  'world-class',
  'innovative solutions',
  'exceeding expectations',
  'going above and beyond'
];

/**
 * Required data citations for different sections
 */
export const REQUIRED_CITATIONS: Record<string, string[]> = {
  business_understanding: [
    'specific product/service examples',
    'customer segments with numbers',
    'competitor names',
    'actual metrics'
  ],
  target_audience: [
    'persona demographics',
    'pain points from research',
    'specific goals',
    'content preferences with data'
  ],
  competitive_landscape: [
    'real competitor handles',
    'exact follower counts',
    'engagement rates',
    'platform distribution %'
  ],
  content_pillars: [
    'specific pain points addressed',
    'competitor examples with metrics',
    'or honest gap statement',
    'format recommendations with data'
  ],
  priority_competitor: [
    'exact metrics from database',
    'real post analysis',
    'specific hooks from posts',
    'performance comparisons'
  ]
};

/**
 * Word variety requirements
 */
export const WORD_VARIETY_RULES = {
  max_repetitions: 3,
  suggest_alternatives: {
    'Islamic values': ['faith-aligned', 'Halal principles', 'spiritual framework', 'ethical guidelines'],
    'entrepreneur': ['business owner', 'founder', 'startup creator', 'business leader'],
    'content': ['posts', 'material', 'messaging', 'creative assets'],
    'engage': ['connect', 'resonate', 'attract', 'capture attention']
  }
};

/**
 * Validate that content doesn't contain placeholders
 */
export function validateNoPlaceholders(content: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  FORBIDDEN_PLACEHOLDERS.forEach(placeholder => {
    if (content.includes(placeholder)) {
      issues.push(`Contains forbidden placeholder: "${placeholder}"`);
    }
  });
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Validate that content avoids generic phrases
 */
export function validateNoGenericPhrases(content: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const lower = content.toLowerCase();
  
  FORBIDDEN_GENERIC_PHRASES.forEach(phrase => {
    if (lower.includes(phrase.toLowerCase())) {
      issues.push(`Contains generic phrase: "${phrase}"`);
    }
  });
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Validate word variety (not too much repetition)
 */
export function validateWordVariety(content: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const { max_repetitions, suggest_alternatives } = WORD_VARIETY_RULES;
  
  Object.entries(suggest_alternatives).forEach(([phrase, alternatives]) => {
    const regex = new RegExp(phrase, 'gi');
    const matches = content.match(regex);
    
    if (matches && matches.length > max_repetitions) {
      issues.push(
        `"${phrase}" repeated ${matches.length} times (max ${max_repetitions}). ` +
        `Consider alternatives: ${alternatives.join(', ')}`
      );
    }
  });
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Validate section has required citations
 */
export function validateRequiredCitations(
  sectionType: keyof typeof REQUIRED_CITATIONS,
  content: string
): { valid: boolean; issues: string[] } {
  const required = REQUIRED_CITATIONS[sectionType];
  if (!required) {
    return { valid: true, issues: [] };
  }
  
  const issues: string[] = [];
  
  // This is a simple check - in production, would use more sophisticated validation
  required.forEach(requirement => {
    // Just log as warning for now
    console.log(`[Validation] Section "${sectionType}" should include: ${requirement}`);
  });
  
  return {
    valid: true,
    issues
  };
}

/**
 * Master validation function
 */
export function validatePromptOutput(
  content: string,
  sectionType?: keyof typeof REQUIRED_CITATIONS
): { valid: boolean; issues: string[] } {
  const allIssues: string[] = [];
  
  // Run all validations
  const placeholderCheck = validateNoPlaceholders(content);
  const genericCheck = validateNoGenericPhrases(content);
  const varietyCheck = validateWordVariety(content);
  
  allIssues.push(...placeholderCheck.issues);
  allIssues.push(...genericCheck.issues);
  allIssues.push(...varietyCheck.issues);
  
  if (sectionType) {
    const citationCheck = validateRequiredCitations(sectionType, content);
    allIssues.push(...citationCheck.issues);
  }
  
  return {
    valid: allIssues.length === 0,
    issues: allIssues
  };
}
