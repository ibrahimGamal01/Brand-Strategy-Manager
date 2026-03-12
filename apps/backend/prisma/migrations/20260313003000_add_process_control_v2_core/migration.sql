-- CreateEnum
CREATE TYPE "ProcessRunDocumentType" AS ENUM ('BUSINESS_STRATEGY');

-- CreateEnum
CREATE TYPE "ProcessRunStage" AS ENUM (
  'INTAKE_READY',
  'METHOD_SELECTED',
  'RESEARCHING',
  'SECTION_PLANNING',
  'SECTION_DRAFTING',
  'SECTION_VALIDATING',
  'WAITING_USER',
  'COMPOSING',
  'FINAL_GATE',
  'READY',
  'NEEDS_HUMAN_REVIEW',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "ProcessRunStatus" AS ENUM (
  'RUNNING',
  'WAITING_USER',
  'PAUSED',
  'READY',
  'NEEDS_HUMAN_REVIEW',
  'FAILED',
  'CANCELLED'
);

-- CreateEnum
CREATE TYPE "ProcessRunMethod" AS ENUM ('NICHE_STANDARD', 'BAT_CORE');

-- CreateEnum
CREATE TYPE "ProcessQuestionSeverity" AS ENUM ('BLOCKER', 'IMPORTANT', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "ProcessQuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ProcessSectionStatus" AS ENUM (
  'PLANNED',
  'DRAFTED',
  'VALIDATED',
  'NEEDS_USER_INPUT',
  'NEEDS_REVIEW',
  'READY',
  'LOCKED'
);

-- CreateEnum
CREATE TYPE "ProcessGateStatus" AS ENUM ('PASS', 'FAIL', 'HOLD');

-- CreateEnum
CREATE TYPE "ProcessEscalationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "process_runs" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "document_type" "ProcessRunDocumentType" NOT NULL DEFAULT 'BUSINESS_STRATEGY',
  "stage" "ProcessRunStage" NOT NULL DEFAULT 'INTAKE_READY',
  "status" "ProcessRunStatus" NOT NULL DEFAULT 'RUNNING',
  "objective" TEXT,
  "idempotency_key" TEXT,
  "method" "ProcessRunMethod",
  "method_rule_id" TEXT,
  "method_inputs_json" JSONB,
  "method_evidence_json" JSONB,
  "composed_markdown" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "retry_with_new_evidence_count" INTEGER NOT NULL DEFAULT 0,
  "max_retries" INTEGER NOT NULL DEFAULT 3,
  "max_retry_with_evidence" INTEGER NOT NULL DEFAULT 2,
  "last_retried_at" TIMESTAMP(3),
  "paused_at" TIMESTAMP(3),
  "last_error" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "process_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_section_runs" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "section_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "framework" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "ProcessSectionStatus" NOT NULL DEFAULT 'PLANNED',
  "required_inputs_json" JSONB,
  "required_evidence_json" JSONB,
  "entry_satisfied" BOOLEAN NOT NULL DEFAULT false,
  "exit_satisfied" BOOLEAN NOT NULL DEFAULT false,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "process_section_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_section_revisions" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "section_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "markdown" TEXT NOT NULL,
  "summary" TEXT,
  "created_by_role" TEXT NOT NULL,
  "evidence_record_ids_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "process_section_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_question_tasks" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "section_run_id" TEXT,
  "field_key" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "severity" "ProcessQuestionSeverity" NOT NULL,
  "status" "ProcessQuestionStatus" NOT NULL DEFAULT 'OPEN',
  "surfaces_json" JSONB,
  "answer_json" JSONB,
  "requested_by" TEXT,
  "answered_by" TEXT,
  "answered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "process_question_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_evidence_records" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "section_run_id" TEXT,
  "source_type" TEXT NOT NULL,
  "ref_id" TEXT,
  "url" TEXT,
  "title" TEXT,
  "snippet" TEXT,
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "process_evidence_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_claim_records" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "section_run_id" TEXT NOT NULL,
  "revision_id" TEXT,
  "claim_text" TEXT NOT NULL,
  "material" BOOLEAN NOT NULL DEFAULT true,
  "evidence_record_ids_json" JSONB,
  "grounding_status" TEXT NOT NULL DEFAULT 'ungrounded',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "process_claim_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_gate_results" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "section_run_id" TEXT,
  "gate_name" TEXT NOT NULL,
  "status" "ProcessGateStatus" NOT NULL,
  "passed" BOOLEAN NOT NULL DEFAULT false,
  "score" DOUBLE PRECISION,
  "rule_id" TEXT,
  "reasons_json" JSONB,
  "evidence_record_ids_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "process_gate_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_decision_events" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "stage" "ProcessRunStage",
  "rule_id" TEXT NOT NULL,
  "input_snapshot_json" JSONB NOT NULL,
  "evidence_refs_json" JSONB,
  "output_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "process_decision_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_escalation_records" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" "ProcessEscalationStatus" NOT NULL DEFAULT 'OPEN',
  "created_by" TEXT NOT NULL,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "process_escalation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_run_events" (
  "id" TEXT NOT NULL,
  "process_run_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "process_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "process_runs_workspace_idempotency_key" ON "process_runs"("research_job_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "process_runs_workspace_stage_created_idx" ON "process_runs"("research_job_id", "stage", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_runs_workspace_doc_created_idx" ON "process_runs"("research_job_id", "document_type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "process_section_runs_run_section_key" ON "process_section_runs"("process_run_id", "section_key");

-- CreateIndex
CREATE INDEX "process_section_runs_workspace_run_order_idx" ON "process_section_runs"("research_job_id", "process_run_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "process_section_revisions_section_revision_key" ON "process_section_revisions"("section_run_id", "revision_number");

-- CreateIndex
CREATE INDEX "process_section_revisions_workspace_run_created_idx" ON "process_section_revisions"("research_job_id", "process_run_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_question_tasks_run_status_severity_idx" ON "process_question_tasks"("process_run_id", "status", "severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_question_tasks_workspace_section_idx" ON "process_question_tasks"("research_job_id", "section_run_id");

-- CreateIndex
CREATE INDEX "process_evidence_records_run_created_idx" ON "process_evidence_records"("process_run_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_evidence_records_workspace_source_idx" ON "process_evidence_records"("research_job_id", "source_type");

-- CreateIndex
CREATE INDEX "process_claim_records_run_section_created_idx" ON "process_claim_records"("process_run_id", "section_run_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_claim_records_workspace_grounding_idx" ON "process_claim_records"("research_job_id", "grounding_status");

-- CreateIndex
CREATE INDEX "process_gate_results_run_section_gate_created_idx" ON "process_gate_results"("process_run_id", "section_run_id", "gate_name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_gate_results_workspace_status_idx" ON "process_gate_results"("research_job_id", "status");

-- CreateIndex
CREATE INDEX "process_decision_events_run_created_idx" ON "process_decision_events"("process_run_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_decision_events_workspace_rule_created_idx" ON "process_decision_events"("research_job_id", "rule_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_escalation_records_run_status_created_idx" ON "process_escalation_records"("process_run_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "process_escalation_records_workspace_status_idx" ON "process_escalation_records"("research_job_id", "status");

-- CreateIndex
CREATE INDEX "process_run_events_run_created_idx" ON "process_run_events"("process_run_id", "created_at");

-- CreateIndex
CREATE INDEX "process_run_events_workspace_type_created_idx" ON "process_run_events"("research_job_id", "type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "process_runs" ADD CONSTRAINT "process_runs_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_section_runs" ADD CONSTRAINT "process_section_runs_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_section_runs" ADD CONSTRAINT "process_section_runs_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_section_revisions" ADD CONSTRAINT "process_section_revisions_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_section_revisions" ADD CONSTRAINT "process_section_revisions_section_run_id_fkey" FOREIGN KEY ("section_run_id") REFERENCES "process_section_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_section_revisions" ADD CONSTRAINT "process_section_revisions_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_question_tasks" ADD CONSTRAINT "process_question_tasks_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_question_tasks" ADD CONSTRAINT "process_question_tasks_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_question_tasks" ADD CONSTRAINT "process_question_tasks_section_run_id_fkey" FOREIGN KEY ("section_run_id") REFERENCES "process_section_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_evidence_records" ADD CONSTRAINT "process_evidence_records_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_evidence_records" ADD CONSTRAINT "process_evidence_records_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_evidence_records" ADD CONSTRAINT "process_evidence_records_section_run_id_fkey" FOREIGN KEY ("section_run_id") REFERENCES "process_section_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_claim_records" ADD CONSTRAINT "process_claim_records_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_claim_records" ADD CONSTRAINT "process_claim_records_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_claim_records" ADD CONSTRAINT "process_claim_records_section_run_id_fkey" FOREIGN KEY ("section_run_id") REFERENCES "process_section_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_claim_records" ADD CONSTRAINT "process_claim_records_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "process_section_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_gate_results" ADD CONSTRAINT "process_gate_results_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_gate_results" ADD CONSTRAINT "process_gate_results_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_gate_results" ADD CONSTRAINT "process_gate_results_section_run_id_fkey" FOREIGN KEY ("section_run_id") REFERENCES "process_section_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_decision_events" ADD CONSTRAINT "process_decision_events_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_decision_events" ADD CONSTRAINT "process_decision_events_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_escalation_records" ADD CONSTRAINT "process_escalation_records_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_escalation_records" ADD CONSTRAINT "process_escalation_records_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_run_events" ADD CONSTRAINT "process_run_events_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "process_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_run_events" ADD CONSTRAINT "process_run_events_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
