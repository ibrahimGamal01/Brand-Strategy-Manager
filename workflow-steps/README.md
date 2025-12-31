# Instagram Agency AI Workflow - Step Files

This folder contains modular workflow steps that you can review and modify individually. Each file represents a phase of the workflow.

## Files

| File | Description |
|------|-------------|
| `step-1-input-config.json` | Input configuration with client + competitor accounts |
| `step-2-scrape-client.json` | Apify scraper for @ummahpreneur posts |
| `step-3-scrape-competitors.json` | Apify scraper for all 7 competitor accounts |
| `step-4-analyze-client.json` | OpenAI GPT-4o client brand analysis |
| `step-5-analyze-competitors.json` | OpenAI GPT-4o competitive intelligence |
| `step-6-production-briefs.json` | Production brief generator (videos, carousels, images) |
| `step-7-content-calendar.json` | Final content calendar with posting schedule |

## How to Use

1. **Review each step** - Open each file to see the node configuration
2. **Modify prompts** - Edit the OpenAI system/user prompts as needed
3. **Import main workflow** - Use `../Instagram Agency AI Workflow.json` to import the complete workflow into n8n

## Credentials Required

Before running the workflow in n8n, configure:

- **Apify API Token**: Already included in workflow URLs
- **OpenAI API Key**: Already included in Authorization headers

## Output

The workflow produces:
- 7 production-ready content briefs
- Weekly content calendar
- Client brand analysis
- Competitor intelligence report
