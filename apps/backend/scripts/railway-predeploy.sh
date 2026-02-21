#!/usr/bin/env bash
set -euo pipefail

LEGACY_BASELINE_MIGRATION="${LEGACY_BASELINE_MIGRATION:-20260211113000_competitor_orchestrator_v2}"

if [ -f "apps/backend/prisma/schema.prisma" ]; then
  SCHEMA_PATH="${PRISMA_SCHEMA_PATH:-apps/backend/prisma/schema.prisma}"
  MIGRATIONS_DIR="${PRISMA_MIGRATIONS_DIR:-apps/backend/prisma/migrations}"
elif [ -f "prisma/schema.prisma" ]; then
  SCHEMA_PATH="${PRISMA_SCHEMA_PATH:-prisma/schema.prisma}"
  MIGRATIONS_DIR="${PRISMA_MIGRATIONS_DIR:-prisma/migrations}"
else
  echo "Could not locate Prisma schema file."
  exit 1
fi

echo "Running Prisma migrate deploy..."
set +e
MIGRATE_OUTPUT="$(npx prisma migrate deploy --schema "$SCHEMA_PATH" 2>&1)"
MIGRATE_STATUS=$?
set -e
echo "$MIGRATE_OUTPUT"

if [ "$MIGRATE_STATUS" -eq 0 ]; then
  echo "Prisma migrations are up to date."
  exit 0
fi

if ! printf '%s' "$MIGRATE_OUTPUT" | grep -Eq 'P3009|P3018'; then
  echo "Prisma migrate deploy failed with a non-recoverable error."
  exit "$MIGRATE_STATUS"
fi

if ! printf '%s' "$MIGRATE_OUTPUT" | grep -q "$LEGACY_BASELINE_MIGRATION"; then
  echo "Failed migration is not the known legacy baseline ($LEGACY_BASELINE_MIGRATION)."
  echo "Automatic recovery skipped."
  exit "$MIGRATE_STATUS"
fi

echo "Detected legacy baseline migration failure. Starting one-time bootstrap recovery..."
npx prisma migrate resolve --schema "$SCHEMA_PATH" --rolled-back "$LEGACY_BASELINE_MIGRATION" || true

echo "Syncing schema with Prisma (db push)..."
npx prisma db push --schema "$SCHEMA_PATH"

echo "Marking existing local migrations as applied in this environment..."
for migration in $(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}_'); do
  npx prisma migrate resolve --schema "$SCHEMA_PATH" --applied "$migration" || true
done

echo "Verifying migration state..."
npx prisma migrate deploy --schema "$SCHEMA_PATH"

echo "Railway predeploy DB step completed."
