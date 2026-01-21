# Brand Strategy Manager

A fullstack application for managing brand strategies, competitor analysis, and content planning.

## Project Structure

```
brand-strategy-manager/
├── apps/
│   ├── frontend/          # Next.js React app
│   └── backend/           # Node.js API + Prisma
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
   npm run dev:frontend  # http://localhost:3000
   npm run dev:backend   # http://localhost:3001
   ```

## Environment Variables

Create a `.env` file in the root:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/brand_strategy_db"

# Backend
BACKEND_PORT=3001

# OpenAI (for AI analysis)
OPENAI_API_KEY=your_openai_key
```

## Instagram Scraper Setup

The system uses a multi-layer scraping strategy:
1. **Python (Instaloader)** - Primary, most reliable
2. **Puppeteer** - Fallback if Python fails

### Install Python dependencies:
```bash
cd apps/backend/scripts
pip3 install -r requirements.txt
```

### Test scraper:
```bash
# Test Python scraper directly
python3 apps/backend/scripts/instagram_scraper.py ummahpreneur 10

# Output will be JSON with profile + posts
```

### Optional: Tor for IP rotation
```bash
brew install tor
tor &  # Runs in background

# Use with scraper
python3 apps/backend/scripts/instagram_scraper.py ummahpreneur 10 "socks5h://127.0.0.1:9050"
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
