-- Persist per-run media analysis scope counters for reliability gating and UI diagnostics.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaAnalysisRunStatus') THEN
    CREATE TYPE "MediaAnalysisRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'SKIPPED', 'FAILED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "media_analysis_runs" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "status" "MediaAnalysisRunStatus" NOT NULL DEFAULT 'RUNNING',
  "allow_degraded" BOOLEAN NOT NULL DEFAULT false,
  "skip_already_analyzed" BOOLEAN NOT NULL DEFAULT true,
  "requested_limit" INTEGER NOT NULL,
  "max_eligible_assets" INTEGER NOT NULL,
  "max_eligible_posts" INTEGER NOT NULL,
  "downloaded_total" INTEGER NOT NULL DEFAULT 0,
  "qualified_for_ai" INTEGER NOT NULL DEFAULT 0,
  "analysis_window" INTEGER NOT NULL DEFAULT 0,
  "analyzed_in_window" INTEGER NOT NULL DEFAULT 0,
  "attempted_assets" INTEGER NOT NULL DEFAULT 0,
  "succeeded_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_reason" TEXT,
  "diagnostics" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "media_analysis_runs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_analysis_runs_research_job_id_fkey'
  ) THEN
    ALTER TABLE "media_analysis_runs"
      ADD CONSTRAINT "media_analysis_runs_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "media_analysis_runs_research_job_id_started_at_idx"
  ON "media_analysis_runs"("research_job_id", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "media_analysis_runs_research_job_id_status_started_at_idx"
  ON "media_analysis_runs"("research_job_id", "status", "started_at" DESC);
