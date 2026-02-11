# Brand Strategy Manager - Setup & Testing Guide

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database running
- Python 3.13+ installed
- OpenAI API key

---

## Step 1: Database Setup

### Create PostgreSQL Database

```bash
# Using psql
createdb brand_strategy_db

# Or using GUI tool (pgAdmin, Postico, etc.)
```

### Configure Environment Variables

Create `.env` in the root directory:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/brand_strategy_db"

# Backend
BACKEND_PORT=3001
NODE_ENV=development

# OpenAI
OPENAI_API_KEY="OPENAI_API_KEY_FROM_SECRET_MANAGER"
```

### Initialize Database

```bash
cd apps/backend

# Push schema to database
npx prisma db push

# Generate Prisma client
npx prisma generate

# Verify tables created
npx prisma studio
# You should see all 18 tables
```

---

## Step 2: Install Dependencies

### Backend Dependencies

```bash
cd apps/backend
npm install
```

### Python Dependencies

```bash
cd apps/backend/scripts
pip3 install -r requirements.txt
```

**Verify Python packages:**
- instaloader
- beautifulsoup4
- requests
- openai

---

## Step 3: Test Backend

### Start Server

```bash
cd apps/backend
npm run dev
```

**Expected output:**
```
🚀 Backend server running on http://localhost:3001
📊 Health check: http://localhost:3001/api/health
📁 Storage: http://localhost:3001/storage/
```

### Test Health Endpoint

```bash
curl http://localhost:3001/api/health
```

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-16T...",
  "database": "connected"
}
```

### If OpenAI Key Is Ignored (Troubleshooting)

1. Stop backend fully and restart (do not rely on hot reload after env edits).
2. Verify shell does not keep stale exports:
   ```bash
   echo $OPENAI_API_KEY
   echo $AI_FALLBACK_MODE
   ```
3. Run runtime config check:
   ```bash
   npm run check:runtime-config --workspace=apps/backend
   ```
4. Local strict-mode expected output:
   - `fallbackMode=off`
   - `openAiKeyPresent=true`
   - `openAiFormatValid=true`
   - `preflightPass=true`

---

## Step 4: End-to-End Test

### Create Test Client

```bash
curl -X POST http://localhost:3001/api/clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Client",
    "handle": "ummahpreneur",
    "platform": "instagram"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "client": { "id": "...", "name": "Test Client" },
  "researchJob": { "id": "...", "status": "PENDING" },
  "message": "Research job started. Check status at /api/research-jobs/..."
}
```

### Monitor Job Progress

```bash
# Replace {jobId} with the ID from previous response
curl http://localhost:3001/api/research-jobs/{jobId}
```

**Watch the job progress through states:**
1. `PENDING`
2. `SCRAPING_CLIENT`
3. `DISCOVERING_COMPETITORS`
4. `COMPLETE`

**This will take 2-5 minutes depending on:**
- Instagram scraping speed
- Media download count
- AI processing time

---

## Step 5: Verify Results

### Check Database

```bash
cd apps/backend
npx prisma studio
```

**Verify these tables have data:**
- ✅ `Client` - 1 record
- ✅ `ClientAccount` - 1 record
- ✅ `ClientPost` - ~30 records
- ✅ `MediaAsset` - Multiple records
- ✅ `AiAnalysis` - Multiple records
- ✅ `DiscoveredCompetitor` - ~10 records
- ✅ `BrandMention` - Multiple records (if web search succeeded)
- ✅ `ResearchJob` - 1 record (status: COMPLETE)

### Check Media Files

```bash
ls -R apps/backend/storage/media/
```

**You should see:**
```
apps/backend/storage/media/client/{clientId}/{postId}/
├── {timestamp}_xxxxx.jpg
├── {timestamp}_yyyyy.jpg
└── ...
```

### Test Media Serving

```bash
# Get media for a post
curl http://localhost:3001/api/media/post/{postId}
```

### Test Analytics

```bash
# Get analytics for client
curl http://localhost:3001/api/analytics/client/{clientId}
```

**Expected response:**
```json
{
  "totalPosts": 30,
  "avgLikes": 1234,
  "avgComments": 56,
  "avgEngagement": 5.2,
  "formatDistribution": { "single_image": 15, "carousel": 10, "reel": 5 },
  "pillarDistribution": { "education": 12, "inspiration": 8, ... },
  "topPosts": [...]
}
```

---

## Step 6: Test All Endpoints

### Clients

```bash
# List all clients
GET http://localhost:3001/api/clients

# Create client (tested above)
POST http://localhost:3001/api/clients
```

### Research Jobs

```bash
# List all jobs
GET http://localhost:3001/api/research-jobs

# Get specific job
GET http://localhost:3001/api/research-jobs/{jobId}
```

### Media

```bash
# Get media for post
GET http://localhost:3001/api/media/post/{postId}

# Get single media asset
GET http://localhost:3001/api/media/{mediaId}

# Serve media file
GET http://localhost:3001/storage/media/client/{clientId}/{postId}/{filename}
```

### Competitors

```bash
# List competitors for client
GET http://localhost:3001/api/competitors/client/{clientId}

# Get competitor details
GET http://localhost:3001/api/competitors/{competitorId}

# Confirm discovered competitor
POST http://localhost:3001/api/competitors/discovered/{id}/confirm

# Get gap analysis
GET http://localhost:3001/api/competitors/{competitorId}/analysis
```

### Analytics

```bash
# Get client analytics
GET http://localhost:3001/api/analytics/client/{clientId}

# Get top posts
GET http://localhost:3001/api/analytics/client/{clientId}/top-posts?metric=likes&limit=10
```

---

## Troubleshooting

### Database Connection Errors

```
Error: Can't reach database server
```

**Fix:**
- Verify PostgreSQL is running
- Check `DATABASE_URL` in `.env`
- Test connection: `psql $DATABASE_URL`

### Python Script Errors

```
Error: python3: command not found
```

**Fix:**
- Install Python 3.13+
- Verify: `python3 --version`
- Add to PATH if needed

### Instagram Scraping Fails

```
Error: Instaloader rate limited
```

**Fix:**
- Wait a few minutes
- Use proxy (Tor)
- Reduce post limit from 30 to 10

### AI Analysis Errors

```
Error: OpenAI API key invalid
```

**Fix:**
- Verify `OPENAI_API_KEY` in `.env`
- Check API key at platform.openai.com
- Ensure API key has credits

### Media Download Fails

```
Error: ENOENT: no such file or directory
```

**Fix:**
- Verify storage folder exists: `mkdir -p apps/backend/storage/media`
- Check file permissions

---

## Next Steps

**After successful testing:**

1. ✅ Backend is complete and working
2. ✅ All 7 pipeline steps functional
3. ✅ All API endpoints tested
4. ✅ Database populated with real data

**Ready for Part 2: Frontend Implementation**

See: `part2_frontend_plan.md` for frontend development plan.

---

## API Documentation Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/clients` | GET | List clients |
| `/api/clients` | POST | Create client + start research |
| `/api/research-jobs` | GET | List all jobs |
| `/api/research-jobs/:id` | GET | Get job status |
| `/api/media/post/:postId` | GET | Get media for post |
| `/api/competitors/client/:clientId` | GET | List competitors |
| `/api/competitors/:id/analysis` | GET | Gap analysis |
| `/api/analytics/client/:clientId` | GET | Client analytics |
| `/storage/*` | GET | Serve media files |

---

**Backend Complete! 🎉**
