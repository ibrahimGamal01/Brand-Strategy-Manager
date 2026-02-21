import { factCheck, sanitizeContent } from '../validation/fact-checker';
import { GenerationResult } from './base-generator';
import { validateDocument } from './document-validator';
import { loadReadinessGateMetrics } from './readiness-metrics';

const SECTION_SCORE_THRESHOLD = 80;

const PLACEHOLDER_OR_DISCLAIMER_PATTERNS: RegExp[] = [
  /@handle\d+/gi,
  /@competitor\d+/gi,
  /@example/gi,
  /\[handle\]/gi,
  /\[competitor\]/gi,
  /\[platform\]/gi,
  /not found in research/gi,
  /data not available/gi,
  /not available in data/gi,
];

export type StrategyQualityGateMode = 'document' | 'section';

export interface StrategyQualityGateInput {
  researchJobId: string;
  sections: Record<string, GenerationResult | undefined>;
  requestedSections: string[];
  mode?: StrategyQualityGateMode;
  minSectionScore?: number;
  readinessGate?: {
    enabled?: boolean;
    minReadyClientSnapshots?: number;
    minReadyCompetitorSnapshots?: number;
    allowCompetitorDegradedFallback?: boolean;
  };
}

export interface StrategySectionFactSummary {
  sectionKey: string;
  totalClaims: number;
  verifiedClaims: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  sanitized: boolean;
}

export interface StrategyQualityGateDecision {
  allowPersist: boolean;
  mode: StrategyQualityGateMode;
  reasonCodes: string[];
  generatedSections: number;
  requiredSections: number;
  minSectionScore: number;
  lowestSectionScore: number;
  placeholderOrDisclaimerHits: number;
  documentValidation:
    | {
        checked: false;
      }
    | {
        checked: true;
        passed: boolean;
        overallScore: number;
        criticalIssues: number;
        highIssues: number;
      };
  factCheck: {
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    sectionSummaries: StrategySectionFactSummary[];
  };
  readiness: {
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
  };
  correctedSections: Record<string, string>;
}

function getRequestedSectionCount(requestedSections: string[]): number {
  const normalized = requestedSections
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (normalized.includes('all')) return 9;
  return new Set(normalized).size;
}

function countPlaceholderHits(content: string): number {
  let total = 0;
  for (const pattern of PLACEHOLDER_OR_DISCLAIMER_PATTERNS) {
    const matches = content.match(pattern);
    total += matches?.length || 0;
  }
  return total;
}

function extractGeneratedSections(
  sections: Record<string, GenerationResult | undefined>
): Record<string, { markdown: string; validationScore: number }> {
  const out: Record<string, { markdown: string; validationScore: number }> = {};
  for (const [key, value] of Object.entries(sections)) {
    if (!value) continue;
    const markdown = String(value.markdown || '').trim();
    if (!markdown) continue;
    out[key] = {
      markdown,
      validationScore: Number(value.validationScore || 0),
    };
  }
  return out;
}

async function runFactCheckWithSanitization(
  researchJobId: string,
  sectionKey: string,
  markdown: string
): Promise<{ corrected: string; summary: StrategySectionFactSummary }> {
  let content = markdown;
  let fact = await factCheck(content, researchJobId);

  const hasBlockingInaccuracies = fact.inaccuracies.some(
    (item) => item.severity === 'CRITICAL' || item.severity === 'HIGH'
  );

  let sanitized = false;
  if (hasBlockingInaccuracies) {
    const next = sanitizeContent(content, fact.inaccuracies);
    if (next !== content) {
      content = next;
      sanitized = true;
      fact = await factCheck(content, researchJobId);
    }
  }

  const summary: StrategySectionFactSummary = {
    sectionKey,
    totalClaims: fact.totalClaims,
    verifiedClaims: fact.verifiedClaims,
    criticalCount: fact.inaccuracies.filter((item) => item.severity === 'CRITICAL').length,
    highCount: fact.inaccuracies.filter((item) => item.severity === 'HIGH').length,
    mediumCount: fact.inaccuracies.filter((item) => item.severity === 'MEDIUM').length,
    lowCount: fact.inaccuracies.filter((item) => item.severity === 'LOW').length,
    sanitized,
  };

  return {
    corrected: content,
    summary,
  };
}

export async function evaluateStrategyQualityGate(
  input: StrategyQualityGateInput
): Promise<StrategyQualityGateDecision> {
  const mode: StrategyQualityGateMode = input.mode || 'document';
  const minSectionScore = Number(input.minSectionScore || SECTION_SCORE_THRESHOLD);
  const generated = extractGeneratedSections(input.sections);
  const correctedSections: Record<string, string> = {};
  const reasonCodes: string[] = [];

  const requiredSections = getRequestedSectionCount(input.requestedSections);
  const generatedSections = Object.keys(generated).length;
  if (generatedSections === 0) {
    reasonCodes.push('NO_GENERATED_SECTIONS');
  }
  if (generatedSections < requiredSections) {
    reasonCodes.push('MISSING_REQUIRED_SECTIONS');
  }

  let lowestSectionScore = 100;
  for (const section of Object.values(generated)) {
    lowestSectionScore = Math.min(lowestSectionScore, section.validationScore);
  }
  if (generatedSections > 0 && lowestSectionScore < minSectionScore) {
    reasonCodes.push('SECTION_SCORE_BELOW_THRESHOLD');
  }

  const factResults = await Promise.all(
    Object.entries(generated).map(async ([sectionKey, section]) => {
      const checked = await runFactCheckWithSanitization(
        input.researchJobId,
        sectionKey,
        section.markdown
      );
      correctedSections[sectionKey] = checked.corrected;
      return checked.summary;
    })
  );

  const factCheck = {
    criticalCount: factResults.reduce((sum, item) => sum + item.criticalCount, 0),
    highCount: factResults.reduce((sum, item) => sum + item.highCount, 0),
    mediumCount: factResults.reduce((sum, item) => sum + item.mediumCount, 0),
    lowCount: factResults.reduce((sum, item) => sum + item.lowCount, 0),
    sectionSummaries: factResults,
  };

  if (factCheck.criticalCount > 0) {
    reasonCodes.push('FACT_CHECK_CRITICAL_INACCURACY');
  }
  if (factCheck.highCount > 0) {
    reasonCodes.push('FACT_CHECK_HIGH_INACCURACY');
  }

  const placeholderOrDisclaimerHits = Object.values(correctedSections).reduce(
    (sum, content) => sum + countPlaceholderHits(content),
    0
  );
  if (placeholderOrDisclaimerHits > 0) {
    reasonCodes.push('PLACEHOLDER_OR_DISCLAIMER_TEXT');
  }

  let documentValidation:
    | StrategyQualityGateDecision['documentValidation']
    | {
        checked: true;
        passed: boolean;
        overallScore: number;
        criticalIssues: number;
        highIssues: number;
      } = { checked: false };

  const readinessGateEnabled =
    input.readinessGate?.enabled ?? mode === 'document';
  const minReadyClientSnapshots = Math.max(
    0,
    Number(input.readinessGate?.minReadyClientSnapshots ?? 1)
  );
  const minReadyCompetitorSnapshots = Math.max(
    0,
    Number(input.readinessGate?.minReadyCompetitorSnapshots ?? 1)
  );
  const allowCompetitorDegradedFallback =
    input.readinessGate?.allowCompetitorDegradedFallback === true;
  let readiness: StrategyQualityGateDecision['readiness'] = {
    checked: false,
    minReadyClientSnapshots,
    minReadyCompetitorSnapshots,
    allowCompetitorDegradedFallback,
    clientReady: 0,
    clientDegraded: 0,
    clientBlocked: 0,
    competitorReady: 0,
    competitorDegraded: 0,
    competitorBlocked: 0,
    hadUnscoredSnapshots: false,
  };

  if (mode === 'document') {
    const sectionPayload: Record<
      string,
      { markdown: string; validationScore: number; score: number }
    > = {};
    for (const [sectionKey, section] of Object.entries(generated)) {
      const correctedMarkdown = correctedSections[sectionKey] || section.markdown;
      sectionPayload[sectionKey] = {
        markdown: correctedMarkdown,
        validationScore: section.validationScore,
        score: section.validationScore,
      };
    }

    const validated = await validateDocument(input.researchJobId, sectionPayload, minSectionScore);
    const criticalIssues = validated.issues.filter((item) => item.severity === 'CRITICAL').length;
    const highIssues = validated.issues.filter((item) => item.severity === 'HIGH').length;
    documentValidation = {
      checked: true,
      passed: validated.passed,
      overallScore: validated.overallScore,
      criticalIssues,
      highIssues,
    };

    if (!validated.passed) {
      reasonCodes.push('DOCUMENT_VALIDATION_FAILED');
    }
    if (criticalIssues > 0) {
      reasonCodes.push('DOCUMENT_CRITICAL_ISSUES');
    }
  }

  if (readinessGateEnabled) {
    const readinessMetrics = await loadReadinessGateMetrics(input.researchJobId);
    readiness = {
      ...readiness,
      checked: true,
      ...readinessMetrics,
    };

    if (readiness.clientReady < minReadyClientSnapshots) {
      reasonCodes.push('READINESS_CLIENT_READY_BELOW_MINIMUM');
    }

    const competitorSatisfied = allowCompetitorDegradedFallback
      ? readiness.competitorReady + readiness.competitorDegraded >= minReadyCompetitorSnapshots
      : readiness.competitorReady >= minReadyCompetitorSnapshots;

    if (!competitorSatisfied) {
      reasonCodes.push('READINESS_COMPETITOR_READY_BELOW_MINIMUM');
    }
  }

  const allowPersist = reasonCodes.length === 0;

  return {
    allowPersist,
    mode,
    reasonCodes: Array.from(new Set(reasonCodes)),
    generatedSections,
    requiredSections,
    minSectionScore,
    lowestSectionScore: generatedSections > 0 ? lowestSectionScore : 0,
    placeholderOrDisclaimerHits,
    documentValidation,
    factCheck,
    readiness,
    correctedSections,
  };
}
