import { Request, Router } from 'express';
import {
  applyReferenceShortlistAction,
  compareStudioDocumentVersions,
  createBrandDnaSummary,
  createGenerationPack,
  createIngestionRun,
  createStudioDocument,
  createStudioDocumentVersion,
  GenerationFormatTarget,
  GenerationRefineMode,
  ExportStudioDocumentFormat,
  exportStudioDocument,
  getBrandDNAProfile,
  getGenerationPack,
  getIngestionRun,
  getStudioDocumentWithVersions,
  getViralStudioContractSnapshot,
  listIngestionRuns,
  listPromptTemplates,
  listReferenceAssets,
  promoteStudioDocumentVersion,
  retryIngestionRun,
  refineGenerationPack,
  ShortlistAction,
  StudioDocumentSection,
  updateStudioDocument,
  upsertBrandDNAProfile,
  ViralStudioPlatform,
} from '../services/portal/viral-studio';

const router = Router({ mergeParams: true });

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseStringArray(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseWorkspaceId(req: Request): string {
  return safeString(req.params.workspaceId);
}

function parsePlatform(value: unknown): ViralStudioPlatform | null {
  const platform = safeString(value).toLowerCase();
  if (platform === 'instagram' || platform === 'tiktok' || platform === 'youtube') {
    return platform;
  }
  return null;
}

function parseShortlistAction(value: unknown): ShortlistAction | null {
  const action = safeString(value).toLowerCase();
  if (action === 'pin' || action === 'exclude' || action === 'must-use' || action === 'clear') {
    return action;
  }
  return null;
}

function parseIngestionPreset(value: unknown): 'balanced' | 'quick-scan' | 'deep-scan' | null {
  const preset = safeString(value).toLowerCase();
  if (preset === 'balanced' || preset === 'quick-scan' || preset === 'deep-scan') {
    return preset;
  }
  return null;
}

function parseExportFormat(value: unknown): ExportStudioDocumentFormat {
  const normalized = safeString(value).toLowerCase();
  return normalized === 'json' ? 'json' : 'markdown';
}

function parseGenerationFormatTarget(value: unknown): GenerationFormatTarget {
  const normalized = safeString(value).toLowerCase();
  if (normalized === 'reel-60') return 'reel-60';
  if (normalized === 'shorts') return 'shorts';
  if (normalized === 'story') return 'story';
  return 'reel-30';
}

function parseGenerationMode(value: unknown): GenerationRefineMode {
  return safeString(value).toLowerCase() === 'regenerate' ? 'regenerate' : 'refine';
}

function parseDocumentSectionKind(value: unknown): StudioDocumentSection['kind'] | undefined {
  const normalized = safeString(value).toLowerCase();
  if (normalized === 'hooks' || normalized === 'script' || normalized === 'captions' || normalized === 'ctas' || normalized === 'angles') {
    return normalized;
  }
  return undefined;
}

function parseDocumentSections(
  value: unknown
): Array<{ id: string; title?: string; kind?: StudioDocumentSection['kind']; content?: string | string[] }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: Array<{ id: string; title?: string; kind?: StudioDocumentSection['kind']; content?: string | string[] }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const id = safeString(record.id);
    if (!id) continue;
    const section: { id: string; title?: string; kind?: StudioDocumentSection['kind']; content?: string | string[] } = { id };
    if (typeof record.title === 'string') section.title = safeString(record.title);
    const kind = parseDocumentSectionKind(record.kind);
    if (kind) section.kind = kind;
    if (typeof record.content === 'string') {
      section.content = record.content;
    } else if (Array.isArray(record.content)) {
      section.content = record.content.map((line) => String(line || '').trim());
    }
    parsed.push(section);
  }
  return parsed;
}

function parseVoiceSliders(value: unknown): Partial<{ bold: number; formal: number; playful: number; direct: number }> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const parsed: Partial<{ bold: number; formal: number; playful: number; direct: number }> = {};
  if (Number.isFinite(Number(record.bold))) parsed.bold = Number(record.bold);
  if (Number.isFinite(Number(record.formal))) parsed.formal = Number(record.formal);
  if (Number.isFinite(Number(record.playful))) parsed.playful = Number(record.playful);
  if (Number.isFinite(Number(record.direct))) parsed.direct = Number(record.direct);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

router.get('/brand-dna', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const profile = await getBrandDNAProfile(workspaceId);
    return res.json({
      ok: true,
      profile,
      contract: {
        onboarding: getViralStudioContractSnapshot().stateMachines.onboarding,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'BRAND_DNA_FETCH_FAILED', details: error?.message || String(error) });
  }
});

router.post('/brand-dna', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const voiceSliders = parseVoiceSliders(payload.voiceSliders);

    const profile = await upsertBrandDNAProfile(
      workspaceId,
      {
        status: safeString(payload.status).toLowerCase() === 'final' ? 'final' : 'draft',
        mission: safeString(payload.mission),
        valueProposition: safeString(payload.valueProposition),
        productOrService: safeString(payload.productOrService),
        region: safeString(payload.region),
        audiencePersonas: parseStringArray(payload.audiencePersonas, 8),
        pains: parseStringArray(payload.pains, 12),
        desires: parseStringArray(payload.desires, 12),
        objections: parseStringArray(payload.objections, 12),
        voiceSliders,
        bannedPhrases: parseStringArray(payload.bannedPhrases, 24),
        requiredClaims: parseStringArray(payload.requiredClaims, 24),
        exemplars: parseStringArray(payload.exemplars, 12),
        summary: safeString(payload.summary),
      },
      'create'
    );

    return res.status(201).json({
      ok: true,
      profile,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'BRAND_DNA_CREATE_FAILED', details: error?.message || String(error) });
  }
});

router.patch('/brand-dna', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const voiceSliders = parseVoiceSliders(payload.voiceSliders);

    const profile = await upsertBrandDNAProfile(
      workspaceId,
      {
        ...(safeString(payload.status) ? { status: safeString(payload.status).toLowerCase() === 'final' ? 'final' : 'draft' } : {}),
        ...(typeof payload.mission === 'string' ? { mission: safeString(payload.mission) } : {}),
        ...(typeof payload.valueProposition === 'string' ? { valueProposition: safeString(payload.valueProposition) } : {}),
        ...(typeof payload.productOrService === 'string' ? { productOrService: safeString(payload.productOrService) } : {}),
        ...(typeof payload.region === 'string' ? { region: safeString(payload.region) } : {}),
        ...(Array.isArray(payload.audiencePersonas) ? { audiencePersonas: parseStringArray(payload.audiencePersonas, 8) } : {}),
        ...(Array.isArray(payload.pains) ? { pains: parseStringArray(payload.pains, 12) } : {}),
        ...(Array.isArray(payload.desires) ? { desires: parseStringArray(payload.desires, 12) } : {}),
        ...(Array.isArray(payload.objections) ? { objections: parseStringArray(payload.objections, 12) } : {}),
        ...(voiceSliders ? { voiceSliders } : {}),
        ...(Array.isArray(payload.bannedPhrases) ? { bannedPhrases: parseStringArray(payload.bannedPhrases, 24) } : {}),
        ...(Array.isArray(payload.requiredClaims) ? { requiredClaims: parseStringArray(payload.requiredClaims, 24) } : {}),
        ...(Array.isArray(payload.exemplars) ? { exemplars: parseStringArray(payload.exemplars, 12) } : {}),
        ...(typeof payload.summary === 'string' ? { summary: safeString(payload.summary) } : {}),
      },
      'patch'
    );

    return res.json({
      ok: true,
      profile,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'BRAND_DNA_PATCH_FAILED', details: error?.message || String(error) });
  }
});

router.post('/brand-dna/summary', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const persisted = await getBrandDNAProfile(workspaceId);
    const summary = createBrandDnaSummary({
      mission: safeString(payload.mission) || persisted?.mission,
      valueProposition: safeString(payload.valueProposition) || persisted?.valueProposition,
      productOrService: safeString(payload.productOrService) || persisted?.productOrService,
      region: safeString(payload.region) || persisted?.region,
      audiencePersonas: Array.isArray(payload.audiencePersonas)
        ? parseStringArray(payload.audiencePersonas, 8)
        : persisted?.audiencePersonas,
      pains: Array.isArray(payload.pains) ? parseStringArray(payload.pains, 12) : persisted?.pains,
      desires: Array.isArray(payload.desires) ? parseStringArray(payload.desires, 12) : persisted?.desires,
      voiceSliders: parseVoiceSliders(payload.voiceSliders) || persisted?.voiceSliders,
    });
    return res.json({
      ok: true,
      summary,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'BRAND_DNA_SUMMARY_FAILED', details: error?.message || String(error) });
  }
});

router.get('/viral-studio/contracts', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const contract = getViralStudioContractSnapshot();
    return res.json({
      ok: true,
      contract,
      promptTemplates: listPromptTemplates(),
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'VIRAL_STUDIO_CONTRACT_FETCH_FAILED', details: error?.message || String(error) });
  }
});

router.get('/viral-studio/ingestions', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    return res.json({
      ok: true,
      runs: listIngestionRuns(workspaceId),
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'INGESTION_RUNS_FETCH_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/ingestions', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const platform = parsePlatform(payload.sourcePlatform);
    if (!platform) {
      return res.status(400).json({ error: 'sourcePlatform must be one of instagram/tiktok/youtube' });
    }
    const sourceUrl = safeString(payload.sourceUrl);
    if (!sourceUrl) {
      return res.status(400).json({ error: 'sourceUrl is required' });
    }

    const maxVideosParsed = Number(payload.maxVideos);
    const lookbackDaysParsed = Number(payload.lookbackDays);
    const sortByRaw = safeString(payload.sortBy).toLowerCase();
    const sortBy = sortByRaw === 'recent' || sortByRaw === 'views' ? sortByRaw : 'engagement';
    const preset = parseIngestionPreset(payload.preset);

    const run = createIngestionRun(workspaceId, {
      sourcePlatform: platform,
      sourceUrl,
      ...(Number.isFinite(maxVideosParsed) ? { maxVideos: maxVideosParsed } : {}),
      ...(Number.isFinite(lookbackDaysParsed) ? { lookbackDays: lookbackDaysParsed } : {}),
      sortBy,
      ...(preset ? { preset } : {}),
    });

    return res.status(202).json({
      ok: true,
      run,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'INGESTION_CREATE_FAILED', details: error?.message || String(error) });
  }
});

router.get('/viral-studio/ingestions/:ingestionId', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const ingestionId = safeString(req.params.ingestionId);
    if (!workspaceId || !ingestionId) {
      return res.status(400).json({ error: 'workspaceId and ingestionId are required' });
    }
    const run = getIngestionRun(workspaceId, ingestionId);
    if (!run) {
      return res.status(404).json({ error: 'Ingestion run not found' });
    }
    return res.json({
      ok: true,
      run,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'INGESTION_FETCH_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/ingestions/:ingestionId/retry', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const ingestionId = safeString(req.params.ingestionId);
    if (!workspaceId || !ingestionId) {
      return res.status(400).json({ error: 'workspaceId and ingestionId are required' });
    }
    const run = retryIngestionRun(workspaceId, ingestionId);
    if (!run) {
      return res.status(409).json({
        error: 'INGESTION_RETRY_NOT_ALLOWED',
        details: 'Retry is only available for failed or partial runs.',
      });
    }
    return res.status(202).json({
      ok: true,
      run,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'INGESTION_RETRY_FAILED', details: error?.message || String(error) });
  }
});

router.get('/viral-studio/references', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const ingestionRunId = safeString(Array.isArray(req.query.ingestionRunId) ? req.query.ingestionRunId[0] : req.query.ingestionRunId);
    const shortlistOnly = safeString(Array.isArray(req.query.shortlistOnly) ? req.query.shortlistOnly[0] : req.query.shortlistOnly) === 'true';
    const includeExcluded = safeString(Array.isArray(req.query.includeExcluded) ? req.query.includeExcluded[0] : req.query.includeExcluded) === 'true';

    const items = listReferenceAssets(workspaceId, {
      ...(ingestionRunId ? { ingestionRunId } : {}),
      shortlistOnly,
      includeExcluded,
    });

    return res.json({
      ok: true,
      items,
      count: items.length,
      scoringWeights: getViralStudioContractSnapshot().scoringWeights,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'REFERENCES_FETCH_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/references/shortlist', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const referenceId = safeString(payload.referenceId);
    const action = parseShortlistAction(payload.action);
    if (!referenceId) return res.status(400).json({ error: 'referenceId is required' });
    if (!action) return res.status(400).json({ error: 'action must be pin, exclude, must-use, or clear' });

    const updated = applyReferenceShortlistAction(workspaceId, referenceId, action);
    if (!updated) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    return res.json({
      ok: true,
      item: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'SHORTLIST_UPDATE_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/generations', async (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const brandProfile = await getBrandDNAProfile(workspaceId);
    if (!brandProfile || !brandProfile.completeness.ready || brandProfile.status !== 'final') {
      return res.status(409).json({
        error: 'BRAND_DNA_REQUIRED',
        details: 'Finalize Brand DNA onboarding before generation.',
      });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const generation = createGenerationPack(workspaceId, {
      templateId: safeString(payload.templateId),
      prompt: safeString(payload.prompt),
      selectedReferenceIds: parseStringArray(payload.selectedReferenceIds, 12),
      formatTarget: parseGenerationFormatTarget(payload.formatTarget),
    });
    return res.status(201).json({
      ok: true,
      generation,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'GENERATION_CREATE_FAILED', details: error?.message || String(error) });
  }
});

router.get('/viral-studio/generations/:generationId', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const generationId = safeString(req.params.generationId);
    if (!workspaceId || !generationId) {
      return res.status(400).json({ error: 'workspaceId and generationId are required' });
    }
    const generation = getGenerationPack(workspaceId, generationId);
    if (!generation) {
      return res.status(404).json({ error: 'Generation not found' });
    }
    return res.json({
      ok: true,
      generation,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'GENERATION_FETCH_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/generations/:generationId/refine', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const generationId = safeString(req.params.generationId);
    if (!workspaceId || !generationId) {
      return res.status(400).json({ error: 'workspaceId and generationId are required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const mode = parseGenerationMode(payload.mode);
    const section = safeString(payload.section) as
      | 'hooks'
      | 'scripts.short'
      | 'scripts.medium'
      | 'scripts.long'
      | 'captions'
      | 'ctas'
      | 'angleRemixes';
    const instruction = safeString(payload.instruction);
    if (
      section !== 'hooks' &&
      section !== 'scripts.short' &&
      section !== 'scripts.medium' &&
      section !== 'scripts.long' &&
      section !== 'captions' &&
      section !== 'ctas' &&
      section !== 'angleRemixes'
    ) {
      return res.status(400).json({ error: 'Invalid section for refine action' });
    }
    if (mode === 'refine' && !instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }

    if (!getGenerationPack(workspaceId, generationId)) {
      return res.status(404).json({ error: 'Generation not found' });
    }
    const updated = refineGenerationPack(workspaceId, generationId, { section, instruction, mode });
    if (!updated) {
      return res.status(404).json({ error: 'Generation not found' });
    }

    return res.json({
      ok: true,
      generation: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'GENERATION_REFINE_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/documents', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const generationId = safeString(payload.generationId);
    if (!generationId) return res.status(400).json({ error: 'generationId is required' });

    const document = createStudioDocument(workspaceId, {
      title: safeString(payload.title),
      generationId,
    });

    return res.status(201).json({
      ok: true,
      document,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: 'DOCUMENT_CREATE_FAILED', details: message || 'Failed to create document' });
  }
});

router.get('/viral-studio/documents/:documentId', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const documentId = safeString(req.params.documentId);
    if (!workspaceId || !documentId) {
      return res.status(400).json({ error: 'workspaceId and documentId are required' });
    }
    const payload = getStudioDocumentWithVersions(workspaceId, documentId);
    if (!payload) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.json({
      ok: true,
      ...payload,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'DOCUMENT_FETCH_FAILED', details: error?.message || String(error) });
  }
});

router.patch('/viral-studio/documents/:documentId', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const documentId = safeString(req.params.documentId);
    if (!workspaceId || !documentId) {
      return res.status(400).json({ error: 'workspaceId and documentId are required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const sections = parseDocumentSections(payload.sections);
    const orderedSectionIds = parseStringArray(payload.orderedSectionIds, 128);
    const document = updateStudioDocument(workspaceId, documentId, {
      ...(typeof payload.title === 'string' ? { title: safeString(payload.title) } : {}),
      ...(sections ? { sections } : {}),
      ...(orderedSectionIds.length > 0 ? { orderedSectionIds } : {}),
      ...(typeof payload.autosave === 'boolean' ? { autosave: payload.autosave } : {}),
    });
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.json({
      ok: true,
      document,
      autosavedAt: typeof payload.autosave === 'boolean' && payload.autosave ? new Date().toISOString() : undefined,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'DOCUMENT_PATCH_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/documents/:documentId/versions', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const documentId = safeString(req.params.documentId);
    if (!workspaceId || !documentId) {
      return res.status(400).json({ error: 'workspaceId and documentId are required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const created = createStudioDocumentVersion(workspaceId, documentId, {
      author: safeString(payload.author),
      summary: safeString(payload.summary),
    });
    if (!created) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.status(201).json({
      ok: true,
      ...created,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'DOCUMENT_VERSION_CREATE_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/documents/:documentId/versions/:versionId/promote', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const documentId = safeString(req.params.documentId);
    const versionId = safeString(req.params.versionId);
    if (!workspaceId || !documentId || !versionId) {
      return res.status(400).json({ error: 'workspaceId, documentId, and versionId are required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const promoted = promoteStudioDocumentVersion(workspaceId, documentId, versionId, {
      author: safeString(payload.author),
      summary: safeString(payload.summary),
    });
    if (!promoted) {
      return res.status(404).json({ error: 'Document or version not found' });
    }
    return res.status(201).json({
      ok: true,
      ...promoted,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'DOCUMENT_VERSION_PROMOTE_FAILED', details: error?.message || String(error) });
  }
});

router.get('/viral-studio/documents/:documentId/compare', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const documentId = safeString(req.params.documentId);
    if (!workspaceId || !documentId) {
      return res.status(400).json({ error: 'workspaceId and documentId are required' });
    }
    const leftVersionId = safeString(Array.isArray(req.query.leftVersionId) ? req.query.leftVersionId[0] : req.query.leftVersionId) || 'current';
    const rightVersionId = safeString(Array.isArray(req.query.rightVersionId) ? req.query.rightVersionId[0] : req.query.rightVersionId) || 'current';
    const comparison = compareStudioDocumentVersions(workspaceId, documentId, leftVersionId, rightVersionId);
    if (!comparison) {
      return res.status(404).json({ error: 'Document or versions not found' });
    }
    return res.json({
      ok: true,
      comparison,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'DOCUMENT_COMPARE_FAILED', details: error?.message || String(error) });
  }
});

router.post('/viral-studio/documents/:documentId/export', (req, res) => {
  try {
    const workspaceId = parseWorkspaceId(req);
    const documentId = safeString(req.params.documentId);
    if (!workspaceId || !documentId) {
      return res.status(400).json({ error: 'workspaceId and documentId are required' });
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const format = parseExportFormat(payload.format);
    const exported = exportStudioDocument(workspaceId, documentId, format);
    if (!exported) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.json({
      ok: true,
      export: exported,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: 'DOCUMENT_EXPORT_FAILED', details: error?.message || String(error) });
  }
});

export default router;
