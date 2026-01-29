/**
 * Main Content Validator (Orchestrator)
 * 
 * Combines all validation checks with cost protection
 */

import { ValidationResult, ValidationImprovement } from '../types/templates';
import { detectGenericPhrases } from './generic-detection';
import { checkSpecificity, checkEvidence, checkRequiredElements, checkWordCount } from './quality-checks';
import { aiValidation } from './ai-validator';

/**
 * Main validation function
 */
export async function validateContent(
  content: string,
  sectionType: string,
  requiredElements: string[],
  wordCount: { min: number; max: number },
  researchContext: any
): Promise<ValidationResult> {
  
  console.log(`[Validator] Validating ${sectionType}...`);

  // Run all checks
  const genericPhrases = detectGenericPhrases(content);
  const specificityCheck = checkSpecificity(content);
  const evidenceCheck = checkEvidence(content);
  const elementsCheck = checkRequiredElements(content, requiredElements);
  const wordCountCheck = checkWordCount(content, wordCount.min, wordCount.max);
  
  const contextString = typeof researchContext === 'string' 
    ? researchContext 
    : JSON.stringify(researchContext).substring(0, 2000);
  
  const aiCheck = await aiValidation(content, sectionType, contextString);

  // Calculate weighted score
  const scores = {
    generic: genericPhrases.length === 0 ? 100 : Math.max(0, 100 - (genericPhrases.length * 10)),
    specificity: specificityCheck.score,
    evidence: evidenceCheck.score,
    elements: elementsCheck.score,
    wordCount: wordCountCheck.score,
    ai: aiCheck.score
  };

  const finalScore = Math.round(
    scores.generic * 0.20 +
    scores.specificity * 0.20 +
    scores.evidence * 0.20 +
    scores.elements * 0.25 +
    scores.wordCount * 0.05 +
    scores.ai * 0.10
  );

  // Compile improvements
  const allImprovements: ValidationImprovement[] = [
    ...specificityCheck.feedback.map(f => ({
      issue: 'Specificity',
      suggestion: f,
      example: undefined
    })),
    ...evidenceCheck.feedback,
    ...aiCheck.improvements
  ];

  if (genericPhrases.length > 0) {
    allImprovements.unshift({
      issue: `${genericPhrases.length} generic phrases detected`,
      suggestion: 'Replace with specific, data-backed statements',
      example: genericPhrases[0].betterAlternative
    });
  }

  if (elementsCheck.missingElements.length > 0) {
    allImprovements.unshift({
      issue: `Missing: ${elementsCheck.missingElements.join(', ')}`,
      suggestion: 'Add sections covering these required topics',
      example: undefined
    });
  }

  const passed = finalScore >= 85;

  // Generate guidance if failed
  let nextAttemptGuidance: string | undefined;
  if (!passed && allImprovements.length > 0) {
    const topIssues = allImprovements.slice(0, 3);
    nextAttemptGuidance = `To improve:\n\n${topIssues.map((imp, i) => 
      `${i + 1}. ${imp.issue}\n   → ${imp.suggestion}${imp.example ? `\n   Example: ${imp.example}` : ''}`
    ).join('\n\n')}`;
  }

  console.log(`[Validator] Score: ${finalScore}/100 (${passed ? 'PASSED' : 'NEEDS IMPROVEMENT'})`);

  return {
    score: finalScore,
    passed,
    feedback: {
      strengths: aiCheck.strengths,
      improvements: allImprovements,
      missingElements: elementsCheck.missingElements,
      genericPhrases
    },
    nextAttemptGuidance
  };
}

/**
 * Quick validation for testing (uses mock mode automatically in dev)
 */
export async function quickValidate(content: string): Promise<ValidationResult> {
  return validateContent(
    content,
    'test_section',
    ['example_element'],
    { min: 100, max: 5000 },
    'Test context'
  );
}
