-- CreateEnum
CREATE TYPE "CompetitorEntityType" AS ENUM ('BUSINESS', 'PERSON', 'PRODUCT', 'ORG');

-- CreateEnum
CREATE TYPE "CompetitorRelationshipType" AS ENUM ('DIRECT', 'INDIRECT', 'SUBSTITUTE', 'INSPIRATION', 'COMPLEMENT');

-- CreateEnum
CREATE TYPE "CompetitorEntityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CompetitorSurfaceType" AS ENUM ('WEBSITE', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'X', 'LINKEDIN', 'APP_STORE', 'DIRECTORY', 'OTHER');

-- CreateEnum
CREATE TYPE "CompetitorScrapeCapability" AS ENUM ('SCRAPABLE_NOW', 'NOT_SCRAPABLE_YET', 'HARD_BLOCKED');

-- CreateEnum
CREATE TYPE "EvidenceRefKind" AS ENUM ('WEB_SNAPSHOT', 'WEB_EXTRACTION', 'URL', 'DOCUMENT', 'CRAWL_RUN', 'SOCIAL_POST', 'NEWS_ITEM', 'OTHER');

-- CreateTable
CREATE TABLE "competitor_entities" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "entity_type" "CompetitorEntityType" NOT NULL DEFAULT 'BUSINESS',
    "name" TEXT NOT NULL,
    "primary_domain" TEXT,
    "canonical_url" TEXT,
    "relationship_type" "CompetitorRelationshipType",
    "confidence" DOUBLE PRECISION,
    "tags" JSONB,
    "fingerprint_json" JSONB,
    "created_by" TEXT NOT NULL DEFAULT 'SYSTEM',
    "status" "CompetitorEntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_surfaces" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "surface_type" "CompetitorSurfaceType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "url" TEXT,
    "scrape_capability" "CompetitorScrapeCapability" NOT NULL DEFAULT 'NOT_SCRAPABLE_YET',
    "blocker_reason_code" TEXT,
    "last_scraped_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_surfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_refs" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "surface_id" TEXT,
    "kind" "EvidenceRefKind" NOT NULL,
    "ref_id" TEXT,
    "url" TEXT,
    "label" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_entities_relationship_idx" ON "competitor_entities"("research_job_id", "relationship_type", "confidence" DESC);

-- CreateIndex
CREATE INDEX "competitor_entities_domain_idx" ON "competitor_entities"("research_job_id", "primary_domain");

-- CreateIndex
CREATE UNIQUE INDEX "comp_entities_rj_et_pd_key" ON "competitor_entities"("research_job_id", "entity_type", "primary_domain");

-- CreateIndex
CREATE UNIQUE INDEX "comp_surfaces_rj_st_nv_key" ON "competitor_surfaces"("research_job_id", "surface_type", "normalized_value");

-- CreateIndex
CREATE INDEX "competitor_surfaces_entity_surface_idx" ON "competitor_surfaces"("entity_id", "surface_type");

-- CreateIndex
CREATE INDEX "competitor_surfaces_research_surface_capability_idx" ON "competitor_surfaces"("research_job_id", "surface_type", "scrape_capability");

-- CreateIndex
CREATE INDEX "evidence_refs_job_kind_created_idx" ON "evidence_refs"("research_job_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "evidence_refs_entity_kind_idx" ON "evidence_refs"("entity_id", "kind");

-- CreateIndex
CREATE INDEX "evidence_refs_surface_idx" ON "evidence_refs"("surface_id");

-- AddForeignKey
ALTER TABLE "competitor_entities" ADD CONSTRAINT "competitor_entities_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_surfaces" ADD CONSTRAINT "competitor_surfaces_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_surfaces" ADD CONSTRAINT "competitor_surfaces_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "competitor_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_refs" ADD CONSTRAINT "evidence_refs_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_refs" ADD CONSTRAINT "evidence_refs_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "competitor_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_refs" ADD CONSTRAINT "evidence_refs_surface_id_fkey" FOREIGN KEY ("surface_id") REFERENCES "competitor_surfaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
