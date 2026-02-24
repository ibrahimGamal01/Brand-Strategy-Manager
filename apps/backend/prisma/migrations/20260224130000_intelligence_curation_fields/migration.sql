-- Intelligence curation metadata and active-row uniqueness guards.

-- Core curation columns
ALTER TABLE "raw_search_results"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ddg_news_results"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ddg_video_results"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ddg_image_results"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "search_trends"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "community_insights"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ai_questions"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "discovered_competitors"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "client_accounts"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "media_assets"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "brand_mentions"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT,
  ADD COLUMN IF NOT EXISTS "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_modified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Archive duplicate active rows before adding partial-unique indexes.
WITH duplicate_rows AS (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY research_job_id, url ORDER BY created_at DESC, id DESC) AS rn
    FROM ddg_news_results
    WHERE is_active = TRUE
  ) ranked
  WHERE rn > 1
)
UPDATE ddg_news_results
SET is_active = FALSE,
    archived_at = COALESCE(archived_at, NOW()),
    archived_by = COALESCE(archived_by, 'migration:dedupe'),
    manually_modified = TRUE,
    last_modified_at = COALESCE(last_modified_at, NOW()),
    last_modified_by = COALESCE(last_modified_by, 'migration:dedupe')
WHERE id IN (SELECT id FROM duplicate_rows);

WITH duplicate_rows AS (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY research_job_id, url ORDER BY created_at DESC, id DESC) AS rn
    FROM ddg_video_results
    WHERE is_active = TRUE
  ) ranked
  WHERE rn > 1
)
UPDATE ddg_video_results
SET is_active = FALSE,
    archived_at = COALESCE(archived_at, NOW()),
    archived_by = COALESCE(archived_by, 'migration:dedupe'),
    manually_modified = TRUE,
    last_modified_at = COALESCE(last_modified_at, NOW()),
    last_modified_by = COALESCE(last_modified_by, 'migration:dedupe')
WHERE id IN (SELECT id FROM duplicate_rows);

WITH duplicate_rows AS (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY research_job_id, image_url ORDER BY created_at DESC, id DESC) AS rn
    FROM ddg_image_results
    WHERE is_active = TRUE
  ) ranked
  WHERE rn > 1
)
UPDATE ddg_image_results
SET is_active = FALSE,
    archived_at = COALESCE(archived_at, NOW()),
    archived_by = COALESCE(archived_by, 'migration:dedupe'),
    manually_modified = TRUE,
    last_modified_at = COALESCE(last_modified_at, NOW()),
    last_modified_by = COALESCE(last_modified_by, 'migration:dedupe')
WHERE id IN (SELECT id FROM duplicate_rows);

WITH duplicate_rows AS (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY client_id, url ORDER BY scraped_at DESC, id DESC) AS rn
    FROM brand_mentions
    WHERE is_active = TRUE
  ) ranked
  WHERE rn > 1
)
UPDATE brand_mentions
SET is_active = FALSE,
    archived_at = COALESCE(archived_at, NOW()),
    archived_by = COALESCE(archived_by, 'migration:dedupe'),
    manually_modified = TRUE,
    last_modified_at = COALESCE(last_modified_at, NOW()),
    last_modified_by = COALESCE(last_modified_by, 'migration:dedupe')
WHERE id IN (SELECT id FROM duplicate_rows);

WITH duplicate_rows AS (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY research_job_id, url ORDER BY created_at DESC, id DESC) AS rn
    FROM community_insights
    WHERE is_active = TRUE
  ) ranked
  WHERE rn > 1
)
UPDATE community_insights
SET is_active = FALSE,
    archived_at = COALESCE(archived_at, NOW()),
    archived_by = COALESCE(archived_by, 'migration:dedupe'),
    manually_modified = TRUE,
    last_modified_at = COALESCE(last_modified_at, NOW()),
    last_modified_by = COALESCE(last_modified_by, 'migration:dedupe')
WHERE id IN (SELECT id FROM duplicate_rows);

WITH duplicate_rows AS (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY research_job_id, keyword, region, timeframe
             ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM search_trends
    WHERE is_active = TRUE
  ) ranked
  WHERE rn > 1
)
UPDATE search_trends
SET is_active = FALSE,
    archived_at = COALESCE(archived_at, NOW()),
    archived_by = COALESCE(archived_by, 'migration:dedupe'),
    manually_modified = TRUE,
    last_modified_at = COALESCE(last_modified_at, NOW()),
    last_modified_by = COALESCE(last_modified_by, 'migration:dedupe')
WHERE id IN (SELECT id FROM duplicate_rows);

-- Active-row uniqueness constraints (partial indexes keep archived duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS "ddg_news_results_active_url_key"
  ON "ddg_news_results" ("research_job_id", "url")
  WHERE "is_active" = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS "ddg_video_results_active_url_key"
  ON "ddg_video_results" ("research_job_id", "url")
  WHERE "is_active" = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS "ddg_image_results_active_image_url_key"
  ON "ddg_image_results" ("research_job_id", "image_url")
  WHERE "is_active" = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS "brand_mentions_active_url_key"
  ON "brand_mentions" ("client_id", "url")
  WHERE "is_active" = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS "community_insights_active_url_key"
  ON "community_insights" ("research_job_id", "url")
  WHERE "is_active" = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS "search_trends_active_scope_key"
  ON "search_trends" ("research_job_id", "keyword", "region", "timeframe")
  WHERE "is_active" = TRUE;
