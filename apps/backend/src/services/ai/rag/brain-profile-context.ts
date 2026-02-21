/**
 * Brain Profile Context for RAG
 * Loads saved intake/BAT Brain data so the RAG sees businessType, goals, etc.
 */

import { prisma } from '../../../lib/prisma';
import { syncInputDataToBrainProfile, isBrainProfileEmpty } from '../../intake/sync-input-to-brain-profile';

export interface BrainProfileContext {
  businessType: string | null;
  offerModel: string | null;
  primaryGoal: string | null;
  secondaryGoals: string[];
  goals: Array<{
    id: string;
    goalType: string;
    priority: number;
    targetMetric: string | null;
    targetValue: string | null;
    targetDate: string | null;
    notes: string | null;
  }>;
  targetMarket: string | null;
  geoScope: string | null;
  websiteDomain: string | null;
  channels: Array<{ platform: string; handle: string }>;
  constraints: Record<string, unknown> | null;
  hasData: boolean;
}

export async function getBrainProfileContext(researchJobId: string): Promise<BrainProfileContext> {
  const empty: BrainProfileContext = {
    businessType: null,
    offerModel: null,
    primaryGoal: null,
    secondaryGoals: [],
    goals: [],
    targetMarket: null,
    geoScope: null,
    websiteDomain: null,
    channels: [],
    constraints: null,
    hasData: false,
  };

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          brainProfile: { include: { goals: true } },
          clientAccounts: { select: { platform: true, handle: true } },
        },
      },
    },
  });

  if (!job?.client) return empty;

  let profile = job.client.brainProfile;
  const inputData = (job.inputData || {}) as Record<string, unknown>;

  // Sync from inputData when profile is missing or empty
  if (isBrainProfileEmpty(profile)) {
    const clientFallbacks = {
      businessOverview: job.client.businessOverview ?? undefined,
      goalsKpis: job.client.goalsKpis ?? undefined,
      clientAccounts: (job.client.clientAccounts || []).map((a) => ({ platform: a.platform, handle: a.handle })),
    };
    const synced = await syncInputDataToBrainProfile(job.client.id, inputData, clientFallbacks);
    if (synced) {
      profile = await prisma.brainProfile.findUnique({
        where: { clientId: job.client.id },
        include: { goals: true },
      });
    }
  }

  if (!profile) return empty;

  const secondaryGoals = Array.isArray(profile.secondaryGoals)
    ? (profile.secondaryGoals as unknown[]).map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const channels = Array.isArray(profile.channels)
    ? (profile.channels as Array<{ platform?: string; handle?: string }>)
        .filter((c) => c && typeof c === 'object' && c.platform && c.handle)
        .map((c) => ({ platform: String(c.platform), handle: String(c.handle) }))
    : [];
  const goals = Array.isArray(profile.goals)
    ? profile.goals
        .map((goal) => ({
          id: goal.id,
          goalType: goal.goalType,
          priority: goal.priority,
          targetMetric: goal.targetMetric ?? null,
          targetValue: goal.targetValue ?? null,
          targetDate: goal.targetDate ? goal.targetDate.toISOString() : null,
          notes: goal.notes ?? null,
        }))
        .sort((a, b) => a.priority - b.priority)
    : [];

  const hasData = Boolean(
    (profile.businessType && String(profile.businessType).trim()) ||
      (profile.offerModel && String(profile.offerModel).trim()) ||
      (profile.primaryGoal && String(profile.primaryGoal).trim()) ||
      (profile.targetMarket && String(profile.targetMarket).trim()) ||
      secondaryGoals.length > 0 ||
      channels.length > 0 ||
      goals.length > 0
  );

  return {
    businessType: profile.businessType,
    offerModel: profile.offerModel,
    primaryGoal: profile.primaryGoal,
    secondaryGoals,
    goals,
    targetMarket: profile.targetMarket,
    geoScope: profile.geoScope,
    websiteDomain: profile.websiteDomain,
    channels,
    constraints: (profile.constraints as Record<string, unknown>) || null,
    hasData,
  };
}
