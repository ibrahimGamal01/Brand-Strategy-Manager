-- Add new ChatBlockEventType values
DO $$ BEGIN
  ALTER TYPE "ChatBlockEventType" ADD VALUE IF NOT EXISTS 'FORM_SUBMIT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

DO $$ BEGIN
  ALTER TYPE "ChatBlockEventType" ADD VALUE IF NOT EXISTS 'ATTACH_VIEW';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- Create client_intake_answers
CREATE TABLE IF NOT EXISTS "client_intake_answers" (
  "id" TEXT PRIMARY KEY,
  "research_job_id" TEXT NOT NULL,
  "question_set_id" TEXT NOT NULL,
  "question_key" TEXT NOT NULL,
  "answer_type" TEXT NOT NULL,
  "answer" JSONB NOT NULL,
  "triggered_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_intake_answers_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "client_intake_answers_research_job_id_question_set_id_idx"
  ON "client_intake_answers"("research_job_id", "question_set_id");

-- Create screenshot_attachments
CREATE TABLE IF NOT EXISTS "screenshot_attachments" (
  "id" TEXT PRIMARY KEY,
  "research_job_id" TEXT NOT NULL,
  "chat_message_id" TEXT,
  "storage_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL DEFAULT 'image/png',
  "file_size_bytes" INTEGER,
  "is_app_screenshot" BOOLEAN NOT NULL DEFAULT false,
  "record_type" TEXT,
  "record_id" TEXT,
  "ocr_text" TEXT,
  "ai_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screenshot_attachments_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "screenshot_attachments_research_job_id_idx"
  ON "screenshot_attachments"("research_job_id");
