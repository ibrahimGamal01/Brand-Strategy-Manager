import OpenAI from 'openai';
import { openai } from '../ai/openai-client';
import { resolveModelForTask } from '../ai/model-router';
import { buildDocumentEditorSystemPrompt } from '../chat/runtime/prompts/document-editor';
import { buildDocumentFactCheckerSystemPrompt } from '../chat/runtime/prompts/document-fact-checker';
import { buildSectionDrafterSystemPrompt } from '../chat/runtime/prompts/section-drafter';
import type { DocumentDataPayload } from './document-spec';
import type { DocumentSpecV1 } from './document-spec-schema';
import { draftDocumentSections, type DraftedDocumentSection } from './section-drafter';

const AUTHORING_TIMEOUT_MS = Number.isFinite(Number(process.env.DOCUMENT_AUTHORING_TIMEOUT_MS))
  ? Math.max(20_000, Math.min(300_000, Math.floor(Number(process.env.DOCUMENT_AUTHORING_TIMEOUT_MS))))
  : 120_000;

export type SectionBrief = {
  id: string;
  kind: DocumentSpecV1['sections'][number]['kind'];
  title: string;
  objective: string;
  audience: string;
  tone: string;
  evidenceRefIds: string[];
  evidencePacket: Array<{
    refId: string;
    lane: 'competitors' | 'posts' | 'web' | 'news' | 'community' | 'mixed';
    label: string;
    snippet: string;
    url?: string;
  }>;
  antiPatterns: string[];
  baselineMd: string;
};

export type SectionDraft = DraftedDocumentSection & {
  source: 'ai' | 'fallback';
  qualityNotes: string[];
  claimBullets: string[];
};

export type EditorialReview = {
  summary: string;
  issues: string[];
  sections: Array<{
    id: string;
    contentMd: string;
    notes: string[];
  }>;
};

export type FactCheckResult = {
  pass: boolean;
  issues: string[];
  sections: Array<{
    id: string;
    status: 'pass' | 'softened' | 'needs_review';
    contentMd: string;
    notes: string[];
    confidence: number;
  }>;
};

export type RenderTheme = {
  id: 'premium_agency_v1';
  name: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
};

export type PremiumDocumentQuality = {
  score: number;
  notes: string[];
  dimensionScores: {
    grounding: number;
    specificity: number;
    usefulness: number;
    redundancy: number;
    tone: number;
    visual: number;
  };
};

export type PremiumDocumentPipelineResult = {
  sectionBriefs: SectionBrief[];
  sections: SectionDraft[];
  editorialReview: EditorialReview;
  factCheck: FactCheckResult;
  quality: PremiumDocumentQuality;
  theme: RenderTheme;
  editorialPassCount: number;
  iterationsUsed: number;
};

type DocumentDepthSignals = {
  totalWords: number;
  minimumWords: number;
  calendarRows: number;
  minimumCalendarRows: number;
  underdevelopedSections: string[];
  reasons: string[];
  needsExpansion: boolean;
};

type JsonRequestResult = {
  parsed: Record<string, unknown> | null;
  requestedModel: string;
  usedModel: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function completionText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  return String(response.choices?.[0]?.message?.content || '').trim();
}

function normalizeModelName(value: unknown): string {
  return String(value || '').trim();
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function requestJsonTask(
  task: Parameters<typeof openai.bat.chatCompletion>[0],
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens = 2200,
): Promise<JsonRequestResult> {
  const requestedModel = resolveModelForTask(task);
  const completion = (await withTimeout(
    openai.bat.chatCompletion(task, {
      messages,
      max_completion_tokens: maxTokens,
    }) as Promise<OpenAI.Chat.Completions.ChatCompletion>,
    AUTHORING_TIMEOUT_MS,
    `Document authoring ${task}`,
  )) as OpenAI.Chat.Completions.ChatCompletion;
  const text = completionText(completion);
  const parsed = extractJsonObject(text);
  if (parsed) {
    return {
      parsed,
      requestedModel,
      usedModel: normalizeModelName(completion.model) || requestedModel,
    };
  }

  const repair = (await withTimeout(
    openai.bat.chatCompletion('analysis_fast', {
      messages: [
        {
          role: 'system',
          content: 'Repair malformed JSON. Return one valid JSON object only with no markdown and no explanation.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      max_completion_tokens: maxTokens,
    }) as Promise<OpenAI.Chat.Completions.ChatCompletion>,
    AUTHORING_TIMEOUT_MS,
    `Document authoring ${task} repair`,
  )) as OpenAI.Chat.Completions.ChatCompletion;

  return {
    parsed: extractJsonObject(completionText(repair)),
    requestedModel,
    usedModel: normalizeModelName(repair.model) || requestedModel,
  };
}

function defaultTheme(): RenderTheme {
  return {
    id: 'premium_agency_v1',
    name: 'Premium Agency Delivery',
    accent: '#3558d6',
    accentSoft: '#edf2ff',
    accentStrong: '#2138a4',
  };
}

function compactText(value: string, max = 220): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function resolveSectionLane(kind: DocumentSpecV1['sections'][number]['kind']): 'competitors' | 'posts' | 'web' | 'news' | 'community' | 'mixed' {
  if (kind === 'competitor_deep_dive' || kind === 'competitor_market_map' || kind === 'competitor_comparison_table' || kind === 'competitor_battlecards') {
    return 'competitors';
  }
  if (kind === 'signal_analysis' || kind === 'signal_delta_analysis' || kind === 'content_calendar_slots' || kind === 'channel_pillar_matrix' || kind === 'cadence_assumptions') {
    return 'posts';
  }
  if (kind === 'market_context' || kind === 'positioning' || kind === 'messaging_house') return 'web';
  if (kind === 'icp_definition') return 'community';
  if (kind === 'swot_matrix' || kind === 'swot_implications') return 'mixed';
  return 'mixed';
}

function buildEvidencePacket(
  section: DocumentSpecV1['sections'][number],
  payload: DocumentDataPayload,
): SectionBrief['evidencePacket'] {
  const lane = resolveSectionLane(section.kind);
  const packets: SectionBrief['evidencePacket'] = [];
  const pushPacket = (item: SectionBrief['evidencePacket'][number]) => {
    if (!item.snippet.trim()) return;
    if (packets.some((existing) => existing.refId === item.refId || (existing.url && item.url && existing.url === item.url))) return;
    packets.push(item);
  };

  const competitorRows = payload.competitors.slice(0, 8);
  const postRows = payload.topPosts.slice(0, 10);
  const webRows = payload.webSnapshots.slice(0, 8);
  const newsRows = payload.news.slice(0, 6);
  const communityRows = payload.communityInsights.slice(0, 6);

  const includeCompetitors = lane === 'competitors' || lane === 'mixed';
  const includePosts = lane === 'posts' || lane === 'mixed';
  const includeWeb = lane === 'web' || lane === 'mixed';
  const includeNews = lane === 'news' || lane === 'mixed';
  const includeCommunity = lane === 'community' || lane === 'mixed';

  if (includeCompetitors) {
    competitorRows.forEach((row, index) => {
      pushPacket({
        refId: row.profileUrl || `competitor:${index + 1}`,
        lane: 'competitors',
        label: `@${row.handle} (${row.platform})`,
        snippet: compactText(`State ${row.selectionState}. Relevance ${Number(row.relevanceScore || 0).toFixed(2)}. ${row.reason || ''}`, 180),
        url: row.profileUrl || undefined,
      });
    });
  }
  if (includePosts) {
    postRows.forEach((row, index) => {
      pushPacket({
        refId: row.postUrl || `post:${index + 1}`,
        lane: 'posts',
        label: `@${row.handle} post`,
        snippet: compactText(`${row.caption} Engagement ${Number(row.likes || 0) + Number(row.comments || 0) + Number(row.shares || 0)}.`, 190),
        url: row.postUrl || undefined,
      });
    });
  }
  if (includeWeb) {
    webRows.forEach((row, index) => {
      pushPacket({
        refId: row.finalUrl || `web:${index + 1}`,
        lane: 'web',
        label: row.finalUrl,
        snippet: compactText(row.snippet || 'Web snapshot evidence.', 180),
        url: row.finalUrl || undefined,
      });
    });
  }
  if (includeNews) {
    newsRows.forEach((row, index) => {
      pushPacket({
        refId: row.url || `news:${index + 1}`,
        lane: 'news',
        label: row.title,
        snippet: compactText(`${row.source}: ${row.snippet}`, 180),
        url: row.url || undefined,
      });
    });
  }
  if (includeCommunity) {
    communityRows.forEach((row, index) => {
      pushPacket({
        refId: row.url || `community:${index + 1}`,
        lane: 'community',
        label: row.source,
        snippet: compactText(row.summary || 'Community insight.', 180),
        url: row.url || undefined,
      });
    });
  }

  return packets.slice(0, lane === 'mixed' ? 12 : 8);
}

function buildSectionBriefs(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  baselineSections: DraftedDocumentSection[];
}): SectionBrief[] {
  const baselineMap = new Map(input.baselineSections.map((section) => [section.id, section]));
  return input.spec.sections.map((section) => {
    const baseline = baselineMap.get(section.id);
    return {
      id: section.id,
      kind: section.kind,
      title: section.title,
      objective: uniqueStrings(section.requirements).join(' '),
      audience: input.spec.audience,
      tone: input.spec.audience === 'board' ? 'executive and commercially sharp' : 'confident, client-facing, and strategic',
      evidenceRefIds: uniqueStrings(section.evidenceRefIds).slice(0, 20),
      evidencePacket: buildEvidencePacket(section, input.payload),
      antiPatterns: [
        'Do not narrate the tool or workflow.',
        'Do not write generic filler.',
        'Do not repeat evidence as raw notes without synthesis.',
      ],
      baselineMd: baseline?.contentMd || '- Evidence-backed draft unavailable.',
    };
  });
}

function fallbackClaimBullets(contentMd: string): string[] {
  return String(contentMd || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function mergeSectionDrafts(input: {
  baseline: DraftedDocumentSection[];
  aiParsed: Record<string, unknown> | null;
}): SectionDraft[] {
  const aiSections = Array.isArray(input.aiParsed?.sections) ? input.aiParsed?.sections : [];
  const aiMap = new Map<string, Record<string, unknown>>();
  for (const section of aiSections) {
    if (!isRecord(section)) continue;
    const id = String(section.id || '').trim();
    if (!id) continue;
    aiMap.set(id, section);
  }

  return input.baseline.map((section) => {
    const aiSection = aiMap.get(section.id);
    const aiContent = String(aiSection?.contentMd || '').trim();
    const aiStatusRaw = String(aiSection?.status || '').trim().toLowerCase();
    const aiStatus: DraftedDocumentSection['status'] =
      aiStatusRaw === 'grounded' || aiStatusRaw === 'insufficient_evidence'
        ? (aiStatusRaw as DraftedDocumentSection['status'])
        : section.status;
    const aiPartialReason = String(aiSection?.partialReason || '').trim();
    const contentMd = aiContent || section.contentMd;
    return {
      ...section,
      contentMd,
      status: aiStatus,
      partialReason: aiPartialReason || section.partialReason,
      source: aiContent ? 'ai' : 'fallback',
      qualityNotes: asStringArray(aiSection?.notes, 6),
      claimBullets: asStringArray(aiSection?.claims, 5).length
        ? asStringArray(aiSection?.claims, 5)
        : fallbackClaimBullets(contentMd),
    };
  });
}

async function draftSectionsWithAi(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  sectionBriefs: SectionBrief[];
  memoryContext?: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const systemPrompt = buildSectionDrafterSystemPrompt({
    docFamily: input.spec.docFamily,
    audience: input.spec.audience,
    depth: input.spec.depth,
  });
  const payload = {
    document: {
      title: input.spec.title,
      docFamily: input.spec.docFamily,
      audience: input.spec.audience,
      depth: input.spec.depth,
      businessArchetype: input.spec.businessArchetype,
      requestedIntent: input.spec.requestedIntent,
      coverage: {
        overallScore: input.payload.coverage.overallScore,
        relevanceScore: input.payload.coverage.relevanceScore,
        partial: input.payload.coverage.partial,
        partialReasons: input.payload.coverage.partialReasons,
      },
    },
    memoryContext: input.memoryContext || {},
    briefs: input.sectionBriefs,
  };

  try {
    const result = await requestJsonTask(
      'content_generation',
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      input.spec.depth === 'deep' ? 3600 : 2800,
    );
    return result.parsed;
  } catch (error) {
    console.warn('[DocumentAuthoring] Section drafting fell back to deterministic path:', (error as Error).message);
    return null;
  }
}

function mergeEditorialSections(sections: SectionDraft[], review: EditorialReview): SectionDraft[] {
  const reviewMap = new Map(review.sections.map((section) => [section.id, section]));
  return sections.map((section) => {
    const revised = reviewMap.get(section.id);
    const contentMd = String(revised?.contentMd || '').trim() || section.contentMd;
    return {
      ...section,
      contentMd,
      qualityNotes: uniqueStrings([...section.qualityNotes, ...asStringArray(revised?.notes, 6)]).slice(0, 8),
      claimBullets: fallbackClaimBullets(contentMd),
    };
  });
}

async function editSectionsWithAi(input: {
  spec: DocumentSpecV1;
  sections: SectionDraft[];
  qualityHistory?: Record<string, unknown>;
}): Promise<EditorialReview> {
  const fallback: EditorialReview = {
    summary: 'Editorial pass fell back to pre-edit drafts.',
    issues: [],
    sections: input.sections.map((section) => ({ id: section.id, contentMd: section.contentMd, notes: [] })),
  };

  try {
    const result = await requestJsonTask(
      'analysis_quality',
      [
        {
          role: 'system',
          content: buildDocumentEditorSystemPrompt({
            docFamily: input.spec.docFamily,
            audience: input.spec.audience,
            depth: input.spec.depth,
          }),
        },
        {
          role: 'user',
          content: JSON.stringify({
            document: {
              title: input.spec.title,
              family: input.spec.docFamily,
              audience: input.spec.audience,
              qualityHistory: input.qualityHistory || {},
            },
            sections: input.sections.map((section) => ({
              id: section.id,
              title: section.title,
              kind: section.kind,
              contentMd: section.contentMd,
              evidenceRefIds: section.evidenceRefIds,
              qualityNotes: section.qualityNotes,
            })),
          }),
        },
      ],
      input.spec.depth === 'deep' ? 3400 : 2600,
    );
    const parsed = result.parsed;
    if (!parsed) return fallback;
    return {
      summary: String(parsed.summary || '').trim() || fallback.summary,
      issues: asStringArray(parsed.issues, 8),
      sections: Array.isArray(parsed.sections)
        ? parsed.sections
            .map((section) => {
              if (!isRecord(section)) return null;
              const id = String(section.id || '').trim();
              const contentMd = String(section.contentMd || '').trim();
              if (!id || !contentMd) return null;
              return {
                id,
                contentMd,
                notes: asStringArray(section.notes, 6),
              };
            })
            .filter((section): section is EditorialReview['sections'][number] => Boolean(section))
        : fallback.sections,
    };
  } catch (error) {
    console.warn('[DocumentAuthoring] Editorial pass failed, keeping drafted sections:', (error as Error).message);
    return fallback;
  }
}

async function factCheckSectionsWithAi(input: {
  spec: DocumentSpecV1;
  sections: SectionDraft[];
  sectionBriefs: SectionBrief[];
}): Promise<FactCheckResult> {
  const fallback: FactCheckResult = {
    pass: true,
    issues: [],
    sections: input.sections.map((section) => ({
      id: section.id,
      status: section.status === 'grounded' ? 'pass' : 'softened',
      contentMd: section.contentMd,
      notes: section.partialReason ? [section.partialReason] : [],
      confidence: section.status === 'grounded' ? 0.84 : 0.62,
    })),
  };

  try {
    const result = await requestJsonTask(
      'analysis_quality',
      [
        {
          role: 'system',
          content: buildDocumentFactCheckerSystemPrompt({
            docFamily: input.spec.docFamily,
            audience: input.spec.audience,
          }),
        },
        {
          role: 'user',
          content: JSON.stringify({
            document: {
              title: input.spec.title,
              family: input.spec.docFamily,
              audience: input.spec.audience,
            },
            sections: input.sections.map((section) => ({
              id: section.id,
              title: section.title,
              contentMd: section.contentMd,
              evidenceRefIds: section.evidenceRefIds,
              evidencePacket: input.sectionBriefs.find((brief) => brief.id === section.id)?.evidencePacket || [],
            })),
          }),
        },
      ],
      input.spec.depth === 'deep' ? 2800 : 2200,
    );
    const parsed = result.parsed;
    if (!parsed) return fallback;
    return {
      pass: typeof parsed.pass === 'boolean' ? parsed.pass : fallback.pass,
      issues: asStringArray(parsed.issues, 8),
      sections: Array.isArray(parsed.sections)
        ? parsed.sections
            .map((section) => {
              if (!isRecord(section)) return null;
              const id = String(section.id || '').trim();
              const contentMd = String(section.contentMd || '').trim();
              const statusRaw = String(section.status || '').trim().toLowerCase();
              const status =
                statusRaw === 'pass' || statusRaw === 'softened' || statusRaw === 'needs_review'
                  ? (statusRaw as 'pass' | 'softened' | 'needs_review')
                  : 'pass';
              const confidence = Number(section.confidence);
              if (!id || !contentMd) return null;
              return {
                id,
                status,
                contentMd,
                notes: asStringArray(section.notes, 6),
                confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.78,
              };
            })
            .filter((section): section is FactCheckResult['sections'][number] => Boolean(section))
        : fallback.sections,
    };
  } catch (error) {
    console.warn('[DocumentAuthoring] Fact-check pass failed, keeping editorial draft:', (error as Error).message);
    return fallback;
  }
}

function applyFactCheckSections(sections: SectionDraft[], factCheck: FactCheckResult): SectionDraft[] {
  const factMap = new Map(factCheck.sections.map((section) => [section.id, section]));
  return sections.map((section) => {
    const reviewed = factMap.get(section.id);
    if (!reviewed) return section;
    return {
      ...section,
      contentMd: reviewed.contentMd || section.contentMd,
      status: reviewed.status === 'needs_review' ? 'insufficient_evidence' : section.status,
      qualityNotes: uniqueStrings([...section.qualityNotes, ...reviewed.notes]).slice(0, 8),
      partialReason:
        reviewed.status === 'needs_review'
          ? reviewed.notes[0] || section.partialReason || 'Fact-check flagged unsupported claims.'
          : section.partialReason,
      claimBullets: fallbackClaimBullets(reviewed.contentMd || section.contentMd),
    };
  });
}

function duplicateSentenceRatio(sections: SectionDraft[]): number {
  const sentences = sections
    .flatMap((section) => String(section.contentMd || '').split(/[.!?]\s+/))
    .map((sentence) => sentence.trim().toLowerCase())
    .filter((sentence) => sentence.length >= 30);
  if (!sentences.length) return 0;
  const unique = new Set(sentences);
  return 1 - unique.size / sentences.length;
}

function countWords(value: string): number {
  return String(value || '')
    .replace(/[`*_>#|]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;
}

function countMarkdownTableRows(value: string): number {
  const lines = String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  if (lines.length <= 2) return 0;
  return lines.slice(2).filter((line) => !/^|\s*-+\s*\|/i.test(line)).length;
}

function minimumDocumentWords(docFamily: DocumentSpecV1['docFamily'], depth: DocumentSpecV1['depth']): number {
  const table: Record<DocumentSpecV1['docFamily'], Record<DocumentSpecV1['depth'], number>> = {
    SWOT: { short: 500, standard: 900, deep: 1400 },
    BUSINESS_STRATEGY: { short: 700, standard: 1200, deep: 1800 },
    PLAYBOOK: { short: 650, standard: 1100, deep: 1550 },
    COMPETITOR_AUDIT: { short: 700, standard: 1200, deep: 1700 },
    CONTENT_CALENDAR: { short: 650, standard: 1150, deep: 1600 },
    GO_TO_MARKET: { short: 750, standard: 1300, deep: 1900 },
  };
  return table[docFamily]?.[depth] ?? 1000;
}

function minimumSectionWords(section: SectionDraft, depth: DocumentSpecV1['depth']): number {
  if (depth === 'short') return 45;
  if (section.kind === 'content_calendar_slots') return depth === 'deep' ? 420 : 260;
  if (section.kind === 'executive_summary') return depth === 'deep' ? 100 : 70;
  if (section.kind === 'source_ledger') return depth === 'deep' ? 120 : 80;
  if (section.kind === 'risk_register' || section.kind === 'kpi_block') return depth === 'deep' ? 90 : 70;
  return depth === 'deep' ? 85 : 60;
}

function evaluateDocumentDepthSignals(input: {
  spec: DocumentSpecV1;
  sections: SectionDraft[];
}): DocumentDepthSignals {
  const totalWords = input.sections.reduce((sum, section) => sum + countWords(section.contentMd), 0);
  const minimumWords = minimumDocumentWords(input.spec.docFamily, input.spec.depth);
  const calendarSection = input.sections.find((section) => section.kind === 'content_calendar_slots');
  const calendarRows = calendarSection ? countMarkdownTableRows(calendarSection.contentMd) : 0;
  const minimumCalendarRows =
    input.spec.docFamily === 'CONTENT_CALENDAR'
      ? input.spec.depth === 'deep'
        ? 24
        : input.spec.depth === 'standard'
          ? 16
          : 8
      : 0;
  const underdevelopedSections = input.sections
    .filter((section) => countWords(section.contentMd) < minimumSectionWords(section, input.spec.depth))
    .map((section) => section.id);

  const reasons: string[] = [];
  if (totalWords < minimumWords) {
    reasons.push(`Document depth is below premium target (${totalWords}/${minimumWords} words).`);
  }
  if (minimumCalendarRows > 0 && calendarRows < minimumCalendarRows) {
    reasons.push(`Content calendar coverage is thin (${calendarRows}/${minimumCalendarRows} scheduled rows).`);
  }
  if (underdevelopedSections.length > 0) {
    reasons.push(`Underdeveloped sections remain: ${underdevelopedSections.join(', ')}.`);
  }

  return {
    totalWords,
    minimumWords,
    calendarRows,
    minimumCalendarRows,
    underdevelopedSections,
    reasons,
    needsExpansion: input.spec.depth === 'deep' && reasons.length > 0,
  };
}

export function evaluatePremiumDocumentQuality(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  sections: SectionDraft[];
  factCheck: FactCheckResult;
  html: string;
}): PremiumDocumentQuality {
  const sections = input.sections;
  const depthSignals = evaluateDocumentDepthSignals({ spec: input.spec, sections });
  const totalEvidenceRefs = sections.reduce((sum, section) => sum + section.evidenceRefIds.length, 0);
  const avgEvidenceRefs = sections.length ? totalEvidenceRefs / sections.length : 0;
  const factPassCount = input.factCheck.sections.filter((section) => section.status === 'pass').length;
  const factSoftenedCount = input.factCheck.sections.filter((section) => section.status === 'softened').length;
  const unsupportedCount = input.factCheck.sections.filter((section) => section.status === 'needs_review').length;
  const grounding = Math.max(0, Math.min(100, Math.round(avgEvidenceRefs * 18 + factPassCount * 4 - unsupportedCount * 12)));

  const specificitySignals = sections.reduce((sum, section) => {
    const content = String(section.contentMd || '');
    const matches = (content.match(/@[a-z0-9._-]+/gi) || []).length + (content.match(/\b\d{2,}\b/g) || []).length;
    return sum + matches;
  }, 0);
  const depthPenalty = depthSignals.totalWords < depthSignals.minimumWords
    ? Math.ceil((depthSignals.minimumWords - depthSignals.totalWords) / 22)
    : 0;
  const specificity = Math.max(0, Math.min(100, Math.round(42 + specificitySignals * 2.3 + avgEvidenceRefs * 4 - depthPenalty)));

  const usefulnessKinds = new Set(sections.map((section) => section.kind));
  const usefulness = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        35 +
          (usefulnessKinds.has('roadmap_30_60_90') ? 22 : 0) +
          (usefulnessKinds.has('kpi_block') ? 18 : 0) +
          (usefulnessKinds.has('risk_register') ? 10 : 0) +
          (usefulnessKinds.has('positioning') ? 10 : 0) -
          depthSignals.underdevelopedSections.length * 5 -
          (depthSignals.minimumCalendarRows > 0 && depthSignals.calendarRows < depthSignals.minimumCalendarRows ? 10 : 0)
      ),
    ),
  );

  const redundancy = Math.max(0, Math.min(100, Math.round(100 - duplicateSentenceRatio(sections) * 100 - factSoftenedCount * 4)));

  const combinedContent = sections.map((section) => section.contentMd).join('\n\n');
  const bannedSignals = [
    /tool output/gi,
    /notes?-to-self/gi,
    /internal process/gi,
    /ai monologue/gi,
    /prompt logic/gi,
    /loaded \d+ record/gi,
  ].reduce((count, pattern) => count + (combinedContent.match(pattern) || []).length, 0);
  const tone = Math.max(0, Math.min(100, 96 - bannedSignals * 20 - unsupportedCount * 6));

  const visualSignals =
    Number(/class="cover"/.test(input.html)) +
    Number(/class="hero-band"/.test(input.html)) +
    Number(/class="doc-section"/.test(input.html)) +
    Number(/class="quality-chip"/.test(input.html)) +
    Number(/<table>/i.test(input.html));
  const visual = Math.max(0, Math.min(100, 40 + visualSignals * 12));

  const score = Math.round(
    grounding * 0.25 + specificity * 0.18 + usefulness * 0.22 + redundancy * 0.12 + tone * 0.11 + visual * 0.12,
  );

  const notes: string[] = [];
  if (grounding < 72) notes.push('Grounding is weaker than target; several sections still need denser evidence support.');
  if (specificity < 72) notes.push('Writing is still too general in places; increase concrete examples, numbers, and named references.');
  if (usefulness < 78) notes.push('Execution guidance is not sharp enough yet; strengthen priorities, owners, and decision framing.');
  if (redundancy < 78) notes.push('Some sections still repeat similar language or claims.');
  if (tone < 85) notes.push('Tone needs more polish; remove any process-like or self-referential phrasing.');
  if (visual < 80) notes.push('Rendered document needs stronger visual hierarchy or layout treatment.');
  if (depthSignals.reasons.length) notes.push(...depthSignals.reasons);
  if (!notes.length) notes.push('Document passed the premium quality rubric with strong grounding, usefulness, and presentation.');

  return {
    score,
    notes,
    dimensionScores: {
      grounding,
      specificity,
      usefulness,
      redundancy,
      tone,
      visual,
    },
  };
}

export async function buildPremiumDocumentPipeline(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
  memoryContext?: Record<string, unknown>;
  qualityHistory?: Record<string, unknown>;
}): Promise<PremiumDocumentPipelineResult> {
  const baseline = draftDocumentSections({ spec: input.spec, payload: input.payload });
  const sectionBriefs = buildSectionBriefs({
    spec: input.spec,
    payload: input.payload,
    baselineSections: baseline.sections,
  });

  const draftedSections = mergeSectionDrafts({
    baseline: baseline.sections,
    aiParsed: await draftSectionsWithAi({
      spec: input.spec,
      payload: input.payload,
      sectionBriefs,
      memoryContext: input.memoryContext,
    }),
  });

  const initialEditorialReview = await editSectionsWithAi({
    spec: input.spec,
    sections: draftedSections,
    qualityHistory: input.qualityHistory,
  });
  const editedSections = mergeEditorialSections(draftedSections, initialEditorialReview);
  const initialFactCheck = await factCheckSectionsWithAi({
    spec: input.spec,
    sections: editedSections,
    sectionBriefs,
  });
  let editorialReview = initialEditorialReview;
  let factCheck = initialFactCheck;
  let finalSections = applyFactCheckSections(editedSections, factCheck);
  let editorialPassCount = 1;
  let iterationsUsed = 1;

  const depthSignals = evaluateDocumentDepthSignals({
    spec: input.spec,
    sections: finalSections,
  });
  if (depthSignals.needsExpansion) {
    const expansionReview = await editSectionsWithAi({
      spec: input.spec,
      sections: finalSections,
      qualityHistory: {
        ...(input.qualityHistory || {}),
        expansionRequired: true,
        expansionReasons: depthSignals.reasons,
        currentWordCount: depthSignals.totalWords,
        targetWordCount: depthSignals.minimumWords,
        currentCalendarRows: depthSignals.calendarRows,
        targetCalendarRows: depthSignals.minimumCalendarRows,
        underdevelopedSections: depthSignals.underdevelopedSections,
      },
    });
    const expansionEditedSections = mergeEditorialSections(finalSections, expansionReview);
    const expansionFactCheck = await factCheckSectionsWithAi({
      spec: input.spec,
      sections: expansionEditedSections,
      sectionBriefs,
    });
    finalSections = applyFactCheckSections(expansionEditedSections, expansionFactCheck);
    factCheck = expansionFactCheck;
    editorialReview = {
      summary: [initialEditorialReview.summary, expansionReview.summary].filter(Boolean).join(' '),
      issues: uniqueStrings([...initialEditorialReview.issues, ...expansionReview.issues, ...depthSignals.reasons]).slice(0, 12),
      sections: expansionReview.sections.length ? expansionReview.sections : initialEditorialReview.sections,
    };
    editorialPassCount = 2;
    iterationsUsed = 2;
  }

  return {
    sectionBriefs,
    sections: finalSections,
    editorialReview,
    factCheck,
    quality: {
      score: 0,
      notes: [],
      dimensionScores: {
        grounding: 0,
        specificity: 0,
        usefulness: 0,
        redundancy: 0,
        tone: 0,
        visual: 0,
      },
    },
    theme: defaultTheme(),
    editorialPassCount,
    iterationsUsed,
  };
}
