-- CreateEnum
CREATE TYPE "WebSourceType" AS ENUM ('CLIENT_SITE', 'COMPETITOR_SITE', 'ARTICLE', 'REVIEW', 'FORUM', 'DOC', 'OTHER');

-- CreateEnum
CREATE TYPE "WebSourceDiscoveryMethod" AS ENUM ('DDG', 'USER', 'SCRAPLING_CRAWL', 'CHAT_TOOL', 'IMPORT');

-- CreateEnum
CREATE TYPE "WebFetcherMode" AS ENUM ('AUTO', 'HTTP', 'DYNAMIC', 'STEALTH');

-- CreateTable
CREATE TABLE "web_sources" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "source_type" "WebSourceType" NOT NULL DEFAULT 'OTHER',
    "discovered_by" "WebSourceDiscoveryMethod" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "archived_at" TIMESTAMP(3),
    "archived_by" TEXT,
    "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
    "last_modified_at" TIMESTAMP(3),
    "last_modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_page_snapshots" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "web_source_id" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetcher_used" "WebFetcherMode" NOT NULL DEFAULT 'AUTO',
    "final_url" TEXT,
    "status_code" INTEGER,
    "content_hash" TEXT,
    "html_path" TEXT,
    "text_path" TEXT,
    "clean_text" TEXT,
    "metadata" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "archived_at" TIMESTAMP(3),
    "archived_by" TEXT,
    "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
    "last_modified_at" TIMESTAMP(3),
    "last_modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_page_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_extraction_recipes" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_domain" TEXT,
    "schema" JSONB NOT NULL,
    "created_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "archived_at" TIMESTAMP(3),
    "archived_by" TEXT,
    "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
    "last_modified_at" TIMESTAMP(3),
    "last_modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_extraction_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_extraction_runs" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "extracted" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION DEFAULT 0,
    "warnings" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "archived_at" TIMESTAMP(3),
    "archived_by" TEXT,
    "manually_modified" BOOLEAN NOT NULL DEFAULT FALSE,
    "last_modified_at" TIMESTAMP(3),
    "last_modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adaptive_selector_memory" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "element_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adaptive_selector_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_sources_research_job_id_url_key" ON "web_sources"("research_job_id", "url");

-- CreateIndex
CREATE INDEX "web_sources_research_job_id_domain_idx" ON "web_sources"("research_job_id", "domain");

-- CreateIndex
CREATE INDEX "web_sources_is_active_idx" ON "web_sources"("is_active");

-- CreateIndex
CREATE INDEX "web_page_snapshots_research_job_id_fetched_at_idx" ON "web_page_snapshots"("research_job_id", "fetched_at");

-- CreateIndex
CREATE INDEX "web_page_snapshots_web_source_id_fetched_at_idx" ON "web_page_snapshots"("web_source_id", "fetched_at");

-- CreateIndex
CREATE INDEX "web_page_snapshots_content_hash_idx" ON "web_page_snapshots"("content_hash");

-- CreateIndex
CREATE INDEX "web_page_snapshots_is_active_idx" ON "web_page_snapshots"("is_active");

-- CreateIndex
CREATE INDEX "web_extraction_recipes_research_job_id_name_idx" ON "web_extraction_recipes"("research_job_id", "name");

-- CreateIndex
CREATE INDEX "web_extraction_recipes_is_active_idx" ON "web_extraction_recipes"("is_active");

-- CreateIndex
CREATE INDEX "web_extraction_runs_research_job_id_created_at_idx" ON "web_extraction_runs"("research_job_id", "created_at");

-- CreateIndex
CREATE INDEX "web_extraction_runs_recipe_id_created_at_idx" ON "web_extraction_runs"("recipe_id", "created_at");

-- CreateIndex
CREATE INDEX "web_extraction_runs_snapshot_id_created_at_idx" ON "web_extraction_runs"("snapshot_id", "created_at");

-- CreateIndex
CREATE INDEX "web_extraction_runs_is_active_idx" ON "web_extraction_runs"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "adaptive_selector_memory_research_job_id_namespace_key_key" ON "adaptive_selector_memory"("research_job_id", "namespace", "key");

-- CreateIndex
CREATE INDEX "adaptive_selector_memory_research_job_id_namespace_idx" ON "adaptive_selector_memory"("research_job_id", "namespace");

-- AddForeignKey
ALTER TABLE "web_sources" ADD CONSTRAINT "web_sources_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_page_snapshots" ADD CONSTRAINT "web_page_snapshots_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_page_snapshots" ADD CONSTRAINT "web_page_snapshots_web_source_id_fkey" FOREIGN KEY ("web_source_id") REFERENCES "web_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_extraction_recipes" ADD CONSTRAINT "web_extraction_recipes_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_extraction_runs" ADD CONSTRAINT "web_extraction_runs_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_extraction_runs" ADD CONSTRAINT "web_extraction_runs_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "web_extraction_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_extraction_runs" ADD CONSTRAINT "web_extraction_runs_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "web_page_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adaptive_selector_memory" ADD CONSTRAINT "adaptive_selector_memory_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
