# Qwen on AWS vs OpenAI API - Current App Status (2026-03-02)

This table is for the **current app status**, not the 10k target.

## Current status snapshot used

- Baseline file: `docs/baselines/current-user-baseline.json`
- Generated at: `2026-02-18T15:24:46.029Z`
- Clients: `2`
- Research jobs: `2`

## Cost basis used

- OpenAI current per-full-run estimate from repo:
  - `apps/backend/src/services/ai/BUSINESS-RUN-COST-TABLE.md`
  - `~$1.60` per complete run
- Current monthly OpenAI spend at baseline:
  - `2 runs * $1.60 = $3.20/month`

AWS unit prices (us-east-1):

- `g6.xlarge`: `$0.8048/hour`
- `g5.xlarge`: `$1.006/hour`
- `g6.12xlarge`: `$4.6016/hour`
- EBS gp3: `$0.08/GB-month`

Assumed fixed extras for self-host estimates:

- Qwen 7B profile:
  - gp3 storage `100GB` = `$8/month`
  - logs/ops overhead = `$10/month`
- Qwen 72B profile:
  - gp3 storage `300GB` = `$24/month`
  - logs/ops overhead = `$30/month`

## Table - Current Status Monthly Cost

| Option | Monthly estimate (USD) | Multiplier vs current OpenAI baseline (`$3.20`) | Notes |
|---|---:|---:|---|
| OpenAI API (current baseline usage) | `$3.20` | `1.0x` | From repo run-cost table (`~$1.60/run`, 2 runs) |
| Self-host Qwen 7B on `g6.xlarge` (24x7) | `$605.50` | `189.2x` | `730h * $0.8048 + $8 storage + $10 ops` |
| Self-host Qwen 7B on `g6.xlarge` (12h/day) | `$311.75` | `97.4x` | `365h * $0.8048 + $8 + $10` |
| Self-host Qwen 7B on `g6.xlarge` (4h/day) | `$114.58` | `35.8x` | `120h * $0.8048 + $8 + $10` |
| Self-host Qwen 7B on `g5.xlarge` (24x7) | `$752.38` | `235.1x` | `730h * $1.006 + $8 + $10` |
| Self-host Qwen 72B-ish (quantized) on `g6.12xlarge` (24x7) | `$3,413.17` | `1066.6x` | `730h * $4.6016 + $24 + $30` |

## Break-even heavy run count vs current OpenAI run cost (`$1.60/run`)

How many full runs/month are needed for each self-host setup to match OpenAI baseline per-run economics:

| Self-host setup | Break-even runs/month |
|---|---:|
| Qwen 7B `g6.xlarge` 24x7 | `378.4` |
| Qwen 7B `g6.xlarge` 12h/day | `194.8` |
| Qwen 7B `g6.xlarge` 4h/day | `71.6` |
| Qwen 7B `g5.xlarge` 24x7 | `470.2` |
| Qwen 72B-ish `g6.12xlarge` 24x7 | `2133.2` |

## Interpretation for current status

At the current baseline (`2 runs/month`), moving from OpenAI API to self-hosted Qwen on AWS is **much more expensive** in pure cost terms.

Self-host Qwen only starts to make financial sense when monthly run volume is much higher or when there are non-cost requirements (data residency constraints, strict vendor control, custom serving).

## Source links

- AWS pricing index: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json`
- AWS EC2 pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.json`
- Repo baseline JSON:
  - `docs/baselines/current-user-baseline.json`
- Repo per-run AI cost baseline:
  - `apps/backend/src/services/ai/BUSINESS-RUN-COST-TABLE.md`
