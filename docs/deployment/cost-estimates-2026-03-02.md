# Cost Estimates - AWS vs Railway vs Hybrid (as of 2026-03-02)

This document estimates monthly costs for running the full app at a target of **10,000 customers/month**.

It includes:

- infrastructure-only costs,
- AI/model costs,
- combined totals,
- decision thresholds.

All numbers are estimates, not invoices. Treat them as planning ranges.

## 1) What this model assumes

## Workload assumptions (inference)

- Total customers/month: `10,000`
- Mix: `80% heavy` and `20% light`
- Heavy workflows are scrape + analysis + generation heavy (based on current code and baseline docs).

## Infrastructure shape assumptions (inference)

- Backend has separate API/worker/realtime roles for scaled production.
- Database is PostgreSQL with HA in AWS model.
- Cache/lock/event fanout uses Redis in scaled model.
- Frontends are both deployed (`apps/client-portal`, `apps/frontend`).

## Notes from this repo (facts)

- Current backend process still co-locates API + websockets + schedulers in one runtime.
- Both Next apps currently rewrite `/api/*` through `NEXT_PUBLIC_API_ORIGIN`, which can materially affect CDN transfer costs.
- Internal baseline is very small (2 clients / 2 jobs), so scale projections are inferred.

## 2) Unit prices used

## AWS (us-east-1) unit prices from AWS Price List API

- Fargate Linux vCPU-hour: `$0.04048`
- Fargate Linux GB-hour: `$0.004445`
- ALB hour: `$0.0225`
- ALB LCU-hour: `$0.008`
- RDS PostgreSQL `db.r6g.large` Multi-AZ hour: `$0.45`
- ElastiCache Redis `cache.r7g.large` hour: `$0.219`
- EFS Standard storage: `$0.30 / GB-month`
- NAT Gateway: `$0.045 / hour` and `$0.045 / GB processed`
- SQS Standard Tier1: `$0.40 / million requests`
- CloudFront US data transfer out (first 10 TB): `$0.085 / GB`
- CloudFront HTTP requests: `$0.0075 / 10,000 requests` (=`$0.75 / 1M`)

## Railway pricing docs

- CPU: `$20 / vCPU / month`
- RAM: `$10 / GB / month`
- Network egress: `$0.05 / GB`
- Volume storage: `$0.15 / GB / month`
- Pro plan: `$20 / month` (usage-based billing model)

## Vercel pricing docs

- Pro developer seat: `$20 / user / month`
- Pro includes `$20` usage credit per developer seat
- Pro includes `1 TB` Fast Data Transfer / billing cycle
- Pro includes `10M` Edge Requests / billing cycle
- Fast Data Transfer overage range: `$0.15 - $0.35 / GB`
- Edge Requests overage range: `$2.00 - $3.20 / 1M requests`
- Fluid compute (Pro starting rates):
  - Active CPU: `$0.128 / hour`
  - Provisioned memory: `$0.0106 / GB-hour`
  - Invocations: `$0.60 / 1M`

## Model API prices from OpenRouter model catalog API

- `openai/gpt-5-mini`: input `$0.25 / 1M`, output `$2.00 / 1M`
- `qwen/qwen2.5-coder-7b-instruct`: input `$0.03 / 1M`, output `$0.09 / 1M`
- `qwen/qwen-2.5-72b-instruct`: input `$0.12 / 1M`, output `$0.39 / 1M`
- `qwen/qwen3-235b-a22b`: input `$0.455 / 1M`, output `$1.82 / 1M`

## 3) Infrastructure scenarios and totals

## Scenario definitions (inference)

- `Low`: early production with modest concurrency.
- `Base`: expected 10k/month steady state.
- `High`: bursty heavy usage and larger worker fleet.

## AWS all-in (both frontends + backend + workers + HA data plane)

### Low (`$1,103/mo`)

- Compute (ECS/Fargate all services): `$306`
- Data plane (RDS+Redis): `$488`
- CDN + request transfer: `$143`
- NAT: `$60`
- Observability/logging allowance: `$40`
- Other core (ALB, EFS, SQS): included in total

### Base (`$2,041/mo`)

- Compute: `$721`
- Data plane: `$488`
- CDN + request transfer: `$400`
- NAT: `$156`
- Observability/logging allowance: `$120`
- Other core (ALB, EFS, SQS): included in total

### High (`$5,029/mo`)

- Compute: `$2,090`
- Data plane: `$977`
- CDN + request transfer: `$1,038`
- NAT: `$336`
- Observability/logging allowance: `$250`
- Other core (ALB, EFS, SQS): included in total

## Railway all-in (backend + workers + both frontends + DB/Redis on Railway resources)

### Low (`$528/mo`)

- CPU+RAM: dominant
- Egress + volumes: included in total

### Base (`$1,250/mo`)

- CPU+RAM: dominant
- Egress + volumes: included in total

### High (`$3,320/mo`)

- CPU+RAM: dominant
- Egress + volumes: included in total

## Important caveat

This Railway model is cost-efficient, but it is not automatically equivalent to AWS Multi-AZ fault domains, IAM governance depth, or network controls. Cost is lower partly because reliability/governance assumptions are lighter.

## Hybrid (Railway backend + Vercel frontends)

Base backend on Railway without frontend compute is estimated around: **`$1,170/mo`**.

Frontend cost depends heavily on traffic path:

- `Hybrid (naive, keep heavy API/media proxy through Vercel rewrites)`: **`~$1,887 - $2,565/mo`**
- `Hybrid (optimized, direct API domain + keep Vercel mostly for frontend delivery)`: **`~$1,210 - $1,350/mo`**

The spread is mostly Vercel overage exposure (Fast Data Transfer + Edge Requests).

## 4) AI spend scenarios (10k customers/month, 80/20 mix)

## A) Run-based from this repo baseline

From `BUSINESS-RUN-COST-TABLE.md`:

- heavy full run: `~$1.60`
- mini-optimized light run example: `~$0.15`

Estimated monthly AI spend:

- `8,000 heavy * $1.60 + 2,000 light * $0.15 = ~$13,100/mo`

## B) Token-based scenario model (inference)

### Base token profile used

- Heavy customer: `1.0M input + 0.25M output / month`
- Light customer: `25%` of heavy profile

Totals for 10k/month mix:

- Input: `8,500M`
- Output: `2,125M`

Estimated monthly model spend:

- `openai/gpt-5-mini`: **`~$6,375/mo`**
- `qwen/qwen2.5-coder-7b-instruct`: **`~$446/mo`**
- `qwen/qwen-2.5-72b-instruct`: **`~$1,849/mo`**
- `qwen/qwen3-235b-a22b`: **`~$7,735/mo`**

## 5) Qwen on your own AWS vs hosted Qwen

## GPU monthly reference (us-east-1 on-demand)

- `g6.xlarge`: `$0.8048/hr` => `~$587.50/mo`
- `g5.xlarge`: `$1.006/hr` => `~$734.38/mo`
- `g6e.xlarge`: `$1.861/hr` => `~$1,358.53/mo`

## Practical all-in self-host envelopes (inference)

- Qwen 7B single-node production (1 GPU + storage + ops overhead): `~$760/mo`
- Qwen 7B HA (2 nodes): `~$1,520/mo`

## Break-even guidance

- Against `qwen2.5-coder-7b` hosted API (`~$446/mo` in base token scenario):
  - single-node self-host is usually **more expensive** at current scale.
  - break-even is above this base usage (roughly around mid/high scenario usage).
- Against `gpt-5-mini` API (`~$6,375/mo` in base token scenario):
  - self-hosted 7B can be dramatically cheaper, but quality/capability tradeoff is significant.

## 6) Combined monthly totals (base scenario)

These are **infra + AI** combinations:

- AWS all-in + `gpt-5-mini`: `~$8,416/mo`
- AWS all-in + Qwen 72B API: `~$3,890/mo`
- AWS all-in + Qwen 7B API: `~$2,487/mo`
- Railway all-in + `gpt-5-mini`: `~$7,625/mo`
- Railway all-in + Qwen 72B API: `~$3,099/mo`
- Railway all-in + Qwen 7B API: `~$1,696/mo`
- Hybrid optimized (`~$1,280` midpoint infra) + Qwen 72B API: `~$3,129/mo`

## 7) Recommendation from these numbers

## If your priority is fastest production launch with cost control

- Launch with `Railway backend + Vercel frontend` or `Railway all-in` first.
- Use hosted Qwen (72B or 7B depending quality bar) before self-hosting.
- Avoid expensive proxy patterns through Vercel where possible.

## If your priority is governance, controlled scaling, and future self-hosted AI

- Choose AWS for backend/data plane.
- Keep frontends on Vercel initially if team velocity matters.
- Move to full AWS only when operations/process maturity is ready.

## If your priority is lowest possible AI bill

- Biggest lever is model/provider routing, not infrastructure vendor.
- Move expensive tasks off premium models first.

## 8) Confidence and uncertainty

- High confidence:
  - Unit prices quoted above from official APIs/docs.
- Medium confidence:
  - Resource sizing assumptions per scenario.
- Lower confidence:
  - Exact request/egress and token usage until production telemetry is collected.

Expect real invoices to vary by at least `±20%` until one month of real production metrics is available.

## 9) Source links

- AWS price list index: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json`
- AWS AmazonECS pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-1/index.json`
- AWS AWSELB pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/us-east-1/index.json`
- AWS AmazonRDS pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json`
- AWS AmazonElastiCache pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/us-east-1/index.json`
- AWS AmazonEFS pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEFS/current/us-east-1/index.json`
- AWS AmazonEC2 pricing JSON (NAT): `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.json`
- AWS AmazonCloudFront pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json`
- AWS AWSQueueService pricing JSON: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/us-east-1/index.json`
- Railway pricing docs: `https://docs.railway.com/pricing`
- Vercel pricing machine-readable page: `https://vercel.com/pricing.md`
- Vercel regional pricing docs: `https://vercel.com/docs/pricing/regional-pricing`
- Vercel function usage/pricing docs: `https://vercel.com/docs/functions/usage-and-pricing`
- OpenRouter models API: `https://openrouter.ai/api/v1/models`
- Internal repo run-cost baseline:
  - `apps/backend/src/services/ai/BUSINESS-RUN-COST-TABLE.md`
