-- Cross-Surface Competitor Orchestrator V2
-- Safe/idempotent migration for existing development databases.

-- In older dev databases this table already exists (created manually before Prisma was added).
-- Prisma's shadow database doesn't have it, so ensure a minimal table exists before we ALTER it.
CREATE TABLE IF NOT EXISTS "competitor_orchestration_runs" (
  "id" TEXT PRIMARY KEY,
  "research_job_id" TEXT NOT NULL,
  "platforms" JSONB NOT NULL,
  "target_count" INTEGER NOT NULL DEFAULT 10,
  "mode" TEXT NOT NULL DEFAULT 'append',
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "summary" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'competitor_orchestration_runs_research_job_id_fkey'
  ) THEN
    ALTER TABLE "competitor_orchestration_runs"
      ADD CONSTRAINT "competitor_orchestration_runs_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  CREATE TYPE "CompetitorAvailabilityStatus" AS ENUM (
    'UNVERIFIED',
    'VERIFIED',
    'PROFILE_UNAVAILABLE',
    'INVALID_HANDLE',
    'RATE_LIMITED',
    'CONNECTOR_ERROR'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE "CompetitorCandidateState" AS ENUM (
    'DISCOVERED',
    'FILTERED_OUT',
    'SHORTLISTED',
    'TOP_PICK',
    'APPROVED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

ALTER TABLE "competitor_orchestration_runs"
  ADD COLUMN IF NOT EXISTS "strategy_version" TEXT NOT NULL DEFAULT 'v2',
  ADD COLUMN IF NOT EXISTS "config_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "diagnostics" JSONB,
  ADD COLUMN IF NOT EXISTS "phase" TEXT,
  ADD COLUMN IF NOT EXISTS "error_code" TEXT;

CREATE TABLE IF NOT EXISTS "competitor_identities" (
  "id" TEXT PRIMARY KEY,
  "research_job_id" TEXT NOT NULL,
  "canonical_name" TEXT NOT NULL,
  "website_domain" TEXT,
  "business_type" TEXT,
  "audience_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'competitor_identities_research_job_id_fkey'
  ) THEN
    ALTER TABLE "competitor_identities"
      ADD CONSTRAINT "competitor_identities_research_job_id_fkey"
      FOREIGN KEY ("research_job_id")
      REFERENCES "research_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "competitor_identities_research_job_id_canonical_name_idx"
  ON "competitor_identities"("research_job_id", "canonical_name");

CREATE TABLE IF NOT EXISTS "competitor_candidate_profiles" (
  "id" TEXT PRIMARY KEY,
  "research_job_id" TEXT NOT NULL,
  "orchestration_run_id" TEXT NOT NULL,
  "identity_id" TEXT,
  "platform" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "normalized_handle" TEXT NOT NULL,
  "profile_url" TEXT,
  "source" TEXT NOT NULL,
  "availability_status" "CompetitorAvailabilityStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "availability_reason" TEXT,
  "resolver_confidence" DOUBLE PRECISION,
  "state" "CompetitorCandidateState" NOT NULL DEFAULT 'DISCOVERED',
  "state_reason" TEXT,
  "relevance_score" DOUBLE PRECISION,
  "score_breakdown" JSONB,
  "evidence" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'competitor_candidate_profiles_research_job_id_fkey'
  ) THEN
    ALTER TABLE "competitor_candidate_profiles"
      ADD CONSTRAINT "competitor_candidate_profiles_research_job_id_fkey"
      FOREIGN KEY ("research_job_id")
      REFERENCES "research_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'competitor_candidate_profiles_orchestration_run_id_fkey'
  ) THEN
    ALTER TABLE "competitor_candidate_profiles"
      ADD CONSTRAINT "competitor_candidate_profiles_orchestration_run_id_fkey"
      FOREIGN KEY ("orchestration_run_id")
      REFERENCES "competitor_orchestration_runs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'competitor_candidate_profiles_identity_id_fkey'
  ) THEN
    ALTER TABLE "competitor_candidate_profiles"
      ADD CONSTRAINT "competitor_candidate_profiles_identity_id_fkey"
      FOREIGN KEY ("identity_id")
      REFERENCES "competitor_identities"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "competitor_candidate_profiles_research_job_id_platform_normalized_handle_key"
  ON "competitor_candidate_profiles"("research_job_id", "platform", "normalized_handle");

CREATE INDEX IF NOT EXISTS "competitor_candidate_profiles_research_job_id_state_relevance_score_idx"
  ON "competitor_candidate_profiles"("research_job_id", "state", "relevance_score" DESC);

CREATE INDEX IF NOT EXISTS "competitor_candidate_profiles_research_job_id_availability_status_idx"
  ON "competitor_candidate_profiles"("research_job_id", "availability_status");

CREATE INDEX IF NOT EXISTS "competitor_candidate_profiles_orchestration_run_id_platform_idx"
  ON "competitor_candidate_profiles"("orchestration_run_id", "platform");

CREATE INDEX IF NOT EXISTS "competitor_candidate_profiles_identity_id_idx"
  ON "competitor_candidate_profiles"("identity_id");

CREATE TABLE IF NOT EXISTS "competitor_candidate_evidence" (
  "id" TEXT PRIMARY KEY,
  "candidate_profile_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "query" TEXT,
  "title" TEXT,
  "url" TEXT,
  "snippet" TEXT,
  "signal_score" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'competitor_candidate_evidence_candidate_profile_id_fkey'
  ) THEN
    ALTER TABLE "competitor_candidate_evidence"
      ADD CONSTRAINT "competitor_candidate_evidence_candidate_profile_id_fkey"
      FOREIGN KEY ("candidate_profile_id")
      REFERENCES "competitor_candidate_profiles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "competitor_candidate_evidence_candidate_profile_id_idx"
  ON "competitor_candidate_evidence"("candidate_profile_id");

ALTER TABLE "discovered_competitors"
  ADD COLUMN IF NOT EXISTS "candidate_profile_id" TEXT,
  ADD COLUMN IF NOT EXISTS "availability_status" "CompetitorAvailabilityStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS "availability_reason" TEXT;

CREATE INDEX IF NOT EXISTS "discovered_competitors_candidate_profile_id_idx"
  ON "discovered_competitors"("candidate_profile_id");

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
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
