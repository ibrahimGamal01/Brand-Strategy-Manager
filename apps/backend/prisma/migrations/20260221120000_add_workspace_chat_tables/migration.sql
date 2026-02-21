-- Add workspace chat tables.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatMessageRole') THEN
    CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatBlockEventType') THEN
    CREATE TYPE "ChatBlockEventType" AS ENUM ('VIEW', 'PIN', 'UNPIN', 'SELECT_DESIGN');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "title" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_research_job_id_fkey'
  ) THEN
    ALTER TABLE "chat_sessions"
      ADD CONSTRAINT "chat_sessions_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "chat_sessions_research_job_id_last_active_at_idx"
  ON "chat_sessions"("research_job_id", "last_active_at" DESC);

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" "ChatMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "blocks" JSONB,
  "design_options" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_session_id_fkey'
  ) THEN
    ALTER TABLE "chat_messages"
      ADD CONSTRAINT "chat_messages_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "chat_messages_session_id_created_at_idx"
  ON "chat_messages"("session_id", "created_at");

CREATE TABLE IF NOT EXISTS "chat_block_events" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "block_id" TEXT NOT NULL,
  "event_type" "ChatBlockEventType" NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_block_events_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_block_events_session_id_fkey'
  ) THEN
    ALTER TABLE "chat_block_events"
      ADD CONSTRAINT "chat_block_events_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_block_events_message_id_fkey'
  ) THEN
    ALTER TABLE "chat_block_events"
      ADD CONSTRAINT "chat_block_events_message_id_fkey"
      FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "chat_block_events_session_id_created_at_idx"
  ON "chat_block_events"("session_id", "created_at");

CREATE INDEX IF NOT EXISTS "chat_block_events_message_id_block_id_idx"
  ON "chat_block_events"("message_id", "block_id");

CREATE INDEX IF NOT EXISTS "chat_block_events_block_id_idx"
  ON "chat_block_events"("block_id");

CREATE TABLE IF NOT EXISTS "chat_saved_blocks" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "block_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "block_data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_saved_blocks_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_saved_blocks_session_id_fkey'
  ) THEN
    ALTER TABLE "chat_saved_blocks"
      ADD CONSTRAINT "chat_saved_blocks_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_saved_blocks_message_id_fkey'
  ) THEN
    ALTER TABLE "chat_saved_blocks"
      ADD CONSTRAINT "chat_saved_blocks_message_id_fkey"
      FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "chat_saved_blocks_session_id_block_id_idx"
  ON "chat_saved_blocks"("session_id", "block_id");

CREATE INDEX IF NOT EXISTS "chat_saved_blocks_session_id_created_at_idx"
  ON "chat_saved_blocks"("session_id", "created_at");
