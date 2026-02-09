# Instagram GraphQL Scraper Setup

## Overview

The Instagram GraphQL scraper provides the fastest and most reliable data retrieval by querying Instagram's internal API directly. This is now the primary (Layer 0) scraping method.

## Session Cookie Setup

To use the GraphQL scraper, you need an Instagram session cookie:

### Method 1: Browser DevTools (Recommended)

1. **Open Instagram in your browser** and log in
2. **Open DevTools** (F12 or Cmd+Option+I)
3. **Go to Application tab** (Chrome) or **Storage tab** (Firefox)
4. **Find Cookies** → `https://www.instagram.com`
5. **Copy the `sessionid` cookie value**
6. **Add to your `.env` file**:
   ```bash
   INSTAGRAM_SESSION_COOKIE="sessionid=YOUR_SESSION_ID_HERE"
   ```

### Method 2: Full Cookie String

Alternatively, export the entire cookie string:

1. In DevTools → **Network** tab
2. **Refresh Instagram**
3. **Click any request** to instagram.com
4. **Find the `Cookie` header**
5. **Copy the entire cookie header value**
6. **Add to `.env`**:
   ```bash
   INSTAGRAM_SESSION_COOKIE="sessionid=...; ds_user_id=...; csrftoken=..."
   ```

## Cookie Lifespan

- Instagram session cookies typically last **90 days**
- If you see `401 Unauthorized` errors, refresh your cookie
- The scraper will automatically fall back to Python/Puppeteer if GraphQL fails

## Architecture

```
┌─────────────────────────────────────────┐
│   Instagram Scraping Pipeline           │
└─────────────────────────────────────────┘
             ↓
    ┌────────────────┐
    │ Layer 0: GraphQL│ ← Primary (fastest)
    │ ├─ Session auth │
    │ ├─ doc_id based │
    │ └─ Full metrics │
    └────────────────┘
             ↓ (fallback on error)
    ┌────────────────┐
    │ Layer 1: Python │ ← Secondary
    │ ├─ Instaloader  │
    │ ├─ Rate limited │
    │ └─ OASP support │
    └────────────────┘
             ↓ (fallback on rate limit)
    ┌────────────────┐
    │ Layer 2: DDG    │ ← Last Resort
    │ ├─ Site search  │
    │ ├─ Limited data │
    │ └─ No metrics   │
    └────────────────┘
```

## GraphQL Endpoints

Current `doc_id` values (extracted from Instaloader):

```typescript
POST_METADATA: '8845758582119845'
USER_PROFILE_LOGGED_IN: '7898261790222653'
USER_PROFILE_PUBLIC: '7950326061742207'
USER_TIMELINE: '7845543455542541'
```

**Note:** These IDs may change every 2-4 weeks. Monitor for `401` errors and update accordingly.

## Updating doc_ids

If GraphQL starts failing with structure errors:

1. **Check Instaloader updates**: `pip install --upgrade instaloader`
2. **Extract new IDs** from the package:
   ```bash
   grep -r "doc_id" $(python3 -c "import instaloader; print(instaloader.__file__.replace('__init__.py', ''))")
   ```
3. **Update** `apps/backend/src/services/scraper/instagram-graphql.ts`

## Testing

Test the GraphQL scraper directly:

```bash
cd apps/backend
INSTAGRAM_SESSION_COOKIE="sessionid=YOUR_ID" npx ts-node -e "
import { createGraphQLScraper } from './src/services/scraper/instagram-graphql';
const scraper = createGraphQLScraper();
scraper.scrapeFullProfile('natgeo', 5).then(console.log);
"
```

Expected output:
```json
{
  "success": true,
  "profile": {
    "handle": "natgeo",
    "follower_count": 283000000,
    "following_count": 200,
    "total_posts": 23000,
    ...
  },
  "posts": [...],
  "scraper_used": "graphql"
}
```

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` | Expired/invalid cookie | Refresh session cookie from browser |
| `429 Rate Limited` | Too many requests | Wait 15-30 minutes, will auto-fallback |
| `Structure changed` | Instagram UI update | Update `doc_id` values |
| `Profile not found` | Invalid username | Check handle spelling |

## Performance

- **GraphQL**: ~500ms for profile + 30 posts
- **Python**: ~10-30s (rate limited)
- **Puppeteer**: ~15-45s (slow parsing)

**Recommendation:** Always provide a valid session cookie for optimal performance.
