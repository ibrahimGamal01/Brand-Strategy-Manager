/**
 * Brain enrichment: infer BrainProfile updates from AiQuestion answers, scraped data, and optional media analysis.
 * - Empty brain fields: auto-fill and set meta.autoFilledFields.
 * - Non-empty fields with a different inferred value: create BrainProfileSuggestion (pending) for user accept/reject.
 */

import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import type { AiQuestionType } from '@prisma/client';

const MAX_EXTRACT_CHARS = 300;

/** AiQuestion type -> brain profile field and extractor */
const QUESTION_TO_FIELD: Array<{
  questionType: AiQuestionType;
  field: keyof Pick<
    import('@prisma/client').BrainProfile,
    'businessType' | 'offerModel' | 'primaryGoal' | 'targetMarket' | 'geoScope' | 'websiteDomain' | 'secondaryGoals' | 'channels' | 'constraints'
  >;
  source: string;
  /** Extract value from answer text. Return string or string[] for JSON fields. */
  extract: (answer: string) => string | string[] | Record<string, unknown> | null;
}> = [
  {
    questionType: 'TARGET_AUDIENCE',
    field: 'targetMarket',
    source: 'ai_question',
    extract: (a) => firstParagraphOrSlice(a, MAX_EXTRACT_CHARS),
  },
  {
    questionType: 'VALUE_PROPOSITION',
    field: 'primaryGoal',
    source: 'ai_question',
    extract: (a) => firstParagraphOrSlice(a, 200),
  },
  {
    questionType: 'NICHE_POSITION',
    field: 'businessType',
    source: 'ai_question',
    extract: (a) => firstParagraphOrSlice(a, 150),
  },
  {
    questionType: 'CONTENT_PILLARS',
    field: 'secondaryGoals',
    source: 'ai_question',
    extract: (a) => parseListFromAnswer(a),
  },
  {
    questionType: 'BRAND_VOICE',
    field: 'constraints',
    source: 'ai_question',
    extract: (a) => {
      const summary = firstParagraphOrSlice(a, 150);
      return summary ? { brandTone: summary } : null;
    },
  },
];

function firstParagraphOrSlice(text: string, max: number): string | null {
  const t = (text || '').trim();
  if (!t) return null;
  const first = t.split(/\n\n+/)[0]?.trim() || t;
  const slice = first.length > max ? first.slice(0, max).trim() + '…' : first;
  return slice || null;
}

function parseListFromAnswer(text: string): string[] | null {
  const t = (text || '').trim();
  if (!t) return null;
  const lines = t.split(/\n/).map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  const list = lines.slice(0, 10);
  return list.length > 0 ? list : null;
}

export interface BrainEnrichmentResult {
  autoFilled: string[];
  suggestionsCreated: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Run brain enrichment for a research job: load answers + scraped data, infer updates, auto-fill empty fields and create suggestions for non-empty.
 */
export async function runBrainEnrichment(researchJobId: string): Promise<BrainEnrichmentResult> {
  const result: BrainEnrichmentResult = { autoFilled: [], suggestionsCreated: 0, skipped: false };

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          brainProfile: { include: { goals: true } },
          clientAccounts: true,
        },
      },
    },
  });

  if (!job?.client) {
    result.skipped = true;
    result.reason = 'no_job_or_client';
    return result;
  }

  const clientId = job.client.id;
  let profile = job.client.brainProfile;

  if (!profile) {
    profile = await prisma.brainProfile.create({
      data: { clientId },
      include: { goals: true },
    });
  }

  const aiQuestions = await prisma.aiQuestion.findMany({
    where: { researchJobId, isAnswered: true },
    select: { questionType: true, answer: true },
  });
  const answerByType = new Map<string, string>(
    aiQuestions.filter((q) => q.answer).map((q) => [q.questionType, q.answer!])
  );

  const profileAny = profile as Record<string, unknown>;
  const meta = (profileAny.meta as Record<string, unknown>) || {};
  const autoFilledFields = new Set<string>(Array.isArray(meta.autoFilledFields) ? meta.autoFilledFields : []);
  const updates: Record<string, unknown> = {};
  const now = new Date();

  for (const { questionType, field, source, extract } of QUESTION_TO_FIELD) {
    const answer = answerByType.get(questionType);
    if (!answer) continue;

    const inferred = extract(answer);
    if (inferred == null) continue;

    const currentValue = profile[field];
    const isEmpty = currentValue === null || currentValue === undefined || (typeof currentValue === 'string' && !currentValue.trim());

    if (isEmpty) {
      if (field === 'constraints' && typeof inferred === 'object' && inferred !== null && !Array.isArray(inferred)) {
        updates.constraints = inferred as object;
      } else if (field === 'secondaryGoals' && Array.isArray(inferred)) {
        updates.secondaryGoals = inferred;
      } else if (typeof inferred === 'string') {
        (updates as any)[field] = inferred;
      }
      autoFilledFields.add(field);
    } else {
      const proposedSerialized = typeof inferred === 'string' ? inferred : JSON.stringify(inferred);
      const currentSerialized =
        typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue);
      if (proposedSerialized === currentSerialized) continue;

      const existingPending = await prisma.brainProfileSuggestion.findFirst({
        where: { clientId, field, status: 'PENDING' },
      });

      const proposedValue = typeof inferred === 'string' ? inferred : (inferred as any);
      if (existingPending) {
        await prisma.brainProfileSuggestion.update({
          where: { id: existingPending.id },
          data: {
            proposedValue: proposedValue as any,
            reason: `From ${questionType} answer`,
            source,
          },
        });
      } else {
        await prisma.brainProfileSuggestion.create({
          data: {
            clientId,
            field,
            proposedValue: proposedValue as any,
            reason: `From ${questionType} answer`,
            source,
            status: 'PENDING',
          },
        });
        result.suggestionsCreated++;
      }
    }
  }

  const scrapedWebsite = extractWebsiteFromClient(job.client);
  if (scrapedWebsite && !profile.websiteDomain?.trim()) {
    updates.websiteDomain = scrapedWebsite;
    autoFilledFields.add('websiteDomain');
  }

  if (Object.keys(updates).length > 0) {
    const newMeta = {
      ...meta,
      lastAutoFilledAt: now.toISOString(),
      autoFilledFields: Array.from(autoFilledFields),
    };
    await prisma.brainProfile.update({
      where: { id: profile.id },
      data: {
        ...(updates as any),
        meta: newMeta,
      } as any,
    });
    result.autoFilled = Object.keys(updates);

    emitResearchJobEvent({
      researchJobId,
      source: 'brain-enrichment',
      code: 'brain.auto_filled',
      level: 'info',
      message: `Brain auto-filled: ${result.autoFilled.join(', ')}`,
      metadata: { fields: result.autoFilled },
    });
  }

  if (result.suggestionsCreated > 0) {
    emitResearchJobEvent({
      researchJobId,
      source: 'brain-enrichment',
      code: 'brain.suggestion_created',
      level: 'info',
      message: `Brain suggestions created: ${result.suggestionsCreated}`,
      metadata: { count: result.suggestionsCreated },
    });
  }

  return result;
}

function extractWebsiteFromClient(client: { clientAccounts: Array<{ profileUrl?: string | null }> }): string | null {
  for (const acc of client.clientAccounts || []) {
    const u = (acc.profileUrl || '').trim();
    if (!u || !/^https?:\/\//i.test(u)) continue;
    try {
      const url = new URL(u);
      const host = url.hostname.replace(/^www\./, '');
      if (host && host !== 'instagram.com' && host !== 'tiktok.com') return host;
    } catch (_) {}
  }
  return null;
}
