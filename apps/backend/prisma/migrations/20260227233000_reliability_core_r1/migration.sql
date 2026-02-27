-- R1 reliability core: persist portal intake scan runs/events and add process event sequence cursor.

CREATE TABLE IF NOT EXISTS "portal_intake_scan_runs" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "initiated_by" TEXT NOT NULL,
  "targets_json" JSONB NOT NULL,
  "crawl_settings_json" JSONB,
  "targets_completed" INTEGER NOT NULL DEFAULT 0,
  "snapshots_saved" INTEGER NOT NULL DEFAULT 0,
  "pages_persisted" INTEGER NOT NULL DEFAULT 0,
  "warnings" INTEGER NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_intake_scan_runs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_intake_scan_runs_workspace_id_fkey'
  ) THEN
    ALTER TABLE "portal_intake_scan_runs"
      ADD CONSTRAINT "portal_intake_scan_runs_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "portal_intake_scan_runs_workspace_id_created_at_idx"
  ON "portal_intake_scan_runs"("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "portal_intake_scan_runs_workspace_id_status_created_at_idx"
  ON "portal_intake_scan_runs"("workspace_id", "status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "portal_intake_scan_events" (
  "id" SERIAL NOT NULL,
  "scan_run_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_intake_scan_events_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_intake_scan_events_scan_run_id_fkey'
  ) THEN
    ALTER TABLE "portal_intake_scan_events"
      ADD CONSTRAINT "portal_intake_scan_events_scan_run_id_fkey"
      FOREIGN KEY ("scan_run_id") REFERENCES "portal_intake_scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_intake_scan_events_workspace_id_fkey'
  ) THEN
    ALTER TABLE "portal_intake_scan_events"
      ADD CONSTRAINT "portal_intake_scan_events_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "portal_intake_scan_events_workspace_id_id_idx"
  ON "portal_intake_scan_events"("workspace_id", "id");
CREATE INDEX IF NOT EXISTS "portal_intake_scan_events_scan_run_id_id_idx"
  ON "portal_intake_scan_events"("scan_run_id", "id");

ALTER TABLE "process_events"
  ADD COLUMN IF NOT EXISTS "event_seq" BIGSERIAL;

CREATE INDEX IF NOT EXISTS "process_events_branch_id_event_seq_idx"
  ON "process_events"("branch_id", "event_seq");
