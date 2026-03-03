CREATE TABLE IF NOT EXISTS "work_ledger_versions" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "run_id" TEXT,
    "document_id" TEXT,
    "version_id" TEXT,
    "stage" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_ledger_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_spec_versions" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "run_id" TEXT,
    "document_id" TEXT,
    "version_id" TEXT,
    "schema_version" TEXT NOT NULL DEFAULT 'v1',
    "spec_json" JSONB NOT NULL,
    "repaired" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_spec_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_section_drafts" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "run_id" TEXT,
    "document_id" TEXT,
    "version_id" TEXT,
    "section_id" TEXT NOT NULL,
    "section_kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "evidence_ref_ids_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'insufficient_evidence',
    "partial_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_section_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace_memory_snapshots" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL DEFAULT 'global',
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "source_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_memory_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_ledger_versions_job_created_idx"
ON "work_ledger_versions"("research_job_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "work_ledger_versions_job_run_idx"
ON "work_ledger_versions"("research_job_id", "run_id");

CREATE INDEX IF NOT EXISTS "work_ledger_versions_job_stage_idx"
ON "work_ledger_versions"("research_job_id", "stage");

CREATE INDEX IF NOT EXISTS "work_ledger_versions_document_idx"
ON "work_ledger_versions"("document_id");

CREATE INDEX IF NOT EXISTS "work_ledger_versions_version_idx"
ON "work_ledger_versions"("version_id");

CREATE INDEX IF NOT EXISTS "document_spec_versions_job_created_idx"
ON "document_spec_versions"("research_job_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "document_spec_versions_job_run_idx"
ON "document_spec_versions"("research_job_id", "run_id");

CREATE INDEX IF NOT EXISTS "document_spec_versions_document_idx"
ON "document_spec_versions"("document_id");

CREATE INDEX IF NOT EXISTS "document_spec_versions_version_idx"
ON "document_spec_versions"("version_id");

CREATE INDEX IF NOT EXISTS "document_section_drafts_job_created_idx"
ON "document_section_drafts"("research_job_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "document_section_drafts_job_run_idx"
ON "document_section_drafts"("research_job_id", "run_id");

CREATE INDEX IF NOT EXISTS "document_section_drafts_document_idx"
ON "document_section_drafts"("document_id");

CREATE INDEX IF NOT EXISTS "document_section_drafts_version_idx"
ON "document_section_drafts"("version_id");

CREATE INDEX IF NOT EXISTS "document_section_drafts_job_kind_idx"
ON "document_section_drafts"("research_job_id", "section_kind");

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memory_snapshot_unique_key"
ON "workspace_memory_snapshots"("research_job_id", "branch_id", "scope", "key");

CREATE INDEX IF NOT EXISTS "workspace_memory_snapshot_job_scope_updated_idx"
ON "workspace_memory_snapshots"("research_job_id", "scope", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "workspace_memory_snapshot_job_branch_updated_idx"
ON "workspace_memory_snapshots"("research_job_id", "branch_id", "updated_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_ledger_versions_research_job_id_fkey'
  ) THEN
    ALTER TABLE "work_ledger_versions"
    ADD CONSTRAINT "work_ledger_versions_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_ledger_versions_document_id_fkey'
  ) THEN
    ALTER TABLE "work_ledger_versions"
    ADD CONSTRAINT "work_ledger_versions_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_ledger_versions_version_id_fkey'
  ) THEN
    ALTER TABLE "work_ledger_versions"
    ADD CONSTRAINT "work_ledger_versions_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "workspace_document_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_spec_versions_research_job_id_fkey'
  ) THEN
    ALTER TABLE "document_spec_versions"
    ADD CONSTRAINT "document_spec_versions_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_spec_versions_document_id_fkey'
  ) THEN
    ALTER TABLE "document_spec_versions"
    ADD CONSTRAINT "document_spec_versions_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_spec_versions_version_id_fkey'
  ) THEN
    ALTER TABLE "document_spec_versions"
    ADD CONSTRAINT "document_spec_versions_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "workspace_document_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_section_drafts_research_job_id_fkey'
  ) THEN
    ALTER TABLE "document_section_drafts"
    ADD CONSTRAINT "document_section_drafts_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_section_drafts_document_id_fkey'
  ) THEN
    ALTER TABLE "document_section_drafts"
    ADD CONSTRAINT "document_section_drafts_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_section_drafts_version_id_fkey'
  ) THEN
    ALTER TABLE "document_section_drafts"
    ADD CONSTRAINT "document_section_drafts_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "workspace_document_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_snapshots_research_job_id_fkey'
  ) THEN
    ALTER TABLE "workspace_memory_snapshots"
    ADD CONSTRAINT "workspace_memory_snapshots_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
