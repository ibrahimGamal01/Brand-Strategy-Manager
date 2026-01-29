/**
 * Content Quality Checks
 * 
 * Specificity, evidence, structure, and word count validation
 */

import { ValidationImprovement } from '../types/templates';

/**
 * Check if content includes specific examples, numbers, and names
 */
export function checkSpecificity(content: string): { score: number; feedback: string[] } {
  const feedback: string[] = [];
  let score = 100;

  const numberMatches = content.match(/\d+(\.\d+)?[%KM]?/g) || [];
  if (numberMatches.length < 5) {
    score -= 15;
    feedback.push(`Only ${numberMatches.length} numeric data points. Add more metrics from research.`);
  }

  const properNounMatches = content.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  if (properNounMatches.length < 10) {
    score -= 15;
    feedback.push(`Only ${properNounMatches.length} proper nouns. Include specific names, places, brands.`);
  }

  const vagueQuantifiers = ['many', 'several', 'some', 'various', 'numerous', 'multiple'];
  const vagueFound = vagueQuantifiers.filter(vague => 
    new RegExp(`\\b${vague}\\b`, 'gi').test(content)
  );
  
  if (vagueFound.length > 3) {
    score -= 10;
    feedback.push(`Found ${vagueFound.length} vague quantifiers. Replace with exact numbers.`);
  }

  const hasExamples = /example:|e\.g\.|for instance|specifically|such as/gi.test(content);
  if (!hasExamples) {
    score -= 10;
    feedback.push('No examples found. Add "For example:" with concrete instances.');
  }

  return { score, feedback };
}

/**
 * Check if claims are backed by research data
 */
export function checkEvidence(content: string): { score: number; feedback: ValidationImprovement[] } {
  const feedback: ValidationImprovement[] = [];
  let score = 100;

  const claimPatterns = [
    /customers (want|need|prefer|value)/gi,
    /users (expect|demand|seek)/gi,
    /the (audience|market|industry) (is|wants|needs)/gi,
    /competitors (are|do|have)/gi
  ];

  for (const pattern of claimPatterns) {
    const matches = content.match(pattern) || [];
    
    for (const match of matches) {
      const matchIndex = content.indexOf(match);
      const contextWindow = content.substring(Math.max(0, matchIndex - 50), matchIndex + 150);
      
      const hasCitation = /based on|according to|from|shows|reveals|survey|review|analysis/i.test(contextWindow);
      
      if (!hasCitation) {
        score -= 5;
        feedback.push({
          issue: `Unsupported claim: "${match}"`,
          suggestion: 'Add evidence from research',
          example: `"${match} based on analysis of 127 reviews" or "(from AI TARGET_AUDIENCE)"`
        });
      }
    }
  }

  return { score, feedback };
}

/**
 * Check if required elements are present
 */
export function checkRequiredElements(
  content: string,
  requiredElements: string[]
): { score: number; missingElements: string[] } {
  const missingElements: string[] = [];
  let score = 100;

  for (const element of requiredElements) {
    const keywords = element.split('_').filter(k => k.length > 3);
    
    const found = keywords.some(keyword => 
      new RegExp(`\\b${keyword}\\b`, 'i').test(content)
    );
    
    if (!found) {
      missingElements.push(element);
      score -= 20;
    }
  }

  return { score, missingElements };
}

/**
 * Check word count
 */
export function checkWordCount(
  content: string,
  minWords: number,
  maxWords: number
): { score: number; feedback: string } {
  const wordCount = content.trim().split(/\s+/).length;
  let score = 100;
  let feedback = '';

  if (wordCount < minWords) {
    const deficit = minWords - wordCount;
    score -= Math.min(30, (deficit / minWords) * 100);
    feedback = `${deficit} words short (${wordCount}/${minWords} min). Add more detail.`;
  } else if (wordCount > maxWords) {
    const excess = wordCount - maxWords;
    score -= Math.min(15, (excess / maxWords) * 50);
    feedback = `${excess} words over (${wordCount}/${maxWords} max). Be more concise.`;
  } else {
    feedback = `Word count OK: ${wordCount} words`;
  }

  return { score, feedback };
}
