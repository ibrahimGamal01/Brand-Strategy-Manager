/**
 * Post-Processor for AI-Generated Content
 * Cleans up contradictory statements, unsubstantiated claims, and other quality issues
 */

export function removeContradictoryStatements(markdown: string): string {
  let cleaned = markdown;

  // Remove claims about competitor failures without evidence
  const problematicPatterns: [RegExp, string][] = [
    // Pattern 1: Unsubstantiated competitor failures
    [
      /competitor'?s? [^.]*?(failed|failure|struggled)[^.]*?\.(?![^.]{0,100}(evidence|according to|as shown|data shows|metrics reveal))/gi,
      '' // Remove entire sentence
    ],
    // Pattern 2: "Lacks specific metrics to validate"
    [
      /\b(the )?(claim|assertion|statement) [^.]*?lacks [^.]*?(metrics|data|evidence) to validate[^.]*?\./gi,
      ''
    ],
    // Pattern 3: "Unsubstantiated" claims
    [
      /[^.]*?unsubstantiated[^.]*?(claim|by concrete data)[^.]*?\./gi,
      ''
    ],
    // Pattern 4: Self-contradicting statements like "not entirely unique" after promising unfair advantage
    [
      /which, while significant, is not (entirely )?unique/gi,
      'which provides differentiation'
    ],
    // Pattern 5: Undermining statements
    [
      /\b(however|although), (the )?(evidence|specific details) [^.]*? (not|aren't|isn't) detailed/gi,
      ''
    ]
  ];

  for (const [pattern, replacement] of problematicPatterns) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  // Clean up double spaces and newlines created by removals
  cleaned = cleaned.replace(/\n\n\n+/g, '\n\n');
  cleaned = cleaned.replace(/  +/g, ' ');
  
  // Remove empty list items
  cleaned = cleaned.replace(/^[- ]*\n/gm, '');

  return cleaned;
}

/**
 * Validate that headers match content tone
 * Returns array of issues found
 */
export function validateHeadersMatchContent(markdown: string): string[] {
  const issues: string[] = [];
  
  // Extract headers and their following content (up to next header or 500 chars)
  const headerPattern = /^#{1,3}\s+(.+?)$/gm;
  const lines = markdown.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headerPattern);
    if (match) {
      const header = lines[i].replace(/^#{1,3}\s+/, '');
      // Get next 10 lines of content
      const contentLines = lines.slice(i + 1, i + 11).join(' ');
      
      // Check for contradictions
      
      // If header promises advantage/strength but content undermines it
      if (header.match(/unfair advantage|strength|win|success|benefit/i)) {
        if (contentLines.match(/not (entirely )?unique|not defensible|questionable|weak|insufficient|lacks?/i)) {
          issues.push(`Header "${header}" promises positive outcome, but content undermines it`);
        }
      }
      
      // If header is positive but content is negative
      if (header.match(/strength|advantage|opportunity|gain|benefit/i)) {
        const negativeCount = (contentLines.match(/\b(fail|weak|insufficient|lack|poor|limited|unable|cannot|difficult)\b/gi) || []).length;
        const positiveCount = (contentLines.match(/\b(strong|advantage|benefit|opportunity|successful|effective|powerful)\b/gi) || []).length;
        
        if (negativeCount > positiveCount) {
          issues.push(`Header "${header}" is positive but content is mostly negative`);
        }
      }
    }
  }
  
  return issues;
}

/**
 * Combined post-processing function
 * Applies all quality improvements
 */
export function postProcessContent(markdown: string): {
  cleaned: string;
  issues: string[];
} {
  const cleaned = removeContradictoryStatements(markdown);
  const headerIssues = validateHeadersMatchContent(cleaned);
  
  return {
    cleaned,
    issues: headerIssues
  };
}
