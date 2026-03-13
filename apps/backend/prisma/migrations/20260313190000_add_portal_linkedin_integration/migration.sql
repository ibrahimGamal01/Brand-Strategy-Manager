-- AlterTable
ALTER TABLE "social_profiles" ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "external_urn" TEXT,
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "profile_image_url" TEXT,
ADD COLUMN     "source_connection_id" TEXT,
ADD COLUMN     "source_type" TEXT;

-- CreateTable
CREATE TABLE "portal_linkedin_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'linkedin',
    "status" TEXT NOT NULL,
    "linkedin_member_id" TEXT,
    "linkedin_member_urn" TEXT,
    "email" TEXT,
    "display_name" TEXT,
    "profile_url" TEXT,
    "profile_image_url" TEXT,
    "headline" TEXT,
    "access_token_ciphertext" TEXT,
    "refresh_token_ciphertext" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scopes_json" JSONB,
    "social_profile_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "next_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "last_sync_error" TEXT,
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_linkedin_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_post_analytics_current" (
    "id" TEXT NOT NULL,
    "social_post_id" TEXT NOT NULL,
    "impressions" INTEGER,
    "unique_impressions" INTEGER,
    "clicks" INTEGER,
    "reactions" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "video_views" INTEGER,
    "watch_time_ms" INTEGER,
    "last_fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_stats_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linkedin_post_analytics_current_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_post_analytics_snapshots" (
    "id" TEXT NOT NULL,
    "social_post_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressions" INTEGER,
    "unique_impressions" INTEGER,
    "clicks" INTEGER,
    "reactions" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "video_views" INTEGER,
    "watch_time_ms" INTEGER,
    "raw_stats_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linkedin_post_analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_linkedin_connections_workspace_status_next_sync_idx" ON "portal_linkedin_connections"("research_job_id", "status", "next_sync_at");

-- CreateIndex
CREATE INDEX "portal_linkedin_connections_social_profile_idx" ON "portal_linkedin_connections"("social_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_linkedin_connections_user_workspace_provider_key" ON "portal_linkedin_connections"("user_id", "research_job_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "linkedin_post_analytics_current_social_post_id_key" ON "linkedin_post_analytics_current"("social_post_id");

-- CreateIndex
CREATE INDEX "linkedin_post_analytics_current_last_fetched_idx" ON "linkedin_post_analytics_current"("last_fetched_at");

-- CreateIndex
CREATE INDEX "linkedin_post_analytics_snapshot_post_captured_idx" ON "linkedin_post_analytics_snapshots"("social_post_id", "captured_at" DESC);

-- AddForeignKey
ALTER TABLE "portal_linkedin_connections" ADD CONSTRAINT "portal_linkedin_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_linkedin_connections" ADD CONSTRAINT "portal_linkedin_connections_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_linkedin_connections" ADD CONSTRAINT "portal_linkedin_connections_social_profile_id_fkey" FOREIGN KEY ("social_profile_id") REFERENCES "social_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_post_analytics_current" ADD CONSTRAINT "linkedin_post_analytics_current_social_post_id_fkey" FOREIGN KEY ("social_post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_post_analytics_snapshots" ADD CONSTRAINT "linkedin_post_analytics_snapshots_social_post_id_fkey" FOREIGN KEY ("social_post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

