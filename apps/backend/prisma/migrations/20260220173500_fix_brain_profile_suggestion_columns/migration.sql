-- Fix legacy brain_profile_suggestions table shape to match Prisma schema.

ALTER TABLE "brain_profile_suggestions"
  ADD COLUMN IF NOT EXISTS "approved_value" JSONB;
