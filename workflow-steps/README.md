# Instagram Agency AI Workflow - Step Files (Updated)

This folder contains modular workflow steps. The main workflow has been updated for sequential scraping.

## Updated Workflow Structure

| Step | Description |
|------|-------------|
| 1. Input Config | Client + competitor accounts with API keys |
| 2. Scrape Client | @ummahpreneur → Save immediately |
| 3. Scrape Comp 1 | @_amrouz (TOP priority) → Save |
| 4. Scrape Comp 2 | @islam4everyone_ → Save |
| 5. Scrape Comp 3 | @thesunnahguy → Save |
| 6. Scrape Comp 4 | @taemann__ → Save |
| 7. AI Analysis | OpenAI GPT-4o brand & competitor analysis |
| 8. Production Briefs | 7 production-ready content briefs |
| 9. Content Calendar | Weekly posting schedule |
| 10. Final Export | All data in structured JSON |

## Key Features

✅ **Sequential Scraping**: Each account is scraped and saved before moving to the next  
✅ **Error Handling**: If any scrape fails, workflow continues with available data  
✅ **Hardcoded API Keys**: No n8n credentials needed (tokens in Input Config)  
✅ **Extractable Data**: Final output has separate sections for raw data and AI outputs

## API Keys (already in workflow)

- **Apify Token**: For Instagram scraping
- **OpenAI Key**: For AI analysis and content generation

## How to Use

1. Import `../Instagram Agency AI Workflow.json` into n8n
2. Click "Execute Workflow"
3. Wait for completion (may take 5-10 minutes due to API timeouts)
4. Check "Final Export" node for complete output

## Output Structure

```json
{
  "status": "COMPLETE",
  "rawData": {
    "client": { /* scraped posts */ },
    "competitors": [ /* array of competitor data */ ]
  },
  "aiOutputs": {
    "analysis": { /* brand DNA + competitor intel */ },
    "productionBriefs": { /* 7 content briefs */ },
    "contentCalendar": { /* weekly schedule */ }
  }
}
```

## Competitor List (Updated)

1. **@_amrouz** - TOP priority, premium aesthetic
2. **@islam4everyone_** - Strong educational content  
3. **@thesunnahguy** - Viral hooks, relatable style
4. **@taemann__** - Storytelling mastery

Note: The Reel URL (DSaICfjDFE8) was not included as it's a single post, not a profile.
