/**
 * Two-Pass Document Validator
 * 
 * Ensures document quality before client delivery
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ValidationIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  section: string;
  issue: string;
  evidence: string;
  suggestion: string;
}

interface ValidationResult {
  passed: boolean;
  overallScore: number;
  issues: ValidationIssue[];
  warnings: string[];
  passResults: {
    pass1: { passed: boolean; issues: ValidationIssue[] };
    pass2: { passed: boolean; issues: ValidationIssue[] };
  };
}

/**
 * PASS 1: Generic Content & Placeholder Detection
 * Catches low-quality, AI-generated markers
 */
function validatePass1(documentSections: Record<string, string>): { passed: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  const genericPatterns = {
    // Placeholder handles
    placeholderHandles: /@handle\d+|@competitor\d+|@example|@\[.*?\]/gi,
    
    // "Data not found" disclaimers
    dataNotFound: /not found in research|not available in data|data not available|not found in the data|research data does not include/gi,
    
    // Generic algorithm statements
    genericAlgorithm: /algorithm is (ideal|perfect|great)|algorithm supports/gi,
    
    // Bracketed placeholders
    bracketedPlaceholders: /\[handle\]|\[competitor\]|\[X\]|\[Y\]|\[platform\]/g,
    
    // Generic benefit statements
    genericBenefits: /perfect for|ideal for|great for/gi,
    
    // Vague quantifiers
    vagueQuantifiers: /many (people|users|followers)|significant (number|amount)|considerable (impact|effect)/gi
  };

  Object.entries(documentSections).forEach(([sectionName, content]) => {
    if (!content) return;

    // Check for placeholder handles
    const handleMatches = content.match(genericPatterns.placeholderHandles);
    if (handleMatches && handleMatches.length > 0) {
      issues.push({
        severity: 'CRITICAL',
        section: sectionName,
        issue: 'Placeholder competitor handles detected',
        evidence: `Found: ${handleMatches.slice(0, 3).join(', ')}${handleMatches.length > 3 ? ` and ${handleMatches.length - 3} more` : ''}`,
        suggestion: 'Use real competitor handles from research data'
      });
    }

    // Check for "data not found" text
    const dataNotFoundMatches = content.match(genericPatterns.dataNotFound);
    if (dataNotFoundMatches && dataNotFoundMatches.length > 0) {
      issues.push({
        severity: 'CRITICAL',
        section: sectionName,
        issue: '"Data not found" disclaimers present',
        evidence: `Found ${dataNotFoundMatches.length} instances`,
        suggestion: 'Either find the data or skip the subsection entirely - never admit missing data'
      });
    }

    // Check for generic algorithm statements
    const algorithmMatches = content.match(genericPatterns.genericAlgorithm);
    if (algorithmMatches && algorithmMatches.length > 0) {
      issues.push({
        severity: 'HIGH',
        section: sectionName,
        issue: 'Generic algorithm statements',
        evidence: `Found: "${algorithmMatches[0]}"`,
        suggestion: 'Replace with data-driven rationale citing specific metrics'
      });
    }

    // Check for bracketed placeholders in final output
    const bracketMatches = content.match(genericPatterns.bracketedPlaceholders);
    if (bracketMatches && bracketMatches.length > 0) {
      issues.push({
        severity: 'CRITICAL',
        section: sectionName,
        issue: 'Bracketed placeholders in final output',
        evidence: `Found: ${bracketMatches.slice(0, 5).join(', ')}`,
        suggestion: 'Replace all bracketed text with actual data'
      });
    }

    // Check for generic benefit statements
    const benefitMatches = content.match(genericPatterns.genericBenefits);
    if (benefitMatches && benefitMatches.length > 3) { // Allow up to 3
      issues.push({
        severity: 'MEDIUM',
        section: sectionName,
        issue: `Generic benefit statements (${benefitMatches.length} instances)`,
        evidence: `Examples: "${benefitMatches.slice(0, 2).join('", "')}"`,
        suggestion: 'Replace with specific, data-backed statements'
      });
    }

    // Check for vague quantifiers
    const vagueMatches = content.match(genericPatterns.vagueQuantifiers);
    if (vagueMatches && vagueMatches.length > 2) { // Allow up to 2
      issues.push({
        severity: 'MEDIUM',
        section: sectionName,
        issue: `Vague quantifiers detected (${vagueMatches.length} instances)`,
        evidence: `Examples: "${vagueMatches.slice(0, 2).join('", "')}"`,
        suggestion: 'Use specific numbers from research data'
      });
    }
  });

  const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
  const passed = criticalIssues.length === 0;

  return { passed, issues };
}

/**
 * PASS 2: Strategic Insights Integration & Quality Score
 * Ensures 12 strategic questions are woven into document and overall quality is 8/10+
 */
async function validatePass2(
  researchJobId: string,
  documentSections: Record<string, string>,
  sectionScores: Record<string, number>
): Promise<{ passed: boolean; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];

  // Calculate overall quality score
  const scores = Object.values(sectionScores).filter(s => s > 0);
  const averageScore = scores.length > 0 
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length 
    : 0;

  // CRITICAL: Must be 8/10 (80/100) minimum
  if (averageScore < 80) {
    issues.push({
      severity: 'CRITICAL',
      section: 'overall',
      issue: `Document quality score too low: ${averageScore.toFixed(1)}/100`,
      evidence: `Minimum required: 80/100`,
      suggestion: 'Regenerate sections with scores below 80'
    });
  }

  // Check for strategic insights integration from RAG context
  // The RAG context already includes the 12 strategic questions, so we check if
  // key strategic phrases appear in the document (customer pain, Five Whys, etc.)
  
  const strategicKeywords = [
    'pain point',
    'root cause',
    'five whys',
    'customer journey',
    'value proposition',
    'competitive advantage',
    'market opportunity',
    'blue ocean',
    'jobs to be done',
    'existential pain'
  ];

  const fullDocument = Object.values(documentSections).join('\n\n');
  const keywordMatches = strategicKeywords.filter(keyword =>
    fullDocument.toLowerCase().includes(keyword.toLowerCase())
  );

  const integrationRate = (keywordMatches.length / strategicKeywords.length) * 100;

  if (integrationRate < 40) { // At least 40% of strategic concepts should appear
    issues.push({
      severity: 'HIGH',
      section: 'overall',
      issue: `Low strategic insights integration: ${integrationRate.toFixed(0)}%`,
      evidence: `Only ${keywordMatches.length}/${strategicKeywords.length} strategic concepts detected`,
      suggestion: 'Ensure prompts reference AI Strategic Insights section from RAG context'
    });
  }

  // Check for specific quality markers
  const qualityMarkers = {
    hasSpecificMetrics: /@[\w_]+.*?\d+[KMk%]/g.test(fullDocument), // Handles with numbers
    hasComparisons: /(\d+\.?\d*%?\s*vs\s*\d+\.?\d*%?)|(\d+x\s+(higher|lower|more|less))/gi.test(fullDocument),
    hasQuotes: /"[^"]{30,}"\s*-\s*@/g.test(fullDocument), // Quotes with attribution
    hasDataTables: /\|.*\|.*\|/g.test(fullDocument) // Markdown tables
  };

  const qualityCount = Object.values(qualityMarkers).filter(Boolean).length;
  if (qualityCount < 3) {
    issues.push({
      severity: 'MEDIUM',
      section: 'overall',
      issue: `Missing quality markers (${qualityCount}/4 present)`,
      evidence: `Should have: specific metrics, comparisons, quotes, data tables`,
      suggestion: 'Document lacks consultant-grade depth - needs more data-driven content'
    });
  }

  const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
  const highIssues = issues.filter(i => i.severity === 'HIGH');
  
  // Pass if no CRITICAL issues and score is 8/10+
  const passed = criticalIssues.length === 0 && averageScore >= 80;

  return { passed, issues };
}

/**
 * Main validation function - runs both passes
 */
export async function validateDocument(
  researchJobId: string,
  documentSections: Record<string, any>, // Section objects with markdown and score
  minQualityScore: number = 80
): Promise<ValidationResult> {
  console.log(`[Document Validator] Running 2-pass validation for job: ${researchJobId}`);

  // Extract markdown and scores
  const markdownSections: Record<string, string> = {};
  const scores: Record<string, number> = {};
  
  Object.entries(documentSections).forEach(([key, section]) => {
    if (section && typeof section === 'object') {
      markdownSections[key] = section.markdown || '';
      scores[key] = section.score || 0;
    }
  });

  // PASS 1: Generic content detection
  console.log(`[Validator Pass 1] Checking for generic content and placeholders...`);
  const pass1 = validatePass1(markdownSections);
  console.log(`[Validator Pass 1] ${pass1.passed ? 'PASSED' : 'FAILED'} - ${pass1.issues.length} issues found`);

  // PASS 2: Strategic insights & quality score
  console.log(`[Validator Pass 2] Checking strategic insights integration and quality score...`);
  const pass2 = await validatePass2(researchJobId, markdownSections, scores);
  console.log(`[Validator Pass 2] ${pass2.passed ? 'PASSED' : 'FAILED'} - ${pass2.issues.length} issues found`);

  // Combine results
  const allIssues = [...pass1.issues, ...pass2.issues];
  const criticalIssues = allIssues.filter(i => i.severity === 'CRITICAL');
  
  const overallScore = Object.values(scores).length > 0
    ? Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.values(scores).length
    : 0;

  const passed = pass1.passed && pass2.passed;

  const warnings: string[] = [];
  if (!passed) {
    warnings.push(`Document validation FAILED with ${criticalIssues.length} critical issues`);
  }
  if (overallScore < minQualityScore) {
    warnings.push(`Quality score ${overallScore.toFixed(1)}/100 below minimum ${minQualityScore}/100`);
  }

  console.log(`[Document Validator] Overall: ${passed ? 'PASSED' : 'FAILED'} - Score: ${overallScore.toFixed(1)}/100`);

  return {
    passed,
    overallScore,
    issues: allIssues,
    warnings,
    passResults: {
      pass1: { passed: pass1.passed, issues: pass1.issues },
      pass2: { passed: pass2.passed, issues: pass2.issues }
    }
  };
}
