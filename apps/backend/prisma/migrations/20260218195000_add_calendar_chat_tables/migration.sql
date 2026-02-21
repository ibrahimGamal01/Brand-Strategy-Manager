-- Calendar chat layer (session/message/command) for content calendar collaboration.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalendarChatEntityType') THEN
    CREATE TYPE "CalendarChatEntityType" AS ENUM ('CALENDAR_RUN', 'CALENDAR_SLOT', 'CONTENT_DRAFT');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalendarChatStatus') THEN
    CREATE TYPE "CalendarChatStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ARCHIVED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalendarChatRole') THEN
    CREATE TYPE "CalendarChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalendarCommandType') THEN
    CREATE TYPE "CalendarCommandType" AS ENUM (
      'UPDATE_SLOT_BRIEF',
      'UPDATE_DRAFT_CAPTION',
      'UPDATE_DRAFT_SCRIPT',
      'REGENERATE_DRAFT',
      'RESCHEDULE_SLOT',
      'CHANGE_INSPIRATION',
      'UPDATE_PRODUCTION_PARAMS'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalendarCommandStatus') THEN
    CREATE TYPE "CalendarCommandStatus" AS ENUM ('PENDING', 'APPROVED', 'APPLIED', 'REJECTED', 'FAILED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "calendar_chat_sessions" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "entity_type" "CalendarChatEntityType" NOT NULL,
  "entity_id" TEXT NOT NULL,
  "title" TEXT,
  "status" "CalendarChatStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "contentCalendarRunId" TEXT,
  CONSTRAINT "calendar_chat_sessions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_chat_sessions_research_job_id_fkey'
  ) THEN
    ALTER TABLE "calendar_chat_sessions"
      ADD CONSTRAINT "calendar_chat_sessions_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_chat_sessions_contentCalendarRunId_fkey'
  ) THEN
    ALTER TABLE "calendar_chat_sessions"
      ADD CONSTRAINT "calendar_chat_sessions_contentCalendarRunId_fkey"
      FOREIGN KEY ("contentCalendarRunId") REFERENCES "content_calendar_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "calendar_chat_sessions_research_job_id_entity_type_entity_i_idx"
  ON "calendar_chat_sessions"("research_job_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "calendar_chat_sessions_research_job_id_status_last_message__idx"
  ON "calendar_chat_sessions"("research_job_id", "status", "last_message_at" DESC);

CREATE TABLE IF NOT EXISTS "calendar_chat_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" "CalendarChatRole" NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_chat_messages_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_chat_messages_session_id_fkey'
  ) THEN
    ALTER TABLE "calendar_chat_messages"
      ADD CONSTRAINT "calendar_chat_messages_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "calendar_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "calendar_chat_messages_session_id_created_at_idx"
  ON "calendar_chat_messages"("session_id", "created_at");

CREATE TABLE IF NOT EXISTS "calendar_chat_commands" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "entity_type" "CalendarChatEntityType" NOT NULL,
  "entity_id" TEXT NOT NULL,
  "command_type" "CalendarCommandType" NOT NULL,
  "instruction" TEXT NOT NULL,
  "proposed_patch" JSONB NOT NULL,
  "applied_patch" JSONB,
  "status" "CalendarCommandStatus" NOT NULL DEFAULT 'PENDING',
  "reply_text" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMP(3),
  CONSTRAINT "calendar_chat_commands_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_chat_commands_session_id_fkey'
  ) THEN
    ALTER TABLE "calendar_chat_commands"
      ADD CONSTRAINT "calendar_chat_commands_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "calendar_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "calendar_chat_commands_session_id_status_created_at_idx"
  ON "calendar_chat_commands"("session_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "calendar_chat_commands_entity_type_entity_id_idx"
  ON "calendar_chat_commands"("entity_type", "entity_id");
