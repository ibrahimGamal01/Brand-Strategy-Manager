export type WorkflowMethod = 'NICHE_STANDARD' | 'BAT_CORE';
export type ProcessRequestMode = 'single_doc' | 'section_bundle' | 'multi_doc_bundle';

export type WorkflowSelectionInput = {
  businessState: {
    niche: string;
    businessType: string;
    website: string;
    hasCompetitors: boolean;
  };
  objective: string;
  nicheConfidence: number;
};

export type WorkflowSelectionDecision = {
  method: WorkflowMethod;
  ruleId: string;
  rationale: string;
  score: number;
  evidenceRefs: string[];
  inputSnapshot: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type WorkflowSelectionContext = {
  requestMode: ProcessRequestMode;
  artifactTypes: string[];
};

export function estimateNicheConfidence(input: {
  niche?: string;
  website?: string;
  businessType?: string;
  targetAudience?: string;
}): number {
  const niche = String(input.niche || '').trim();
  const website = String(input.website || '').trim();
  const businessType = String(input.businessType || '').trim();
  const targetAudience = String(input.targetAudience || '').trim();

  let score = 0;
  if (niche.length >= 8) score += 0.4;
  if (businessType.length >= 4) score += 0.25;
  if (targetAudience.length >= 8) score += 0.2;
  if (website.includes('.')) score += 0.15;

  return Number(Math.max(0, Math.min(1, score)).toFixed(4));
}

export function selectMethod(input: WorkflowSelectionInput): WorkflowSelectionDecision {
  const objective = String(input.objective || '').trim().toLowerCase();
  const niche = String(input.businessState.niche || '').trim();
  const businessType = String(input.businessState.businessType || '').trim();
  const website = String(input.businessState.website || '').trim();
  const confidence = Number.isFinite(input.nicheConfidence) ? input.nicheConfidence : 0;

  const methodScore =
    (confidence >= 0 ? confidence * 0.55 : 0) +
    (niche.length >= 10 ? 0.2 : 0) +
    (businessType.length >= 4 ? 0.15 : 0) +
    (website.includes('.') ? 0.1 : 0);

  const useNicheStandard = methodScore >= 0.65 && !objective.includes('generic');
  const method: WorkflowMethod = useNicheStandard ? 'NICHE_STANDARD' : 'BAT_CORE';

  const rationale = useNicheStandard
    ? 'Niche confidence and business context are sufficient, so the niche-specific standard is selected.'
    : 'Signals are not strong enough for niche-specific policy, so BAT core standard is selected as safe fallback.';

  const evidenceRefs = [
    niche ? `niche:${niche}` : '',
    businessType ? `business_type:${businessType}` : '',
    website ? `website:${website}` : '',
    objective ? `objective:${objective}` : '',
  ].filter(Boolean);

  const ruleId = useNicheStandard
    ? 'workflow-selection/business_strategy/v2/niche_standard_if_confident'
    : 'workflow-selection/business_strategy/v2/fallback_bat_core';

  const inputSnapshot = {
    objective,
    niche,
    businessType,
    website,
    hasCompetitors: input.businessState.hasCompetitors,
    nicheConfidence: confidence,
  };

  const output = {
    method,
    stagePolicy: {
      interruption: 'blocker_and_important',
      failMode: 'fail_closed',
    },
  };

  return {
    method,
    ruleId,
    rationale,
    score: Number(Math.max(0, Math.min(1, methodScore)).toFixed(4)),
    evidenceRefs,
    inputSnapshot,
    output,
  };
}

export function selectMethodV2(
  input: WorkflowSelectionInput & {
    context: WorkflowSelectionContext;
  }
): WorkflowSelectionDecision {
  const base = selectMethod(input);
  const artifacts = Array.from(
    new Set(
      (Array.isArray(input.context.artifactTypes) ? input.context.artifactTypes : [])
        .map((entry) => String(entry || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const contextSnapshot = {
    requestMode: input.context.requestMode,
    artifactTypes: artifacts,
    artifactCount: artifacts.length,
  };

  if (input.context.requestMode === 'multi_doc_bundle' || artifacts.length > 1) {
    const score = Math.max(0, Math.min(1, base.score * 0.9));
    const preferNiche = base.method === 'NICHE_STANDARD' && score >= 0.72;
    const method: WorkflowMethod = preferNiche ? 'NICHE_STANDARD' : 'BAT_CORE';
    return {
      ...base,
      method,
      score: Number(score.toFixed(4)),
      ruleId: preferNiche
        ? 'workflow-selection/phase2/composite/niche_standard_if_high_confidence'
        : 'workflow-selection/phase2/composite/fallback_bat_core',
      rationale: preferNiche
        ? 'Composite run has enough confidence and explicit niche context, so niche standard remains safe.'
        : 'Composite run increases orchestration risk; BAT core is selected unless confidence is clearly high.',
      inputSnapshot: {
        ...base.inputSnapshot,
        ...contextSnapshot,
      },
      evidenceRefs: [...base.evidenceRefs, `request_mode:${input.context.requestMode}`],
      output: {
        ...base.output,
        processModel: 'phase2_composite',
      },
    };
  }

  if (input.context.requestMode === 'section_bundle') {
    const score = Math.max(0, Math.min(1, base.score * 0.95));
    const preferNiche = base.method === 'NICHE_STANDARD' && score >= 0.68;
    const method: WorkflowMethod = preferNiche ? 'NICHE_STANDARD' : 'BAT_CORE';
    return {
      ...base,
      method,
      score: Number(score.toFixed(4)),
      ruleId: preferNiche
        ? 'workflow-selection/phase2/section_bundle/niche_standard_if_confident'
        : 'workflow-selection/phase2/section_bundle/fallback_bat_core',
      rationale: preferNiche
        ? 'Section bundle target is explicit and confidence is sufficient for niche standard.'
        : 'Section bundle requires conservative default because confidence is not high enough.',
      inputSnapshot: {
        ...base.inputSnapshot,
        ...contextSnapshot,
      },
      evidenceRefs: [...base.evidenceRefs, `request_mode:${input.context.requestMode}`],
      output: {
        ...base.output,
        processModel: 'phase2_section_bundle',
      },
    };
  }

  return {
    ...base,
    ruleId:
      base.method === 'NICHE_STANDARD'
        ? 'workflow-selection/phase2/single_doc/niche_standard_if_confident'
        : 'workflow-selection/phase2/single_doc/fallback_bat_core',
    inputSnapshot: {
      ...base.inputSnapshot,
      ...contextSnapshot,
    },
    evidenceRefs: [...base.evidenceRefs, `request_mode:${input.context.requestMode}`],
    output: {
      ...base.output,
      processModel: 'phase2_single_doc',
    },
  };
}
