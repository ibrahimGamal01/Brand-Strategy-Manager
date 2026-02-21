# Social Posts: Why You're Not Seeing 50 Posts in the DB

## What's Going On

1. **"limit 4" in the Apify log** – Previously, Instagram inherited `SOCIAL_SCRAPE_POST_LIMIT` (default 4). **Fixed:** Instagram now defaults to 50 posts. Set `INSTAGRAM_POST_LIMIT=50` in `.env` to confirm (or leave unset to use the new default).

2. **Apify `resultsLimit: 50`** – We send `resultsLimit: Math.max(postsLimit, 50)` to Apify. With the fix, Instagram requests 50.

3. **Checkpoint (incremental scrape)** – The log shows `Checkpoint: Last post 3803729245084997794`. With a checkpoint, we only save **new** posts (ones that come before that ID in the feed). If everything returned is older than the checkpoint, you get **0 new posts** saved.

4. **Where posts live** – Instagram posts are stored in:
   - **Table:** `social_posts` (Prisma model: `SocialPost`)
   - **Relation:** `socialProfileId` → `social_profiles` (which has `researchJobId`, `platform`, `handle`)

## How to Inspect What's in the DB

Run in Prisma Studio or a SQL client:

```sql
-- Count Instagram posts for ummahpreneur
SELECT sp.handle, sp.platform, COUNT(p.id) as post_count
FROM social_profiles sp
LEFT JOIN social_posts p ON p.social_profile_id = sp.id
WHERE sp.handle = 'ummahpreneur'
  AND sp.platform = 'instagram'
GROUP BY sp.id, sp.handle, sp.platform;
```

Or with Prisma (Node REPL or a script):

```ts
const profiles = await prisma.socialProfile.findMany({
  where: { handle: 'ummahpreneur', platform: 'instagram' },
  include: { _count: { select: { posts: true } } }
});
console.log(profiles);
```

## How to Get 50 Posts

### Option A: Set limits via env (if needed)

Instagram now **defaults to 50**. To override:

```
INSTAGRAM_POST_LIMIT=50   # or higher
```

For TikTok, set `SOCIAL_SCRAPE_POST_LIMIT=50` if you want more videos. Restart the backend after changing `.env`.

### Option B: Reset checkpoint for a full re-scrape

To stop incremental behavior and treat the next run as a fresh scrape:

```sql
UPDATE social_profiles
SET last_post_id = NULL
WHERE handle = 'ummahpreneur' AND platform = 'instagram';
```

Then trigger a new scrape. Without a checkpoint, all posts returned by Apify will be processed and saved (up to the limit).

### Option C: Enable TikTok page downloads

TikTok URLs are currently skipped. To download them:

```
ENABLE_TIKTOK_PAGE_DOWNLOAD=true
```

## Quick Checklist

- [ ] Instagram defaults to 50; set `INSTAGRAM_POST_LIMIT` only to override
- [ ] Backend restarted after changing `.env`
- [ ] `last_post_id` cleared if you want a full re-scrape
- [ ] `ENABLE_TIKTOK_PAGE_DOWNLOAD=true` if you want TikTok media
