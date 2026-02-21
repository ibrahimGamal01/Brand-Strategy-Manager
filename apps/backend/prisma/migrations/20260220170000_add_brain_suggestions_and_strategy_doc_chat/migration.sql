-- Add Brain profile suggestions + strategy doc chat tables.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrainProfileSuggestionStatus') THEN
    CREATE TYPE "BrainProfileSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'APPROVED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "brain_profile_suggestions" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "proposed_value" JSONB NOT NULL,
  "approved_value" JSONB,
  "reason" TEXT,
  "source" TEXT,
  "status" "BrainProfileSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolved_by" TEXT,
  CONSTRAINT "brain_profile_suggestions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brain_profile_suggestions_client_id_fkey'
  ) THEN
    ALTER TABLE "brain_profile_suggestions"
      ADD CONSTRAINT "brain_profile_suggestions_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "brain_profile_suggestions_client_id_status_created_at_idx"
  ON "brain_profile_suggestions"("client_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "brain_profile_suggestions_client_id_field_status_idx"
  ON "brain_profile_suggestions"("client_id", "field", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StrategyDocChatScope') THEN
    CREATE TYPE "StrategyDocChatScope" AS ENUM ('ALL', 'SECTION');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StrategyDocChatStatus') THEN
    CREATE TYPE "StrategyDocChatStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StrategyDocChatRole') THEN
    CREATE TYPE "StrategyDocChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "strategy_doc_chat_sessions" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "scope" "StrategyDocChatScope" NOT NULL DEFAULT 'ALL',
  "section_key" TEXT,
  "title" TEXT,
  "status" "StrategyDocChatStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "strategy_doc_chat_sessions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_doc_chat_sessions_research_job_id_fkey'
  ) THEN
    ALTER TABLE "strategy_doc_chat_sessions"
      ADD CONSTRAINT "strategy_doc_chat_sessions_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "strategy_doc_chat_sessions_research_job_id_status_last_messag_idx"
  ON "strategy_doc_chat_sessions"("research_job_id", "status", "last_message_at" DESC);

CREATE INDEX IF NOT EXISTS "strategy_doc_chat_sessions_research_job_id_scope_section_key_idx"
  ON "strategy_doc_chat_sessions"("research_job_id", "scope", "section_key");

CREATE TABLE IF NOT EXISTS "strategy_doc_chat_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" "StrategyDocChatRole" NOT NULL,
  "content" TEXT NOT NULL,
  "context_snippet" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "strategy_doc_chat_messages_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_doc_chat_messages_session_id_fkey'
  ) THEN
    ALTER TABLE "strategy_doc_chat_messages"
      ADD CONSTRAINT "strategy_doc_chat_messages_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "strategy_doc_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "strategy_doc_chat_messages_session_id_created_at_idx"
  ON "strategy_doc_chat_messages"("session_id", "created_at");
