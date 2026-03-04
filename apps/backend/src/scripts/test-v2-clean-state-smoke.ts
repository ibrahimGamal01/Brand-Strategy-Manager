import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

type HealthResponse = {
  status?: string;
  schemaReady?: boolean;
};

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function resolveBaseUrl(): string {
  const candidate =
    process.env.V2_BASE_URL ||
    process.env.BACKEND_BASE_URL ||
    process.env.R1_BASE_URL ||
    process.env.PORTAL_E2E_BASE_URL ||
    '';
  const value = String(candidate).trim();
  if (!value) {
    throw new Error('Missing base URL. Set V2_BASE_URL (or BACKEND_BASE_URL / R1_BASE_URL / PORTAL_E2E_BASE_URL).');
  }
  return value.replace(/\/+$/, '');
}

async function fetchHealth(baseUrl: string): Promise<{ status: number; body: HealthResponse }> {
  const response = await fetch(`${baseUrl}/api/health`, { method: 'GET' });
  const text = await response.text();
  let body: HealthResponse = {};
  try {
    body = text ? (JSON.parse(text) as HealthResponse) : {};
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

async function main() {
  const baseUrl = resolveBaseUrl();
  requiredEnv('DATABASE_URL');

  const prisma = new PrismaClient({
    log: ['error'],
  });

  try {
    const health = await fetchHealth(baseUrl);
    assert.equal(health.status, 200, `Health endpoint failed: ${health.status}`);
    assert.equal(String(health.body.status || ''), 'ok', 'Health response status is not ok.');
    assert.equal(Boolean(health.body.schemaReady), true, 'Health response schemaReady is not true.');

    const tableRows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    const existing = new Set(tableRows.map((row) => String(row.table_name || '').trim()).filter(Boolean));

    const requiredTables = [
      '_prisma_migrations',
      'clients',
      'research_jobs',
      'portal_users',
      'chat_threads',
      'workspace_documents',
      'tool_runs',
      'process_events',
    ];

    for (const tableName of requiredTables) {
      assert.ok(existing.has(tableName), `Missing required table after reset: ${tableName}`);
    }

    const migrationRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "_prisma_migrations"
    `;
    const migrationCount = Number(migrationRows[0]?.count || 0);
    assert.ok(migrationCount > 0, 'No applied migrations found after reset.');

    const counts = {
      clients: await prisma.client.count(),
      researchJobs: await prisma.researchJob.count(),
      portalUsers: await prisma.portalUser.count(),
      chatThreads: await prisma.chatThread.count(),
      workspaceDocuments: await prisma.workspaceDocument.count(),
      competitors: await prisma.competitor.count(),
      socialProfiles: await prisma.socialProfile.count(),
    };

    for (const [key, value] of Object.entries(counts)) {
      assert.equal(value, 0, `${key} is not empty after V2 clean reset: ${value}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          health: health.body,
          migrationCount,
          emptyCounts: counts,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
