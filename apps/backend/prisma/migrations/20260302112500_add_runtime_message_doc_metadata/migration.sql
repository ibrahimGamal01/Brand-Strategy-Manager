ALTER TABLE "chat_branch_messages"
  ADD COLUMN IF NOT EXISTS "attachment_ids_json" JSONB,
  ADD COLUMN IF NOT EXISTS "document_ids_json" JSONB;

ALTER TABLE "agent_runs"
  ADD COLUMN IF NOT EXISTS "attachment_ids_json" JSONB,
  ADD COLUMN IF NOT EXISTS "document_ids_json" JSONB;

ALTER TABLE "message_queue_items"
  ADD COLUMN IF NOT EXISTS "attachment_ids_json" JSONB,
  ADD COLUMN IF NOT EXISTS "document_ids_json" JSONB;
