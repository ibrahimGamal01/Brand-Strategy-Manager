-- AlterTable
ALTER TABLE "chat_mutations"
ADD COLUMN "applied_at" TIMESTAMP(3),
ADD COLUMN "undone_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "chat_mutation_undo_snapshots" (
    "id" TEXT NOT NULL,
    "mutation_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "before_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_mutation_undo_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_mutation_undo_snapshots_mutation_id_idx" ON "chat_mutation_undo_snapshots"("mutation_id");

-- CreateIndex
CREATE INDEX "chat_mutation_undo_snapshots_model_name_record_id_idx" ON "chat_mutation_undo_snapshots"("model_name", "record_id");

-- AddForeignKey
ALTER TABLE "chat_mutation_undo_snapshots" ADD CONSTRAINT "chat_mutation_undo_snapshots_mutation_id_fkey" FOREIGN KEY ("mutation_id") REFERENCES "chat_mutations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
