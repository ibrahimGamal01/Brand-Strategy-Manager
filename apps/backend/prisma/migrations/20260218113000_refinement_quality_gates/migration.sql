-- Refinement quality gates: snapshot readiness, competitor scrape eligibility, and strategy draft/final grounding metadata.

ALTER TABLE "client_profile_snapshots"
  ADD COLUMN IF NOT EXISTS "readiness_score" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "readiness_status" TEXT,
  ADD COLUMN IF NOT EXISTS "readiness_reasons" JSONB,
  ADD COLUMN IF NOT EXISTS "last_readiness_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "client_profile_snapshots_research_job_id_readiness_status_scraped_at_idx"
  ON "client_profile_snapshots"("research_job_id", "readiness_status", "scraped_at" DESC);

ALTER TABLE "competitor_profile_snapshots"
  ADD COLUMN IF NOT EXISTS "readiness_score" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "readiness_status" TEXT,
  ADD COLUMN IF NOT EXISTS "readiness_reasons" JSONB,
  ADD COLUMN IF NOT EXISTS "last_readiness_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "competitor_profile_snapshots_research_job_id_readiness_status_scraped_at_idx"
  ON "competitor_profile_snapshots"("research_job_id", "readiness_status", "scraped_at" DESC);

ALTER TABLE "competitor_candidate_profiles"
  ADD COLUMN IF NOT EXISTS "input_type" TEXT,
  ADD COLUMN IF NOT EXISTS "scrape_eligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "blocker_reason_code" TEXT;

CREATE INDEX IF NOT EXISTS "competitor_candidate_profiles_research_job_id_scrape_eligible_state_avail_idx"
  ON "competitor_candidate_profiles"("research_job_id", "scrape_eligible", "state", "availability_status");

ALTER TABLE "ai_analyses"
  ADD COLUMN IF NOT EXISTS "document_status" TEXT,
  ADD COLUMN IF NOT EXISTS "grounding_report" JSONB;
