-- Portal intake scan coverage fields
ALTER TABLE "portal_intake_scan_runs"
ADD COLUMN "pages_discovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pages_fetched" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unique_path_patterns" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "template_coverage_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "coverage_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "proof_json" JSONB,
ADD COLUMN "asset_stats_json" JSONB;

-- Snapshot linkage to scan runs
ALTER TABLE "web_page_snapshots"
ADD COLUMN "scan_run_id" TEXT;

-- First-class website asset lineage store
CREATE TABLE "website_asset_records" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "scan_run_id" TEXT,
  "lineage_key" TEXT NOT NULL,
  "page_url" TEXT NOT NULL,
  "asset_url" TEXT NOT NULL,
  "normalized_asset_url" TEXT NOT NULL,
  "asset_type" TEXT NOT NULL,
  "role" TEXT,
  "selector_path" TEXT,
  "attribute_name" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "mime_type" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "metadata" JSONB,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "website_asset_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "website_asset_records_lineage_key_key"
ON "website_asset_records"("lineage_key");

CREATE INDEX "website_asset_records_job_type_created_idx"
ON "website_asset_records"("research_job_id", "asset_type", "created_at" DESC);

CREATE INDEX "website_asset_records_job_scan_created_idx"
ON "website_asset_records"("research_job_id", "scan_run_id", "created_at" DESC);

CREATE INDEX "website_asset_records_job_norm_url_created_idx"
ON "website_asset_records"("research_job_id", "normalized_asset_url", "created_at" DESC);

CREATE INDEX "website_asset_records_snapshot_created_idx"
ON "website_asset_records"("snapshot_id", "created_at" DESC);

CREATE INDEX "web_page_snapshots_scan_run_fetched_idx"
ON "web_page_snapshots"("scan_run_id", "fetched_at");

ALTER TABLE "website_asset_records"
ADD CONSTRAINT "website_asset_records_research_job_id_fkey"
FOREIGN KEY ("research_job_id")
REFERENCES "research_jobs"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "website_asset_records"
ADD CONSTRAINT "website_asset_records_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id")
REFERENCES "web_page_snapshots"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "website_asset_records"
ADD CONSTRAINT "website_asset_records_scan_run_id_fkey"
FOREIGN KEY ("scan_run_id")
REFERENCES "portal_intake_scan_runs"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
