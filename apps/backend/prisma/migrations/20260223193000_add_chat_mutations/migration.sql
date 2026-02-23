-- CreateEnum
CREATE TYPE "ChatMutationKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'CLEAR');

-- CreateTable
CREATE TABLE "chat_mutations" (
    "id" TEXT NOT NULL,
    "research_job_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "kind" "ChatMutationKind" NOT NULL,
    "section" TEXT NOT NULL,
    "request_json" JSONB NOT NULL,
    "preview_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_mutations_research_job_id_created_at_idx" ON "chat_mutations"("research_job_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "chat_mutations_session_id_created_at_idx" ON "chat_mutations"("session_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "chat_mutations" ADD CONSTRAINT "chat_mutations_research_job_id_fkey" FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_mutations" ADD CONSTRAINT "chat_mutations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
