import { openai as openaiClient, OpenAI } from '../ai/openai-client';

export type AttentionTriageResult = {
  shouldCreate: boolean;
  type: 'NEEDS_REPLY' | 'FEEDBACK_REQUEST' | 'DEADLINE';
  summary: string;
  dueAtIso?: string | null;
  severity: 'INFO' | 'WARN' | 'URGENT';
  draftReply?: string | null;
  confidence: number;
  reason: string;
};

function clamp01(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function parseModelJson(raw: string): Partial<AttentionTriageResult> | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Partial<AttentionTriageResult>;
  } catch {
    return null;
  }
}

function fallbackTriage(text: string): AttentionTriageResult {
  const lower = String(text || '').toLowerCase();
  const hasDeadline = /\b(by|before|deadline|tomorrow|today|asap|eod|end of day|this week)\b/.test(lower);
  const asksFeedback = /\b(feedback|review|thoughts|approve|approval)\b/.test(lower);
  const asksResponse = /\?$/.test(lower) || /\b(can you|could you|please|let me know|update)\b/.test(lower);

  if (hasDeadline) {
    return {
      shouldCreate: true,
      type: 'DEADLINE',
      summary: 'Message includes a clear timing/deadline signal and likely needs follow-up.',
      severity: 'URGENT',
      draftReply: 'Thanks for the deadline context. We are on it and will share an update shortly.',
      confidence: 0.62,
      reason: 'Keyword-based fallback detected deadline language.',
    };
  }
  if (asksFeedback) {
    return {
      shouldCreate: true,
      type: 'FEEDBACK_REQUEST',
      summary: 'Message asks for feedback or approval.',
      severity: 'WARN',
      draftReply: 'Thanks for sharing this. We are reviewing and will send structured feedback next.',
      confidence: 0.58,
      reason: 'Keyword-based fallback detected feedback language.',
    };
  }
  if (asksResponse) {
    return {
      shouldCreate: true,
      type: 'NEEDS_REPLY',
      summary: 'Message likely needs an owner response.',
      severity: 'INFO',
      draftReply: 'Thanks for the note. We received this and will follow up with details shortly.',
      confidence: 0.54,
      reason: 'Keyword-based fallback detected response-needed language.',
    };
  }
  return {
    shouldCreate: false,
    type: 'NEEDS_REPLY',
    summary: 'No strong action signal detected.',
    severity: 'INFO',
    confidence: 0.4,
    reason: 'No deadline, feedback, or direct response cue detected in fallback mode.',
  };
}

function normalizeTriage(raw: Partial<AttentionTriageResult> | null, sourceText: string): AttentionTriageResult {
  if (!raw) return fallbackTriage(sourceText);
  const shouldCreate = Boolean(raw.shouldCreate);
  const typeRaw = String(raw.type || '').trim().toUpperCase();
  const type: AttentionTriageResult['type'] =
    typeRaw === 'DEADLINE' || typeRaw === 'FEEDBACK_REQUEST' || typeRaw === 'NEEDS_REPLY'
      ? (typeRaw as AttentionTriageResult['type'])
      : 'NEEDS_REPLY';
  const severityRaw = String(raw.severity || '').trim().toUpperCase();
  const severity: AttentionTriageResult['severity'] =
    severityRaw === 'URGENT' || severityRaw === 'WARN' || severityRaw === 'INFO'
      ? (severityRaw as AttentionTriageResult['severity'])
      : type === 'DEADLINE'
        ? 'URGENT'
        : type === 'FEEDBACK_REQUEST'
          ? 'WARN'
          : 'INFO';
  const summary = String(raw.summary || '').trim() || fallbackTriage(sourceText).summary;
  const draftReply = raw.draftReply ? String(raw.draftReply).trim() : null;
  const dueAtIso = raw.dueAtIso ? String(raw.dueAtIso).trim() : null;
  const reason = String(raw.reason || '').trim() || 'AI triage result.';
  return {
    shouldCreate,
    type,
    summary: summary.slice(0, 400),
    dueAtIso: dueAtIso || null,
    severity,
    draftReply: draftReply ? draftReply.slice(0, 3000) : null,
    confidence: clamp01(raw.confidence, 0.5),
    reason: reason.slice(0, 500),
  };
}

export async function runAttentionTriageAi(input: {
  workspaceLabel: string;
  channelLabel: string;
  messageText: string;
  threadContext?: string[];
}): Promise<AttentionTriageResult> {
  const messageText = String(input.messageText || '').trim();
  if (!messageText) return fallbackTriage(messageText);

  const contextLines = (input.threadContext || [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n- ');

  const prompt = [
    'You classify Slack messages into BAT action items and produce safe draft replies.',
    'Return STRICT JSON only with keys:',
    '{"shouldCreate":boolean,"type":"NEEDS_REPLY|FEEDBACK_REQUEST|DEADLINE","summary":string,"dueAtIso":string|null,"severity":"INFO|WARN|URGENT","draftReply":string|null,"confidence":number,"reason":string}',
    'Rules:',
    '- shouldCreate=false only if no follow-up is needed.',
    '- Use DEADLINE only when a concrete time pressure exists.',
    '- Draft reply should be concise, professional, and non-committal.',
    '- Keep summary under 220 chars.',
    `Workspace: ${input.workspaceLabel}`,
    `Channel: ${input.channelLabel}`,
    `Message: ${messageText}`,
    contextLines ? `Thread context:\n- ${contextLines}` : 'Thread context: (none)',
  ].join('\n');

  try {
    const completion = (await openaiClient.bat.chatCompletion('analysis_fast', {
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 500,
    })) as OpenAI.Chat.Completions.ChatCompletion;
    const content = completion.choices?.[0]?.message?.content || '';
    return normalizeTriage(parseModelJson(content), messageText);
  } catch (error: any) {
    console.warn('[AttentionTriage] AI triage failed; using fallback:', error?.message || error);
    return fallbackTriage(messageText);
  }
}
