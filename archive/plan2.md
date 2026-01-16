# Instagram Scraping Strategy - 5-Service Rotation

## Overview
Rotate through 5 free-tier scraping services to achieve $0/month ongoing cost.

---

## 5 Services (Round-Robin Rotation)

| # | Service | Free Tier | API Endpoint |
|---|---------|-----------|--------------|
| 1 | **Apify** | $5/month credits | `api.apify.com/v2/acts/apify~instagram-scraper` |
| 2 | **Bright Data** | Trial credits | `api.brightdata.com/dca/trigger` |
| 3 | **SociaVault** | 50 credits (no expiry!) | `api.sociavault.com/instagram/user` |
| 4 | **Scrapeless** | Trial (no CC) | `api.scrapeless.com/task` |
| 5 | **ScrapingBot** | Limited requests | `api.scraping-bot.io/scrape` |

---

## Rotation Logic

```javascript
// Rotation Manager (Code Node)
const staticData = $getWorkflowStaticData('global');
const services = ['apify', 'brightdata', 'sociavault', 'scrapeless', 'scrapingbot'];

let lastIndex = staticData.lastServiceIndex ?? -1;
let currentIndex = (lastIndex + 1) % services.length;

staticData.lastServiceIndex = currentIndex;
return [{ json: { currentService: services[currentIndex] } }];
```

---

## Workflow Structure

```
Start → Input Config → Setup Competitors → Rotation Manager
                                              ↓
                        ┌─────────────────────┴─────────────────────┐
                        ↓                                           ↓
              Route: Client Scraper                     Route: Competitor Scraper
                        ↓                                           ↓
    ┌────┬────┬────┬────┬────┐              ┌────┬────┬────┬────┬────┐
    ↓    ↓    ↓    ↓    ↓                   ↓    ↓    ↓    ↓    ↓
  Apify BD  SV  SL  SB                    Apify BD  SV  SL  SB
    ↓    ↓    ↓    ↓    ↓                   ↓    ↓    ↓    ↓    ↓
    └────┴────┴────┴────┘                   └────┴────┴────┴────┘
              ↓                                       ↓
        Merge: Client                           Merge: Competitor
              ↓                                       ↓
        Process Client ────────────────────── Process Competitor
                              ↓
                      Merge Scraped Data
                              ↓
                      Save to Cache (Immediate)
                              ↓
                        AI Analysis...
```

---

## Environment Variables Required

```bash
APIFY_TOKEN=apify_api_...
BRIGHTDATA_TOKEN=...
SOCIAVAULT_TOKEN=...
SCRAPELESS_TOKEN=...
SCRAPINGBOT_USER=...
SCRAPINGBOT_PASS=...
OPENAI_API_KEY=sk-...
```

---

## Data Saving Strategy

**"Save As We Go"** - Data is saved to cache immediately after scraping, before AI analysis. This prevents data loss if the workflow fails during the AI steps.

```javascript
// Save to Cache (Immediate) Node
const staticData = $getWorkflowStaticData('global');
staticData.instagramCache = {
  timestamp: Date.now(),
  data: $input.first().json
};
```

---

## Files Updated

| File | Description |
|------|-------------|
| `Instagram Agency AI Workflow.json` | Main workflow with 5-service rotation |
| `workflow-steps/step-2-scrape-client.json` | Client scraping step docs |
| `workflow-steps/step-3-scrape-competitors.json` | Competitor scraping step docs |