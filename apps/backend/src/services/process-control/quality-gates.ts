import type { BusinessStrategySectionRubric } from './rubric-business-strategy';

export type GateName = 'coverage' | 'citation' | 'freshness' | 'consistency' | 'depth' | 'safety';
export type GateStatus = 'PASS' | 'FAIL' | 'HOLD';

export type SectionGateInput = {
  section: BusinessStrategySectionRubric;
  markdown: string;
  availableInputs: Record<string, unknown>;
  evidenceCount: number;
  latestEvidenceAt: Date | null;
};

export type GateEvaluation = {
  gateName: GateName;
  status: GateStatus;
  passed: boolean;
  score: number;
  reasons: string[];
  ruleId: string;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function hasUsableValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => normalizeText(entry).length > 0);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return normalizeText(value).length > 0;
}

function wordCount(value: string): number {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean).length;
}

export function evaluateSectionPolicyGates(input: SectionGateInput): GateEvaluation[] {
  const markdown = normalizeText(input.markdown);
  const words = wordCount(markdown);
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const requiredCoverageFailures = input.section.requiredInputs
    .filter((field) => field.severity !== 'OPTIONAL')
    .filter((field) => !hasUsableValue(input.availableInputs[field.key]))
    .map((field) => `${field.key} is missing`);

  const coverage: GateEvaluation = {
    gateName: 'coverage',
    status: requiredCoverageFailures.length ? 'FAIL' : 'PASS',
    passed: requiredCoverageFailures.length === 0,
    score: requiredCoverageFailures.length ? 0.2 : 1,
    reasons: requiredCoverageFailures.length
      ? requiredCoverageFailures
      : ['All required section inputs are present.'],
    ruleId: 'policy-gate/coverage/v1',
  };

  const citation: GateEvaluation = {
    gateName: 'citation',
    status: input.evidenceCount >= input.section.minEvidence ? 'PASS' : 'FAIL',
    passed: input.evidenceCount >= input.section.minEvidence,
    score: Math.max(0, Math.min(1, input.evidenceCount / Math.max(1, input.section.minEvidence))),
    reasons:
      input.evidenceCount >= input.section.minEvidence
        ? ['Citation threshold met for section.']
        : [`Expected at least ${input.section.minEvidence} evidence records, got ${input.evidenceCount}.`],
    ruleId: 'policy-gate/citation/v1',
  };

  const freshnessSatisfied =
    input.latestEvidenceAt instanceof Date
      ? now - input.latestEvidenceAt.getTime() <= ninetyDaysMs
      : false;
  const freshness: GateEvaluation = {
    gateName: 'freshness',
    status: freshnessSatisfied ? 'PASS' : input.evidenceCount > 0 ? 'HOLD' : 'FAIL',
    passed: freshnessSatisfied,
    score: freshnessSatisfied ? 1 : input.evidenceCount > 0 ? 0.45 : 0,
    reasons: freshnessSatisfied
      ? ['Recent evidence exists within freshness threshold.']
      : input.evidenceCount > 0
        ? ['Evidence exists but is older than freshness policy threshold.']
        : ['No evidence available for freshness validation.'],
    ruleId: 'policy-gate/freshness/v1',
  };

  const hasPlaceholder = /\b(tbd|todo|unknown|lorem ipsum|coming soon)\b/i.test(markdown);
  const consistency: GateEvaluation = {
    gateName: 'consistency',
    status: hasPlaceholder ? 'FAIL' : 'PASS',
    passed: !hasPlaceholder,
    score: hasPlaceholder ? 0 : 1,
    reasons: hasPlaceholder
      ? ['Section contains placeholder or unresolved language.']
      : ['Section consistency checks passed.'],
    ruleId: 'policy-gate/consistency/v1',
  };

  const depth: GateEvaluation = {
    gateName: 'depth',
    status: words >= input.section.minWords ? 'PASS' : 'HOLD',
    passed: words >= input.section.minWords,
    score: Math.max(0, Math.min(1, words / Math.max(1, input.section.minWords))),
    reasons:
      words >= input.section.minWords
        ? ['Section depth requirement satisfied.']
        : [`Section has ${words} words, requires ${input.section.minWords}.`],
    ruleId: 'policy-gate/depth/v1',
  };

  const unsafePattern =
    /\b(guaranteed results|no risk|instant success|100% certain|secret hack|manipulate customers)\b/i.test(markdown);
  const safety: GateEvaluation = {
    gateName: 'safety',
    status: unsafePattern ? 'FAIL' : 'PASS',
    passed: !unsafePattern,
    score: unsafePattern ? 0 : 1,
    reasons: unsafePattern
      ? ['Unsafe or non-compliant promise language detected.']
      : ['Safety policy checks passed.'],
    ruleId: 'policy-gate/safety/v1',
  };

  return [coverage, citation, freshness, consistency, depth, safety];
}

export function summarizeGateEvaluations(evaluations: GateEvaluation[]): {
  passed: boolean;
  hasHold: boolean;
  shouldEscalate: boolean;
  reasons: string[];
} {
  const failed = evaluations.filter((item) => item.status === 'FAIL');
  const hold = evaluations.filter((item) => item.status === 'HOLD');
  const shouldEscalate = failed.some((item) => item.gateName === 'safety' || item.gateName === 'consistency');

  return {
    passed: failed.length === 0 && hold.length === 0,
    hasHold: hold.length > 0,
    shouldEscalate,
    reasons: [...failed, ...hold].flatMap((item) => item.reasons),
  };
}
