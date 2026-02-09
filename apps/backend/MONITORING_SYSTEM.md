# TikTok Competitor Discovery & Daily Monitoring System

## Overview
This document provides instructions for testing and running the newly implemented daily monitoring system for TikTok and Instagram competitor discovery.

## Features Implemented

### 1. Multi-Platform Competitor Discovery
- ✅ AI suggestions now discover **both** Instagram AND TikTok competitors
- ✅ DuckDuckGo search supports TikTok profile discovery
- ✅ Competitor validation works for both platforms

### 2. Background Scraping
- ✅ After discovery, competitors are automatically scraped in background
- ✅ Handles both Instagram and TikTok profiles
- ✅ Downloads posts with full metadata

### 3. Daily Monitoring System
- ✅ Scheduler runs automatically at 2 AM UTC daily
- ✅ Monitors all active clients and their top 10 competitors
- ✅ Scrapes fresh Instagram + TikTok posts daily
- ✅ Logs results to `monitoring_logs` table

### 4. RAG Integration
- ✅ Competitor context includes TikTok profiles and posts
- ✅ Both Instagram and TikTok data available for strategy generation
- ✅ Platform-specific metrics tracked correctly

## Database Migration Required

**IMPORTANT:** Before running the system, you need to apply the database migration:

```bash
cd apps/backend
npx prisma migrate dev --name add_monitoring_logs
```

This creates the `monitoring_logs` table for tracking daily monitoring runs.

## API Endpoints

### Manual Monitoring

```bash
# Monitor a specific client
POST /api/monitoring/run/:clientId

# Monitor all active clients (runs immediately)
POST /api/monitoring/run-all

# Get monitoring status
GET /api/monitoring/status
```

### Scheduler Control

```bash
# Start the scheduler
POST /api/monitoring/scheduler/start
Body: {
  "cronExpression": "0 2 * * *",  // 2 AM daily
  "timezone": "UTC"
}

# Stop the scheduler
POST /api/monitoring/scheduler/stop
```

## Testing the System

### 1. Test TikTok Competitor Discovery

Create a new research job and check logs for:
- `[Competitors] Running AI Multi-Platform Discovery`
- `[Competitors] Received X multi-platform suggestions`

Expected: You should see both Instagram AND TikTok competitors discovered.

### 2. Test Background Scraping

After competitors are discovered, check logs for:
- `[SocialScraper] Starting safe scrape: tiktok @handle`
- `[TikTok] Scraped X videos for @handle`

Expected: TikTok profiles are scraped with posts saved to database.

### 3. Test Daily Monitoring

Run manual monitoring:

```bash
curl -X POST http://localhost:3001/api/monitoring/run-all
```

Check logs for:
- `[Monitoring] Starting monitoring for all active clients`
- `[Monitoring] Scraping client tiktok: @handle`
- `[Monitoring] Scraping competitor tiktok: @handle`

Expected: All client and competitor profiles updated with latest posts.

### 4. Test RAG Integration

Query the RAG system and check logs for:
- `[Competitor Context] Found X discovered competitors`
- `[Competitor Context] Platform breakdown: Instagram=X, TikTok=Y`

Expected: TikTok competitor data appears in RAG responses.

## Monitoring Schedule

The scheduler automatically runs daily at **2:00 AM UTC** by default. It:

1. Queries all active clients
2. For each client:
   - Scrapes client's Instagram profile
   - Scrapes client's TikTok profile
   - Scrapes top 10 competitors (Instagram + TikTok)
3. Saves monitoring logs to database
4. Continues even if individual scrapes fail

## Performance Expectations

- **Per client:** ~22 scraping operations (2 client profiles + 20 competitor profiles)
- **Processing time:** ~44 seconds per client (2 second delay between scrapes)
- **With 10 clients:** ~7.3 minutes total daily processing
- **All runs in background:** Non-blocking, asynchronous

## Troubleshooting

### TikTok competitors not discovered
- Check that `suggestCompetitorsMultiPlatform` is being called (not the old Instagram-only method)
- Verify AI suggestions include both platforms in response

### TikTok profiles not scraped
- Ensure `tiktok_scraper.py` is executable and yt-dlp is installed
- Check Python dependencies: `pip install yt-dlp requests`

### Monitoring not running daily
- Verify scheduler started: Check for `📅 Monitoring scheduler started` in logs
- Check scheduler status: `GET /api/monitoring/status`
- Ensure server stays running (use PM2 or similar for production)

### Database migration fails
- Ensure PostgreSQL is running: `docker-compose up -d` or start manually
- Check DATABASE_URL in `.env` file
- Run migration manually: `npx prisma migrate dev`

## Next Steps

1. **Run the database migration** (see above)
2. **Test the monitoring system** with manual trigger
3. **Create a research job** to verify TikTok competitor discovery
4. **Monitor the logs** at 2 AM UTC to confirm scheduled monitoring works
5. **Check monitoring logs** table for results: `SELECT * FROM monitoring_logs ORDER BY last_monitored_at DESC;`
