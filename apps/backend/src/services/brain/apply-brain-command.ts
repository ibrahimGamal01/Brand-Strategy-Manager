/**
 * Apply a single brain command (shared by API route and continuous orchestrator).
 */

import { prisma } from '../../lib/prisma';
import { isModuleKey, performResearchModuleAction } from '../social/research-resume';
import { syncBrainGoals } from '../intake/brain-intake-utils';

export interface ApplyBrainCommandResult {
  success: boolean;
  error?: string;
}

function normalizeWebsiteDomain(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').trim().toLowerCase();
}

function toStringList(value: unknown, max = 12): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, max);
  }
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
}

function parseGoalUpdate(
  patch: Record<string, unknown>,
  instruction: string
): { primaryGoal: string | null; secondaryGoals: string[] } {
  const patchPrimary = String(patch.primaryGoal || patch.goal || '').trim();
  const patchSecondary = toStringList(patch.secondaryGoals, 12);

  let primaryGoal = patchPrimary;
  if (!primaryGoal) {
    const text = String(instruction || '').trim();
    const patterns = [
      /set\s+(?:the\s+)?(?:primary\s+)?goal(?:\s+to)?\s*[:\-]?\s*(.+)$/i,
      /update\s+(?:the\s+)?(?:primary\s+)?goal(?:\s+to)?\s*[:\-]?\s*(.+)$/i,
      /\bgoal(?:\s+is|\s+to)?\s*[:\-]?\s*(.+)$/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        primaryGoal = match[1].trim();
        break;
      }
    }
  }
  if (!primaryGoal) {
    primaryGoal = String(instruction || '').trim();
  }

  return {
    primaryGoal: primaryGoal ? primaryGoal.slice(0, 500) : null,
    secondaryGoals: patchSecondary,
  };
}

const CONTEXT_FIELD_REGEX: Array<{ field: string; patterns: RegExp[] }> = [
  {
    field: 'businessType',
    patterns: [
      /business\s*type(?:\s+to)?\s*[:=\-]?\s*([^,;\n]+)/i,
      /niche(?:\s+to)?\s*[:=\-]?\s*([^,;\n]+)/i,
    ],
  },
  {
    field: 'offerModel',
    patterns: [/offer\s*model(?:\s+to)?\s*[:=\-]?\s*([^,;\n]+)/i, /main\s*offer(?:\s+to)?\s*[:=\-]?\s*([^,;\n]+)/i],
  },
  {
    field: 'targetMarket',
    patterns: [
      /target\s*(?:market|audience)(?:\s+to)?\s*[:=\-]?\s*(.+?)(?=\s+\b(?:and\s+(?:website|domain|geo\s*scope|location|business\s*type|offer\s*model|primary\s*goal)|with)\b|$)/i,
      /audience(?:\s+to)?\s*[:=\-]?\s*(.+?)(?=\s+\b(?:and\s+(?:website|domain|geo\s*scope|location|business\s*type|offer\s*model|primary\s*goal)|with)\b|$)/i,
    ],
  },
  {
    field: 'geoScope',
    patterns: [/geo\s*scope(?:\s+to)?\s*[:=\-]?\s*([^,;\n]+)/i, /location(?:\s+to)?\s*[:=\-]?\s*([^,;\n]+)/i],
  },
  {
    field: 'websiteDomain',
    patterns: [
      /website(?:\s*domain)?(?:\s+to)?\s*[:=\-]?\s*(.+?)(?=\s+\b(?:and\s+(?:target|audience|geo\s*scope|location|business\s*type|offer\s*model|primary\s*goal)|with)\b|$)/i,
      /domain(?:\s+to)?\s*[:=\-]?\s*(.+?)(?=\s+\b(?:and\s+(?:target|audience|geo\s*scope|location|business\s*type|offer\s*model|primary\s*goal)|with)\b|$)/i,
    ],
  },
  {
    field: 'primaryGoal',
    patterns: [/primary\s*goal(?:\s+to)?\s*[:=\-]?\s*([^,;\n]+)/i],
  },
];

function buildContextUpdate(
  patch: Record<string, unknown>,
  instruction: string
): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  const mutableFields = [
    'businessType',
    'offerModel',
    'primaryGoal',
    'targetMarket',
    'geoScope',
    'websiteDomain',
    'secondaryGoals',
    'channels',
    'constraints',
  ];
  for (const field of mutableFields) {
    if (patch[field] !== undefined && patch[field] !== null) {
      if (field === 'secondaryGoals') {
        update.secondaryGoals = toStringList(patch.secondaryGoals, 12);
      } else if (field === 'websiteDomain') {
        const domain = normalizeWebsiteDomain(String(patch.websiteDomain || ''));
        if (domain) update.websiteDomain = domain;
      } else {
        const value = patch[field];
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) update[field] = trimmed;
        } else {
          update[field] = value;
        }
      }
    }
  }

  for (const row of CONTEXT_FIELD_REGEX) {
    if (update[row.field] !== undefined) continue;
    for (const pattern of row.patterns) {
      const match = String(instruction || '').match(pattern);
      if (match?.[1]) {
        const value = match[1].trim();
        if (!value) continue;
        if (row.field === 'websiteDomain') {
          const domain = normalizeWebsiteDomain(value);
          if (domain) update.websiteDomain = domain;
        } else {
          update[row.field] = value;
        }
        break;
      }
    }
  }

  return update;
}

export async function applyBrainCommand(
  researchJobId: string,
  commandId: string
): Promise<ApplyBrainCommandResult> {
  const command = await prisma.brainCommand.findFirst({
    where: { id: commandId, researchJobId },
    include: { researchJob: true },
  });

  if (!command) {
    return { success: false, error: 'Brain command not found' };
  }

  const patch = (command.proposedPatch || {}) as Record<string, unknown>;
  let appliedPatch: Record<string, unknown> = { ...patch };

  try {
    if (command.commandType === 'ADD_COMPETITOR') {
      const handle = String(patch.handle || '').trim().replace(/^@+/, '');
      const platform = String(patch.platform || 'instagram').trim().toLowerCase();
      if (!handle) throw new Error('ADD_COMPETITOR command missing handle');

      await prisma.discoveredCompetitor.upsert({
        where: {
          researchJobId_platform_handle: { researchJobId, platform, handle },
        },
        update: {
          selectionState: 'APPROVED',
          status: 'SUGGESTED',
          availabilityStatus: 'UNVERIFIED',
          selectionReason: 'Manually added from Brain command',
          discoveryReason: command.instruction,
        },
        create: {
          researchJobId,
          platform,
          handle,
          selectionState: 'APPROVED',
          status: 'SUGGESTED',
          availabilityStatus: 'UNVERIFIED',
          selectionReason: 'Manually added from Brain command',
          discoveryReason: command.instruction,
        },
      });
      appliedPatch.action = 'competitor_added';
    } else if (command.commandType === 'REMOVE_COMPETITOR') {
      const handle = String(patch.handle || '').trim().replace(/^@+/, '');
      const platform = String(patch.platform || 'instagram').trim().toLowerCase();
      if (!handle) throw new Error('REMOVE_COMPETITOR command missing handle');

      await prisma.discoveredCompetitor.updateMany({
        where: { researchJobId, platform, handle },
        data: {
          selectionState: 'REJECTED',
          status: 'REJECTED',
          selectionReason: `Removed via Brain command: ${command.instruction}`,
        },
      });
      appliedPatch.action = 'competitor_removed';
    } else if (command.commandType === 'RUN_SECTION') {
      const moduleGuess = String(command.section || '').toLowerCase();
      const moduleKey = isModuleKey(moduleGuess) ? moduleGuess : 'competitors';
      const result = await performResearchModuleAction(researchJobId, moduleKey, 'continue');
      appliedPatch = { ...appliedPatch, action: 'module_run', module: moduleKey, result };
    } else if (command.commandType === 'UPDATE_GOAL') {
      const { primaryGoal, secondaryGoals } = parseGoalUpdate(patch, command.instruction);
      const profile = await prisma.brainProfile.upsert({
        where: { clientId: command.researchJob.clientId },
        update: {
          primaryGoal,
          secondaryGoals: secondaryGoals as any,
        },
        create: {
          clientId: command.researchJob.clientId,
          primaryGoal,
          secondaryGoals: secondaryGoals as any,
        },
      });
      await syncBrainGoals(profile.id, primaryGoal, secondaryGoals);
      appliedPatch = {
        ...appliedPatch,
        action: 'goal_updated',
        primaryGoal,
        secondaryGoals,
      };
    } else if (command.commandType === 'UPDATE_CONTEXT') {
      const updateData = buildContextUpdate(patch, command.instruction);
      if (Object.keys(updateData).length === 0) {
        throw new Error('UPDATE_CONTEXT command missing recognized context fields');
      }

      const profile = await prisma.brainProfile.upsert({
        where: { clientId: command.researchJob.clientId },
        update: updateData as any,
        create: {
          clientId: command.researchJob.clientId,
          ...(updateData as any),
        },
      });

      if (updateData.primaryGoal !== undefined || updateData.secondaryGoals !== undefined) {
        const refreshed = await prisma.brainProfile.findUnique({
          where: { id: profile.id },
          select: { id: true, primaryGoal: true, secondaryGoals: true },
        });
        if (refreshed) {
          await syncBrainGoals(
            refreshed.id,
            refreshed.primaryGoal ? String(refreshed.primaryGoal).trim() || null : null,
            toStringList(refreshed.secondaryGoals, 12)
          );
        }
      }

      appliedPatch = {
        ...appliedPatch,
        action: 'context_updated',
        updatedFields: Object.keys(updateData),
      };
    }

    await prisma.brainCommand.update({
      where: { id: command.id },
      data: {
        status: 'APPLIED',
        appliedPatch: appliedPatch as any,
        appliedAt: new Date(),
        error: null,
      },
    });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Apply failed';
    await prisma.brainCommand
      .update({
        where: { id: commandId },
        data: { status: 'FAILED', error: message },
      })
      .catch(() => undefined);
    return { success: false, error: message };
  }
}
