-- De-duplicate evidence refs before adding uniqueness guarantees.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY research_job_id, kind, ref_id
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS row_num
    FROM evidence_refs
    WHERE ref_id IS NOT NULL
)
DELETE FROM evidence_refs target
USING ranked
WHERE target.id = ranked.id
  AND ranked.row_num > 1;

-- Enforce idempotency across repeated V3 runs and retries.
CREATE UNIQUE INDEX "evidence_refs_job_kind_ref_key"
ON "evidence_refs"("research_job_id", "kind", "ref_id");
