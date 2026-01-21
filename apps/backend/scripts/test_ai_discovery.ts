
import dotenv from 'dotenv';
import path from 'path';

// Load env from backend .env
const envPath = path.join(__dirname, '../.env');
console.log('Loading env from:', envPath);
dotenv.config({ path: envPath });

async function main() {
    console.log('Testing AI Competitor Discovery...');
    
    // Dynamic import to ensure env is loaded first
    const { suggestCompetitorsWithAI } = await import('../src/services/ai/competitor-discovery');
    
    // Use a mock brand info similar to what user might have
    const brandName = 'Islamic Finance Guru';
    const niche = 'Islamic Finance Education';
    const description = 'We help muslims grow their wealth in a halal way.';

    console.log(`Input: Brand=${brandName}, Niche=${niche}`);

    try {
        const results = await suggestCompetitorsWithAI(brandName, niche, description);
        console.log('--- Results ---');
        console.log(JSON.stringify(results, null, 2));
        console.log('--- End Results ---');
    } catch (error) {
        console.error('Error running service:', error);
    }
}

main();
