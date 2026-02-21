import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateStrategyDocument } from '../services/ai/generators/index';
import { GenerationResult } from '../services/ai/generators/base-generator';
import { openai as openaiClient } from '../services/ai/openai-client';
import {
  evaluateStrategyQualityGate,
  StrategyQualityGateMode,
} from '../services/ai/generators/strategy-quality-gate';
import {
  buildGroundingReportFromQualityGate,
  normalizeGroundingReport,
  toPrismaJson,
} from '../services/ai/generators/grounding-report';

const router = Router();

const SECTION_MAPPING_DB_TO_KEY: Record<string, string> = {
  business_understanding: 'businessUnderstanding',
  target_audience: 'targetAudience',
  industry_overview: 'industryOverview',
  priority_competitor: 'priorityCompetitor',
  content_analysis: 'contentAnalysis',
  content_pillars: 'contentPillars',
  format_recommendations: 'formatRecommendations',
  buyer_journey: 'buyerJourney',
  platform_strategy: 'platformStrategy',
};

const SECTION_MAPPING_KEY_TO_DB: Record<string, string> = Object.entries(
  SECTION_MAPPING_DB_TO_KEY
).reduce((acc, [dbKey, sectionKey]) => {
  acc[sectionKey] = dbKey;
  return acc;
}, {} as Record<string, string>);

const SECTION_ORDER = [
  'businessUnderstanding',
  'targetAudience',
  'industryOverview',
  'priorityCompetitor',
  'contentAnalysis',
  'contentPillars',
  'formatRecommendations',
  'buyerJourney',
  'platformStrategy',
] as const;

const FINAL_DOCUMENT_STATUS = 'FINAL';
const DRAFT_DOCUMENT_STATUS = 'DRAFT';
const STRATEGY_CHAT_MODEL = process.env.STRATEGY_DOC_CHAT_MODEL || 'gpt-4o-mini';

type StrategyDocChatScopeValue = 'ALL' | 'SECTION';

function normalizeChatScope(value: unknown): StrategyDocChatScopeValue {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw === 'SECTION' ? 'SECTION' : 'ALL';
}

function normalizeChatSectionKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (SECTION_MAPPING_KEY_TO_DB[raw]) return raw;
  if (SECTION_MAPPING_DB_TO_KEY[raw]) return SECTION_MAPPING_DB_TO_KEY[raw];
  return null;
}

function compactMarkdownForChat(markdown: string, maxChars: number): string {
  const text = String(markdown || '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}\n\n[truncated for chat context]`;
}

async function loadStrategySectionsForChat(jobId: string): Promise<{
  sections: Record<string, string>;
  documentStatus: 'FINAL' | 'DRAFT' | 'NONE';
}> {
  const finalOrLegacy = await prisma.aiAnalysis.findMany({
    where: {
      researchJobId: jobId,
      analysisType: 'DOCUMENT',
      OR: [{ documentStatus: FINAL_DOCUMENT_STATUS }, { documentStatus: null }],
    },
    orderBy: { analyzedAt: 'desc' },
  });

  const draftOnly = await prisma.aiAnalysis.findMany({
    where: {
      researchJobId: jobId,
      analysisType: 'DOCUMENT',
      documentStatus: DRAFT_DOCUMENT_STATUS,
    },
    orderBy: { analyzedAt: 'desc' },
  });

  const latestFinalAt = finalOrLegacy[0]?.analyzedAt ? new Date(finalOrLegacy[0].analyzedAt).getTime() : 0;
  const latestDraftAt = draftOnly[0]?.analyzedAt ? new Date(draftOnly[0].analyzedAt).getTime() : 0;
  const preferDraft = draftOnly.length > 0 && (finalOrLegacy.length === 0 || latestDraftAt > latestFinalAt);
  const analyses = preferDraft ? draftOnly : finalOrLegacy;
  const documentStatus: 'FINAL' | 'DRAFT' | 'NONE' = analyses.length
    ? preferDraft
      ? 'DRAFT'
      : 'FINAL'
    : 'NONE';

  const sections: Record<string, string> = {};
  for (const key of SECTION_ORDER) {
    const topic = SECTION_MAPPING_KEY_TO_DB[key];
    const analysis = topic ? analyses.find((a) => a.topic === topic) : undefined;
    if (!analysis?.fullResponse) continue;
    sections[key] =
      typeof analysis.fullResponse === 'string'
        ? analysis.fullResponse
        : JSON.stringify(analysis.fullResponse);
  }

  return { sections, documentStatus };
}

function buildStrategyChatContext(params: {
  sections: Record<string, string>;
  scope: StrategyDocChatScopeValue;
  sectionKey: string | null;
}): {
  scopeLabel: string;
  contextText: string;
  contextSnippet: Record<string, unknown>;
} {
  const { sections, scope, sectionKey } = params;
  if (scope === 'SECTION' && sectionKey && sections[sectionKey]) {
    const markdown = compactMarkdownForChat(sections[sectionKey], 7000);
    return {
      scopeLabel: `${sectionKey}`,
      contextText: `Section: ${sectionKey}\n\n${markdown}`,
      contextSnippet: {
        scope,
        sectionKey,
        includedSections: [sectionKey],
        sectionCount: 1,
      },
    };
  }

  const availableKeys = SECTION_ORDER.filter((key) => sections[key]);
  const combined = availableKeys
    .map((key) => `## ${key}\n${compactMarkdownForChat(sections[key], 1200)}`)
    .join('\n\n');

  return {
    scopeLabel: 'entire strategy document',
    contextText: combined || 'No strategy sections are currently available.',
    contextSnippet: {
      scope: 'ALL',
      sectionKey: null,
      includedSections: availableKeys,
      sectionCount: availableKeys.length,
    },
  };
}

async function generateStrategyDocChatReply(params: {
  message: string;
  scope: StrategyDocChatScopeValue;
  sectionKey: string | null;
  documentStatus: 'FINAL' | 'DRAFT' | 'NONE';
  contextText: string;
  scopeLabel: string;
}): Promise<string> {
  const { message, scope, sectionKey, documentStatus, contextText, scopeLabel } = params;
  if (!process.env.OPENAI_API_KEY) {
    if (documentStatus === 'NONE') {
      return 'No strategy document sections are available yet. Generate the document first, then ask me to review or refine it.';
    }
    const sectionNote = scope === 'SECTION' && sectionKey ? `the ${sectionKey} section` : 'the full strategy';
    return `Doc chat is ready. I can help with ${sectionNote}. Add an OpenAI key to get full AI replies from your saved strategy content.`;
  }

  try {
    const completion = (await openaiClient.chat.completions.create({
      model: STRATEGY_CHAT_MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content:
            'You are BAT Doc Copilot. Answer only from the provided strategy context. If context lacks a fact, say it is not present and suggest what to add. Keep answers clear, practical, and concise.',
        },
        {
          role: 'system',
          content: `Scope: ${scopeLabel}. Document status: ${documentStatus}.`,
        },
        {
          role: 'system',
          content: `Strategy context:\n${contextText}`,
        },
        {
          role: 'user',
          content: message,
        },
      ],
    })) as any;
    const text = completion?.choices?.[0]?.message?.content?.trim();
    if (text) return text;
  } catch (error: any) {
    console.warn('[Strategy Chat] OpenAI reply failed:', error?.message || error);
  }

  return 'I could not generate a full reply right now. Please retry in a moment.';
}

function normalizeRequestedSections(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  const single = String(value ?? 'all').trim();
  return single ? [single] : ['all'];
}

function normalizeGeneratorSections(value: unknown): string[] {
  const requested = normalizeRequestedSections(value);
  const normalized = requested.map((entry) => entry.trim());
  if (normalized.includes('all')) return ['all'];

  const allowed = new Set(Object.keys(SECTION_MAPPING_KEY_TO_DB));
  return Array.from(new Set(normalized.filter((entry) => allowed.has(entry))));
}

function resolveQualityGateMode(requestedGeneratorSections: string[]): StrategyQualityGateMode {
  if (requestedGeneratorSections.includes('all')) return 'document';
  // For small partial updates/regenerations use section-level gating.
  return 'section';
}

function buildSectionsForClient(sections: Record<string, string>): Record<string, string> {
  return Object.entries(sections).reduce((acc, [key, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, string>);
}

function buildTopicListFromSections(sections: Record<string, string>): string[] {
  return Object.keys(sections)
    .map((sectionKey) => SECTION_MAPPING_KEY_TO_DB[sectionKey])
    .filter(Boolean);
}

type StrategyQualityGateDecision = Awaited<ReturnType<typeof evaluateStrategyQualityGate>>;

async function buildGroundingReportForPersist(params: {
  researchJobId: string;
  qualityGate: StrategyQualityGateDecision;
  blocked: boolean;
  source: string;
}): Promise<Prisma.InputJsonValue> {
  const report = await buildGroundingReportFromQualityGate(
    params.researchJobId,
    params.qualityGate,
    {
      blocked: params.blocked,
      defaultSource: params.source,
      readiness: params.qualityGate.readiness,
    }
  );
  return toPrismaJson(report);
}

type PersistStrategySectionsInput = {
  researchJobId: string;
  sections: Record<string, string>;
  documentStatus: 'FINAL' | 'DRAFT';
  groundingReport: Prisma.InputJsonValue;
};

async function persistStrategySections(input: PersistStrategySectionsInput): Promise<number> {
  const topics = buildTopicListFromSections(input.sections);
  if (topics.length === 0) return 0;

  await prisma.aiAnalysis.deleteMany({
    where: {
      researchJobId: input.researchJobId,
      analysisType: 'DOCUMENT',
      topic: { in: topics },
      ...(input.documentStatus === DRAFT_DOCUMENT_STATUS
        ? {
            documentStatus: DRAFT_DOCUMENT_STATUS,
          }
        : {}),
    },
  });

  const analysisRecords = Object.entries(input.sections)
    .map(([sectionKey, markdownContent]) => {
      const topic = SECTION_MAPPING_KEY_TO_DB[sectionKey];
      if (!topic || !markdownContent) return null;
      return {
        researchJobId: input.researchJobId,
        topic,
        fullResponse: markdownContent,
        analysisType: 'DOCUMENT' as const,
        modelUsed: 'gpt-4o',
        tokensUsed: 0,
        documentStatus: input.documentStatus,
        groundingReport: input.groundingReport,
      };
    })
    .filter(Boolean) as Array<{
    researchJobId: string;
    topic: string;
    fullResponse: string;
    analysisType: 'DOCUMENT';
    modelUsed: string;
    tokensUsed: number;
    documentStatus: 'FINAL' | 'DRAFT';
    groundingReport: Prisma.InputJsonValue;
  }>;

  if (analysisRecords.length === 0) return 0;
  await prisma.aiAnalysis.createMany({ data: analysisRecords });
  return analysisRecords.length;
}

/**
 * GET /api/strategy/:jobId
 * Fetch existing strategy document sections
 */
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const finalOrLegacy = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: jobId,
        analysisType: 'DOCUMENT',
        OR: [{ documentStatus: FINAL_DOCUMENT_STATUS }, { documentStatus: null }],
      },
      orderBy: {
        analyzedAt: 'desc',
      },
    });

    const draftOnly = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: jobId,
        analysisType: 'DOCUMENT',
        documentStatus: DRAFT_DOCUMENT_STATUS,
      },
      orderBy: {
        analyzedAt: 'desc',
      },
    });

    const latestFinalAt = finalOrLegacy[0]?.analyzedAt
      ? new Date(finalOrLegacy[0].analyzedAt).getTime()
      : 0;
    const latestDraftAt = draftOnly[0]?.analyzedAt
      ? new Date(draftOnly[0].analyzedAt).getTime()
      : 0;
    const preferDraft = draftOnly.length > 0 && (finalOrLegacy.length === 0 || latestDraftAt > latestFinalAt);
    const analyses = preferDraft ? draftOnly : finalOrLegacy;

    if (analyses.length === 0) {
      return res.status(404).json({
        status: 'NONE',
        message: 'No strategy document found',
      });
    }

    const sections: Record<string, string> = {};
    for (const key of SECTION_ORDER) {
      const topic = SECTION_MAPPING_KEY_TO_DB[key];
      const analysis = topic ? analyses.find((a) => a.topic === topic) : undefined;
      if (analysis?.fullResponse) {
        const content =
          typeof analysis.fullResponse === 'string'
            ? analysis.fullResponse
            : JSON.stringify(analysis.fullResponse);
        sections[key] = content;
      }
    }

    const sectionsCount = Object.keys(sections).length;
    const hasFinal = !preferDraft && finalOrLegacy.length > 0;
    const status = hasFinal
      ? sectionsCount === 9
        ? 'COMPLETE'
        : sectionsCount > 0
          ? 'PARTIAL'
          : 'NONE'
      : sectionsCount > 0
        ? 'PARTIAL'
        : 'NONE';

    res.json({
      sections,
      generatedAt: analyses[0]?.analyzedAt,
      status,
      documentStatus: hasFinal ? FINAL_DOCUMENT_STATUS : DRAFT_DOCUMENT_STATUS,
      sectionsComplete: sectionsCount,
      totalSections: 9,
      groundingReport: analyses[0]?.groundingReport ?? null,
    });

  } catch (error) {
    console.error('[Strategy API] Error fetching document:', error);
    res.status(500).json({
      error: 'Failed to fetch strategy document',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/strategy/:jobId/generate
 * Generate strategy document sections
 */
router.post('/:jobId/generate', async (req, res) => {
  try {
    const { jobId } = req.params;
    const requestedGeneratorSections = normalizeGeneratorSections(req.body?.sections ?? 'all');

    console.log(`[Strategy API] Generating document for job: ${jobId}`);
    console.log(
      `[Strategy API] Sections requested: ${requestedGeneratorSections.join(', ')}`
    );
    if (requestedGeneratorSections.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid sections requested',
      });
    }

    // Call the generator service from Phase 2
    const result = await generateStrategyDocument(jobId, requestedGeneratorSections);

    if (!result.sections || Object.keys(result.sections).length === 0) {
      throw new Error('Generation failed - no sections generated');
    }

    console.log(
      `[Strategy API] Generated ${Object.keys(result.sections).length} sections with status: ${result.status}`
    );

    const qualityMode = resolveQualityGateMode(requestedGeneratorSections);
    const qualityGate = await evaluateStrategyQualityGate({
      researchJobId: jobId,
      sections: result.sections,
      requestedSections: requestedGeneratorSections,
      mode: qualityMode,
      minSectionScore: 80,
    });

    if (!qualityGate.allowPersist) {
      console.warn(
        `[Strategy API] Quality gate blocked persistence for job ${jobId}: ${qualityGate.reasonCodes.join(', ')}`
      );
      const correctedSections = buildSectionsForClient(qualityGate.correctedSections);
      const groundingReport = await buildGroundingReportForPersist({
        researchJobId: jobId,
        qualityGate,
        blocked: true,
        source: 'strategy_route_generate',
      });
      const persistedDraftCount = await persistStrategySections({
        researchJobId: jobId,
        sections: correctedSections,
        documentStatus: DRAFT_DOCUMENT_STATUS,
        groundingReport,
      });

      return res.json({
        success: false,
        status: 'PARTIAL',
        error: 'Generated content failed grounding checks and was saved as draft only',
        qualityGate,
        sections: correctedSections,
        persistedDraftCount,
        documentStatus: DRAFT_DOCUMENT_STATUS,
        generatedAt: new Date().toISOString(),
      });
    }

    const correctedSections = buildSectionsForClient(qualityGate.correctedSections);
    if (Object.keys(correctedSections).length === 0) {
      return res.status(422).json({
        success: false,
        status: 'FAILED',
        error: 'No persistable sections found after quality gate',
        qualityGate,
        sections: correctedSections,
        generatedAt: new Date().toISOString(),
      });
    }

    const groundingReport = await buildGroundingReportForPersist({
      researchJobId: jobId,
      qualityGate,
      blocked: false,
      source: 'strategy_route_generate',
    });
    const persistedFinalCount = await persistStrategySections({
      researchJobId: jobId,
      sections: correctedSections,
      documentStatus: FINAL_DOCUMENT_STATUS,
      groundingReport,
    });

    if (persistedFinalCount === 0) {
      return res.status(422).json({
        success: false,
        status: 'FAILED',
        error: 'No valid analysis records after quality gate',
        qualityGate,
        sections: correctedSections,
        generatedAt: new Date().toISOString(),
      });
    }

    console.log(`[Strategy API] Successfully stored ${persistedFinalCount} sections`);

    res.json({
      success: true,
      sections: correctedSections,
      generatedAt: new Date().toISOString(),
      status: 'COMPLETE',
      documentStatus: FINAL_DOCUMENT_STATUS,
      sectionsComplete: Object.keys(correctedSections).length,
      totalSections: requestedGeneratorSections.includes('all')
        ? 9
        : requestedGeneratorSections.length,
      qualityGate: {
        mode: qualityGate.mode,
        reasonCodes: qualityGate.reasonCodes,
        lowestSectionScore: qualityGate.lowestSectionScore,
        placeholderOrDisclaimerHits: qualityGate.placeholderOrDisclaimerHits,
        readiness: qualityGate.readiness,
        factCheck: {
          criticalCount: qualityGate.factCheck.criticalCount,
          highCount: qualityGate.factCheck.highCount,
        },
      },
    });
  } catch (error) {
    console.error('[Strategy API] Error generating document:', error);
    res.status(500).json({
      status: 'FAILED',
      error: 'Failed to generate strategy document',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/strategy/:jobId/regenerate/:section
 * Regenerate a specific section
 */
router.post('/:jobId/regenerate/:section', async (req, res) => {
  try {
    const { jobId, section } = req.params;

    console.log(`[Strategy API] Regenerating section: ${section} for job: ${jobId}`);

    const generatorKey = SECTION_MAPPING_DB_TO_KEY[section];
    if (!generatorKey) {
      return res.status(400).json({
        error: 'Invalid section name'
      });
    }

    const result = await generateStrategyDocument(jobId, [generatorKey]);
    const sectionData = result.sections[generatorKey as keyof typeof result.sections];
    if (!sectionData) {
      throw new Error('Section generation failed');
    }

    const qualityGate = await evaluateStrategyQualityGate({
      researchJobId: jobId,
      sections: result.sections,
      requestedSections: [generatorKey],
      mode: 'section',
      minSectionScore: 80,
    });

    if (!qualityGate.allowPersist) {
      console.warn(
        `[Strategy API] Quality gate blocked section regenerate for ${section}: ${qualityGate.reasonCodes.join(', ')}`
      );
      const draftSection = buildSectionsForClient({
        [generatorKey]: qualityGate.correctedSections[generatorKey] || '',
      });
      const groundingReport = await buildGroundingReportForPersist({
        researchJobId: jobId,
        qualityGate,
        blocked: true,
        source: 'strategy_route_regenerate',
      });
      const persistedDraftCount = await persistStrategySections({
        researchJobId: jobId,
        sections: draftSection,
        documentStatus: DRAFT_DOCUMENT_STATUS,
        groundingReport,
      });
      return res.json({
        success: false,
        status: 'PARTIAL',
        error: 'Regenerated section failed grounding checks and was saved as draft only',
        qualityGate,
        section: generatorKey,
        content: qualityGate.correctedSections[generatorKey] || '',
        persistedDraftCount,
        documentStatus: DRAFT_DOCUMENT_STATUS,
      });
    }

    const markdownContent = qualityGate.correctedSections[generatorKey] || '';
    if (!markdownContent) {
      return res.status(422).json({
        success: false,
        status: 'BLOCKED_BY_QUALITY_GATE',
        error: 'No section content available after quality gate',
        qualityGate,
      });
    }

    const groundingReport = await buildGroundingReportForPersist({
      researchJobId: jobId,
      qualityGate,
      blocked: false,
      source: 'strategy_route_regenerate',
    });
    await persistStrategySections({
      researchJobId: jobId,
      sections: { [generatorKey]: markdownContent },
      documentStatus: FINAL_DOCUMENT_STATUS,
      groundingReport,
    });

    res.json({
      success: true,
      status: 'COMPLETE',
      documentStatus: FINAL_DOCUMENT_STATUS,
      section: generatorKey,
      content: markdownContent,
      qualityGate: {
        mode: qualityGate.mode,
        reasonCodes: qualityGate.reasonCodes,
        lowestSectionScore: qualityGate.lowestSectionScore,
        placeholderOrDisclaimerHits: qualityGate.placeholderOrDisclaimerHits,
        readiness: qualityGate.readiness,
      },
    });
  } catch (error) {
    console.error('[Strategy API] Error regenerating section:', error);
    res.status(500).json({
      status: 'FAILED',
      error: 'Failed to regenerate section',
      message: (error as Error).message
    });
  }
});

/**
 * PATCH /api/strategy/:jobId/section/:sectionKey
 * Update a specific section content
 */
router.patch('/:jobId/section/:sectionKey', async (req, res) => {
  try {
    const { jobId, sectionKey } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        error: 'Content is required and must be a string'
      });
    }

    console.log(`[Strategy API] Updating section: ${sectionKey} for job: ${jobId}`);

    const topic = SECTION_MAPPING_KEY_TO_DB[sectionKey];
    if (!topic) {
      return res.status(400).json({
        error: 'Invalid section key'
      });
    }

    const latestTopicRow = await prisma.aiAnalysis.findFirst({
      where: {
        researchJobId: jobId,
        topic,
        analysisType: 'DOCUMENT',
        OR: [{ documentStatus: FINAL_DOCUMENT_STATUS }, { documentStatus: null }],
      },
      orderBy: { analyzedAt: 'desc' },
      select: {
        id: true,
        groundingReport: true,
      },
    });
    if (!latestTopicRow) {
      return res.status(404).json({
        error: 'Section not found'
      });
    }
    const groundingReport = await normalizeGroundingReport(jobId, latestTopicRow.groundingReport, {
      defaultMode: 'section',
      defaultSource: 'strategy_route_section_patch',
      forceBlocked: false,
    });

    // Update the section in database
    const updated = await prisma.aiAnalysis.updateMany({
      where: {
        researchJobId: jobId,
        topic,
        analysisType: 'DOCUMENT',
        OR: [{ documentStatus: FINAL_DOCUMENT_STATUS }, { documentStatus: null }],
      },
      data: {
        fullResponse: content,
        documentStatus: FINAL_DOCUMENT_STATUS,
        groundingReport: toPrismaJson(groundingReport),
      }
    });

    if (updated.count === 0) {
      return res.status(404).json({
        error: 'Section not found'
      });
    }

    console.log(`[Strategy API] Section ${sectionKey} updated successfully`);

    res.json({
      success: true,
      sectionKey,
      content
    });

  } catch (error) {
    console.error('[Strategy API] Error updating section:', error);
    res.status(500).json({
      error: 'Failed to update section',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/strategy/:jobId/export
 * Generate and download PDF of strategy document
 */
router.get('/:jobId/export', async (req, res) => {
  try {
    const { jobId } = req.params;

    console.log(`[Strategy API] Generating PDF for job: ${jobId}`);

    // Fetch document sections
    const analyses = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: jobId,
        analysisType: 'DOCUMENT',
        OR: [{ documentStatus: FINAL_DOCUMENT_STATUS }, { documentStatus: null }],
      },
      orderBy: {
        analyzedAt: 'desc',
      }
    });

    if (analyses.length === 0) {
      return res.status(404).json({
        error: 'No document found for this job'
      });
    }

    // Map sections
    const sectionMapping: { [key: string]: string } = {
      'business_understanding': 'Business Understanding',
      'target_audience': 'Target Audience',
      'industry_overview': 'Industry Overview',
      'priority_competitor': 'Priority Competitor Analysis',
      'content_analysis': 'Content Analysis',
      'content_pillars': 'Strategic Content Pillars',
      'format_recommendations': 'Format Recommendations',
      'buyer_journey': 'Buyer Journey Mapping',
      'platform_strategy': 'Platform Strategy'
    };

    const latestByTopic = analyses.reduce((acc, analysis) => {
      if (!analysis.topic) return acc;
      if (!acc[analysis.topic]) {
        acc[analysis.topic] = analysis;
      }
      return acc;
    }, {} as Record<string, (typeof analyses)[number]>);

    const sections = SECTION_ORDER.map((sectionKey) => {
      const topic = SECTION_MAPPING_KEY_TO_DB[sectionKey];
      const analysis = topic ? latestByTopic[topic] : undefined;
      if (!analysis?.fullResponse) return '';
      const title = sectionMapping[topic || ''] || topic;
      const content =
        typeof analysis.fullResponse === 'string'
          ? analysis.fullResponse
          : JSON.stringify(analysis.fullResponse);

      return `
        <section class="document-section">
          <h2 class="section-title">${title}</h2>
          <div class="section-content">
            ${renderMarkdownToHTML(content)}
          </div>
        </section>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            @page {
              margin: 0.75in;
              size: letter;
            }
            
            body {
              font-family: Georgia, 'Times New Roman', serif;
              line-height: 1.6;
              color: #1a1a1a;
              font-size: 11pt;
            }
            
            .document-header {
              border-bottom: 3px solid #1a1a1a;
              padding-bottom: 20px;
              margin-bottom: 40px;
            }
            
            .document-header h1 {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              font-size: 28pt;
              margin: 0 0 10px 0;
              font-weight: bold;
            }
            
            .document-meta {
              font-size: 10pt;
              color: #666;
            }
            
            .document-section {
              page-break-inside: avoid;
              margin-bottom: 40px;
            }
            
            .section-title {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              font-size: 18pt;
              font-weight: bold;
              margin: 0 0 16px 0;
              padding-bottom: 8px;
              border-bottom: 2px solid #2563eb;
            }
            
            .section-content {
              margin-left: 0;
            }
            
            .section-content p {
              margin: 0 0 12pt 0;
            }
            
            .section-content h3 {
              font-size: 14pt;
              margin: 16pt 0 8pt 0;
              font-weight: 600;
            }
            
            .section-content ul, .section-content ol {
              margin: 8pt 0;
              padding-left: 24pt;
            }
            
            .section-content li {
              margin-bottom: 4pt;
            }
            
            .section-content strong {
              font-weight: 600;
              color: #000;
            }
            
            .section-content blockquote {
              border-left: 4px solid #2563eb;
              padding-left: 16px;
              margin: 12pt 0;
              font-style: italic;
              background: #f8f9fa;
              padding: 12px 16px;
            }
            
            .section-content code {
              background: #f3f4f6;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: 'Courier New', monospace;
              font-size: 9pt;
            }
          </style>
        </head>
        <body>
          <div class="document-header">
            <h1>Brand Strategy Document</h1>
            <div class="document-meta">
              Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
          
          ${sections}
        </body>
      </html>
    `;

    // Generate PDF with puppeteer
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.75in',
        right: '0.75in',
        bottom: '0.75in',
        left: '0.75in'
      }
    });

    await browser.close();

    console.log(`[Strategy API] PDF generated successfully`);

    // Send PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="brand-strategy-${jobId}.pdf"`);
    res.send(Buffer.from(pdf));

  } catch (error) {
    console.error('[Strategy API] Error generating PDF:', error);
    res.status(500).json({
      error: 'Failed to generate PDF',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/strategy/:jobId/chat/sessions
 * List active doc chat sessions for a strategy document.
 */
router.get('/:jobId/chat/sessions', async (req, res) => {
  try {
    const { jobId } = req.params;
    const scope = req.query.scope ? normalizeChatScope(req.query.scope) : undefined;
    const sectionKey = normalizeChatSectionKey(req.query.sectionKey);

    const sessions = await prisma.strategyDocChatSession.findMany({
      where: {
        researchJobId: jobId,
        status: 'ACTIVE',
        ...(scope ? { scope } : {}),
        ...(scope === 'SECTION' ? { sectionKey } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 30,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return res.json({
      success: true,
      sessions: sessions.map((session) => ({
        ...session,
        lastMessage: session.messages[0] || null,
      })),
    });
  } catch (error: any) {
    console.error('[Strategy Chat] Failed to list sessions:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to list doc chat sessions' });
  }
});

/**
 * POST /api/strategy/:jobId/chat/sessions
 * Create or reuse an active doc chat session for scope=ALL|SECTION.
 */
router.post('/:jobId/chat/sessions', async (req, res) => {
  try {
    const { jobId } = req.params;
    const scope = normalizeChatScope(req.body?.scope);
    const normalizedSectionKey = normalizeChatSectionKey(req.body?.sectionKey);
    const sectionKey = scope === 'SECTION' ? normalizedSectionKey : null;
    if (scope === 'SECTION' && !sectionKey) {
      return res.status(400).json({
        success: false,
        error: 'sectionKey is required for SECTION scope',
      });
    }

    const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Research job not found' });
    }

    const existing = await prisma.strategyDocChatSession.findFirst({
      where: {
        researchJobId: jobId,
        scope,
        sectionKey,
        status: 'ACTIVE',
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    const session =
      existing ||
      (await prisma.strategyDocChatSession.create({
        data: {
          researchJobId: jobId,
          scope,
          sectionKey,
          title:
            typeof req.body?.title === 'string' && req.body.title.trim()
              ? req.body.title.trim().slice(0, 140)
              : scope === 'SECTION'
                ? `Section chat: ${sectionKey}`
                : 'Strategy doc chat',
        },
      }));

    const messages = await prisma.strategyDocChatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    return res.json({ success: true, session, messages });
  } catch (error: any) {
    console.error('[Strategy Chat] Failed to create session:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to create doc chat session' });
  }
});

/**
 * GET /api/strategy/:jobId/chat/sessions/:sessionId
 * Fetch a single doc chat session and messages.
 */
router.get('/:jobId/chat/sessions/:sessionId', async (req, res) => {
  try {
    const { jobId, sessionId } = req.params;
    const session = await prisma.strategyDocChatSession.findFirst({
      where: {
        id: sessionId,
        researchJobId: jobId,
      },
    });
    if (!session) {
      return res.status(404).json({ success: false, error: 'Chat session not found' });
    }
    const messages = await prisma.strategyDocChatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    return res.json({ success: true, session, messages });
  } catch (error: any) {
    console.error('[Strategy Chat] Failed to fetch session:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to fetch doc chat session' });
  }
});

/**
 * POST /api/strategy/:jobId/chat/sessions/:sessionId/messages
 * Send a message to doc chat and persist assistant reply.
 */
router.post('/:jobId/chat/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { jobId, sessionId } = req.params;
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    const session = await prisma.strategyDocChatSession.findFirst({
      where: {
        id: sessionId,
        researchJobId: jobId,
        status: 'ACTIVE',
      },
    });
    if (!session) {
      return res.status(404).json({ success: false, error: 'Active chat session not found' });
    }

    const { sections, documentStatus } = await loadStrategySectionsForChat(jobId);
    const { scopeLabel, contextText, contextSnippet } = buildStrategyChatContext({
      sections,
      scope: session.scope as StrategyDocChatScopeValue,
      sectionKey: session.sectionKey,
    });
    const assistantReply = await generateStrategyDocChatReply({
      message,
      scope: session.scope as StrategyDocChatScopeValue,
      sectionKey: session.sectionKey,
      documentStatus,
      contextText,
      scopeLabel,
    });

    const now = new Date();
    const userMessage = await prisma.strategyDocChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: message,
        contextSnippet: contextSnippet as any,
      },
    });

    const assistantMessage = await prisma.strategyDocChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: assistantReply,
        contextSnippet: {
          ...contextSnippet,
          documentStatus,
        } as any,
      },
    });

    await prisma.strategyDocChatSession.update({
      where: { id: session.id },
      data: {
        lastMessageAt: now,
      },
    });

    const messages = await prisma.strategyDocChatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });

    return res.json({
      success: true,
      sessionId: session.id,
      userMessage,
      assistantMessage,
      messages,
      documentStatus,
    });
  } catch (error: any) {
    console.error('[Strategy Chat] Failed to post message:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to post doc chat message' });
  }
});

/**
 * Simple markdown to HTML converter (basic implementation)
 * For production, consider using a library like marked or remark
 */
function renderMarkdownToHTML(markdown: string): string {
  return markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^## (.*$)/gim, '<h3>$1</h3>')
    .replace(/^# (.*$)/gim, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Lists
    .replace(/^\* (.+)$/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, (match) => `<ul>${match}</ul>`)
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => {
      if (!line.startsWith('<') && !line.endsWith('>')) {
        return `<p>${line}</p>`;
      }
      return line;
    });
}

export default router;
