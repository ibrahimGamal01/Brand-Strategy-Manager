-- Harden discovered_competitors for orchestrator V2/V3 compatibility.
-- This migration is intentionally idempotent for already-upgraded environments.

DO $$
BEGIN
  CREATE TYPE "CompetitorSelectionState" AS ENUM (
    'FILTERED_OUT',
    'SHORTLISTED',
    'TOP_PICK',
    'APPROVED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

ALTER TABLE "discovered_competitors"
  ADD COLUMN IF NOT EXISTS "orchestration_run_id" TEXT,
  ADD COLUMN IF NOT EXISTS "candidate_profile_id" TEXT,
  ADD COLUMN IF NOT EXISTS "availability_status" "CompetitorAvailabilityStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS "availability_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "selection_state" "CompetitorSelectionState" NOT NULL DEFAULT 'SHORTLISTED',
  ADD COLUMN IF NOT EXISTS "selection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "evidence" JSONB,
  ADD COLUMN IF NOT EXISTS "score_breakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "relevance_score" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "discovered_competitors_research_job_id_selection_state_relevance_score_idx"
  ON "discovered_competitors"("research_job_id", "selection_state", "relevance_score" DESC);

CREATE INDEX IF NOT EXISTS "discovered_competitors_orchestration_run_id_idx"
  ON "discovered_competitors"("orchestration_run_id");

CREATE INDEX IF NOT EXISTS "discovered_competitors_candidate_profile_id_idx"
  ON "discovered_competitors"("candidate_profile_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'discovered_competitors_orchestration_run_id_fkey'
  ) THEN
    ALTER TABLE "discovered_competitors"
      ADD CONSTRAINT "discovered_competitors_orchestration_run_id_fkey"
      FOREIGN KEY ("orchestration_run_id")
      REFERENCES "competitor_orchestration_runs"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'discovered_competitors_candidate_profile_id_fkey'
  ) THEN
    ALTER TABLE "discovered_competitors"
      ADD CONSTRAINT "discovered_competitors_candidate_profile_id_fkey"
      FOREIGN KEY ("candidate_profile_id")
      REFERENCES "competitor_candidate_profiles"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END$$;
