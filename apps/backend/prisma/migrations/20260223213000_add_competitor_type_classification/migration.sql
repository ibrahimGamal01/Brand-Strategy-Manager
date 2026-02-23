-- CreateEnum
CREATE TYPE "CompetitorType" AS ENUM ('DIRECT', 'INDIRECT', 'ADJACENT', 'MARKETPLACE', 'MEDIA', 'INFLUENCER', 'COMMUNITY', 'UNKNOWN');

-- AlterTable
ALTER TABLE "competitor_candidate_profiles"
ADD COLUMN "competitor_type" "CompetitorType",
ADD COLUMN "type_confidence" DOUBLE PRECISION,
ADD COLUMN "entity_flags" JSONB;

-- AlterTable
ALTER TABLE "discovered_competitors"
ADD COLUMN "competitor_type" "CompetitorType",
ADD COLUMN "type_confidence" DOUBLE PRECISION,
ADD COLUMN "entity_flags" JSONB;

-- CreateIndex
CREATE INDEX "competitor_candidate_type_state_idx" ON "competitor_candidate_profiles"("research_job_id", "competitor_type", "state");

-- CreateIndex
CREATE INDEX "discovered_competitors_type_state_idx" ON "discovered_competitors"("research_job_id", "competitor_type", "selection_state");
