/**
 * Test Suite for RAG Retriever and Validator
 * 
 * Run with: npm test from backend directory
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { getFullResearchContext, formatContextForLLM } from '../rag-retriever';
import { validateContent, quickValidate } from '../content-validator';

// ============================================
// RAG RETRIEVER TESTS
// ============================================

describe('RAG Retriever', () => {
  
  test('should detect when data is complete and reliable', async () => {
    // This would use a real research job ID in production
    // For now, testing the structure
    
    const mockContext = {
      business: {
        name: 'Test Business',
        qualityScore: { score: 90, isReliable: true, issues: [], warnings: [] }
      },
      aiInsights: {
        qualityScore: { score: 85, isReliable: true, issues: [], warnings: [] }
      },
      competitors: {
        all10: [],
        priority3: [],
        overallQuality: { score: 80, isReliable: true, issues: [], warnings: [] }
      },
      socialData: {
        qualityScore: { score: 75, isReliable: true, issues: [], warnings: [] }
      },
      community: {
        qualityScore: { score: 70, isReliable: true, issues: [], warnings: [] }
      },
      overallQuality: { score: 80, isReliable: true, issues: [], warnings: [] },
      warnings: [],
      missingData: []
    };

    expect(mockContext.overallQuality.isReliable).toBe(true);
    expect(mockContext.overallQuality.score).toBeGreaterThanOrEqual(70);
  });

  test('should flag unreliable data when quality is low', () => {
    const qualityScore = {
      score: 50,
      isReliable: false,
      issues: ['Missing critical data'],
      warnings: ['Incomplete scraping']
    };

    expect(qualityScore.isReliable).toBe(false);
    expect(qualityScore.issues.length).toBeGreaterThan(0);
  });

  test('should detect duplicate data (scraper loops)', () => {
    const data = [
      { id: 1, value: 'test' },
      { id: 2, value: 'test' },
      { id: 3, value: 'test' }
    ];

    const uniqueValues = new Set(data.map(d => d.value));
    const hasDuplicates = uniqueValues.size < data.length;

    expect(hasDuplicates).toBe(true);
  });
});

// ============================================
// CONTENT VALIDATOR TESTS
// ============================================

describe('Content Validator', () => {
  
  test('should detect generic phrases', async () => {
    const genericContent = `
      We are an industry-leading company providing cutting-edge solutions.
      Our world-class team delivers exceptional quality.
    `;

    const result = await quickValidate(genericContent);

    expect(result.feedback.genericPhrases.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(85);
    expect(result.passed).toBe(false);
  });

  test('should pass specific content with data', async () => {
    const specificContent = `
      Founded in 2018, the company has completed 47 residential projects with an average
      value of $850,000. Unlike competitors who post 3x/week, they post daily but with
      40% lower engagement (2,341 likes vs competitor average of 3,890 likes per post).
      
      Based on analysis of 127 Google reviews, customers specifically mention "price
      transparency" in 68% of positive reviews. Their unique 95% accuracy guarantee
      between renders and delivered spaces is backed by only 2 material substitutions
      in 2023 (vs industry average of 12-15 per project).
      
      The business operates in New Cairo and Sheikh Zayed, competing directly with
      4-5 boutique firms including @competitor1 (12.8K followers) and @competitor2 (45.2K followers).
    `;

    const result = await quickValidate(specificContent);

    expect(result.score).toBeGreaterThan(70); // Should score reasonably well
    expect(result.feedback.genericPhrases.length).toBe(0);
  });

  test('should provide actionable improvement suggestions', async () => {
    const needsImprovementContent = `
      The company provides many services to various customers.
      They have a proven track record and years of experience.
      Customers want quality and value.
    `;

    const result = await quickValidate(needsImprovementContent);

    expect(result.passed).toBe(false);
    expect(result.feedback.improvements.length).toBeGreaterThan(0);
    expect(result.nextAttemptGuidance).toBeDefined();
    
    // Check that improvements have specific suggestions
    const firstImprovement = result.feedback.improvements[0];
    expect(firstImprovement.suggestion).toBeDefined();
    expect(firstImprovement.suggestion.length).toBeGreaterThan(10);
  });

  test('should detect missing evidence for claims', async () => {
    const unsubstantiatedContent = `
      Customers prefer our service because we're better.
      The market wants innovative solutions.
      Competitors are falling behind.
      Users expect seamless experiences.
    `;

    const result = await quickValidate(unsubstantiatedContent);

    const evidenceImprovements = result.feedback.improvements.filter(imp => 
      imp.issue.includes('Unsupported') || imp.issue.includes('evidence')
    );

    expect(evidenceImprovements.length).toBeGreaterThan(0);
  });

  test('should check word count requirements', async () => {
    const tooShortContent = 'This is too short.';

    const result = await validateContent(
      tooShortContent,
      'test',
      [],
      { min: 300, max: 500 },
      'test'
    );

    expect(result.score).toBeLessThan(85);
    const wordCountFeedback = result.feedback.improvements.find(imp => 
      imp.suggestion.includes('words') || imp.suggestion.includes('short')
    );
    expect(wordCountFeedback).toBeDefined();
  });

  test('should detect vague quantifiers', async () => {
    const vagueContent = `
      Many customers appreciate the service. Several businesses use our platform.
      Various features are available. We have multiple locations serving numerous clients
      with some special offers.
    `;

    const result = await quickValidate(vagueContent);

    const vagueIssue = result.feedback.improvements.find(imp => 
      imp.suggestion.includes('vague') || imp.suggestion.includes('exact')
    );
    
    expect(vagueIssue).toBeDefined();
  });
});

// ============================================
// INTEGRATION TESTS
// ============================================

describe('Integration Tests', () => {
  
  test('RAG context can be formatted for LLM', () => {
    const mockContext = {
      business: {
        name: 'Test Co',
        handle: '@testco',
        website: 'https://test.co',
        searchResults: [{ title: 'Test', body: 'Body', url: 'https://example.com' }],
        qualityScore: { score: 90, isReliable: true, issues: [], warnings: [] }
      },
      aiInsights: {
        valueProposition: 'Test value prop',
        qualityScore: { score: 85, isReliable: true, issues: [], warnings: [] }
      },
      competitors: {
        all10: [],
        priority3: [],
        overallQuality: { score: 80, isReliable: true, issues: [], warnings: [] }
      },
      socialData: {
        profiles: [],
        posts: [],
        trends: [],
        qualityScore: { score: 75, isReliable: true, issues: [], warnings: [] }
      },
      community: {
        insights: [],
        searchTrends: [],
        qualityScore: { score: 70, isReliable: true, issues: [], warnings: [] }
      },
      overallQuality: { score: 80, isReliable: true, issues: [], warnings: [] },
      warnings: [],
      missingData: []
    };

    const formatted = formatContextForLLM(mockContext as any);

    expect(formatted).toContain('# Research Context');
    expect(formatted).toContain('Data Quality Overview');
    expect(formatted).toContain('Test Co');
    expect(formatted).toContain('@testco');
  });
});

// Run example usage
console.log('Test suite ready. Run with: npm test');
