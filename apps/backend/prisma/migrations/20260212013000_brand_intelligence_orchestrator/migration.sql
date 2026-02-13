-- Dual-module Brand Intelligence orchestration
-- Idempotent migration for dev environments.

CREATE TABLE IF NOT EXISTS "brand_intelligence_runs" (
  "id" TEXT PRIMARY KEY,
  "research_job_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "mode" TEXT NOT NULL DEFAULT 'append',
  "modules" JSONB NOT NULL,
  "module_order" JSONB NOT NULL,
  "module_inputs" JSONB,
  "run_reason" TEXT,
  "diagnostics" JSONB,
  "summary" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'brand_intelligence_runs_research_job_id_fkey'
  ) THEN
    ALTER TABLE "brand_intelligence_runs"
      ADD CONSTRAINT "brand_intelligence_runs_research_job_id_fkey"
      FOREIGN KEY ("research_job_id")
      REFERENCES "research_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "brand_intelligence_runs_research_job_id_created_at_idx"
  ON "brand_intelligence_runs"("research_job_id", "created_at" DESC);

ALTER TABLE "brand_mentions"
  ADD COLUMN IF NOT EXISTS "brand_intelligence_run_id" TEXT,
  ADD COLUMN IF NOT EXISTS "availability_status" "CompetitorAvailabilityStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS "availability_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "resolver_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "evidence" JSONB;

CREATE INDEX IF NOT EXISTS "brand_mentions_brand_intelligence_run_id_idx"
  ON "brand_mentions"("brand_intelligence_run_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'brand_mentions_brand_intelligence_run_id_fkey'
  ) THEN
    ALTER TABLE "brand_mentions"
      ADD CONSTRAINT "brand_mentions_brand_intelligence_run_id_fkey"
      FOREIGN KEY ("brand_intelligence_run_id")
      REFERENCES "brand_intelligence_runs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

ALTER TABLE "community_insights"
  ADD COLUMN IF NOT EXISTS "brand_intelligence_run_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_query" TEXT,
  ADD COLUMN IF NOT EXISTS "evidence" JSONB;

CREATE INDEX IF NOT EXISTS "community_insights_brand_intelligence_run_id_idx"
  ON "community_insights"("brand_intelligence_run_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_insights_brand_intelligence_run_id_fkey'
  ) THEN
    ALTER TABLE "community_insights"
      ADD CONSTRAINT "community_insights_brand_intelligence_run_id_fkey"
      FOREIGN KEY ("brand_intelligence_run_id")
      REFERENCES "brand_intelligence_runs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
