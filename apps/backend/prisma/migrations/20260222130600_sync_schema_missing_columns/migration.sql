-- Align production schema with prisma/schema.prisma

-- Optional columns for chat
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "follow_up" JSONB;
ALTER TABLE "chat_sessions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- Media download tracking on snapshots
ALTER TABLE "client_profile_snapshots" ADD COLUMN IF NOT EXISTS "last_media_download_queued_at" TIMESTAMP(3);
ALTER TABLE "competitor_profile_snapshots" ADD COLUMN IF NOT EXISTS "last_media_download_queued_at" TIMESTAMP(3);

-- User-supplied context entries for research jobs
CREATE TABLE IF NOT EXISTS "user_supplied_contexts" (
    "id" TEXT PRIMARY KEY,
    "research_job_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "source_message" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_supplied_contexts_research_job_id_is_active_idx"
  ON "user_supplied_contexts"("research_job_id", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "user_supplied_contexts_research_job_id_category_key_key"
  ON "user_supplied_contexts"("research_job_id", "category", "key");

ALTER TABLE "user_supplied_contexts"
  ADD CONSTRAINT "user_supplied_contexts_research_job_id_fkey"
  FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Rename index to match Prisma naming (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'chat_saved_blocks_session_id_block_id_idx'
  ) THEN
    ALTER INDEX "chat_saved_blocks_session_id_block_id_idx"
      RENAME TO "chat_saved_blocks_session_id_block_id_key";
  END IF;
END $$;
