import { config } from './config';
import { logger } from './utils/logger';
import { Cache } from './utils/cache';
import { scrapeInstagramAccount, scrapeMultipleAccounts } from './scrapers/apify';
import { processClientData, processCompetitorData, combineData, ProcessedData } from './scrapers/processor';
import { runAIPipeline } from './ai/pipeline';
import { formatOutput, saveOutputs } from './output/formatter';

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     📸 Instagram Agency AI Workflow - Node.js Edition      ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Client: @${config.client.username.padEnd(48)}║`);
  console.log(`║  Competitors: ${config.competitors.length} accounts${' '.repeat(40)}║`);
  console.log(`║  Rate Limit: ${config.rateLimitMs / 1000}s between API calls${' '.repeat(28)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');

  const cache = new Cache(config.cacheHours);
  const startTime = Date.now();
  
  try {
    // Step 1: Check cache or scrape data
    let scrapedData: ProcessedData;
    const cachedData = cache.get<ProcessedData>('instagram_data');
    
    if (cachedData) {
      logger.info('Using cached Instagram data');
      scrapedData = cachedData;
    } else {
      logger.info('Scraping fresh Instagram data...');
      
      // Scrape client
      const clientRaw = await scrapeInstagramAccount(config.client.username, 12);
      const clientPosts = processClientData(clientRaw);
      
      // Scrape competitors
      const competitorRaw = await scrapeMultipleAccounts(config.competitors, 12);
      const competitorPosts = processCompetitorData(competitorRaw);
      
      // Combine and cache
      scrapedData = combineData(clientPosts, competitorPosts);
      cache.set('instagram_data', scrapedData);
    }
    
    logger.info(`Data ready: ${scrapedData.clientPosts.length} client posts, ${scrapedData.competitorPosts.length} competitor posts`);
    
    // Step 2: Run AI Pipeline
    const pipelineResult = await runAIPipeline(scrapedData);
    
    // Step 3: Format and save outputs
    const deliverable = formatOutput(pipelineResult, scrapedData, config.client.username);
    saveOutputs(deliverable);
    
    const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ WORKFLOW COMPLETE                    ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Total Time: ${elapsedMinutes} minutes${' '.repeat(42 - elapsedMinutes.length)}║`);
    console.log(`║  Quality Score: ${deliverable.executiveSummary.qualityScore}/10${' '.repeat(38)}║`);
    console.log('║  Outputs saved to: ./output/                               ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');
    
  } catch (error) {
    logger.error('Pipeline failed', error);
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);
