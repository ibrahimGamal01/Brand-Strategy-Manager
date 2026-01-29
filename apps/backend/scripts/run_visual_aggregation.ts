
import { visualAggregationService } from '../src/services/analytics/visual-aggregation';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const researchJobId = args[0];

  if (!researchJobId) {
    console.error('Usage: ts-node run_visual_aggregation.ts <researchJobId>');
    console.log('Finding latest research job...');
    const latest = await prisma.researchJob.findFirst({
        orderBy: { startedAt: 'desc' },
        where: { socialProfiles: { some: { posts: { some: {} } } } } // Find one with data
    });
    if (latest) {
        console.log(`Using latest job: ${latest.id}`);
        await runTest(latest.id);
    } else {
        console.log('No suitable research job found.');
    }
    return;
  }

  await runTest(researchJobId);
}

async function runTest(jobId: string) {
    console.log(`Testing Visual Aggregation for Job: ${jobId}`);
    
    try {
        const results = await visualAggregationService.getTopPerformingAssets(jobId, 4);
        
        console.log('\n=== Top 4 Performing Assets ===');
        results.forEach((asset: any, i: number) => {
            console.log(`\n#${i + 1} [Score: ${asset.engagementScore.toFixed(0)}]`);
            console.log(`Platform: ${asset.platform} @${asset.handle}`);
            console.log(`Type: ${asset.type}`);
            console.log(`Metrics: ${asset.likes} likes, ${asset.views} views`);

            console.log(`URL: ${asset.postUrl}`);
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
