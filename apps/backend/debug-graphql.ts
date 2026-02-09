import { createGraphQLScraper } from './src/services/scraper/instagram-graphql';
import * as dotenv from 'dotenv';
dotenv.config();

async function debugGraphQL() {
  console.log('Testing GraphQL Scraper...');
  const scraper = createGraphQLScraper();
  
  try {
    console.log('Attempting to scrape profile: ummahpreneur');
    const result = await scraper.scrapeFullProfile('ummahpreneur', 5);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

debugGraphQL();
