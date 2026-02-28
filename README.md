# Brand Strategy Manager

A fullstack application for managing brand strategies, competitor analysis, and content planning.

## Project Structure

```
brand-strategy-manager/
├── apps/
│   ├── client-portal/     # Client-facing Next.js portal (runtime chat UI)
│   ├── frontend/          # Legacy Next.js app (kept for compatibility)
│   └── backend/           # Node.js API + Prisma + runtime websocket server
│       ├── src/           # TypeScript source
│       ├── prisma/        # Database schema
│       └── scripts/       # Python automation scripts
├── archive/               # Old n8n workflow files
├── docs/                  # Strategy documentation
└── .env                   # Environment variables
```

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Python 3.10+ (for automation scripts)

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Setup database**
   ```bash
   cd apps/backend
   npx prisma db push
   npx prisma generate
   ```

4. **Run development servers**
   ```bash
   # From root
   npm run dev
   
   # Or separately
   npm run dev:client-portal  # http://localhost:3000
   npm run dev:backend   # http://localhost:3001
   # Legacy app (optional)
   npm run dev:frontend
   ```

## Environment Variables

Create a `.env` file in the root:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/brand_strategy_db"

# Backend
BACKEND_PORT=3001
PORTAL_INTAKE_EVENT_STORE_MODE=dual
PORTAL_INTAKE_DB_FALLBACK_WARNING_MS=60000
CHAT_TOOL_TIMEOUT_MS=45000
CHAT_TOTAL_TOOL_TIMEOUT_MS=180000
CHAT_MAX_TOOL_LOOP_ITERATIONS=6
CHAT_TOOL_MAX_RETRIES=2
RUNTIME_WS_SIGNING_SECRET=replace_with_long_random_secret
RUNTIME_EVIDENCE_LEDGER_ENABLED=true
RUNTIME_CONTINUATION_CALLS_V2=true
RUNTIME_LEDGER_BUILDER_ROLLOUT=25

# OpenAI (for AI analysis)
OPENAI_API_KEY=OPENAI_API_KEY_FROM_SECRET_MANAGER
```

## R1 Deployment Checks

```bash
# Reliability regression suite
npm run test:runtime-reliability-r1 --workspace=apps/backend

# Runtime guard: no summarizer stage references
npm run test:runtime-no-summarizer --workspace=apps/backend

# Online smoke test (deployed backend)
R1_BASE_URL=https://<backend-host> \
R1_ADMIN_EMAIL=<admin-email> \
R1_ADMIN_PASSWORD=<admin-password> \
R1_WORKSPACE_ID=<workspace-id> \
npm run test:r1-online-smoke --workspace=apps/backend
```

Cutover runbook: `docs/deployment/r1-online-cutover.md`

## Scraper Runtime Setup

The backend includes Python + Puppeteer runtime dependencies for supported connectors.

### Install Python dependencies:
```bash
cd apps/backend/scripts
pip3 install -r requirements.txt
```

### Test scrapers:
```bash
# Test Python scraper directly
python3 apps/backend/scripts/instagram_scraper.py ummahpreneur 10

# Test browser-backed scraper integration
./apps/backend/scripts/test-camoufox-smoke.sh
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/clients` | GET, POST | Manage clients |
| `/api/research-jobs` | GET, POST | Manage research jobs |

## Database Schema

See `apps/backend/prisma/schema.prisma` for the complete schema.

Key entities:
- **Client** - Business being strategized
- **ResearchJob** - Automated research pipeline
- **ClientAccount/ClientPost** - Client's social content
- **Competitor/RawPost/CleanedPost** - Competitor analysis
- **ContentPillar, Format, BuyerJourneyStage** - Strategy outputs
