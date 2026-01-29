# Social Media Scraper Testing Guide

## Overview

Two free scraping options have been prepared for testing:
1. **Instagram Scraper** (Instaloader - Python)
2. **TikTok Scraper** (tiktok-scraper - Node.js)

Both have detailed playground test files with comprehensive logging.

---

## Instagram Scraper (Instaloader)

### Installation

```bash
# Install Python package
pip3 install instaloader

# Verify installation
python3 -c "import instaloader; print('✓ Instaloader installed')"
```

### Test the Scraper

```bash
cd apps/backend

# Test with a public Instagram account
python3 playground-instagram.py designstudiocairo 10

# Or try other accounts
python3 playground-instagram.py natgeo 5
python3 playground-instagram.py nike 15
```

### What It Tests

✅ **Profile Data**:
- Username, full name, bio
- Followers, following count
- Total posts
- Verification status
- Business account detection
- Privacy check

✅ **Post Data** (per post):
- Post type (CAROUSEL, REEL, SINGLE)
- Caption (full text)
- Likes count
- Comments count
- Engagement rate (calculated)
- Date posted
- Hashtags
- Mentions
- Location (if available)
- Video duration (for reels)

✅ **Statistics**:
- Average likes/comments
- Average engagement rate
- Post type breakdown (% reels vs carousels vs singles)
- Top 3 performing posts
- Scraping speed

✅ **Output**:
- Saves JSON file: `instagram_<username>_<timestamp>.json`
- Detailed terminal logging
- Error handling with clear messages

### Expected Output

```
============================================================
  INSTAGRAM SCRAPER TEST: @designstudiocairo
============================================================

--- Initializing Instaloader ---
✓ Instaloader initialized
  Target: @designstudiocairo
  Max posts: 10

--- Fetching Profile Data ---
✓ Profile loaded in 1.23s

--- Profile Information ---
  username: designstudiocairo
  full_name: Design Studio Cairo
  biography: Transforming spaces into experiences | Cairo...
  followers: 12847
  following: 324
  total_posts: 456
  is_verified: False
  is_private: False
  is_business: True

--- Scraping Posts (Max: 10) ---

Fetching posts...

  Post 1/10
    ✓ Type: Carousel (5 slides)
    ✓ Likes: 1,247
    ✓ Comments: 89
    ✓ Engagement: 10.4%
    ✓ Date: 2024-01-15
    ✓ Caption: Modern villa in Katameya Heights - 380...

  Post 2/10
    ✓ Type: Reel (15s)
    ✓ Likes: 892
    ✓ Comments: 45
    ✓ Engagement: 7.3%
    ...

--- Scraping Summary ---
  ✓ Total posts scraped: 10
  ✓ Total time: 8.45s
  ✓ Average time per post: 0.85s

  Post Types:
    CAROUSEL: 6 (60.0%)
    REEL: 3 (30.0%)
    SINGLE: 1 (10.0%)

  Engagement Averages:
    Likes: 1,023
    Comments: 67
    Engagement Rate: 8.5%

  Top 3 Posts by Engagement:
    1. 10.4% - CAROUSEL - 1,247 likes
    2. 9.8% - REEL - 1,156 likes
    3. 8.9% - CAROUSEL - 1,089 likes

--- Output ---
  ✓ Data saved to: instagram_designstudiocairo_20240126_045523.json

============================================================
  TEST COMPLETE
============================================================
✓ SUCCESS - Data scraped and saved to JSON
```

### Common Errors & Solutions

**Error**: "Profile is PRIVATE"
- Solution: Account is private, you need to login and follow them first

**Error**: "Connection error"
- Solution: Instagram is rate-limiting. Wait 1 hour and try again, or use login

**Error**: "Profile does not exist"
- Solution: Username is wrong or account deleted

### Advanced: Using with Login (Bypass Rate Limits)

```python
# Edit playground-instagram.py, uncomment these lines:
L.login("your_instagram_username", "your_password")
```

With login you can:
- Access private accounts you follow
- Scrape 500+ profiles/day without rate limits
- Get saves count (not available without login)

---

## TikTok Scraper

### Installation

```bash
cd apps/backend

# Install package
npm install tiktok-scraper

# Install TypeScript runner (if not already installed)
npm install -D tsx
```

### Test the Scraper

```bash
# Test with a public TikTok account
npx tsx playground-tiktok.ts therock 10

# Or try other accounts
npx tsx playground-tiktok.ts khaby.lame 5
npx tsx playground-tiktok.ts charlidamelio 15
```

### What It Tests

✅ **Profile Data**:
- Username, nickname
- Followers, following count
- Total videos
- Total hearts (likes across all videos)
- Verification status
- Bio/signature

✅ **Post Data** (per post):
- Video ID
- Description/caption
- Likes (diggs)
- Comments count
- Shares count
- Plays/views count
- Engagement rate (calculated)
- Date posted
- Hashtags
- Mentions
- Video duration
- Music/audio used

✅ **Statistics**:
- Average likes/comments/shares/plays
- Average engagement rate
- Top 3 performing videos
- Scraping speed

✅ **Output**:
- Saves JSON file: `tiktok_<username>_<timestamp>.json`
- Detailed terminal logging
- Error handling

### Expected Output

```
============================================================
  TIKTOK SCRAPER TEST: @therock
============================================================

--- Initializing TikTok Scraper ---
✓ Scraper initialized
  Target: @therock
  Max posts: 10

--- Fetching Profile & Posts ---
✓ Data fetched in 12.34s

--- Profile Information ---
  username: therock
  nickname: Dwayne Johnson
  followers: 73500000
  following: 138
  total_videos: 2847
  hearts: 642000000
  verified: true
  signature: CEO of Tequila. Gym enthusiast...

--- Processing Posts (10) ---

  Post 1/10
    ✓ Likes: 2,456,789
    ✓ Comments: 12,345
    ✓ Shares: 45,678
    ✓ Plays: 18,900,000
    ✓ Engagement: 3.41%
    ✓ Duration: 23s
    ✓ Description: Training day! Let's get it 💪...
    ✓ Hashtags: #gym, #motivation, #fitness

  Post 2/10
    ...

--- Scraping Summary ---
  ✓ Total posts scraped: 10
  ✓ Total time: 12.34s
  ✓ Average time per post: 1.23s

  Engagement Averages:
    Likes: 1,890,234
    Comments: 8,901
    Shares: 34,567
    Plays: 12,345,678
    Engagement Rate: 2.87%

  Top 3 Posts by Engagement:
    1. 3.41% - 2,456,789 likes - 18,900,000 plays
    2. 3.12% - 2,123,456 likes - 16,700,000 plays
    3. 2.98% - 2,089,123 likes - 15,200,000 plays

--- Output ---
  ✓ Data saved to: tiktok_therock_2024-01-26T04-55-23.json

============================================================
  TEST COMPLETE
============================================================
✓ SUCCESS - Data scraped and saved to JSON
```

### Common Errors & Solutions

**Error**: "User not found"
- Solution: Username incorrect or account deleted/banned

**Error**: "Rate limit"
- Solution: TikTok is blocking requests. Wait 1-2 hours or use proxy

**Error**: "Captcha required"
- Solution: TikTok detected scraping. Options:
  - Use residential proxy
  - Add session cookies from logged-in browser
  - Wait 24 hours and try again

---

## Comparison: Instagram vs TikTok

| Feature | Instagram (Instaloader) | TikTok (tiktok-scraper) |
|---------|------------------------|------------------------|
| **Reliability** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐ Good (blocks common) |
| **Speed** | ~0.8s per post | ~1.2s per post |
| **Data Quality** | Complete | Complete |
| **Rate Limits** | 50 profiles/day (no login)<br>500+/day (with login) | 20 profiles/day<br>Can get blocked |
| **Maintenance** | Active (7K+ stars) | Active (2K+ stars) |
| **Breaking Risk** | Low | Medium-High |
| **Login Required** | No (optional for more) | No |
| **Private Accounts** | Yes (if you follow them) | No |

---

## JSON Output Format

### Instagram Output

```json
{
  "success": true,
  "scraped_at": "2024-01-26T04:55:23.123Z",
  "profile": {
    "username": "designstudiocairo",
    "full_name": "Design Studio Cairo",
    "biography": "...",
    "followers": 12847,
    "following": 324,
    "total_posts": 456
  },
  "posts": [
    {
      "shortcode": "ABC123",
      "url": "https://instagram.com/p/ABC123",
      "type": "CAROUSEL",
      "caption": "Modern villa design...",
      "likes": 1247,
      "comments": 89,
      "engagement_rate": 10.4,
      "date": "2024-01-15T12:34:56Z",
      "hashtags": ["#interiordesign", "#cairo"],
      "mentions": ["@clientname"]
    }
  ],
  "stats": {
    "total_posts": 10,
    "scraping_time": 8.45,
    "avg_likes": 1023,
    "avg_engagement_rate": 8.5
  }
}
```

### TikTok Output

```json
{
  "success": true,
  "profile": {
    "username": "therock",
    "nickname": "Dwayne Johnson",
    "followers": 73500000
  },
  "posts": [
    {
      "id": "7123456789",
      "url": "https://tiktok.com/@therock/video/7123456789",
      "description": "Training day...",
      "likes": 2456789,
      "comments": 12345,
      "shares": 45678,
      "plays": 18900000,
      "engagement_rate": 3.41,
      "hashtags": ["#gym", "#motivation"]
    }
  ],
  "stats": {
    "avg_plays": 12345678,
    "avg_engagement_rate": 2.87
  }
}
```

---

## Next Steps After Testing

### If Instagram Works Well ✅
1. Integrate `playground-instagram.py` into backend
2. Add Node.js wrapper using `python-shell`
3. Create API endpoint: `POST /api/scrape/instagram/:competitorId`
4. Add to competitor management UI

### If TikTok Works Well ✅
1. Move `playground-tiktok.ts` logic to service
2. Add error retry logic
3. Create API endpoint: `POST /api/scrape/tiktok/:competitorId`
4. Add to competitor management UI

### If Both Have Issues ❌
Fallback options:
1. Manual entry form (4 hours to build)
2. Browser extension (8 hours to build)
3. Apify API (paid but reliable)

---

## Testing Recommended Accounts

### Instagram (Good for Testing)
- `natgeo` - National Geographic (lots of posts, public)
- `nike` - Nike (business account, good variety)
- `designstudiocairo` - Interior design (niche example)

### TikTok (Good for Testing)
- `therock` - Dwayne Johnson (high engagement)
- `khaby.lame` - Khaby Lame (most followed)
- `charlidamelio` - Charli D'Amelio (variety of content)

---

## Run Tests Now

```bash
cd apps/backend

# Test Instagram
pip3 install instaloader
python3 playground-instagram.py natgeo 5

# Test TikTok
npm install tiktok-scraper tsx
npx tsx playground-tiktok.ts therock 5
```

Check the generated JSON files to see what data you get!
