import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { ReadinessGateMetrics, loadReadinessGateMetrics } from './readiness-metrics';

export interface GroundingReadinessMetadata {
  checked: boolean;
  minReadyClientSnapshots: number;
  minReadyCompetitorSnapshots: number;
  allowCompetitorDegradedFallback: boolean;
  clientReady: number;
  clientDegraded: number;
  clientBlocked: number;
  competitorReady: number;
  competitorDegraded: number;
  competitorBlocked: number;
  hadUnscoredSnapshots: boolean;
}

interface BuildGroundingReadinessOptions {
  checked?: boolean;
  minReadyClientSnapshots?: number;
  minReadyCompetitorSnapshots?: number;
  allowCompetitorDegradedFallback?: boolean;
}

interface NormalizeGroundingReportOptions extends BuildGroundingReadinessOptions {
  defaultMode?: string;
  defaultSource?: string;
  forceBlocked?: boolean;
  generatedAt?: string;
  readiness?: GroundingReadinessMetadata;
}

interface QualityGateGroundingInput {
  mode: string;
  reasonCodes: string[];
  lowestSectionScore: number;
  placeholderOrDisclaimerHits: number;
  factCheck: unknown;
  documentValidation: unknown;
  readiness?: GroundingReadinessMetadata;
}

interface FinalDocGroundingBackfillResult {
  checked: number;
  missing: number;
  updated: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function normalizeReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseReadinessFromUnknown(value: unknown): GroundingReadinessMetadata | null {
  const record = asRecord(value);
  if (
    !isNumber(record.clientReady) ||
    !isNumber(record.competitorReady) ||
    !isNumber(record.clientDegraded) ||
    !isNumber(record.clientBlocked) ||
    !isNumber(record.competitorDegraded) ||
    !isNumber(record.competitorBlocked)
  ) {
    return null;
  }

  const checked = typeof record.checked === 'boolean' ? record.checked : true;
  const hadUnscoredSnapshots =
    typeof record.hadUnscoredSnapshots === 'boolean' ? record.hadUnscoredSnapshots : false;
  const minReadyClientSnapshots = Math.max(
    0,
    Number(record.minReadyClientSnapshots ?? 1)
  );
  const minReadyCompetitorSnapshots = Math.max(
    0,
    Number(record.minReadyCompetitorSnapshots ?? 1)
  );
  const allowCompetitorDegradedFallback =
    record.allowCompetitorDegradedFallback === true;

  return {
    checked,
    minReadyClientSnapshots,
    minReadyCompetitorSnapshots,
    allowCompetitorDegradedFallback,
    clientReady: Number(record.clientReady),
    clientDegraded: Number(record.clientDegraded),
    clientBlocked: Number(record.clientBlocked),
    competitorReady: Number(record.competitorReady),
    competitorDegraded: Number(record.competitorDegraded),
    competitorBlocked: Number(record.competitorBlocked),
    hadUnscoredSnapshots,
  };
}

export function hasGroundingReadinessMetadata(report: unknown): boolean {
  const record = asRecord(report);
  return parseReadinessFromUnknown(record.readiness) !== null;
}

export function buildGroundingReadinessMetadata(
  metrics: ReadinessGateMetrics,
  options: BuildGroundingReadinessOptions = {}
): GroundingReadinessMetadata {
  return {
    checked: options.checked ?? true,
    minReadyClientSnapshots: Math.max(
      0,
      Number(options.minReadyClientSnapshots ?? 1)
    ),
    minReadyCompetitorSnapshots: Math.max(
      0,
      Number(options.minReadyCompetitorSnapshots ?? 1)
    ),
    allowCompetitorDegradedFallback:
      options.allowCompetitorDegradedFallback === true,
    clientReady: metrics.clientReady,
    clientDegraded: metrics.clientDegraded,
    clientBlocked: metrics.clientBlocked,
    competitorReady: metrics.competitorReady,
    competitorDegraded: metrics.competitorDegraded,
    competitorBlocked: metrics.competitorBlocked,
    hadUnscoredSnapshots: metrics.hadUnscoredSnapshots,
  };
}

function hasMeaningfulReadiness(value: GroundingReadinessMetadata | null | undefined): boolean {
  if (!value) return false;
  if (value.checked) return true;
  const totalCount =
    value.clientReady +
    value.clientDegraded +
    value.clientBlocked +
    value.competitorReady +
    value.competitorDegraded +
    value.competitorBlocked;
  return totalCount > 0;
}

export async function normalizeGroundingReport(
  researchJobId: string,
  report: unknown,
  options: NormalizeGroundingReportOptions = {}
): Promise<Record<string, unknown>> {
  const base = asRecord(report);
  const existingReadiness = parseReadinessFromUnknown(base.readiness);

  let readiness = options.readiness || existingReadiness;
  if (!hasMeaningfulReadiness(readiness)) {
    const metrics = await loadReadinessGateMetrics(researchJobId);
    readiness = buildGroundingReadinessMetadata(metrics, options);
  }

  const blocked =
    typeof options.forceBlocked === 'boolean'
      ? options.forceBlocked
      : Boolean(base.blocked ?? false);
  const generatedAt = String(
    base.generatedAt || options.generatedAt || new Date().toISOString()
  );
  const mode = String(base.mode || options.defaultMode || 'document');
  const source =
    base.source !== undefined && String(base.source).trim().length > 0
      ? String(base.source)
      : options.defaultSource;

  const normalized: Record<string, unknown> = {
    ...base,
    mode,
    blocked,
    reasonCodes: normalizeReasonCodes(base.reasonCodes),
    readiness,
    generatedAt,
  };
  if (source) {
    normalized.source = source;
  }
  return normalized;
}

export async function buildGroundingReportFromQualityGate(
  researchJobId: string,
  qualityGate: QualityGateGroundingInput,
  options: NormalizeGroundingReportOptions & { blocked: boolean }
): Promise<Record<string, unknown>> {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const rawReport = {
    mode: qualityGate.mode,
    blocked: options.blocked,
    reasonCodes: qualityGate.reasonCodes,
    lowestSectionScore: qualityGate.lowestSectionScore,
    placeholderOrDisclaimerHits: qualityGate.placeholderOrDisclaimerHits,
    factCheck: qualityGate.factCheck,
    documentValidation: qualityGate.documentValidation,
    readiness: qualityGate.readiness,
    generatedAt,
  };

  return normalizeGroundingReport(researchJobId, rawReport, {
    ...options,
    generatedAt,
    defaultMode: qualityGate.mode,
    forceBlocked: options.blocked,
  });
}

export async function backfillFinalDocumentGroundingReadiness(
  researchJobId: string,
  options: { dryRun?: boolean; source?: string } = {}
): Promise<FinalDocGroundingBackfillResult> {
  const rows = await prisma.aiAnalysis.findMany({
    where: {
      researchJobId,
      analysisType: 'DOCUMENT',
      OR: [{ documentStatus: 'FINAL' }, { documentStatus: null }],
    },
    select: {
      id: true,
      groundingReport: true,
    },
  });

  const missingRows = rows.filter(
    (row) => !hasGroundingReadinessMetadata(row.groundingReport)
  );
  if (missingRows.length === 0) {
    return { checked: rows.length, missing: 0, updated: 0 };
  }

  const metrics = await loadReadinessGateMetrics(researchJobId);
  const readiness = buildGroundingReadinessMetadata(metrics);

  let updated = 0;
  for (const row of missingRows) {
    if (options.dryRun) {
      updated += 1;
      continue;
    }
    const report = await normalizeGroundingReport(researchJobId, row.groundingReport, {
      defaultMode: 'document',
      defaultSource: options.source || 'grounding_readiness_backfill',
      forceBlocked: false,
      readiness,
    });
    await prisma.aiAnalysis.update({
      where: { id: row.id },
      data: {
        documentStatus: 'FINAL',
        groundingReport: toPrismaJson(report),
      },
    });
    updated += 1;
  }

  return {
    checked: rows.length,
    missing: missingRows.length,
    updated,
  };
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
