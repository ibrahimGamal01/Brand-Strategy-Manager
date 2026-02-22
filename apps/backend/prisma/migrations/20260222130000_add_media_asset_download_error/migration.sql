-- Add missing download_error column for media asset downloads
-- This aligns the production DB schema with prisma/schema.prisma
ALTER TABLE "media_assets"
ADD COLUMN IF NOT EXISTS "download_error" TEXT;
