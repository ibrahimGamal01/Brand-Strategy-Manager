-- Content Calendar: enums and tables only (no changes to existing tables)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentCalendarStatus') THEN
    CREATE TYPE "ContentCalendarStatus" AS ENUM ('RUNNING', 'COMPLETE', 'FAILED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalendarSlotStatus') THEN
    CREATE TYPE "CalendarSlotStatus" AS ENUM ('PLANNED', 'BLOCKED', 'READY_TO_GENERATE', 'GENERATING', 'DRAFT_CREATED', 'APPROVED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentDraftStatus') THEN
    CREATE TYPE "ContentDraftStatus" AS ENUM ('DRAFT', 'AWAITING_FEEDBACK', 'APPROVED', 'FAILED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeedbackAuthorType') THEN
    CREATE TYPE "FeedbackAuthorType" AS ENUM ('CLIENT', 'INTERNAL');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "content_calendar_runs" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "week_start" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
  "calendar_brief_json" JSONB NOT NULL,
  "content_calendar_json" JSONB NOT NULL,
  "status" "ContentCalendarStatus" NOT NULL DEFAULT 'RUNNING',
  "error_message" TEXT,
  "diagnostics" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "content_calendar_runs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_calendar_runs_research_job_id_fkey'
  ) THEN
    ALTER TABLE "content_calendar_runs"
      ADD CONSTRAINT "content_calendar_runs_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "content_calendar_runs_research_job_id_week_start_idx"
  ON "content_calendar_runs"("research_job_id", "week_start");

CREATE TABLE IF NOT EXISTS "calendar_slots" (
  "id" TEXT NOT NULL,
  "calendar_run_id" TEXT NOT NULL,
  "slot_index" INTEGER NOT NULL,
  "platform" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "theme" TEXT,
  "pillar_id" TEXT,
  "objective" TEXT,
  "production_brief_json" JSONB NOT NULL,
  "generation_plan_json" JSONB NOT NULL,
  "inspiration_post_ids" TEXT[] NOT NULL,
  "status" "CalendarSlotStatus" NOT NULL DEFAULT 'PLANNED',
  "block_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_slots_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_slots_calendar_run_id_fkey'
  ) THEN
    ALTER TABLE "calendar_slots"
      ADD CONSTRAINT "calendar_slots_calendar_run_id_fkey"
      FOREIGN KEY ("calendar_run_id") REFERENCES "content_calendar_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_slots_calendar_run_id_slot_index_key"
  ON "calendar_slots"("calendar_run_id", "slot_index");
CREATE INDEX IF NOT EXISTS "calendar_slots_calendar_run_id_status_idx"
  ON "calendar_slots"("calendar_run_id", "status");

CREATE TABLE IF NOT EXISTS "content_drafts" (
  "id" TEXT NOT NULL,
  "slot_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ContentDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "caption" TEXT,
  "script_json" JSONB,
  "assets_json" JSONB,
  "used_inspiration_post_ids" TEXT[] NOT NULL,
  "generation_params" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_drafts_slot_id_fkey'
  ) THEN
    ALTER TABLE "content_drafts"
      ADD CONSTRAINT "content_drafts_slot_id_fkey"
      FOREIGN KEY ("slot_id") REFERENCES "calendar_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "content_drafts_slot_id_version_key"
  ON "content_drafts"("slot_id", "version");
CREATE INDEX IF NOT EXISTS "content_drafts_slot_id_status_idx"
  ON "content_drafts"("slot_id", "status");

CREATE TABLE IF NOT EXISTS "draft_feedback" (
  "id" TEXT NOT NULL,
  "draft_id" TEXT NOT NULL,
  "author_type" "FeedbackAuthorType" NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "draft_feedback_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_feedback_draft_id_fkey'
  ) THEN
    ALTER TABLE "draft_feedback"
      ADD CONSTRAINT "draft_feedback_draft_id_fkey"
      FOREIGN KEY ("draft_id") REFERENCES "content_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "draft_feedback_draft_id_created_at_idx"
  ON "draft_feedback"("draft_id", "created_at");
