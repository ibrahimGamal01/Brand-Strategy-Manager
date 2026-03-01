ALTER TABLE "chat_branch_messages"
  ADD COLUMN IF NOT EXISTS "input_options_json" JSONB;

ALTER TABLE "agent_runs"
  ADD COLUMN IF NOT EXISTS "input_options_json" JSONB;

ALTER TABLE "message_queue_items"
  ADD COLUMN IF NOT EXISTS "input_options_json" JSONB,
  ADD COLUMN IF NOT EXISTS "steer_json" JSONB;
