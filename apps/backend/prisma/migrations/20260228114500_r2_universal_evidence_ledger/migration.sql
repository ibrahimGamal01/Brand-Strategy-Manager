-- R2 universal evidence ledger (additive, non-breaking)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceEvidenceStatus') THEN
    CREATE TYPE "WorkspaceEvidenceStatus" AS ENUM ('RAW', 'PARTIAL', 'BLOCKED', 'VERIFIED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "workspace_evidence_refs" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "ref_id" TEXT,
  "url" TEXT,
  "label" TEXT,
  "snippet" TEXT,
  "content_hash" TEXT,
  "provider" TEXT,
  "run_id" TEXT,
  "status" "WorkspaceEvidenceStatus" NOT NULL DEFAULT 'RAW',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workspace_evidence_refs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_evidence_refs_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "workspace_evidence_links" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "evidence_ref_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_evidence_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_evidence_links_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_evidence_links_evidence_ref_id_fkey"
    FOREIGN KEY ("evidence_ref_id") REFERENCES "workspace_evidence_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "connector_runs" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "coverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "error" TEXT,
  "warnings" JSONB,
  "meta" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "connector_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "connector_runs_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "knowledge_ledger_versions" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "run_id" TEXT,
  "source" TEXT NOT NULL DEFAULT 'runtime',
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_ledger_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_ledger_versions_research_job_id_fkey"
    FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "workspace_evidence_refs_job_kind_created_idx"
  ON "workspace_evidence_refs"("research_job_id", "kind", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "workspace_evidence_refs_job_run_idx"
  ON "workspace_evidence_refs"("research_job_id", "run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_evidence_refs_job_kind_ref_key"
  ON "workspace_evidence_refs"("research_job_id", "kind", "ref_id");

CREATE INDEX IF NOT EXISTS "workspace_evidence_links_job_entity_idx"
  ON "workspace_evidence_links"("research_job_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "workspace_evidence_links_ref_idx"
  ON "workspace_evidence_links"("evidence_ref_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_evidence_links_unique_link_key"
  ON "workspace_evidence_links"("research_job_id", "evidence_ref_id", "entity_type", "entity_id", "role");

CREATE INDEX IF NOT EXISTS "connector_runs_job_platform_target_created_idx"
  ON "connector_runs"("research_job_id", "platform", "target", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "connector_runs_job_provider_created_idx"
  ON "connector_runs"("research_job_id", "provider", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "knowledge_ledger_versions_job_created_idx"
  ON "knowledge_ledger_versions"("research_job_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "knowledge_ledger_versions_job_run_idx"
  ON "knowledge_ledger_versions"("research_job_id", "run_id");
CREATE INDEX IF NOT EXISTS "knowledge_ledger_versions_job_source_idx"
  ON "knowledge_ledger_versions"("research_job_id", "source");
