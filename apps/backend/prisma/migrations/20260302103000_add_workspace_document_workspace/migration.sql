-- Workspace document workspace tables for chat-first upload/edit/export workflow.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceDocumentSourceKind') THEN
    CREATE TYPE "WorkspaceDocumentSourceKind" AS ENUM ('UPLOADED', 'GENERATED', 'IMPORTED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceDocumentParserStatus') THEN
    CREATE TYPE "WorkspaceDocumentParserStatus" AS ENUM ('PENDING', 'PARSING', 'READY', 'NEEDS_REVIEW', 'FAILED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceDocumentIngestionStatus') THEN
    CREATE TYPE "WorkspaceDocumentIngestionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceDocumentExportFormat') THEN
    CREATE TYPE "WorkspaceDocumentExportFormat" AS ENUM ('PDF', 'DOCX', 'MD');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "workspace_documents" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "source_kind" "WorkspaceDocumentSourceKind" NOT NULL DEFAULT 'UPLOADED',
  "source_attachment_id" TEXT,
  "source_client_document_id" TEXT,
  "title" TEXT NOT NULL,
  "original_file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "parser_status" "WorkspaceDocumentParserStatus" NOT NULL DEFAULT 'PENDING',
  "parser_quality_score" DOUBLE PRECISION,
  "parser_meta_json" JSONB,
  "latest_version_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace_document_versions" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "content_md" TEXT NOT NULL,
  "change_summary" TEXT,
  "patch_json" JSONB,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "run_id" TEXT,
  CONSTRAINT "workspace_document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace_document_chunks" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "document_version_id" TEXT NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "heading_path" TEXT,
  "text" TEXT NOT NULL,
  "token_count" INTEGER NOT NULL,
  "table_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace_document_ingestion_runs" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "branch_id" TEXT,
  "document_id" TEXT NOT NULL,
  "status" "WorkspaceDocumentIngestionStatus" NOT NULL DEFAULT 'QUEUED',
  "parser" TEXT NOT NULL,
  "warnings_json" JSONB,
  "pages_total" INTEGER,
  "pages_parsed" INTEGER,
  "started_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_document_ingestion_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace_document_exports" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "document_version_id" TEXT NOT NULL,
  "format" "WorkspaceDocumentExportFormat" NOT NULL,
  "storage_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size_bytes" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,
  CONSTRAINT "workspace_document_exports_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_documents_research_job_id_fkey'
  ) THEN
    ALTER TABLE "workspace_documents"
      ADD CONSTRAINT "workspace_documents_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_documents_client_id_fkey'
  ) THEN
    ALTER TABLE "workspace_documents"
      ADD CONSTRAINT "workspace_documents_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_documents_source_attachment_id_fkey'
  ) THEN
    ALTER TABLE "workspace_documents"
      ADD CONSTRAINT "workspace_documents_source_attachment_id_fkey"
      FOREIGN KEY ("source_attachment_id") REFERENCES "file_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_documents_source_client_document_id_fkey'
  ) THEN
    ALTER TABLE "workspace_documents"
      ADD CONSTRAINT "workspace_documents_source_client_document_id_fkey"
      FOREIGN KEY ("source_client_document_id") REFERENCES "client_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_versions_document_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_versions"
      ADD CONSTRAINT "workspace_document_versions_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_versions_branch_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_versions"
      ADD CONSTRAINT "workspace_document_versions_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "chat_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_chunks_document_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_chunks"
      ADD CONSTRAINT "workspace_document_chunks_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_chunks_document_version_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_chunks"
      ADD CONSTRAINT "workspace_document_chunks_document_version_id_fkey"
      FOREIGN KEY ("document_version_id") REFERENCES "workspace_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_ingestion_runs_document_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_ingestion_runs"
      ADD CONSTRAINT "workspace_document_ingestion_runs_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_ingestion_runs_research_job_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_ingestion_runs"
      ADD CONSTRAINT "workspace_document_ingestion_runs_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_ingestion_runs_branch_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_ingestion_runs"
      ADD CONSTRAINT "workspace_document_ingestion_runs_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "chat_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_exports_document_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_exports"
      ADD CONSTRAINT "workspace_document_exports_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_document_exports_document_version_id_fkey'
  ) THEN
    ALTER TABLE "workspace_document_exports"
      ADD CONSTRAINT "workspace_document_exports_document_version_id_fkey"
      FOREIGN KEY ("document_version_id") REFERENCES "workspace_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_document_versions_document_version_key" ON "workspace_document_versions"("document_id", "version_number");
CREATE INDEX IF NOT EXISTS "workspace_documents_research_job_created_idx" ON "workspace_documents"("research_job_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_documents_client_created_idx" ON "workspace_documents"("client_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_documents_parser_status_updated_idx" ON "workspace_documents"("parser_status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_documents_source_attachment_idx" ON "workspace_documents"("source_attachment_id");
CREATE INDEX IF NOT EXISTS "workspace_documents_source_client_document_idx" ON "workspace_documents"("source_client_document_id");
CREATE INDEX IF NOT EXISTS "workspace_document_versions_branch_created_idx" ON "workspace_document_versions"("branch_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_document_versions_run_created_idx" ON "workspace_document_versions"("run_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_document_chunks_document_chunk_idx" ON "workspace_document_chunks"("document_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "workspace_document_chunks_version_chunk_idx" ON "workspace_document_chunks"("document_version_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "workspace_document_ingestion_runs_job_created_idx" ON "workspace_document_ingestion_runs"("research_job_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_document_ingestion_runs_document_created_idx" ON "workspace_document_ingestion_runs"("document_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_document_ingestion_runs_branch_created_idx" ON "workspace_document_ingestion_runs"("branch_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_document_exports_document_created_idx" ON "workspace_document_exports"("document_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_document_exports_version_created_idx" ON "workspace_document_exports"("document_version_id", "created_at" DESC);
