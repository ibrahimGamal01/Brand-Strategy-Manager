/**
 * Test Validator with Cost Protection
 * 
 * Run: npx ts-node src/services/ai/__tests__/test-validator.ts
 */

import { validateContent } from '../validation';
import { costTracker, COST_PROTECTION } from '../validation/cost-protection';

async function testValidator() {
  console.log('\n=== Testing Content Validator ===\n');
  
  console.log('Cost Protection Settings:');
  console.log(`  Mock Mode: ${COST_PROTECTION.mockMode ? '✓ ENABLED (no API costs)' : '✗ DISABLED (will use real API)'}`);
  console.log(`  Max Tokens: ${COST_PROTECTION.maxTokensPerCall}`);
  console.log(`  Monthly Budget: $${COST_PROTECTION.monthlyBudgetUSD}`);
  console.log(`  Current Spend: $${costTracker.getStats().estimatedCostUSD.toFixed(4)}\n`);

  // Test 1: Generic content (should fail)
  console.log('Test 1: Generic content (should fail)');
  const genericContent = `
    We are an industry-leading company providing cutting-edge solutions.
    Our world-class team delivers exceptional quality and seamless experiences.
    We have a proven track record and years of experience.
    Customers want the best, and we provide it.
  `;

  const result1 = await validateContent(
    genericContent,
    'test_generic',
    ['value_proposition', 'examples'],
    { min: 100, max: 500 },
    'mock context'
  );

  console.log(`  Score: ${result1.score}/100`);
  console.log(`  Passed: ${result1.passed ? '✓' : '✗'}`);
  console.log(`  Generic phrases: ${result1.feedback.genericPhrases.length}`);
  console.log(`  Improvements: ${result1.feedback.improvements.length}`);
  if (result1.feedback.improvements.length > 0) {
    console.log(`  First issue: ${result1.feedback.improvements[0].issue}`);
  }

  // Test 2: Specific content (should pass)
  console.log('\nTest 2: Specific content (should pass)');
  const specificContent = `
    Founded in 2018, the company completed 47 residential projects in Cairo with an average
    value of $850,000. Unlike competitors who post 3x/week (average 2,341 likes per post),
    they post daily but with engagement 40% lower.
    
    Based on analysis of 127 Google reviews, customers specifically mention "price transparency"
    in 68% of positive reviews. The Value Proposition includes a 95% accuracy guarantee between
    renders and delivered spaces, backed by only 2 material substitutions in 2023 versus the
    industry average of 12-15 per project.
    
    For example, competitor @CompetitorA has 12.8K followers and posts reels 65% of the time,
    while competitor @CompetitorB focuses on carousel posts (32.4K followers, 5.2% engagement).
  `;

  const result2 = await validateContent(
    specificContent,
    'test_specific',
    ['value_proposition', 'examples'],
    { min: 100, max: 500 },
    'mock context'
  );

  console.log(`  Score: ${result2.score}/100`);
  console.log(`  Passed: ${result2.passed ? '✓' : '✗'}`);
  console.log(`  Generic phrases: ${result2.feedback.genericPhrases.length}`);
  console.log(`  Strengths: ${result2.feedback.strengths.length}`);

  // Show cost summary
  const stats = costTracker.getStats();
  console.log('\n=== Cost Summary ===');
  console.log(`Total Tokens: ${stats.totalTokens.toLocaleString()}`);
  console.log(`Estimated Cost: $${stats.estimatedCostUSD.toFixed(4)}`);
  console.log(`Remaining Budget: $${stats.remainingBudget.toFixed(2)}`);
  
  if (COST_PROTECTION.mockMode) {
    console.log('\n✓ All tests ran in MOCK MODE - actual cost: $0.00');
  }

  console.log('\n=== Summary ===');
  console.log(result1.passed ? '✗ Test 1 should have failed' : '✓ Test 1 failed as expected');
  console.log(result2.score >= 70 ? '✓ Test 2 passed with good score' : '✗ Test 2 should have higher score');
}

// Run if called directly
if (require.main === module) {
  testValidator().catch(console.error);
}

export { testValidator };
