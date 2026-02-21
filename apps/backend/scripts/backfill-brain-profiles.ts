/**
 * Backfill BrainProfile for clients that don't have one or have empty profiles.
 * Syncs from ResearchJob.inputData when available.
 *
 * Run from apps/backend: npx tsx -r dotenv/config scripts/backfill-brain-profiles.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import {
  syncInputDataToBrainProfile,
  isBrainProfileEmpty,
} from '../src/services/intake/sync-input-to-brain-profile';

async function main() {
  console.log('[Backfill] Finding clients without BrainProfile or with empty BrainProfile...\n');

  const clients = await prisma.client.findMany({
    include: {
      brainProfile: { include: { goals: true } },
      clientAccounts: { select: { platform: true, handle: true } },
      researchJobs: {
        orderBy: { startedAt: 'desc' },
        take: 5,
        select: { id: true, inputData: true },
      },
    },
  });

  let created = 0;
  let synced = 0;
  let skipped = 0;

  for (const client of clients) {
    const jobs = client.researchJobs;
    let bestInputData = {} as Record<string, unknown>;
    for (const j of jobs) {
      const od = (j.inputData || {}) as Record<string, unknown>;
      if (od && typeof od === 'object' && Object.keys(od).length > Object.keys(bestInputData).length) {
        bestInputData = od;
      }
    }
    const clientFallbacks = {
      businessOverview: client.businessOverview ?? undefined,
      goalsKpis: client.goalsKpis ?? undefined,
      clientAccounts: (client.clientAccounts || []).map((a) => ({ platform: a.platform, handle: a.handle })),
    };
    const hasInputData = Object.keys(bestInputData).length > 0 || client.businessOverview || client.goalsKpis || (client.clientAccounts?.length ?? 0) > 0;

    if (!client.brainProfile) {
      if (hasInputData) {
        const syncedProfile = await syncInputDataToBrainProfile(client.id, bestInputData, clientFallbacks);
        if (syncedProfile) {
          synced++;
          console.log(`  [OK] Client ${client.name} (${client.id}): synced from inputData + client fallbacks`);
        } else {
          await prisma.brainProfile.create({
            data: { clientId: client.id },
          });
          created++;
          console.log(`  [OK] Client ${client.name} (${client.id}): created empty profile (no inputData)`);
        }
      } else {
        await prisma.brainProfile.create({
          data: { clientId: client.id },
        });
        created++;
        console.log(`  [OK] Client ${client.name} (${client.id}): created empty profile`);
      }
    } else if ((process.env.BACKFILL_FORCE === '1' || isBrainProfileEmpty(client.brainProfile)) && hasInputData) {
      const syncedProfile = await syncInputDataToBrainProfile(client.id, bestInputData, clientFallbacks);
      if (syncedProfile) {
        synced++;
        console.log(`  [OK] Client ${client.name} (${client.id}): synced empty profile from inputData`);
      } else {
        skipped++;
        console.log(`  [SKIP] Client ${client.name} (${client.id}): sync returned null`);
      }
    } else {
      skipped++;
    }
  }

  console.log(`\n[Backfill] Done. Created: ${created}, Synced: ${synced}, Skipped: ${skipped}`);
}

main()
  .catch((err) => {
    console.error('[Backfill] Error:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
