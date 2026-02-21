import { prisma } from '../../lib/prisma';
import { patchBrainProfileFromAnswers } from '../intake/brain-intake';
import crypto from 'crypto';

export type QuestionOption = {
  value: string;
  label: string;
};

export type Question = {
  key: string;
  text: string;
  type: 'single_select' | 'multi_select' | 'text';
  options?: QuestionOption[];
  optional?: boolean;
  brainProfileField?: string;
};

export type QuestionSet = {
  id: string;
  trigger: 'post_intake' | 'intelligence_ready' | 'competitor_approved' | 'calendar_generated' | 'manual';
  title: string;
  description?: string;
  questions: Question[];
};

const QUESTION_SETS: QuestionSet[] = [
  {
    id: 'onboarding_goals',
    trigger: 'post_intake',
    title: 'Clarify growth goals',
    description: 'A few quick picks to tune recommendations.',
    questions: [
      {
        key: 'biggest_blocker',
        text: "What's the biggest thing holding back your growth right now?",
        type: 'multi_select',
        options: [
          { value: 'content_frequency', label: 'Posting frequency' },
          { value: 'content_quality', label: 'Content quality' },
          { value: 'audience_fit', label: 'Unsure if content fits audience' },
          { value: 'lead_flow', label: 'Lead flow / conversions' },
          { value: 'creative_resources', label: 'Not enough creative resources' },
          { value: 'other', label: 'Other' },
        ],
      },
      {
        key: 'posting_cadence',
        text: 'How often do you currently post?',
        type: 'single_select',
        options: [
          { value: '1_week', label: '1x/week' },
          { value: '3_week', label: '2-3x/week' },
          { value: 'daily', label: 'Daily' },
          { value: 'burst', label: 'In bursts / campaigns' },
        ],
      },
    ],
  },
  {
    id: 'content_clarity',
    trigger: 'intelligence_ready',
    title: 'Content clarity',
    questions: [
      {
        key: 'format_preference',
        text: 'Which formats work best for you?',
        type: 'multi_select',
        options: [
          { value: 'reels', label: 'Reels/shorts' },
          { value: 'carousels', label: 'Carousels' },
          { value: 'stories', label: 'Stories' },
          { value: 'long_video', label: 'Long video' },
          { value: 'live', label: 'Lives/AMAs' },
        ],
      },
      {
        key: 'upcoming_campaigns',
        text: 'Any launches or campaigns coming up?',
        type: 'text',
        optional: true,
      },
    ],
  },
  {
    id: 'competitor_context',
    trigger: 'competitor_approved',
    title: 'Competitor context',
    questions: [
      {
        key: 'direct_threats',
        text: 'Are any approved competitors direct threats?',
        type: 'multi_select',
        options: [], // filled dynamically by caller if desired
      },
      {
        key: 'competitor_edge',
        text: 'What does your top competitor do better than you right now?',
        type: 'text',
        optional: true,
      },
    ],
  },
  {
    id: 'calendar_preferences',
    trigger: 'calendar_generated',
    title: 'Calendar preferences',
    questions: [
      {
        key: 'publish_days',
        text: 'Which days do you prefer to publish?',
        type: 'multi_select',
        options: [
          { value: 'mon', label: 'Mon' },
          { value: 'tue', label: 'Tue' },
          { value: 'wed', label: 'Wed' },
          { value: 'thu', label: 'Thu' },
          { value: 'fri', label: 'Fri' },
          { value: 'sat', label: 'Sat' },
          { value: 'sun', label: 'Sun' },
        ],
      },
      {
        key: 'team_setup',
        text: 'Do you have a team helping with content?',
        type: 'single_select',
        options: [
          { value: 'solo', label: 'It’s just me' },
          { value: 'small_team', label: 'Small team/agency' },
          { value: 'inhouse', label: 'In-house team' },
        ],
      },
    ],
  },
];

export async function evaluatePendingQuestionSets(researchJobId: string): Promise<QuestionSet[]> {
  // For now, always return post_intake as pending unless answered; more triggers can be plugged in with job state.
  const answered = await prisma.clientIntakeAnswer.findMany({
    where: { researchJobId },
    select: { questionSetId: true },
  });
  const answeredSetIds = new Set(answered.map((a) => a.questionSetId));
  return QUESTION_SETS.filter((set) => !answeredSetIds.has(set.id));
}

export async function saveQuestionSetAnswers(params: {
  researchJobId: string;
  setId: string;
  answers: Array<{ key: string; answer: any; answerType?: string; triggeredBy?: string }>;
}) {
  const { researchJobId, setId, answers } = params;
  if (!answers?.length) return;
  const rows = answers.map((a) => ({
    id: crypto.randomUUID(),
    researchJobId,
    questionSetId: setId,
    questionKey: a.key,
    answerType: a.answerType || inferAnswerType(a.answer),
    answer: a.answer,
    triggeredBy: a.triggeredBy || null,
  }));
  await prisma.clientIntakeAnswer.createMany({ data: rows });
  try {
    const answerMap: Record<string, string | string[]> = {};
    for (const a of answers) {
      answerMap[a.key] = Array.isArray(a.answer)
        ? a.answer.map((v) => String(v))
        : String(a.answer ?? '');
    }
    await patchBrainProfileFromAnswers(researchJobId, answerMap);
  } catch (error) {
    console.warn('[QuestionWorkflow] Failed to patch brain profile from answers:', (error as Error)?.message);
  }
}

function inferAnswerType(value: any): string {
  if (Array.isArray(value)) return 'multi';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  return 'text';
}

export { QUESTION_SETS };
