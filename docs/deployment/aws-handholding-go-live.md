# AWS Hand-Holding Go-Live Runbook

This is a step-by-step guide to take this repo from zero to production, then scale toward 10k customers/month.

It is written to be used interactively: finish one checkpoint, verify it, then move to the next.

## 1. Scope and Deployment Target

We are deploying all app surfaces from this repo:

- `apps/backend` (API + websocket + schedulers + scraping + AI orchestration)
- `apps/client-portal` (client-facing app)
- `apps/frontend` (legacy compatibility app)

Recommended target stack:

- Backend + workers: AWS ECS
- Database: AWS RDS PostgreSQL
- Cache/locks/pubsub: AWS ElastiCache Redis
- File persistence: AWS EFS (phase 1) then S3 migration (phase 2)
- Frontends: Vercel first for speed, then optional move to AWS
- AI: OpenAI today, plus optional Qwen path (OpenRouter or self-hosted on AWS)

Why this target:

- Fastest path to production without rewriting your Next.js apps.
- Keeps hard scaling work focused on backend/data first (the real bottleneck).

## 2. Current Repo Facts You Must Respect

- Backend currently starts API + websocket + schedulers in one process: `apps/backend/src/index.ts`.
- Backend writes files to local `STORAGE_ROOT`, so container ephemeral storage is not enough.
- Strict runtime preflight currently requires a valid `OPENAI_API_KEY` in real mode (`AI_FALLBACK_MODE=off`), even if you route tasks to other providers.
- Existing production-oriented docs:
  - `README.md`
  - `SETUP.md`
  - `docs/deployment/railway.md`
  - `docs/deployment/r1-online-cutover.md`
  - `docs/SECRETS_AND_AI_MODE.md`

## 3. Day-by-Day Execution Plan (With Checkpoints)

## Day 0 - Proper AWS Account Foundation (Scale-Ready)

### Checklist

- Create account strategy first:
  - minimum: `management + production`
  - preferred: `management + production + staging`
- Enable root MFA and stop root daily usage.
- Enable IAM Identity Center and create an admin role.
- Enable CloudTrail, GuardDuty, Security Hub, and Config.
- Create budgets + anomaly detection + alert channels.
- Select primary region (`us-east-1`) and DR region.
- Review and request quota increases for ECS/ALB/RDS/ElastiCache/ECR.
- Create production VPC across 3 AZs with public/private subnets.
- Configure Route53 (or external DNS) and request ACM certs.
- Create least-privilege CI deploy role.
- Install/authenticate AWS CLI with non-root profile.

### Verify

- `aws sts get-caller-identity` returns admin role identity (not root).
- Budget and anomaly alert test notifications are received.
- Security services show `enabled` in the production account.
- Quota requests are submitted for expected 6-month demand.
- Domain and certificate status are ready for deployment.

### Output artifact

- `docs/deployment/day0-access.md` with account IDs, role names, and alert recipients.

## Day 1 - Local Production Parity Check

### Checklist

- Copy `.env.example` to `.env` and fill required keys.
- Install dependencies in repo root: `npm install`.
- Verify backend strict config:
  - `npm run check:runtime-config --workspace=apps/backend`
- Run reliability checks:
  - `npm run test:runtime-reliability-r1 --workspace=apps/backend`
  - `npm run test:runtime-no-summarizer --workspace=apps/backend`

### Verify

- Runtime config check passes with `fallbackMode=off` and valid keys.
- Reliability tests pass.

### Output artifact

- Save command logs in `docs/deployment/day1-validation.md`.

## Day 2 - Data Plane in AWS

### Checklist

- Create RDS PostgreSQL (Multi-AZ for production).
- Create ElastiCache Redis (single node to start, upgrade later).
- Create EFS filesystem and access point for backend storage path.
- Create Secrets Manager entries for:
  - `DATABASE_URL`
  - `OPENAI_API_KEY`
  - `APIFY_API_TOKEN`
  - `APIFY_MEDIA_DOWNLOADER_TOKEN`
  - `RUNTIME_WS_SIGNING_SECRET`

### Verify

- Test DB connection from your machine or bastion.
- Redis endpoint reachable from ECS VPC subnets.
- EFS mount target exists in each private subnet.

### Output artifact

- `docs/deployment/day2-data-plane.md` with endpoints (no secrets).

## Day 3 - Container Registry and Backend Deploy

### Checklist

- Create ECR repo for backend image.
- Build and push backend container:

```bash
docker build -f apps/backend/Dockerfile -t brand-backend:prod .
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker tag brand-backend:prod <account>.dkr.ecr.us-east-1.amazonaws.com/brand-backend:prod
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/brand-backend:prod
```

- Create ECS cluster/service with:
  - ALB health check: `/api/health`
  - EFS mount to `/app/apps/backend/storage`
  - Secrets from Secrets Manager
  - Desired count: 2 tasks

### Verify

- `GET /api/health` returns `status: ok` and `schemaReady: true`.
- Service remains healthy through one rolling restart.

### Output artifact

- `docs/deployment/day3-backend-live.md` with ALB URL and task definition revision.

## Day 4 - Database Migration and Smoke

### Checklist

- Run Prisma deploy migration in production task context:
  - `npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma`
- Run online smoke check:

```bash
R1_BASE_URL=https://<backend-host> \
R1_ADMIN_EMAIL=<admin-email> \
R1_ADMIN_PASSWORD=<admin-password> \
R1_WORKSPACE_ID=<workspace-id> \
npm run test:r1-online-smoke --workspace=apps/backend
```

### Verify

- Smoke test passes.
- No schema readiness errors in logs.

### Output artifact

- `docs/deployment/day4-smoke.md`.

## Day 5 - Frontend and Client Portal Live

### Checklist

- Deploy `apps/client-portal` on Vercel.
- Deploy `apps/frontend` on Vercel (legacy compatibility).
- Set both apps env var:
  - `NEXT_PUBLIC_API_ORIGIN=https://<backend-host>`

### Verify

- Both UIs load.
- Auth, research-job creation, and runtime chat work end-to-end.
- File/media URLs resolve via backend `/storage/*`.

### Output artifact

- `docs/deployment/day5-ui-live.md` with public URLs.

## Day 6-10 - Scale Architecture for 10k/Month

### Checklist

- Split backend runtime roles from one image:
  - `api`
  - `realtime`
  - `scheduler`
  - worker pools (`scrape`, `analysis`, `orchestration`)
- Introduce durable queues (SQS + DLQ) for all fire-and-forget flows.
- Replace in-memory locks/subscriber maps with Redis + persisted event cursor store.
- Add autoscaling:
  - API/realtime by CPU + request count
  - Workers by queue depth + oldest message age
- Add dashboards and alarms:
  - API p95 latency
  - 5xx rate
  - queue lag
  - DLQ depth
  - DB CPU/connections

### Verify

- No critical path relies on process-local memory for coordination.
- Queue lag stays under agreed threshold during load.
- API and websocket behavior remain stable across multi-instance deploys.

### Output artifact

- `docs/deployment/day10-scale-cutover.md`.

## 4. Production Env Contract (Minimum)

Backend required:

- `NODE_ENV=production`
- `AI_FALLBACK_MODE=off`
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `APIFY_API_TOKEN`
- `APIFY_MEDIA_DOWNLOADER_TOKEN`
- `RUNTIME_WS_SIGNING_SECRET`
- `PORTAL_INTAKE_EVENT_STORE_MODE=dual` (during rollout window, then `db`)
- `RUNTIME_EVIDENCE_LEDGER_ENABLED=true`
- `RUNTIME_CONTINUATION_CALLS_V2=true`
- `RUNTIME_LEDGER_BUILDER_ROLLOUT=25` (ramp to 100 after validation)

Frontend + portal required:

- `NEXT_PUBLIC_API_ORIGIN=https://<backend-host>`

## 5. Qwen Cost and Hosting Decision (Required Section)

## Option A (recommended first): Use Qwen via OpenRouter

No GPU operations needed. Fastest way to test lower cost models.

Env example:

- `AI_PROVIDER_DEFAULT=openrouter`
- `OPENROUTER_API_KEY=<key>`
- `AI_MODEL_DEFAULT_FAST=qwen/qwen3.5-flash-02-23`
- `AI_MODEL_DEFAULT_QUALITY=qwen/qwen3.5-35b-a3b`

Important:

- Keep valid `OPENAI_API_KEY` for current strict preflight and for features still tied to OpenAI-specific endpoints.

## Option B: Self-host Qwen in your AWS

Use when monthly token volume is high enough to justify fixed GPU cost and MLOps overhead.

Reference deployment shape:

- GPU service (vLLM OpenAI-compatible server) on ECS EC2 GPU or EKS.
- Internal NLB endpoint (private).
- Backend calls OpenAI-compatible endpoint through a dedicated provider adapter.

Code impact required in this repo:

- Extend `AiProvider` in `apps/backend/src/services/ai/model-config.ts`.
- Add OpenAI-compatible provider client path in `apps/backend/src/services/ai/openai-client.ts`.
- Add envs for custom base URL and key(s).
- Keep fallback chain and telemetry behavior unchanged.

## Cost Gate (when self-hosting is financially justified)

AWS us-east-1 on-demand GPU hourly prices (official AWS price API):

- `g6.xlarge`: `$0.8048/hr` (`~$587.50/mo`)
- `g5.xlarge`: `$1.006/hr` (`~$734.38/mo`)
- `g6e.xlarge`: `$1.861/hr` (`~$1358.53/mo`)

Token API list prices used for comparison:

- OpenAI `gpt-5-mini`: `$0.25/M input`, `$2.00/M output`
- OpenRouter `qwen/qwen2.5-coder-7b-instruct`: `$0.04/M input`, `$0.10/M output`
- OpenRouter `qwen/qwen3.5-flash`: `$0.10/M input`, `$0.40/M output`

Break-even formulas:

- `api_cost = (input_tokens/1_000_000 * input_price) + (output_tokens/1_000_000 * output_price)`
- `self_host_cost = (gpu_hourly * 730) + storage + data_transfer + ops_overhead`

Rule of thumb with 4:1 input/output ratio and `~$760/mo` all-in for one `g6.xlarge`:

- Break-even vs OpenAI `gpt-5-mini`: about `1.27B tokens/month`.
- Break-even vs OpenRouter Qwen 2.5 7B pricing: about `14.6B tokens/month`.

Inference:

- Self-hosted Qwen is usually cheaper than GPT-5 mini at high volume.
- Self-hosted Qwen is often not cheaper than already-low-cost hosted Qwen unless your volume is very high and GPU utilization is excellent.

## 6. Go-Live Acceptance Checklist

- `GET /api/health` stable with `schemaReady=true`.
- Portal signup and verification flow passes.
- Research job full run reaches `COMPLETE`.
- Media files persist across backend restarts.
- Runtime websocket reconnect works after deploy roll.
- Daily schedulers execute once (no duplicate runs).
- Alarm tests fire and recover.
- Rollback tested to previous backend image tag.

## 7. Operations Cadence After Launch

- Daily:
  - Check API error rate, queue lag, job failures.
- Weekly:
  - Check DB growth, slow queries, storage growth, AI spend by model.
- Monthly:
  - Recompute Qwen hosted vs self-hosted break-even with real token usage and current rates.

## 8. Sources for Price/Model Inputs

- AWS EC2 public pricing API (us-east-1): `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.json`
- OpenAI API pricing page: `https://openai.com/api/pricing/`
- OpenRouter model pricing pages:
  - `https://openrouter.ai/qwen/qwen2.5-coder-7b-instruct`
  - `https://openrouter.ai/qwen/qwen3.5-flash`
- Hugging Face Qwen model cards:
  - `https://huggingface.co/Qwen/Qwen2.5-7B-Instruct`
  - `https://huggingface.co/Qwen/Qwen2.5-32B-Instruct`
- vLLM OpenAI-compatible serving docs: `https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html`
