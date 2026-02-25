-- Add branch-aware chat runtime models (threads, branches, runs, tool runs, process events, queue).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatBranchStatus') THEN
    CREATE TYPE "ChatBranchStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatBranchMessageRole') THEN
    CREATE TYPE "ChatBranchMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentRunTriggerType') THEN
    CREATE TYPE "AgentRunTriggerType" AS ENUM (
      'USER_MESSAGE',
      'TOOL_RESULT',
      'SCHEDULED_LOOP',
      'MUTATION_APPLIED',
      'MANUAL_RETRY'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentRunStatus') THEN
    CREATE TYPE "AgentRunStatus" AS ENUM (
      'QUEUED',
      'RUNNING',
      'WAITING_TOOLS',
      'WAITING_USER',
      'DONE',
      'FAILED',
      'CANCELLED'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ToolRunStatus') THEN
    CREATE TYPE "ToolRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProcessEventLevel') THEN
    CREATE TYPE "ProcessEventLevel" AS ENUM ('INFO', 'WARN', 'ERROR');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProcessEventType') THEN
    CREATE TYPE "ProcessEventType" AS ENUM (
      'PROCESS_STARTED',
      'PROCESS_PROGRESS',
      'PROCESS_LOG',
      'PROCESS_RESULT',
      'DECISION_REQUIRED',
      'WAITING_FOR_INPUT',
      'DONE',
      'FAILED',
      'PROCESS_CANCELLED'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageQueueItemStatus') THEN
    CREATE TYPE "MessageQueueItemStatus" AS ENUM ('QUEUED', 'SENT', 'CANCELLED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "chat_threads" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "pinned_branch_id" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_branches" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "forked_from_message_id" TEXT,
  "forked_from_branch_id" TEXT,
  "status" "ChatBranchStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_branches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_branch_messages" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "role" "ChatBranchMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "blocks_json" JSONB,
  "citations_json" JSONB,
  "reasoning_json" JSONB,
  "parent_message_id" TEXT,
  "client_visible" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_branch_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "trigger_type" "AgentRunTriggerType" NOT NULL,
  "trigger_message_id" TEXT,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
  "policy_json" JSONB,
  "plan_json" JSONB,
  "started_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tool_runs" (
  "id" TEXT NOT NULL,
  "agent_run_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "args_json" JSONB NOT NULL,
  "status" "ToolRunStatus" NOT NULL DEFAULT 'QUEUED',
  "result_json" JSONB,
  "started_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "cost_json" JSONB,
  "produced_artifacts_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tool_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "process_events" (
  "id" TEXT NOT NULL,
  "agent_run_id" TEXT,
  "tool_run_id" TEXT,
  "branch_id" TEXT NOT NULL,
  "level" "ProcessEventLevel" NOT NULL DEFAULT 'INFO',
  "type" "ProcessEventType" NOT NULL,
  "message" TEXT NOT NULL,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "process_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "message_queue_items" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "status" "MessageQueueItemStatus" NOT NULL DEFAULT 'QUEUED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_queue_items_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_threads_research_job_id_fkey'
  ) THEN
    ALTER TABLE "chat_threads"
      ADD CONSTRAINT "chat_threads_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_threads_pinned_branch_id_fkey'
  ) THEN
    ALTER TABLE "chat_threads"
      ADD CONSTRAINT "chat_threads_pinned_branch_id_fkey"
      FOREIGN KEY ("pinned_branch_id") REFERENCES "chat_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_branches_thread_id_fkey'
  ) THEN
    ALTER TABLE "chat_branches"
      ADD CONSTRAINT "chat_branches_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_branches_forked_from_message_id_fkey'
  ) THEN
    ALTER TABLE "chat_branches"
      ADD CONSTRAINT "chat_branches_forked_from_message_id_fkey"
      FOREIGN KEY ("forked_from_message_id") REFERENCES "chat_branch_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_branches_forked_from_branch_id_fkey'
  ) THEN
    ALTER TABLE "chat_branches"
      ADD CONSTRAINT "chat_branches_forked_from_branch_id_fkey"
      FOREIGN KEY ("forked_from_branch_id") REFERENCES "chat_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_branch_messages_branch_id_fkey'
  ) THEN
    ALTER TABLE "chat_branch_messages"
      ADD CONSTRAINT "chat_branch_messages_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "chat_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_branch_messages_parent_message_id_fkey'
  ) THEN
    ALTER TABLE "chat_branch_messages"
      ADD CONSTRAINT "chat_branch_messages_parent_message_id_fkey"
      FOREIGN KEY ("parent_message_id") REFERENCES "chat_branch_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_branch_id_fkey'
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "chat_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_trigger_message_id_fkey'
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_trigger_message_id_fkey"
      FOREIGN KEY ("trigger_message_id") REFERENCES "chat_branch_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tool_runs_agent_run_id_fkey'
  ) THEN
    ALTER TABLE "tool_runs"
      ADD CONSTRAINT "tool_runs_agent_run_id_fkey"
      FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'process_events_agent_run_id_fkey'
  ) THEN
    ALTER TABLE "process_events"
      ADD CONSTRAINT "process_events_agent_run_id_fkey"
      FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'process_events_tool_run_id_fkey'
  ) THEN
    ALTER TABLE "process_events"
      ADD CONSTRAINT "process_events_tool_run_id_fkey"
      FOREIGN KEY ("tool_run_id") REFERENCES "tool_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'process_events_branch_id_fkey'
  ) THEN
    ALTER TABLE "process_events"
      ADD CONSTRAINT "process_events_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "chat_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_queue_items_branch_id_fkey'
  ) THEN
    ALTER TABLE "message_queue_items"
      ADD CONSTRAINT "message_queue_items_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "chat_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "chat_threads_research_job_id_updated_at_idx"
  ON "chat_threads"("research_job_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "chat_threads_pinned_branch_id_idx"
  ON "chat_threads"("pinned_branch_id");

CREATE INDEX IF NOT EXISTS "chat_branches_thread_id_created_at_idx"
  ON "chat_branches"("thread_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "chat_branches_thread_id_status_created_at_idx"
  ON "chat_branches"("thread_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "chat_branches_forked_from_message_id_idx"
  ON "chat_branches"("forked_from_message_id");

CREATE INDEX IF NOT EXISTS "chat_branches_forked_from_branch_id_idx"
  ON "chat_branches"("forked_from_branch_id");

CREATE INDEX IF NOT EXISTS "chat_branch_messages_branch_id_created_at_idx"
  ON "chat_branch_messages"("branch_id", "created_at");

CREATE INDEX IF NOT EXISTS "chat_branch_messages_branch_id_role_created_at_idx"
  ON "chat_branch_messages"("branch_id", "role", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "chat_branch_messages_parent_message_id_idx"
  ON "chat_branch_messages"("parent_message_id");

CREATE INDEX IF NOT EXISTS "agent_runs_branch_id_created_at_idx"
  ON "agent_runs"("branch_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_runs_branch_id_status_created_at_idx"
  ON "agent_runs"("branch_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_runs_trigger_message_id_idx"
  ON "agent_runs"("trigger_message_id");

CREATE INDEX IF NOT EXISTS "tool_runs_agent_run_id_created_at_idx"
  ON "tool_runs"("agent_run_id", "created_at");

CREATE INDEX IF NOT EXISTS "tool_runs_agent_run_id_status_created_at_idx"
  ON "tool_runs"("agent_run_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "process_events_branch_id_created_at_idx"
  ON "process_events"("branch_id", "created_at");

CREATE INDEX IF NOT EXISTS "process_events_agent_run_id_created_at_idx"
  ON "process_events"("agent_run_id", "created_at");

CREATE INDEX IF NOT EXISTS "process_events_tool_run_id_created_at_idx"
  ON "process_events"("tool_run_id", "created_at");

CREATE INDEX IF NOT EXISTS "message_queue_items_branch_id_status_position_idx"
  ON "message_queue_items"("branch_id", "status", "position");

CREATE INDEX IF NOT EXISTS "message_queue_items_branch_id_created_at_idx"
  ON "message_queue_items"("branch_id", "created_at");
