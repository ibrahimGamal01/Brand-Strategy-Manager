/**
 * Test Business Understanding Generator
 * 
 * Run: npx ts-node src/services/ai/generators/__tests__/test-generator.ts
 */

import { generateBusinessUnderstanding } from '../business-understanding';
import { PrismaClient } from '@prisma/client';
import { costTracker } from '../../validation/cost-protection';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function testGenerator() {
  console.log('\n=== Testing Business Understanding Generator ===\n');

  // Get a research job
  const job = await prisma.researchJob.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { startedAt: 'desc' }
  });

  if (!job) {
    console.log('❌ No completed research jobs found');
    console.log('Create and complete a research job first');
    return;
  }

  console.log(`Using Research Job: ${job.id}`);
  console.log(`Client: ${job.clientId}`);
  console.log(`Status: ${job.status}\n`);

  try {
    // Generate
    console.log('Starting generation...\n');
    const startTime = Date.now();
    
    const result = await generateBusinessUnderstanding(job.id);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n=== Generation Complete ===\n');
    console.log(`Duration: ${duration}s`);
    console.log(`Attempts: ${result.attempts}`);
    console.log(`Validation Score: ${result.validationScore}/100`);
    console.log(`Passed: ${result.passed ? '✓' : '✗'}`);
    console.log(`Cost: $${costTracker.getStats().estimatedCostUSD.toFixed(4)}`);

    if (result.warnings.length > 0) {
      console.log(`\nWarnings (${result.warnings.length}):`);
      result.warnings.slice(0, 3).forEach(w => console.log(`  - ${w}`));
    }

    // Save to file
    const outputDir = path.join(__dirname, '../../__output__');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `business-understanding-${job.id}.md`);
    fs.writeFileSync(outputPath, result.markdown);

    console.log(`\n✓ Markdown saved to: ${outputPath}`);
    console.log(`\nPreview (first 500 chars):`);
    console.log(result.markdown.substring(0, 500) + '...\n');

    // Show stats
    console.log('=== Summary ===');
    if (result.passed) {
      console.log('✓ Generator working correctly');
      console.log('✓ Content passed validation');
      console.log('✓ Ready for production use');
    } else {
      console.log('⚠️  Content needs manual review');
      console.log(`   Score: ${result.validationScore}/100 (need >= 85)`);
    }

  } catch (error) {
    console.error('\n✗ Generation Failed');
    console.error('Error:', error instanceof Error ? error.message : 'Unknown');
    if (error instanceof Error && error.stack) {
      console.error('\nStack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run test
if (require.main === module) {
  testGenerator().catch(console.error);
}

export { testGenerator };
