CREATE TABLE IF NOT EXISTS "viral_studio_brand_dna_profiles" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mission" TEXT NOT NULL DEFAULT '',
    "value_proposition" TEXT NOT NULL DEFAULT '',
    "product_or_service" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "audience_json" JSONB,
    "pains_json" JSONB,
    "desires_json" JSONB,
    "objections_json" JSONB,
    "voice_sliders_json" JSONB,
    "banned_phrases_json" JSONB,
    "required_claims_json" JSONB,
    "exemplars_json" JSONB,
    "summary" TEXT NOT NULL DEFAULT '',
    "completeness_json" JSONB,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_brand_dna_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_ingestion_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source_platform" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "max_videos" INTEGER NOT NULL,
    "lookback_days" INTEGER NOT NULL,
    "sort_by" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "retry_of_run_id" TEXT,
    "status" TEXT NOT NULL,
    "found" INTEGER NOT NULL DEFAULT 0,
    "downloaded" INTEGER NOT NULL DEFAULT 0,
    "analyzed" INTEGER NOT NULL DEFAULT 0,
    "ranked" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "asset_ref" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_ingestion_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_ingestion_events" (
    "id" SERIAL NOT NULL,
    "ingestion_run_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "message" TEXT NOT NULL,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_ingestion_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_reference_assets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ingestion_run_id" TEXT NOT NULL,
    "source_platform" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "viral_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "shortlist_state" TEXT NOT NULL DEFAULT 'none',
    "asset_ref" TEXT,
    "explainability_json" JSONB,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_reference_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_generation_packs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "prompt_template_id" TEXT NOT NULL,
    "format_target" TEXT NOT NULL,
    "input_prompt" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "selected_reference_ids_json" JSONB,
    "prompt_context_json" JSONB NOT NULL,
    "outputs_json" JSONB NOT NULL,
    "quality_check_json" JSONB,
    "asset_ref" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_generation_packs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_generation_revisions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "mode" TEXT,
    "section" TEXT,
    "instruction" TEXT,
    "payload_json" JSONB NOT NULL,
    "quality_check_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_generation_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_documents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "linked_generation_ids_json" JSONB,
    "sections_json" JSONB NOT NULL,
    "current_version_id" TEXT,
    "asset_ref" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_document_versions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "based_on_version_id" TEXT,
    "snapshot_sections_json" JSONB NOT NULL,
    "asset_ref" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "viral_studio_telemetry_events" (
    "id" SERIAL NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viral_studio_telemetry_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_brand_dna_workspace_unique"
ON "viral_studio_brand_dna_profiles"("workspace_id");

CREATE INDEX IF NOT EXISTS "viral_studio_brand_dna_workspace_created_idx"
ON "viral_studio_brand_dna_profiles"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_brand_dna_workspace_updated_idx"
ON "viral_studio_brand_dna_profiles"("workspace_id", "updated_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_ingestion_runs_asset_ref_key"
ON "viral_studio_ingestion_runs"("asset_ref");

CREATE INDEX IF NOT EXISTS "viral_studio_ingestion_runs_workspace_created_idx"
ON "viral_studio_ingestion_runs"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_ingestion_runs_workspace_status_created_idx"
ON "viral_studio_ingestion_runs"("workspace_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_ingestion_runs_retry_of_idx"
ON "viral_studio_ingestion_runs"("retry_of_run_id");

CREATE INDEX IF NOT EXISTS "viral_studio_ingestion_events_workspace_id_idx"
ON "viral_studio_ingestion_events"("workspace_id", "id");

CREATE INDEX IF NOT EXISTS "viral_studio_ingestion_events_run_id_idx"
ON "viral_studio_ingestion_events"("ingestion_run_id", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_reference_assets_asset_ref_key"
ON "viral_studio_reference_assets"("asset_ref");

CREATE INDEX IF NOT EXISTS "viral_studio_reference_assets_workspace_created_idx"
ON "viral_studio_reference_assets"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_reference_assets_workspace_shortlist_created_idx"
ON "viral_studio_reference_assets"("workspace_id", "shortlist_state", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_reference_assets_ingestion_run_idx"
ON "viral_studio_reference_assets"("ingestion_run_id");

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_generation_packs_asset_ref_key"
ON "viral_studio_generation_packs"("asset_ref");

CREATE INDEX IF NOT EXISTS "viral_studio_generation_packs_workspace_created_idx"
ON "viral_studio_generation_packs"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_generation_packs_workspace_status_created_idx"
ON "viral_studio_generation_packs"("workspace_id", "status", "created_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_generation_revisions_generation_revision_unique"
ON "viral_studio_generation_revisions"("generation_id", "revision_number");

CREATE INDEX IF NOT EXISTS "viral_studio_generation_revisions_workspace_created_idx"
ON "viral_studio_generation_revisions"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_generation_revisions_generation_idx"
ON "viral_studio_generation_revisions"("generation_id");

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_documents_asset_ref_key"
ON "viral_studio_documents"("asset_ref");

CREATE INDEX IF NOT EXISTS "viral_studio_documents_workspace_created_idx"
ON "viral_studio_documents"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_documents_workspace_version_idx"
ON "viral_studio_documents"("workspace_id", "current_version_id");

CREATE INDEX IF NOT EXISTS "viral_studio_documents_generation_idx"
ON "viral_studio_documents"("generation_id");

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_document_versions_asset_ref_key"
ON "viral_studio_document_versions"("asset_ref");

CREATE UNIQUE INDEX IF NOT EXISTS "viral_studio_document_versions_document_version_unique"
ON "viral_studio_document_versions"("document_id", "version_number");

CREATE INDEX IF NOT EXISTS "viral_studio_document_versions_workspace_created_idx"
ON "viral_studio_document_versions"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_document_versions_document_version_idx"
ON "viral_studio_document_versions"("document_id", "version_number");

CREATE INDEX IF NOT EXISTS "viral_studio_document_versions_document_idx"
ON "viral_studio_document_versions"("document_id");

CREATE INDEX IF NOT EXISTS "viral_studio_telemetry_events_workspace_created_idx"
ON "viral_studio_telemetry_events"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "viral_studio_telemetry_events_workspace_stage_created_idx"
ON "viral_studio_telemetry_events"("workspace_id", "stage", "created_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_brand_dna_profiles_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_brand_dna_profiles"
    ADD CONSTRAINT "viral_studio_brand_dna_profiles_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_ingestion_runs_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_ingestion_runs"
    ADD CONSTRAINT "viral_studio_ingestion_runs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_ingestion_events_ingestion_run_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_ingestion_events"
    ADD CONSTRAINT "viral_studio_ingestion_events_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "viral_studio_ingestion_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_ingestion_events_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_ingestion_events"
    ADD CONSTRAINT "viral_studio_ingestion_events_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_reference_assets_ingestion_run_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_reference_assets"
    ADD CONSTRAINT "viral_studio_reference_assets_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "viral_studio_ingestion_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_reference_assets_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_reference_assets"
    ADD CONSTRAINT "viral_studio_reference_assets_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_generation_packs_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_generation_packs"
    ADD CONSTRAINT "viral_studio_generation_packs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_generation_revisions_generation_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_generation_revisions"
    ADD CONSTRAINT "viral_studio_generation_revisions_generation_id_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "viral_studio_generation_packs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_generation_revisions_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_generation_revisions"
    ADD CONSTRAINT "viral_studio_generation_revisions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_documents_generation_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_documents"
    ADD CONSTRAINT "viral_studio_documents_generation_id_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "viral_studio_generation_packs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_documents_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_documents"
    ADD CONSTRAINT "viral_studio_documents_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_document_versions_document_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_document_versions"
    ADD CONSTRAINT "viral_studio_document_versions_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "viral_studio_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_document_versions_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_document_versions"
    ADD CONSTRAINT "viral_studio_document_versions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viral_studio_telemetry_events_workspace_id_fkey'
  ) THEN
    ALTER TABLE "viral_studio_telemetry_events"
    ADD CONSTRAINT "viral_studio_telemetry_events_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
