-- Portal auth: users, sessions, memberships, email verification tokens.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PortalUserRole') THEN
    CREATE TYPE "PortalUserRole" AS ENUM ('ADMIN', 'CLIENT');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PortalEmailTokenType') THEN
    CREATE TYPE "PortalEmailTokenType" AS ENUM ('VERIFY_EMAIL', 'PASSWORD_RESET');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "portal_users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "full_name" TEXT,
  "company_name" TEXT,
  "email_verified_at" TIMESTAMP(3),
  "is_admin" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portal_workspace_memberships" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "role" "PortalUserRole" NOT NULL DEFAULT 'CLIENT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_workspace_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portal_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "user_agent" TEXT,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portal_email_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" "PortalEmailTokenType" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_email_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_users_email_key" ON "portal_users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_workspace_memberships_user_id_research_job_id_key"
  ON "portal_workspace_memberships"("user_id", "research_job_id");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_sessions_token_hash_key" ON "portal_sessions"("token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_email_tokens_token_hash_key" ON "portal_email_tokens"("token_hash");

CREATE INDEX IF NOT EXISTS "portal_workspace_memberships_research_job_id_role_idx"
  ON "portal_workspace_memberships"("research_job_id", "role");
CREATE INDEX IF NOT EXISTS "portal_sessions_user_id_created_at_idx"
  ON "portal_sessions"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "portal_sessions_expires_at_revoked_at_idx"
  ON "portal_sessions"("expires_at", "revoked_at");
CREATE INDEX IF NOT EXISTS "portal_email_tokens_user_id_type_created_at_idx"
  ON "portal_email_tokens"("user_id", "type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "portal_email_tokens_expires_at_used_at_idx"
  ON "portal_email_tokens"("expires_at", "used_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_workspace_memberships_user_id_fkey'
  ) THEN
    ALTER TABLE "portal_workspace_memberships"
      ADD CONSTRAINT "portal_workspace_memberships_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_workspace_memberships_research_job_id_fkey'
  ) THEN
    ALTER TABLE "portal_workspace_memberships"
      ADD CONSTRAINT "portal_workspace_memberships_research_job_id_fkey"
      FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_sessions_user_id_fkey'
  ) THEN
    ALTER TABLE "portal_sessions"
      ADD CONSTRAINT "portal_sessions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_email_tokens_user_id_fkey'
  ) THEN
    ALTER TABLE "portal_email_tokens"
      ADD CONSTRAINT "portal_email_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
