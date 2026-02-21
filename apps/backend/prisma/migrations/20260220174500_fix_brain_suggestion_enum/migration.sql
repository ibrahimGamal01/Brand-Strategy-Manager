-- Ensure BrainProfileSuggestionStatus enum contains APPROVED for legacy databases.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrainProfileSuggestionStatus') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'BrainProfileSuggestionStatus'
        AND e.enumlabel = 'APPROVED'
    ) THEN
      ALTER TYPE "BrainProfileSuggestionStatus" ADD VALUE 'APPROVED';
    END IF;
  END IF;
END$$;
