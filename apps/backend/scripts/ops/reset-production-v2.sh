#!/usr/bin/env bash
set -euo pipefail

TARGET_PROJECT="vibrant-ambition"
TARGET_ENVIRONMENT="production"
POSTGRES_SERVICE="Postgres"
BACKEND_SERVICE="Brand-Strategy-Manager"

usage() {
  cat <<'EOF'
Usage:
  reset-production-v2.sh --snapshot-id <id> --confirm-reset-v2

Description:
  Performs destructive V2 production reset after verifying V1 backup exists:
  - verifies local V1 backup files and cloud clone DB
  - scales backend to 0 replicas
  - resets public schema
  - reapplies Prisma migrations
  - scales backend back to original replicas
  - wipes backend storage files
  - verifies health + clean baseline counts

Required:
  --snapshot-id <id>
  --confirm-reset-v2
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

extract_railway_variable() {
  local service="$1"
  local var_name="$2"
  railway run -s "$service" -- env | awk -F= -v key="$var_name" '$1 == key { print substr($0, index($0, "=") + 1); exit }'
}

database_url_with_dbname() {
  local url="$1"
  local db_name="$2"
  node -e '
    const raw = process.argv[1];
    const dbName = process.argv[2];
    const parsed = new URL(raw);
    parsed.pathname = "/" + dbName;
    process.stdout.write(parsed.toString());
  ' "$url" "$db_name"
}

SNAPSHOT_ID=""
CONFIRMED="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot-id)
      SNAPSHOT_ID="${2:-}"
      shift 2
      ;;
    --confirm-reset-v2)
      CONFIRMED="true"
      shift 1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$SNAPSHOT_ID" ]; then
  echo "--snapshot-id is required." >&2
  usage
  exit 1
fi

if [ "$CONFIRMED" != "true" ]; then
  echo "Refusing to continue without --confirm-reset-v2." >&2
  exit 1
fi

require_cmd railway
require_cmd node
require_cmd psql
require_cmd curl
require_cmd npx

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SNAPSHOT_DIR="$REPO_ROOT/backups/railway-v1/$SNAPSHOT_ID"
MANIFEST_PATH="$SNAPSHOT_DIR/manifest.json"
DUMP_PATH="$SNAPSHOT_DIR/railway-v1.dump"
SCHEMA_PATH="$SNAPSHOT_DIR/railway-v1.schema.sql"
STORAGE_PATH="$SNAPSHOT_DIR/storage-v1.tgz"

if [ ! -d "$SNAPSHOT_DIR" ]; then
  echo "Snapshot folder not found: $SNAPSHOT_DIR" >&2
  exit 1
fi
if [ ! -f "$MANIFEST_PATH" ] || [ ! -f "$DUMP_PATH" ] || [ ! -f "$SCHEMA_PATH" ] || [ ! -f "$STORAGE_PATH" ]; then
  echo "Snapshot is incomplete. Required files missing in $SNAPSHOT_DIR" >&2
  exit 1
fi

STATUS_JSON="$(railway status --json)"

node -e '
  const status = JSON.parse(process.argv[1]);
  const project = String(status?.name || "");
  const envNode = (((status?.environments?.edges || [])[0] || {}).node) || {};
  const environment = String(envNode?.name || "");
  const expectedProject = process.argv[2];
  const expectedEnvironment = process.argv[3];
  if (project !== expectedProject || environment !== expectedEnvironment) {
    console.error(`Railway context mismatch. expected=${expectedProject}/${expectedEnvironment}, actual=${project}/${environment}`);
    process.exit(1);
  }
' "$STATUS_JSON" "$TARGET_PROJECT" "$TARGET_ENVIRONMENT"

CLONE_DB="$(node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const clone = String(manifest?.railway?.cloudCloneDatabase || "").trim();
  if (!clone) process.exit(1);
  process.stdout.write(clone);
' "$MANIFEST_PATH")"

if [ -z "$CLONE_DB" ]; then
  echo "Cloud clone DB name missing in manifest: $MANIFEST_PATH" >&2
  exit 1
fi

DB_PUBLIC_URL="$(extract_railway_variable "$POSTGRES_SERVICE" "DATABASE_PUBLIC_URL")"
if [ -z "$DB_PUBLIC_URL" ]; then
  echo "Failed to resolve DATABASE_PUBLIC_URL from Railway Postgres service." >&2
  exit 1
fi
ADMIN_DB_URL="$(database_url_with_dbname "$DB_PUBLIC_URL" "postgres")"

CLONE_EXISTS="$(psql "$ADMIN_DB_URL" -tAc "select 1 from pg_database where datname = '$CLONE_DB' limit 1;" | tr -d '[:space:]')"
if [ "$CLONE_EXISTS" != "1" ]; then
  echo "Cloud clone DB not found: $CLONE_DB" >&2
  exit 1
fi

SCALE_MAP_JSON="$(node -e '
  const status = JSON.parse(process.argv[1]);
  const envNode = (((status?.environments?.edges || [])[0] || {}).node) || {};
  const services = ((envNode?.serviceInstances?.edges || []).map((edge) => edge?.node || {}));
  const backend = services.find((svc) => String(svc?.serviceName || "") === process.argv[2]);
  if (!backend) {
    console.error("Backend service not found in Railway status.");
    process.exit(1);
  }
  const deploy = (((backend?.latestDeployment || {}).meta || {}).serviceManifest || {}).deploy || {};
  const multi = deploy.multiRegionConfig && typeof deploy.multiRegionConfig === "object" ? deploy.multiRegionConfig : {};
  const out = {};
  for (const [region, value] of Object.entries(multi)) {
    const replicas = Number(value?.numReplicas || 0);
    out[region] = Number.isFinite(replicas) ? replicas : 0;
  }
  if (!Object.keys(out).length) {
    const fallbackRegion = String(deploy.region || "europe-west4-drams3a");
    const fallbackReplicas = Number(deploy.numReplicas || 1);
    out[fallbackRegion] = Number.isFinite(fallbackReplicas) ? fallbackReplicas : 1;
  }
  process.stdout.write(JSON.stringify(out));
' "$STATUS_JSON" "$BACKEND_SERVICE")"

BACKEND_BASE_URL="$(node -e '
  const status = JSON.parse(process.argv[1]);
  const envNode = (((status?.environments?.edges || [])[0] || {}).node) || {};
  const services = ((envNode?.serviceInstances?.edges || []).map((edge) => edge?.node || {}));
  const backend = services.find((svc) => String(svc?.serviceName || "") === process.argv[2]);
  const domain = String((((backend?.domains || {}).serviceDomains || [])[0] || {}).domain || "");
  process.stdout.write(domain ? `https://${domain}` : "");
' "$STATUS_JSON" "$BACKEND_SERVICE")"

if [ -z "$BACKEND_BASE_URL" ]; then
  echo "Failed to resolve backend public URL from Railway status." >&2
  exit 1
fi

SCALE_DOWN_APPLIED="false"
RESET_COMPLETED="false"

restore_backend_scale_on_error() {
  if [ "$SCALE_DOWN_APPLIED" != "true" ] || [ "$RESET_COMPLETED" = "true" ]; then
    return
  fi
  echo "Reset failed after scale-down. Attempting to restore backend replicas..."
  node -e '
    const map = JSON.parse(process.argv[1]);
    const service = process.argv[2];
    const { spawnSync } = require("node:child_process");
    for (const region of Object.keys(map)) {
      const replicas = String(map[region]);
      const args = ["scale", "--service", service, `--${region}`, replicas];
      const result = spawnSync("railway", args, { stdio: "inherit" });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  ' "$SCALE_MAP_JSON" "$BACKEND_SERVICE" || true
}

trap restore_backend_scale_on_error EXIT

echo "Scaling backend down to 0 replicas..."
node -e '
  const map = JSON.parse(process.argv[1]);
  const service = process.argv[2];
  const { spawnSync } = require("node:child_process");
  for (const region of Object.keys(map)) {
    const args = ["scale", "--service", service, `--${region}`, "0"];
    const result = spawnSync("railway", args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  }
' "$SCALE_MAP_JSON" "$BACKEND_SERVICE"
SCALE_DOWN_APPLIED="true"

echo "Resetting public schema..."
psql "$DB_PUBLIC_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
SQL

echo "Reapplying Prisma migrations..."
DATABASE_URL="$DB_PUBLIC_URL" npx prisma migrate deploy --schema "$REPO_ROOT/apps/backend/prisma/schema.prisma"

echo "Restoring backend replicas..."
node -e '
  const map = JSON.parse(process.argv[1]);
  const service = process.argv[2];
  const { spawnSync } = require("node:child_process");
  for (const region of Object.keys(map)) {
    const replicas = String(map[region]);
    const args = ["scale", "--service", service, `--${region}`, replicas];
    const result = spawnSync("railway", args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  }
' "$SCALE_MAP_JSON" "$BACKEND_SERVICE"

echo "Waiting for backend health..."
attempt=0
max_attempts=30
while [ "$attempt" -lt "$max_attempts" ]; do
  attempt=$((attempt + 1))
  if HEALTH_JSON="$(curl -fsS "$BACKEND_BASE_URL/api/health" 2>/dev/null)"; then
    STATUS="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(String(data.status || ""));' "$HEALTH_JSON" 2>/dev/null || true)"
    if [ "$STATUS" = "ok" ]; then
      break
    fi
  fi
  sleep 2
done

if [ "$attempt" -ge "$max_attempts" ]; then
  echo "Backend health check timed out at $BACKEND_BASE_URL/api/health" >&2
  exit 1
fi

echo "Wiping backend storage artifacts..."
railway ssh -s "$BACKEND_SERVICE" -- sh -lc 'find /app/apps/backend/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
STORAGE_ENTRY_COUNT="$(railway ssh -s "$BACKEND_SERVICE" -- sh -lc 'find /app/apps/backend/storage -mindepth 1 | wc -l' | tr -d '[:space:]')"
if [ "${STORAGE_ENTRY_COUNT:-0}" != "0" ]; then
  echo "Storage wipe verification failed. Remaining entries: $STORAGE_ENTRY_COUNT" >&2
  exit 1
fi

echo "Verifying critical table existence..."
for table_name in clients research_jobs portal_users chat_threads workspace_documents tool_runs process_events; do
  exists="$(psql "$DB_PUBLIC_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name='${table_name}';" | tr -d '[:space:]')"
  if [ "$exists" != "1" ]; then
    echo "Missing expected table after migration: $table_name" >&2
    exit 1
  fi
done

echo "Verifying clean baseline counts..."
for table_name in clients research_jobs portal_users chat_threads workspace_documents competitors social_profiles; do
  rows="$(psql "$DB_PUBLIC_URL" -tAc "select count(*) from ${table_name};" | tr -d '[:space:]')"
  if [ "${rows:-0}" != "0" ]; then
    echo "Table is not empty after reset: ${table_name}=${rows}" >&2
    exit 1
  fi
done

echo "V2 production reset complete."
echo "Snapshot used: $SNAPSHOT_ID"
echo "Cloud clone: $CLONE_DB"
echo "Backend health: $BACKEND_BASE_URL/api/health"
RESET_COMPLETED="true"
