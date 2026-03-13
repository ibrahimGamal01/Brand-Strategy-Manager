import { ProcessQuestionSeverity, ProcessQuestionStatus, ProcessRunStage, ProcessRunStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export const BRAND_ASSET_FIELD_KEYS = {
  logo: 'brandPrimaryLogo',
  typography: 'brandTypography',
  colors: 'brandColorPalette',
} as const;

export const BRAND_ASSET_FIELD_KEY_SET = new Set<string>(Object.values(BRAND_ASSET_FIELD_KEYS));

export type WebsiteAssetPackKey = 'brand_identity' | 'typography' | 'imagery' | 'design_tokens';

type AssetPackSelection = {
  value: string;
  label: string;
  confidence: number;
  evidenceRefs: string[];
};

export type WebsiteAssetPackItem = {
  id: string;
  packKey: WebsiteAssetPackKey;
  assetType: string;
  role: string;
  assetUrl: string;
  normalizedAssetUrl: string;
  confidence: number;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  pageUrl: string;
  selectorPath: string | null;
  attributeName: string | null;
  discoveryRuleId: string;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  snapshotId: string;
  scanRunId: string | null;
};

export type WebsiteAssetPack = {
  key: WebsiteAssetPackKey;
  count: number;
  items: WebsiteAssetPackItem[];
};

export type WebsiteAssetPacksResult = {
  workspaceId: string;
  generatedAt: string;
  sourceScanRunId: string | null;
  coverage: {
    status: string;
    pagesDiscovered: number;
    pagesFetched: number;
    pagesPersisted: number;
    uniquePathPatterns: number;
    templateCoverageScore: number;
  };
  extraction: {
    totalAssets: number;
    logos: number;
    images: number;
    typography: number;
    designTokens: number;
  };
  packs: {
    brand_identity: WebsiteAssetPack;
    typography: WebsiteAssetPack;
    imagery: WebsiteAssetPack;
    design_tokens: WebsiteAssetPack;
  };
  selection: {
    primaryLogo: AssetPackSelection | null;
    typography: AssetPackSelection | null;
    colorPalette: AssetPackSelection | null;
  };
  ambiguities: string[];
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toPackKey(assetType: string): WebsiteAssetPackKey {
  const normalized = normalizeText(assetType).toLowerCase();
  if (normalized === 'logo') return 'brand_identity';
  if (normalized === 'font_family' || normalized === 'font_file' || normalized === 'stylesheet') return 'typography';
  if (normalized === 'image') return 'imagery';
  return 'design_tokens';
}

function logoRolePriority(role: string): number {
  const normalized = normalizeText(role).toLowerCase();
  if (normalized.includes('logo_candidate')) return 1.0;
  if (normalized.includes('inline_svg_brand_mark')) return 0.96;
  if (normalized.includes('social_meta_image')) return 0.92;
  if (normalized.includes('icon_link')) return 0.88;
  return 0.82;
}

function buildSelectionLabel(input: {
  role: string;
  assetType: string;
  pageUrl: string;
  value: string;
  metadata: Record<string, unknown>;
}): string {
  const role = normalizeText(input.role).replace(/_/g, ' ');
  const family = normalizeText(input.metadata.family || input.metadata.name);
  if (family && input.assetType.startsWith('font_')) {
    return `Font: ${family}`;
  }

  const tokenValue = normalizeText(input.metadata.value || input.metadata.color);
  if (tokenValue && (input.assetType === 'design_token' || input.assetType === 'color')) {
    return `Color token ${tokenValue}`;
  }

  if (role) return `${role} (${input.pageUrl})`;
  return `${input.assetType} (${input.pageUrl})`;
}

function dedupePackItems(
  rows: Array<{
    id: string;
    assetType: string;
    role: string | null;
    assetUrl: string;
    normalizedAssetUrl: string;
    confidence: number;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    pageUrl: string;
    selectorPath: string | null;
    attributeName: string | null;
    metadata: unknown;
    firstSeenAt: Date;
    lastSeenAt: Date;
    snapshotId: string;
    scanRunId: string | null;
  }>,
  maxPerPack: number
): Record<WebsiteAssetPackKey, WebsiteAssetPackItem[]> {
  const store: Record<WebsiteAssetPackKey, Map<string, WebsiteAssetPackItem>> = {
    brand_identity: new Map(),
    typography: new Map(),
    imagery: new Map(),
    design_tokens: new Map(),
  };

  for (const row of rows) {
    const packKey = toPackKey(row.assetType);
    const key = `${normalizeText(row.normalizedAssetUrl).toLowerCase()}|${normalizeText(row.assetType).toLowerCase()}|${normalizeText(row.role).toLowerCase()}`;
    if (!key) continue;

    const metadata = asRecord(row.metadata);
    const next: WebsiteAssetPackItem = {
      id: row.id,
      packKey,
      assetType: normalizeText(row.assetType),
      role: normalizeText(row.role),
      assetUrl: normalizeText(row.assetUrl),
      normalizedAssetUrl: normalizeText(row.normalizedAssetUrl),
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
      mimeType: normalizeText(row.mimeType) || null,
      width: Number.isFinite(Number(row.width)) ? Number(row.width) : null,
      height: Number.isFinite(Number(row.height)) ? Number(row.height) : null,
      pageUrl: normalizeText(row.pageUrl),
      selectorPath: normalizeText(row.selectorPath) || null,
      attributeName: normalizeText(row.attributeName) || null,
      discoveryRuleId: normalizeText(metadata.discoveryRuleId || metadata.discoveryRule || metadata.ruleId) || 'website_lineage/default',
      metadata,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      snapshotId: row.snapshotId,
      scanRunId: normalizeText(row.scanRunId) || null,
    };

    const existing = store[packKey].get(key);
    if (!existing) {
      store[packKey].set(key, next);
      continue;
    }

    const shouldReplace =
      next.confidence > existing.confidence ||
      (next.confidence === existing.confidence && next.lastSeenAt > existing.lastSeenAt);
    if (shouldReplace) {
      store[packKey].set(key, next);
    }
  }

  return {
    brand_identity: Array.from(store.brand_identity.values())
      .sort((left, right) => right.confidence - left.confidence || right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, maxPerPack),
    typography: Array.from(store.typography.values())
      .sort((left, right) => right.confidence - left.confidence || right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, maxPerPack),
    imagery: Array.from(store.imagery.values())
      .sort((left, right) => right.confidence - left.confidence || right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, maxPerPack),
    design_tokens: Array.from(store.design_tokens.values())
      .sort((left, right) => right.confidence - left.confidence || right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, maxPerPack),
  };
}

function selectPrimaryLogo(items: WebsiteAssetPackItem[]): {
  selection: AssetPackSelection | null;
  ambiguous: boolean;
} {
  const logos = items.filter((item) => item.assetType.toLowerCase() === 'logo');
  if (logos.length === 0) return { selection: null, ambiguous: false };

  const ranked = [...logos].sort((left, right) => {
    const leftScore = left.confidence + logoRolePriority(left.role) * 0.25;
    const rightScore = right.confidence + logoRolePriority(right.role) * 0.25;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return right.lastSeenAt.localeCompare(left.lastSeenAt) || left.normalizedAssetUrl.localeCompare(right.normalizedAssetUrl);
  });

  const top = ranked[0];
  if (!top) return { selection: null, ambiguous: false };
  const runnerUp = ranked[1];
  const ambiguous = Boolean(
    runnerUp &&
      Math.abs((top.confidence + logoRolePriority(top.role) * 0.25) - (runnerUp.confidence + logoRolePriority(runnerUp.role) * 0.25)) <=
        0.06,
  );

  return {
    selection: {
      value: top.normalizedAssetUrl,
      label: `Primary logo (${top.pageUrl})`,
      confidence: top.confidence,
      evidenceRefs: [top.id],
    },
    ambiguous,
  };
}

function selectPrimaryTypography(items: WebsiteAssetPackItem[]): {
  selection: AssetPackSelection | null;
  ambiguous: boolean;
} {
  const familyScore = new Map<string, { score: number; refIds: string[]; label: string }>();

  for (const item of items) {
    if (item.assetType !== 'font_family' && item.assetType !== 'font_file') continue;
    const familyRaw =
      normalizeText(item.metadata.family) || normalizeText(item.normalizedAssetUrl.replace(/^font-family:/i, '')) || normalizeText(item.normalizedAssetUrl);
    if (!familyRaw) continue;

    const key = familyRaw.toLowerCase();
    const usageCount = Number(item.metadata.usageCount || 0);
    const score = item.confidence + Math.min(0.18, Math.max(0, usageCount) * 0.02);
    const existing = familyScore.get(key);
    if (!existing) {
      familyScore.set(key, {
        score,
        refIds: [item.id],
        label: familyRaw,
      });
      continue;
    }

    existing.score = Math.max(existing.score, score);
    if (!existing.refIds.includes(item.id)) existing.refIds.push(item.id);
  }

  const ranked = Array.from(familyScore.entries()).sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]));
  if (ranked.length === 0) return { selection: null, ambiguous: false };

  const top = ranked[0];
  const runnerUp = ranked[1];
  const ambiguous = Boolean(runnerUp && Math.abs(top[1].score - runnerUp[1].score) <= 0.05);

  return {
    selection: {
      value: top[1].label,
      label: `Primary typography: ${top[1].label}`,
      confidence: Math.max(0, Math.min(1, top[1].score)),
      evidenceRefs: top[1].refIds.slice(0, 5),
    },
    ambiguous,
  };
}

function selectPrimaryColorPalette(items: WebsiteAssetPackItem[]): {
  selection: AssetPackSelection | null;
  ambiguous: boolean;
} {
  const colorScores = new Map<string, { score: number; refs: string[] }>();

  for (const item of items) {
    if (item.assetType !== 'color' && item.assetType !== 'design_token') continue;
    const value = normalizeText(item.normalizedAssetUrl.replace(/^color:/i, '').replace(/^token:/i, ''));
    if (!value) continue;
    const key = value.toLowerCase();
    const existing = colorScores.get(key);
    if (!existing) {
      colorScores.set(key, { score: item.confidence, refs: [item.id] });
      continue;
    }
    existing.score = Math.max(existing.score, item.confidence);
    if (!existing.refs.includes(item.id)) existing.refs.push(item.id);
  }

  const ranked = Array.from(colorScores.entries())
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .slice(0, 4);
  if (ranked.length === 0) return { selection: null, ambiguous: false };

  const palette = ranked.map(([key]) => key).join(', ');
  const refs = ranked.flatMap(([, value]) => value.refs).slice(0, 8);

  return {
    selection: {
      value: palette,
      label: `Palette: ${palette}`,
      confidence: Math.max(0, Math.min(1, ranked[0][1].score)),
      evidenceRefs: refs,
    },
    ambiguous: false,
  };
}

export async function getLatestWorkspaceWebsiteAssetPacks(input: {
  workspaceId: string;
  preferredScanRunId?: string;
  maxRows?: number;
  maxPerPack?: number;
}): Promise<WebsiteAssetPacksResult> {
  const workspaceId = normalizeText(input.workspaceId);
  if (!workspaceId) {
    throw new Error('workspaceId is required');
  }

  const maxRows = Math.max(50, Math.min(1500, Number(input.maxRows || 600)));
  const maxPerPack = Math.max(10, Math.min(160, Number(input.maxPerPack || 60)));

  const requestedScanRunId = normalizeText(input.preferredScanRunId);
  const sourceRun = requestedScanRunId
    ? await prisma.portalIntakeScanRun.findFirst({
        where: {
          id: requestedScanRunId,
          workspaceId,
        },
      })
    : await prisma.portalIntakeScanRun.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
      });

  const scopedRows = await prisma.websiteAssetRecord.findMany({
    where: {
      researchJobId: workspaceId,
      ...(sourceRun ? { scanRunId: sourceRun.id } : {}),
    },
    orderBy: [{ confidence: 'desc' }, { lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    take: maxRows,
  });

  const rows =
    scopedRows.length > 0
      ? scopedRows
      : await prisma.websiteAssetRecord.findMany({
          where: { researchJobId: workspaceId },
          orderBy: [{ confidence: 'desc' }, { lastSeenAt: 'desc' }, { createdAt: 'desc' }],
          take: maxRows,
        });

  const deduped = dedupePackItems(
    rows.map((row) => ({
      id: row.id,
      assetType: row.assetType,
      role: row.role,
      assetUrl: row.assetUrl,
      normalizedAssetUrl: row.normalizedAssetUrl,
      confidence: row.confidence,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      pageUrl: row.pageUrl,
      selectorPath: row.selectorPath,
      attributeName: row.attributeName,
      metadata: row.metadata,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      snapshotId: row.snapshotId,
      scanRunId: row.scanRunId,
    })),
    maxPerPack,
  );

  const primaryLogo = selectPrimaryLogo(deduped.brand_identity);
  const primaryTypography = selectPrimaryTypography(deduped.typography);
  const primaryColors = selectPrimaryColorPalette(deduped.design_tokens);

  const ambiguities: string[] = [];
  if (primaryLogo.ambiguous) {
    ambiguities.push('Multiple high-confidence logo candidates require user confirmation.');
  }
  if (primaryTypography.ambiguous) {
    ambiguities.push('Multiple typography families have near-equal confidence.');
  }

  const sourceScanRunId = sourceRun?.id || null;

  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    sourceScanRunId,
    coverage: {
      status: normalizeText(sourceRun?.coverageStatus) || 'PENDING',
      pagesDiscovered: Number(sourceRun?.pagesDiscovered || 0),
      pagesFetched: Number(sourceRun?.pagesFetched || 0),
      pagesPersisted: Number(sourceRun?.pagesPersisted || 0),
      uniquePathPatterns: Number(sourceRun?.uniquePathPatterns || 0),
      templateCoverageScore: Number(sourceRun?.templateCoverageScore || 0),
    },
    extraction: {
      totalAssets:
        deduped.brand_identity.length +
        deduped.typography.length +
        deduped.imagery.length +
        deduped.design_tokens.length,
      logos: deduped.brand_identity.filter((item) => item.assetType === 'logo').length,
      images: deduped.imagery.length,
      typography: deduped.typography.length,
      designTokens: deduped.design_tokens.length,
    },
    packs: {
      brand_identity: {
        key: 'brand_identity',
        count: deduped.brand_identity.length,
        items: deduped.brand_identity,
      },
      typography: {
        key: 'typography',
        count: deduped.typography.length,
        items: deduped.typography,
      },
      imagery: {
        key: 'imagery',
        count: deduped.imagery.length,
        items: deduped.imagery,
      },
      design_tokens: {
        key: 'design_tokens',
        count: deduped.design_tokens.length,
        items: deduped.design_tokens,
      },
    },
    selection: {
      primaryLogo: primaryLogo.selection,
      typography: primaryTypography.selection,
      colorPalette: primaryColors.selection,
    },
    ambiguities,
  };
}

export async function getWorkspaceWebsiteAssetProvenance(input: {
  workspaceId: string;
  assetId: string;
}) {
  const workspaceId = normalizeText(input.workspaceId);
  const assetId = normalizeText(input.assetId);
  if (!workspaceId || !assetId) {
    throw new Error('workspaceId and assetId are required');
  }

  const row = await prisma.websiteAssetRecord.findFirst({
    where: {
      id: assetId,
      researchJobId: workspaceId,
    },
    include: {
      snapshot: {
        select: {
          id: true,
          finalUrl: true,
          fetchedAt: true,
          statusCode: true,
          fetcherUsed: true,
          webSource: {
            select: {
              id: true,
              url: true,
              domain: true,
              sourceType: true,
              discoveredBy: true,
            },
          },
        },
      },
      scanRun: {
        select: {
          id: true,
          mode: true,
          status: true,
          coverageStatus: true,
          templateCoverageScore: true,
        },
      },
    },
  });

  if (!row) {
    throw new Error('Asset record not found');
  }

  return {
    id: row.id,
    assetType: row.assetType,
    role: row.role,
    assetUrl: row.assetUrl,
    normalizedAssetUrl: row.normalizedAssetUrl,
    confidence: row.confidence,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    pageUrl: row.pageUrl,
    selectorPath: row.selectorPath,
    attributeName: row.attributeName,
    metadata: row.metadata,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    snapshot: {
      id: row.snapshot.id,
      finalUrl: row.snapshot.finalUrl,
      fetchedAt: row.snapshot.fetchedAt.toISOString(),
      statusCode: row.snapshot.statusCode,
      fetcherUsed: row.snapshot.fetcherUsed,
      webSource: {
        id: row.snapshot.webSource.id,
        url: row.snapshot.webSource.url,
        domain: row.snapshot.webSource.domain,
        sourceType: row.snapshot.webSource.sourceType,
        discoveredBy: row.snapshot.webSource.discoveredBy,
      },
    },
    scanRun: row.scanRun
      ? {
          id: row.scanRun.id,
          mode: row.scanRun.mode,
          status: row.scanRun.status,
          coverageStatus: row.scanRun.coverageStatus,
          templateCoverageScore: row.scanRun.templateCoverageScore,
        }
      : null,
  };
}

export async function listOpenBrandAssetAmbiguityTasks(workspaceId: string) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    throw new Error('workspaceId is required');
  }

  const tasks = await prisma.processQuestionTask.findMany({
    where: {
      researchJobId: normalizedWorkspaceId,
      status: ProcessQuestionStatus.OPEN,
      severity: {
        in: [ProcessQuestionSeverity.BLOCKER, ProcessQuestionSeverity.IMPORTANT],
      },
      fieldKey: {
        in: Array.from(BRAND_ASSET_FIELD_KEY_SET),
      },
      processRun: {
        stage: {
          in: [
            ProcessRunStage.RESEARCHING,
            ProcessRunStage.SECTION_PLANNING,
            ProcessRunStage.SECTION_DRAFTING,
            ProcessRunStage.SECTION_VALIDATING,
            ProcessRunStage.WAITING_USER,
            ProcessRunStage.COMPOSING,
            ProcessRunStage.FINAL_GATE,
          ],
        },
        status: {
          in: [ProcessRunStatus.RUNNING, ProcessRunStatus.WAITING_USER, ProcessRunStatus.PAUSED],
        },
      },
    },
    include: {
      processRun: {
        select: {
          id: true,
          stage: true,
          status: true,
        },
      },
      sectionRun: {
        select: {
          id: true,
          sectionKey: true,
          title: true,
        },
      },
    },
    orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
    take: 60,
  });

  return tasks.map((task) => ({
    id: task.id,
    processRunId: task.processRunId,
    sectionRunId: task.sectionRunId,
    sectionKey: task.sectionRun?.sectionKey || null,
    sectionTitle: task.sectionRun?.title || null,
    fieldKey: task.fieldKey,
    question: task.question,
    severity: task.severity,
    status: task.status,
    surfacesJson: task.surfacesJson,
    answerJson: task.answerJson,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    runStage: task.processRun.stage,
    runStatus: task.processRun.status,
  }));
}

export function buildBrandAssetQuestionOptionsFromPacks(packs: WebsiteAssetPacksResult): {
  [BRAND_ASSET_FIELD_KEYS.logo]: Array<{ value: string; label: string }>;
  [BRAND_ASSET_FIELD_KEYS.typography]: Array<{ value: string; label: string }>;
  [BRAND_ASSET_FIELD_KEYS.colors]: Array<{ value: string; label: string }>;
} {
  const logoOptions = packs.packs.brand_identity.items
    .filter((item) => item.assetType === 'logo')
    .slice(0, 8)
    .map((item) => ({
      value: item.normalizedAssetUrl,
      label: buildSelectionLabel({
        role: item.role,
        assetType: item.assetType,
        pageUrl: item.pageUrl,
        value: item.normalizedAssetUrl,
        metadata: {},
      }),
    }));

  const typographyMap = new Map<string, { value: string; label: string }>();
  for (const item of packs.packs.typography.items) {
    const normalized = normalizeText(item.normalizedAssetUrl);
    if (!normalized) continue;
    const family = normalized.replace(/^font-family:/i, '').trim();
    const value = family || normalized;
    const key = value.toLowerCase();
    if (typographyMap.has(key)) continue;
    typographyMap.set(key, {
      value,
      label: value,
    });
    if (typographyMap.size >= 8) break;
  }

  const colorMap = new Map<string, { value: string; label: string }>();
  for (const item of packs.packs.design_tokens.items) {
    const normalized = normalizeText(item.normalizedAssetUrl).replace(/^color:/i, '').replace(/^token:/i, '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (colorMap.has(key)) continue;
    colorMap.set(key, {
      value: normalized,
      label: normalized,
    });
    if (colorMap.size >= 8) break;
  }

  return {
    [BRAND_ASSET_FIELD_KEYS.logo]: logoOptions,
    [BRAND_ASSET_FIELD_KEYS.typography]: Array.from(typographyMap.values()),
    [BRAND_ASSET_FIELD_KEYS.colors]: Array.from(colorMap.values()),
  };
}
