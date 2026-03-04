-- CreateEnum
CREATE TYPE "SlackConversationType" AS ENUM ('CHANNEL', 'GROUP', 'IM', 'MPIM');

-- CreateEnum
CREATE TYPE "SlackInstallationStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "SlackBackfillState" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AttentionItemType" AS ENUM ('NEEDS_REPLY', 'FEEDBACK_REQUEST', 'DEADLINE');

-- CreateEnum
CREATE TYPE "AttentionItemStatus" AS ENUM ('OPEN', 'SNOOZED', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SLACK_ATTENTION', 'SLACK_DRAFT_READY', 'BAT_WAITING_INPUT', 'DEADLINE_REMINDER');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARN', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationDeliveryDestination" AS ENUM ('SLACK_DM', 'SLACK_CHANNEL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationJobType" AS ENUM ('SLACK_SYNC_CHANNELS', 'SLACK_BACKFILL_CHANNEL', 'SLACK_BACKFILL_THREAD', 'SLACK_TRIAGE_MESSAGE', 'ATTENTION_REMINDER_SCAN', 'BAT_WAITING_INPUT_SCAN');

-- CreateEnum
CREATE TYPE "IntegrationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'RETRY');

-- CreateTable
CREATE TABLE "slack_installations" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "enterprise_id" TEXT,
    "team_name" TEXT,
    "bot_user_id" TEXT NOT NULL,
    "bot_token_enc" TEXT NOT NULL,
    "bot_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "installed_by_slack_user_id" TEXT NOT NULL,
    "installed_by_portal_user_id" TEXT,
    "default_notify_channel_id" TEXT,
    "settings_json" JSONB,
    "status" "SlackInstallationStatus" NOT NULL DEFAULT 'ACTIVE',
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_user_links" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "portal_user_id" TEXT,
    "email" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_user_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_channels" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_member" BOOLEAN NOT NULL DEFAULT false,
    "conversation_type" "SlackConversationType" NOT NULL DEFAULT 'CHANNEL',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_channel_links" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "backfill_state" "SlackBackfillState" NOT NULL DEFAULT 'PENDING',
    "backfill_cursor" TEXT,
    "backfill_error" TEXT,
    "last_backfill_at" TIMESTAMP(3),
    "created_by_portal_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_channel_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_channel_owners" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "portal_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_channel_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_messages" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_ts" TEXT NOT NULL,
    "thread_ts" TEXT,
    "research_job_id" TEXT,
    "slack_user_id" TEXT,
    "text" TEXT NOT NULL,
    "raw_json" JSONB,
    "permalink" TEXT,
    "message_created_at" TIMESTAMP(3) NOT NULL,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_event_receipts" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_event_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attention_items" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_message_id" TEXT,
    "slack_message_ts" TEXT,
    "thread_ts" TEXT,
    "type" "AttentionItemType" NOT NULL,
    "summary" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "status" "AttentionItemStatus" NOT NULL DEFAULT 'OPEN',
    "draft_reply" TEXT,
    "assigned_slack_user_id" TEXT,
    "assigned_portal_user_id" TEXT,
    "last_notified_at" TIMESTAMP(3),
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attention_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "research_job_id" TEXT,
    "attention_item_id" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata_json" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "slack_team_id" TEXT,
    "slack_channel_id" TEXT,
    "slack_user_id" TEXT,
    "destination" "NotificationDeliveryDestination" NOT NULL,
    "slack_message_ts" TEXT,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_jobs" (
    "id" TEXT NOT NULL,
    "type" "IntegrationJobType" NOT NULL,
    "status" "IntegrationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "research_job_id" TEXT,
    "slack_team_id" TEXT,
    "payload_json" JSONB,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "last_error" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slack_installations_status_updated_idx" ON "slack_installations"("status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "slack_installations_team_key" ON "slack_installations"("slack_team_id");

-- CreateIndex
CREATE INDEX "slack_user_links_portal_user_idx" ON "slack_user_links"("portal_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_user_links_team_user_key" ON "slack_user_links"("slack_team_id", "slack_user_id");

-- CreateIndex
CREATE INDEX "slack_channels_team_updated_idx" ON "slack_channels"("slack_team_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "slack_channels_team_member_archived_idx" ON "slack_channels"("slack_team_id", "is_member", "is_archived");

-- CreateIndex
CREATE UNIQUE INDEX "slack_channels_team_channel_key" ON "slack_channels"("slack_team_id", "slack_channel_id");

-- CreateIndex
CREATE INDEX "slack_channel_links_workspace_enabled_idx" ON "slack_channel_links"("research_job_id", "enabled");

-- CreateIndex
CREATE INDEX "slack_channel_links_backfill_state_updated_idx" ON "slack_channel_links"("backfill_state", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "slack_channel_links_team_channel_key" ON "slack_channel_links"("slack_team_id", "slack_channel_id");

-- CreateIndex
CREATE INDEX "slack_channel_owners_portal_user_idx" ON "slack_channel_owners"("portal_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_channel_owners_team_channel_user_key" ON "slack_channel_owners"("slack_team_id", "slack_channel_id", "slack_user_id");

-- CreateIndex
CREATE INDEX "slack_messages_workspace_created_idx" ON "slack_messages"("research_job_id", "message_created_at" DESC);

-- CreateIndex
CREATE INDEX "slack_messages_team_channel_thread_idx" ON "slack_messages"("slack_team_id", "slack_channel_id", "thread_ts");

-- CreateIndex
CREATE UNIQUE INDEX "slack_messages_team_channel_ts_key" ON "slack_messages"("slack_team_id", "slack_channel_id", "slack_ts");

-- CreateIndex
CREATE INDEX "slack_event_receipts_team_received_idx" ON "slack_event_receipts"("slack_team_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "slack_event_receipts_team_event_key" ON "slack_event_receipts"("slack_team_id", "event_id");

-- CreateIndex
CREATE INDEX "attention_items_workspace_status_due_idx" ON "attention_items"("research_job_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "attention_items_team_channel_status_idx" ON "attention_items"("slack_team_id", "slack_channel_id", "status");

-- CreateIndex
CREATE INDEX "attention_items_assigned_portal_status_idx" ON "attention_items"("assigned_portal_user_id", "status");

-- CreateIndex
CREATE INDEX "notifications_portal_user_read_created_idx" ON "notifications"("portal_user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_workspace_created_idx" ON "notifications"("research_job_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_attention_item_idx" ON "notifications"("attention_item_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_created_idx" ON "notification_deliveries"("notification_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_deliveries_destination_status_created_idx" ON "notification_deliveries"("destination", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "integration_jobs_status_run_at_idx" ON "integration_jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "integration_jobs_type_status_run_at_idx" ON "integration_jobs"("type", "status", "run_at");

-- CreateIndex
CREATE INDEX "integration_jobs_workspace_status_run_at_idx" ON "integration_jobs"("research_job_id", "status", "run_at");

-- AddForeignKey
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_installed_by_portal_user_id_fkey" FOREIGN KEY ("installed_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channels" ADD CONSTRAINT "slack_channels_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_links" ADD CONSTRAINT "slack_channel_links_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_links" ADD CONSTRAINT "slack_channel_links_slack_team_id_slack_channel_id_fkey" FOREIGN KEY ("slack_team_id", "slack_channel_id") REFERENCES "slack_channels"("slack_team_id", "slack_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_links" ADD CONSTRAINT "slack_channel_links_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_links" ADD CONSTRAINT "slack_channel_links_created_by_portal_user_id_fkey" FOREIGN KEY ("created_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_owners" ADD CONSTRAINT "slack_channel_owners_slack_team_id_slack_channel_id_fkey" FOREIGN KEY ("slack_team_id", "slack_channel_id") REFERENCES "slack_channels"("slack_team_id", "slack_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_owners" ADD CONSTRAINT "slack_channel_owners_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_slack_team_id_slack_channel_id_fkey" FOREIGN KEY ("slack_team_id", "slack_channel_id") REFERENCES "slack_channels"("slack_team_id", "slack_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_event_receipts" ADD CONSTRAINT "slack_event_receipts_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_slack_team_id_slack_channel_id_fkey" FOREIGN KEY ("slack_team_id", "slack_channel_id") REFERENCES "slack_channels"("slack_team_id", "slack_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_slack_message_id_fkey" FOREIGN KEY ("slack_message_id") REFERENCES "slack_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_assigned_portal_user_id_fkey" FOREIGN KEY ("assigned_portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attention_item_id_fkey" FOREIGN KEY ("attention_item_id") REFERENCES "attention_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_slack_team_id_slack_channel_id_fkey" FOREIGN KEY ("slack_team_id", "slack_channel_id") REFERENCES "slack_channels"("slack_team_id", "slack_channel_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "slack_installations"("slack_team_id") ON DELETE SET NULL ON UPDATE CASCADE;

