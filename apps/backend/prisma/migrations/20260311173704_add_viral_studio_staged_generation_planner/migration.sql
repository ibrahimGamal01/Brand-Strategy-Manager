-- Durable staged generation planner for Viral Studio.

CREATE TABLE IF NOT EXISTS "viral_studio_planner_sessions" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "shortlisted_reference_ids_json" JSONB,
  "approved_design_direction_id" TEXT,
  "approved_content_direction_id" TEXT,
  "selected_content_type" TEXT,
  "latest_format_generation_id" TEXT,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "viral_studio_planner_sessions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_planner_sessions_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_planner_sessions"
      ADD CONSTRAINT "viral_studio_planner_sessions_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_planner_sessions_workspace_id_key"
  ON "viral_studio_planner_sessions"("workspace_id");
CREATE INDEX IF NOT EXISTS "viral_studio_planner_sessions_workspace_updated_idx"
  ON "viral_studio_planner_sessions"("workspace_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "viral_studio_planner_sessions_workspace_stage_idx"
  ON "viral_studio_planner_sessions"("workspace_id", "stage");

CREATE TABLE IF NOT EXISTS "viral_studio_design_direction_candidates" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL,
  "archetype_name" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "viral_studio_design_direction_candidates_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_design_direction_candidates_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_design_direction_candidates"
      ADD CONSTRAINT "viral_studio_design_direction_candidates_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_design_directions_session_order_unique"
  ON "viral_studio_design_direction_candidates"("session_id", "order_index");
CREATE INDEX IF NOT EXISTS "viral_studio_design_directions_workspace_created_idx"
  ON "viral_studio_design_direction_candidates"("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "viral_studio_design_directions_workspace_session_idx"
  ON "viral_studio_design_direction_candidates"("workspace_id", "session_id");

CREATE TABLE IF NOT EXISTS "viral_studio_approved_design_directions" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "viral_studio_approved_design_directions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_approved_design_directions_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_approved_design_directions"
      ADD CONSTRAINT "viral_studio_approved_design_directions_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_approved_design_directions_session_id_key"
  ON "viral_studio_approved_design_directions"("session_id");
CREATE INDEX IF NOT EXISTS "viral_studio_approved_designs_workspace_created_idx"
  ON "viral_studio_approved_design_directions"("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "viral_studio_approved_designs_workspace_candidate_idx"
  ON "viral_studio_approved_design_directions"("workspace_id", "candidate_id");

CREATE TABLE IF NOT EXISTS "viral_studio_content_direction_candidates" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "approved_design_direction_id" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "viral_studio_content_direction_candidates_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_content_direction_candidates_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_content_direction_candidates"
      ADD CONSTRAINT "viral_studio_content_direction_candidates_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_content_directions_session_order_unique"
  ON "viral_studio_content_direction_candidates"("session_id", "order_index");
CREATE INDEX IF NOT EXISTS "viral_studio_content_directions_workspace_created_idx"
  ON "viral_studio_content_direction_candidates"("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "viral_studio_content_directions_workspace_design_idx"
  ON "viral_studio_content_direction_candidates"("workspace_id", "approved_design_direction_id");

CREATE TABLE IF NOT EXISTS "viral_studio_approved_content_directions" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "approved_design_direction_id" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "viral_studio_approved_content_directions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_approved_content_directions_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_approved_content_directions"
      ADD CONSTRAINT "viral_studio_approved_content_directions_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_approved_content_directions_session_id_key"
  ON "viral_studio_approved_content_directions"("session_id");
CREATE INDEX IF NOT EXISTS "viral_studio_approved_contents_workspace_created_idx"
  ON "viral_studio_approved_content_directions"("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "viral_studio_approved_contents_workspace_design_idx"
  ON "viral_studio_approved_content_directions"("workspace_id", "approved_design_direction_id");

CREATE TABLE IF NOT EXISTS "viral_studio_format_generation_jobs" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "approved_design_direction_id" TEXT NOT NULL,
  "approved_content_direction_id" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "generation_pack_id" TEXT NOT NULL,
  "selected_reference_ids_json" JSONB,
  "result_json" JSONB NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "viral_studio_format_generation_jobs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_format_generation_jobs_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_format_generation_jobs"
      ADD CONSTRAINT "viral_studio_format_generation_jobs_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "viral_studio_format_generations_workspace_created_idx"
  ON "viral_studio_format_generation_jobs"("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "viral_studio_format_generations_workspace_type_created_idx"
  ON "viral_studio_format_generation_jobs"("workspace_id", "content_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "viral_studio_format_generations_workspace_session_idx"
  ON "viral_studio_format_generation_jobs"("workspace_id", "session_id");
CREATE INDEX IF NOT EXISTS "viral_studio_format_generations_generation_idx"
  ON "viral_studio_format_generation_jobs"("generation_pack_id");
