#!/usr/bin/env bash
set -euo pipefail

TARGET_PROJECT="vibrant-ambition"
TARGET_ENVIRONMENT="production"
POSTGRES_SERVICE="Postgres"
BACKEND_SERVICE="Brand-Strategy-Manager"

usage() {
  cat <<'EOF'
Usage:
  backup-railway-v1.sh [--label <label>] [--workspace <workspace-note>]

Description:
  Creates a V1 production backup package:
  - local DB full dump (custom format)
  - local DB schema dump (sql)
  - local storage archive from backend service
  - cloud clone database in Railway Postgres
  - manifest.json + checksum files

Notes:
  - Railway CLI must already be linked to the target project/environment.
  - Uses Railway Postgres pg_dump (v17) via `railway ssh -s Postgres`.
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

sha256_file() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
  else
    shasum -a 256 "$file_path" | awk '{print $1}'
  fi
}

sanitize_snapshot_id() {
  local raw="$1"
  local value
  value="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//; s/-*$//')"
  if [ -z "$value" ]; then
    value="$(date -u +%Y%m%dt%H%M%SZ | tr '[:upper:]' '[:lower:]')"
  fi
  printf '%s' "$value"
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

extract_railway_variable() {
  local service="$1"
  local var_name="$2"
  railway run -s "$service" -- env | awk -F= -v key="$var_name" '$1 == key { print substr($0, index($0, "=") + 1); exit }'
}

LABEL=""
WORKSPACE_NOTE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    --workspace)
      WORKSPACE_NOTE="${2:-}"
      shift 2
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

require_cmd railway
require_cmd node
require_cmd psql
require_cmd awk
require_cmd sed
require_cmd grep

download_remote_file_with_retries() {
  local service="$1"
  local remote_path="$2"
  local local_path="$3"
  local attempts=0
  local max_attempts=3

  while [ "$attempts" -lt "$max_attempts" ]; do
    attempts=$((attempts + 1))
    if railway ssh -s "$service" -- cat "$remote_path" > "$local_path"; then
      return 0
    fi
    if [ "$attempts" -lt "$max_attempts" ]; then
      echo "Retrying download ($attempts/$max_attempts): $remote_path"
      sleep 2
    fi
  done

  echo "Failed to download remote file after $max_attempts attempts: $remote_path" >&2
  return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BACKUP_ROOT="$REPO_ROOT/backups/railway-v1"

mkdir -p "$BACKUP_ROOT"

TIMESTAMP_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SNAPSHOT_ID="$(sanitize_snapshot_id "${LABEL:-$TIMESTAMP_UTC}")"
SNAPSHOT_DIR="$BACKUP_ROOT/$SNAPSHOT_ID"

if [ -d "$SNAPSHOT_DIR" ]; then
  echo "Snapshot directory already exists: $SNAPSHOT_DIR" >&2
  exit 1
fi

mkdir -p "$SNAPSHOT_DIR"

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

DB_PUBLIC_URL="$(extract_railway_variable "$POSTGRES_SERVICE" "DATABASE_PUBLIC_URL")"
if [ -z "$DB_PUBLIC_URL" ]; then
  echo "Failed to resolve DATABASE_PUBLIC_URL from Railway Postgres service." >&2
  exit 1
fi

ADMIN_DB_URL="$(database_url_with_dbname "$DB_PUBLIC_URL" "postgres")"

CLONE_DATABASE="v1_$(printf '%s' "$SNAPSHOT_ID" | tr -cs 'a-z0-9' '_' | sed 's/^_*//; s/_*$//')"
if [ "${#CLONE_DATABASE}" -gt 63 ]; then
  CLONE_DATABASE="${CLONE_DATABASE:0:63}"
fi

if [ -z "$CLONE_DATABASE" ]; then
  echo "Failed to compute clone database name." >&2
  exit 1
fi

CLONE_EXISTS="$(psql "$ADMIN_DB_URL" -tAc "select 1 from pg_database where datname = '$CLONE_DATABASE' limit 1;" | tr -d '[:space:]')"
if [ "$CLONE_EXISTS" = "1" ]; then
  echo "Clone database already exists: $CLONE_DATABASE" >&2
  exit 1
fi

DUMP_FILE="$SNAPSHOT_DIR/railway-v1.dump"
SCHEMA_FILE="$SNAPSHOT_DIR/railway-v1.schema.sql"
STORAGE_ARCHIVE_FILE="$SNAPSHOT_DIR/storage-v1.tgz"
MANIFEST_FILE="$SNAPSHOT_DIR/manifest.json"
CHECKSUM_FILE="$SNAPSHOT_DIR/SHA256SUMS"

SOURCE_CONNECTIONS_LOCKED="false"
unlock_source_database_connections() {
  if [ "$SOURCE_CONNECTIONS_LOCKED" = "true" ]; then
    psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "alter database railway with allow_connections true;" >/dev/null || true
  fi
}
trap unlock_source_database_connections EXIT

echo "Creating cloud DB clone: $CLONE_DATABASE"
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "alter database railway with allow_connections false;" >/dev/null
SOURCE_CONNECTIONS_LOCKED="true"
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'railway' and pid <> pg_backend_pid();" >/dev/null
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "create database \"$CLONE_DATABASE\" template railway;"
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "alter database railway with allow_connections true;" >/dev/null
SOURCE_CONNECTIONS_LOCKED="false"

REMOTE_DB_DUMP="/tmp/${SNAPSHOT_ID}-railway-v1.dump"
REMOTE_SCHEMA_DUMP="/tmp/${SNAPSHOT_ID}-railway-v1.schema.sql"

echo "Creating full DB dump (custom format) on Railway Postgres service..."
railway ssh -s "$POSTGRES_SERVICE" -- pg_dump --format=custom --no-owner --no-privileges --file "$REMOTE_DB_DUMP"

echo "Creating schema-only SQL dump on Railway Postgres service..."
railway ssh -s "$POSTGRES_SERVICE" -- pg_dump --schema-only --no-owner --no-privileges --file "$REMOTE_SCHEMA_DUMP"

echo "Downloading DB dumps..."
download_remote_file_with_retries "$POSTGRES_SERVICE" "$REMOTE_DB_DUMP" "$DUMP_FILE"
download_remote_file_with_retries "$POSTGRES_SERVICE" "$REMOTE_SCHEMA_DUMP" "$SCHEMA_FILE"
railway ssh -s "$POSTGRES_SERVICE" -- rm -f "$REMOTE_DB_DUMP" "$REMOTE_SCHEMA_DUMP"

REMOTE_STORAGE_ARCHIVE="/tmp/storage-${SNAPSHOT_ID}.tgz"
echo "Creating backend storage archive on Railway backend service..."
railway ssh -s "$BACKEND_SERVICE" -- tar -czf "$REMOTE_STORAGE_ARCHIVE" -C /app/apps/backend storage

echo "Downloading backend storage archive..."
download_remote_file_with_retries "$BACKEND_SERVICE" "$REMOTE_STORAGE_ARCHIVE" "$STORAGE_ARCHIVE_FILE"
railway ssh -s "$BACKEND_SERVICE" -- rm -f "$REMOTE_STORAGE_ARCHIVE"

DB_DUMP_SHA="$(sha256_file "$DUMP_FILE")"
SCHEMA_SHA="$(sha256_file "$SCHEMA_FILE")"
STORAGE_SHA="$(sha256_file "$STORAGE_ARCHIVE_FILE")"

printf '%s  %s\n' "$DB_DUMP_SHA" "railway-v1.dump" > "$CHECKSUM_FILE"
printf '%s  %s\n' "$SCHEMA_SHA" "railway-v1.schema.sql" >> "$CHECKSUM_FILE"
printf '%s  %s\n' "$STORAGE_SHA" "storage-v1.tgz" >> "$CHECKSUM_FILE"

SOURCE_DB_SIZE="$(psql "$DB_PUBLIC_URL" -tAc "select pg_size_pretty(pg_database_size(current_database()));" | xargs)"
SOURCE_TABLE_COUNT="$(psql "$DB_PUBLIC_URL" -tAc "select count(*) from information_schema.tables where table_schema='public';" | xargs)"
CLONE_DB_URL="$(database_url_with_dbname "$DB_PUBLIC_URL" "$CLONE_DATABASE")"
CLONE_DB_SIZE="$(psql "$CLONE_DB_URL" -tAc "select pg_size_pretty(pg_database_size(current_database()));" | xargs)"
CLONE_TABLE_COUNT="$(psql "$CLONE_DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public';" | xargs)"

BACKEND_PUBLIC_URL="$(node -e '
  const status = JSON.parse(process.argv[1]);
  const envNode = (((status?.environments?.edges || [])[0] || {}).node) || {};
  const services = ((envNode?.serviceInstances?.edges || []).map((edge) => edge?.node || {}));
  const backend = services.find((svc) => String(svc?.serviceName || "") === process.argv[2]);
  const domain = String((((backend?.domains || {}).serviceDomains || [])[0] || {}).domain || "");
  process.stdout.write(domain ? `https://${domain}` : "");
' "$STATUS_JSON" "$BACKEND_SERVICE")"

export SNAPSHOT_ID
export SNAPSHOT_DIR
export TIMESTAMP_UTC
export WORKSPACE_NOTE
export TARGET_PROJECT
export TARGET_ENVIRONMENT
export POSTGRES_SERVICE
export BACKEND_SERVICE
export BACKEND_PUBLIC_URL
export CLONE_DATABASE
export SOURCE_DB_SIZE
export SOURCE_TABLE_COUNT
export CLONE_DB_SIZE
export CLONE_TABLE_COUNT
export DB_DUMP_SHA
export SCHEMA_SHA
export STORAGE_SHA
export DUMP_FILE_NAME="$(basename "$DUMP_FILE")"
export SCHEMA_FILE_NAME="$(basename "$SCHEMA_FILE")"
export STORAGE_FILE_NAME="$(basename "$STORAGE_ARCHIVE_FILE")"

node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const manifest = {
    snapshotId: process.env.SNAPSHOT_ID,
    createdAtUtc: process.env.TIMESTAMP_UTC,
    workspaceNote: process.env.WORKSPACE_NOTE || null,
    railway: {
      project: process.env.TARGET_PROJECT,
      environment: process.env.TARGET_ENVIRONMENT,
      postgresService: process.env.POSTGRES_SERVICE,
      backendService: process.env.BACKEND_SERVICE,
      backendPublicUrl: process.env.BACKEND_PUBLIC_URL || null,
      cloudCloneDatabase: process.env.CLONE_DATABASE,
    },
    sourceDatabase: {
      size: process.env.SOURCE_DB_SIZE || null,
      publicTableCount: Number(process.env.SOURCE_TABLE_COUNT || "0"),
    },
    cloudCloneDatabase: {
      name: process.env.CLONE_DATABASE,
      size: process.env.CLONE_DB_SIZE || null,
      publicTableCount: Number(process.env.CLONE_TABLE_COUNT || "0"),
    },
    localArtifacts: {
      dbDump: {
        file: process.env.DUMP_FILE_NAME,
        sha256: process.env.DB_DUMP_SHA,
      },
      schemaDump: {
        file: process.env.SCHEMA_FILE_NAME,
        sha256: process.env.SCHEMA_SHA,
      },
      storageArchive: {
        file: process.env.STORAGE_FILE_NAME,
        sha256: process.env.STORAGE_SHA,
      },
      checksumFile: "SHA256SUMS",
    },
    quickVerify: [
      "shasum -a 256 -c SHA256SUMS",
      `psql \"$DATABASE_PUBLIC_URL\" -tAc \"select count(*) from information_schema.tables where table_schema='public';\"`,
      `psql \"$DATABASE_PUBLIC_URL\" -tAc \"select pg_size_pretty(pg_database_size(current_database()));\"`,
    ],
  };
  fs.writeFileSync(path.join(process.env.SNAPSHOT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
'

echo "V1 backup completed."
echo "Snapshot ID: $SNAPSHOT_ID"
echo "Local folder: $SNAPSHOT_DIR"
echo "Cloud clone DB: $CLONE_DATABASE"
echo "Checksums:"
cat "$CHECKSUM_FILE"
