import express from 'express';
import { SocialScraperService } from '../services/scrapers/social-scraper';

const router = express.Router();
const scraperService = new SocialScraperService();

// POST /api/scrapers/:competitorId
router.post('/:competitorId', async (req, res) => {
  const { competitorId } = req.params;
  const { platform } = req.body; // 'INSTAGRAM' or 'TIKTOK'

  if (!platform || !['INSTAGRAM', 'TIKTOK'].includes(platform)) {
    return res.status(400).json({ error: 'Valid platform (INSTAGRAM, TIKTOK) is required' });
  }

  try {
    const result = await scraperService.scrapeCompetitor(competitorId, platform as 'INSTAGRAM' | 'TIKTOK');
    res.json(result);
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown scraping error' 
    });
  }
});

export default router;
