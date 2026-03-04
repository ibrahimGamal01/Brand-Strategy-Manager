# Railway V1 Backup + V2 Production Reset Runbook

Last updated: 2026-03-04 (Africa/Cairo)

## Scope

This runbook handles:

1. Create a production **V1 snapshot** (local archive + cloud DB clone in Railway).
2. Reset production to **V2 clean state** (database + backend storage artifacts wiped).
3. Restore (rollback) to V1 if needed.

This flow is intentionally destructive after backup verification.

## Preconditions

1. Linked Railway context must be:
   - project: `vibrant-ambition`
   - environment: `production`
2. Railway CLI authenticated and linked in this repo.
3. Local dependencies installed:
   - `npm ci`
4. No critical user traffic expected during reset window.

## Scripts

- Backup: [backup-railway-v1.sh](/Users/ibrahimgamal/Downloads/ali/upwork/brand-strategy-manager/apps/backend/scripts/ops/backup-railway-v1.sh)
- Reset: [reset-production-v2.sh](/Users/ibrahimgamal/Downloads/ali/upwork/brand-strategy-manager/apps/backend/scripts/ops/reset-production-v2.sh)
- Rollback: [rollback-to-v1.sh](/Users/ibrahimgamal/Downloads/ali/upwork/brand-strategy-manager/apps/backend/scripts/ops/rollback-to-v1.sh)
- V2 smoke: [test-v2-clean-state-smoke.ts](/Users/ibrahimgamal/Downloads/ali/upwork/brand-strategy-manager/apps/backend/src/scripts/test-v2-clean-state-smoke.ts)

## 1) Create V1 backup

```bash
npm run ops:backup:v1 --workspace=apps/backend -- --label=v1
```

Optional metadata:

```bash
npm run ops:backup:v1 --workspace=apps/backend -- --label=v1 --workspace "main workspace reset baseline"
```

The script prints:

- `Snapshot ID`
- local snapshot folder
- cloud clone DB name (`v1_<snapshot-id>`)

## 2) Verify V1 backup integrity

Use the printed `Snapshot ID`:

```bash
SNAPSHOT_ID=<snapshot-id>
cd backups/railway-v1/$SNAPSHOT_ID
shasum -a 256 -c SHA256SUMS
cat manifest.json
```

Cloud clone verification:

```bash
DB_PUBLIC_URL=$(railway run -s Postgres -- env | awk -F= '/^DATABASE_PUBLIC_URL=/{print $2}')
psql "$DB_PUBLIC_URL" -tAc "select datname from pg_database where datname = 'v1_${SNAPSHOT_ID//-/_}';"
```

If your snapshot ID includes characters converted by sanitization, use the exact clone name in `manifest.json` (`railway.cloudCloneDatabase`).

## 3) Execute V2 clean reset

```bash
npm run ops:reset:v2 --workspace=apps/backend -- --snapshot-id=$SNAPSHOT_ID --confirm-reset-v2
```

What this does:

1. Verifies local V1 artifacts exist.
2. Verifies cloud clone DB exists.
3. Scales backend replicas to 0.
4. Drops/recreates `public` schema.
5. Reapplies Prisma migrations.
6. Scales backend back to original replicas.
7. Wipes backend storage path `/app/apps/backend/storage/*`.
8. Verifies `/api/health` and key empty-table checks.

## 4) Post-reset smoke checks

```bash
export V2_BASE_URL=https://brand-strategy-manager-production.up.railway.app
export DATABASE_URL=$(railway run -s Postgres -- env | awk -F= '/^DATABASE_PUBLIC_URL=/{print $2}')
npm run test:v2-clean-state-smoke --workspace=apps/backend
```

Optional existing online runtime smoke (if creds configured):

```bash
npm run test:r1-online-smoke --workspace=apps/backend
```

## 5) Roll back to V1 (if required)

```bash
npm run ops:rollback:v1 --workspace=apps/backend -- --snapshot-id=$SNAPSHOT_ID --confirm-rollback-v1
```

Rollback performs:

1. Backend scale down.
2. Recreate `railway` DB from clone template.
3. Restore local storage archive to backend storage path.
4. Backend scale up and health wait.

## How to access V1 backups later

### Local archive

Path format:

`backups/railway-v1/<snapshot-id>/`

Contents:

- `manifest.json`
- `SHA256SUMS`
- `railway-v1.dump`
- `railway-v1.schema.sql`
- `storage-v1.tgz`

### Cloud clone

Clone database naming:

`v1_<snapshot-id-sanitized>`

Listing clones:

```bash
DB_PUBLIC_URL=$(railway run -s Postgres -- env | awk -F= '/^DATABASE_PUBLIC_URL=/{print $2}')
psql "$DB_PUBLIC_URL" -tAc "select datname from pg_database where datname like 'v1_%' order by datname;"
```

## Security notes

1. Do not store raw credentials in markdown or git.
2. Always read connection values at runtime from Railway CLI env.
3. Keep backup archives out of git history (see `.gitignore`).

## Troubleshooting

1. `pg_dump version mismatch`:
   - this flow intentionally runs `pg_dump` through Railway Postgres service (v17), not local `pg_dump`.
2. Missing clone DB:
   - check `manifest.json` for `railway.cloudCloneDatabase`.
3. Health timeout after reset:
   - inspect backend logs:
     - `railway logs --service Brand-Strategy-Manager`
