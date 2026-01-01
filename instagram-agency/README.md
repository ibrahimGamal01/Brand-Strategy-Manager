# Instagram Agency AI Workflow

A Node.js/TypeScript application for automated Instagram content strategy generation using AI.

## Features

- 🔄 **Instagram Scraping** - Fetch posts from client and competitor accounts via Apify
- 🧠 **6-Step AI Pipeline** - Brand DNA → Competitor Intel → Trends → Briefs → QA → Calendar
- ⏱️ **Rate Limiting** - Configurable delay between OpenAI calls (default: 90s)
- 💾 **Caching** - 24-hour cache for scraped data
- 📄 **Multiple Outputs** - JSON + Markdown deliverables

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment (edit .env with your keys)
# OPENAI_API_KEY, APIFY_TOKEN

# Run the workflow
npm start
```

## Configuration

Edit `.env` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | Your OpenAI API key |
| `APIFY_TOKEN` | - | Your Apify API token |
| `RATE_LIMIT_MS` | 90000 | Delay between AI calls (ms) |
| `CACHE_HOURS` | 24 | Cache expiration time |
| `CLIENT_USERNAME` | ummahpreneur | Instagram account to analyze |

## Output

Results are saved to `./output/`:
- `deliverable-YYYY-MM-DD.json` - Complete data
- `briefs-YYYY-MM-DD.md` - Production briefs
- `calendar-YYYY-MM-DD.md` - Content calendar

## Project Structure

```
src/
├── index.ts           # Main entry point
├── config.ts          # Environment config
├── utils/             # Rate limiter, cache, logger
├── scrapers/          # Apify integration
├── ai/                # OpenAI client + prompts
└── output/            # Output formatters
```

## Expected Runtime

~12-15 minutes (6 AI calls × 90s waits + API response times)
