import { BUSINESS_STRATEGY_RUBRIC, type RubricFieldRequirement } from './rubric-business-strategy';

export const PHASE2_ARTIFACT_TYPES = [
  'BUSINESS_STRATEGY',
  'COMPETITOR_AUDIT',
  'EXECUTIVE_SUMMARY',
  'CONTENT_CALENDAR',
  'GO_TO_MARKET',
  'PLAYBOOK',
  'SWOT',
] as const;

export type Phase2ArtifactType = (typeof PHASE2_ARTIFACT_TYPES)[number];

export type StandardSectionDefinition = {
  key: string;
  title: string;
  framework: string;
  order: number;
  minWords: number;
  minEvidence: number;
  requiredInputs: RubricFieldRequirement[];
  exitCriteria: string[];
  dependsOn: string[];
};

export type ArtifactStandardPack = {
  artifactType: Phase2ArtifactType;
  standardId: string;
  standardVersion: number;
  professorMethod: string;
  sections: StandardSectionDefinition[];
};

function toDependencyChain<T extends { key: string; order: number }>(sections: T[]): string[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const deps: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    if (previous) deps.push(previous.key);
  }
  return deps;
}

const BUSINESS_STRATEGY_PACK: ArtifactStandardPack = {
  artifactType: 'BUSINESS_STRATEGY',
  standardId: 'professor/business_strategy/bat-core',
  standardVersion: 2,
  professorMethod: 'Capstone strategy sequence (context -> diagnosis -> direction -> execution -> governance)',
  sections: BUSINESS_STRATEGY_RUBRIC
    .map((section, index, source) => ({
      key: section.key,
      title: section.title,
      framework: section.framework,
      order: section.order,
      minWords: section.minWords,
      minEvidence: section.minEvidence,
      requiredInputs: section.requiredInputs,
      exitCriteria: section.exitCriteria,
      dependsOn: index > 0 ? [source[index - 1].key] : [],
    }))
    .sort((a, b) => a.order - b.order),
};

const COMPETITOR_AUDIT_PACK: ArtifactStandardPack = {
  artifactType: 'COMPETITOR_AUDIT',
  standardId: 'professor/competitor_audit/porter-positioning',
  standardVersion: 1,
  professorMethod: 'Competitive intelligence method (market map -> opponent profile -> gap -> counter-strategy)',
  sections: [
    {
      key: 'market_topology',
      title: 'Market Topology',
      framework: 'Category map -> Segment lanes -> Momentum signals',
      order: 1,
      minWords: 150,
      minEvidence: 3,
      requiredInputs: [
        {
          key: 'niche',
          label: 'Niche',
          severity: 'BLOCKER',
          question: 'What niche are we mapping in this audit?',
        },
      ],
      exitCriteria: ['Category boundaries are explicit', 'Evidence includes current market signals'],
      dependsOn: [],
    },
    {
      key: 'direct_competitors',
      title: 'Direct Competitors',
      framework: 'Who competes -> What they promise -> How they win',
      order: 2,
      minWords: 170,
      minEvidence: 3,
      requiredInputs: [
        {
          key: 'competitorInspirationLinks',
          label: 'Competitor links',
          severity: 'IMPORTANT',
          question: 'List the top direct competitors to audit.',
        },
      ],
      exitCriteria: ['Top direct players are profiled', 'Claims are backed by linked evidence'],
      dependsOn: ['market_topology'],
    },
    {
      key: 'adjacent_competitors',
      title: 'Adjacent Competitors',
      framework: 'Substitutes -> Near-category threats -> Future entrants',
      order: 3,
      minWords: 150,
      minEvidence: 2,
      requiredInputs: [],
      exitCriteria: ['Adjacent threats are named', 'At least two evidence references exist'],
      dependsOn: ['direct_competitors'],
    },
    {
      key: 'positioning_gap',
      title: 'Positioning Gap Analysis',
      framework: 'Current map -> White space -> Strategic wedge',
      order: 4,
      minWords: 180,
      minEvidence: 2,
      requiredInputs: [
        {
          key: 'mainOffer',
          label: 'Main offer',
          severity: 'IMPORTANT',
          question: 'What is our primary offer compared against competitors?',
        },
      ],
      exitCriteria: ['Wedge is concrete and defensible', 'Recommendations reference observed gaps'],
      dependsOn: ['adjacent_competitors'],
    },
  ],
};

const EXECUTIVE_SUMMARY_PACK: ArtifactStandardPack = {
  artifactType: 'EXECUTIVE_SUMMARY',
  standardId: 'professor/executive_summary/board-brief',
  standardVersion: 1,
  professorMethod: 'Executive briefing structure (signal -> decision -> expected outcome)',
  sections: [
    {
      key: 'signal_snapshot',
      title: 'Signal Snapshot',
      framework: 'Current state -> Priority signal -> Why now',
      order: 1,
      minWords: 110,
      minEvidence: 2,
      requiredInputs: [],
      exitCriteria: ['Top strategic signals are explicit'],
      dependsOn: [],
    },
    {
      key: 'decision_recommendations',
      title: 'Decision Recommendations',
      framework: 'Decision set -> Tradeoffs -> Chosen path',
      order: 2,
      minWords: 130,
      minEvidence: 2,
      requiredInputs: [
        {
          key: 'primaryGoal',
          label: 'Primary goal',
          severity: 'BLOCKER',
          question: 'What is the single decision objective for this summary?',
        },
      ],
      exitCriteria: ['Recommendations are decision-grade', 'Tradeoffs are explicit'],
      dependsOn: ['signal_snapshot'],
    },
    {
      key: 'next_90_days',
      title: 'Next 90 Days',
      framework: 'Milestones -> Owners -> Review cadence',
      order: 3,
      minWords: 120,
      minEvidence: 1,
      requiredInputs: [],
      exitCriteria: ['Milestones are measurable and time-bound'],
      dependsOn: ['decision_recommendations'],
    },
  ],
};

const CONTENT_CALENDAR_PACK: ArtifactStandardPack = {
  artifactType: 'CONTENT_CALENDAR',
  standardId: 'professor/content_calendar/editorial-method',
  standardVersion: 1,
  professorMethod: 'Editorial planning method (themes -> cadence -> measurement)',
  sections: [
    {
      key: 'themes_and_pillars',
      title: 'Themes and Pillars',
      framework: 'Audience intent -> Pillars -> Narrative angle',
      order: 1,
      minWords: 140,
      minEvidence: 2,
      requiredInputs: [
        {
          key: 'topicsToAvoid',
          label: 'Topics to avoid',
          severity: 'OPTIONAL',
          question: 'Are there content topics that must be avoided?',
        },
      ],
      exitCriteria: ['Pillars are scoped and audience-linked'],
      dependsOn: [],
    },
    {
      key: 'cadence_and_channels',
      title: 'Cadence and Channels',
      framework: 'Channel intent -> Weekly cadence -> Resource fit',
      order: 2,
      minWords: 130,
      minEvidence: 1,
      requiredInputs: [
        {
          key: 'planningHorizon',
          label: 'Planning horizon',
          severity: 'IMPORTANT',
          question: 'What planning horizon should calendar cadence cover?',
        },
      ],
      exitCriteria: ['Cadence is consistent with resource limits'],
      dependsOn: ['themes_and_pillars'],
    },
    {
      key: 'measurement_loop',
      title: 'Measurement Loop',
      framework: 'KPI mapping -> Feedback loop -> Iteration rule',
      order: 3,
      minWords: 110,
      minEvidence: 1,
      requiredInputs: [],
      exitCriteria: ['Iteration rules are explicit'],
      dependsOn: ['cadence_and_channels'],
    },
  ],
};

const GO_TO_MARKET_PACK: ArtifactStandardPack = {
  artifactType: 'GO_TO_MARKET',
  standardId: 'professor/gtm/stp-launch',
  standardVersion: 1,
  professorMethod: 'GTM method (segmentation -> targeting -> positioning -> launch sequence)',
  sections: [
    {
      key: 'segment_and_target',
      title: 'Segment and Target',
      framework: 'Segments -> Priority target -> Qualification criteria',
      order: 1,
      minWords: 140,
      minEvidence: 2,
      requiredInputs: [
        {
          key: 'targetAudience',
          label: 'Target audience',
          severity: 'BLOCKER',
          question: 'Which target segment should GTM prioritize?',
        },
      ],
      exitCriteria: ['Target definition is testable and narrow'],
      dependsOn: [],
    },
    {
      key: 'channel_strategy',
      title: 'Channel Strategy',
      framework: 'Acquisition lanes -> Message fit -> Activation sequence',
      order: 2,
      minWords: 150,
      minEvidence: 2,
      requiredInputs: [],
      exitCriteria: ['Channel rationale references evidence'],
      dependsOn: ['segment_and_target'],
    },
    {
      key: 'launch_plan',
      title: 'Launch Plan',
      framework: 'Pre-launch -> Launch -> Post-launch optimization',
      order: 3,
      minWords: 140,
      minEvidence: 1,
      requiredInputs: [
        {
          key: 'resultsIn90Days',
          label: '90-day outcomes',
          severity: 'IMPORTANT',
          question: 'What outcomes should GTM deliver in 90 days?',
        },
      ],
      exitCriteria: ['Launch sequencing is explicit with checkpoints'],
      dependsOn: ['channel_strategy'],
    },
  ],
};

const PLAYBOOK_PACK: ArtifactStandardPack = {
  artifactType: 'PLAYBOOK',
  standardId: 'professor/playbook/ops-execution',
  standardVersion: 1,
  professorMethod: 'Operational playbook method (trigger -> action -> owner -> review)',
  sections: [
    {
      key: 'operating_principles',
      title: 'Operating Principles',
      framework: 'Principles -> Guardrails -> Quality bars',
      order: 1,
      minWords: 110,
      minEvidence: 1,
      requiredInputs: [],
      exitCriteria: ['Principles are explicit and non-conflicting'],
      dependsOn: [],
    },
    {
      key: 'plays',
      title: 'Priority Plays',
      framework: 'Trigger -> Action set -> Expected result',
      order: 2,
      minWords: 170,
      minEvidence: 2,
      requiredInputs: [],
      exitCriteria: ['Each play has trigger, owner, and expected output'],
      dependsOn: ['operating_principles'],
    },
    {
      key: 'governance',
      title: 'Governance and Escalation',
      framework: 'Review cadence -> Escalation matrix -> Exception policy',
      order: 3,
      minWords: 120,
      minEvidence: 1,
      requiredInputs: [],
      exitCriteria: ['Escalation policy is explicit'],
      dependsOn: ['plays'],
    },
  ],
};

const SWOT_PACK: ArtifactStandardPack = {
  artifactType: 'SWOT',
  standardId: 'professor/swot/diagnostic',
  standardVersion: 1,
  professorMethod: 'SWOT diagnostic method (internal factors + external factors + strategic implication)',
  sections: [
    {
      key: 'strengths',
      title: 'Strengths',
      framework: 'Internal advantage -> Proof -> Leverage',
      order: 1,
      minWords: 100,
      minEvidence: 1,
      requiredInputs: [],
      exitCriteria: ['Strengths are evidenced, not generic'],
      dependsOn: [],
    },
    {
      key: 'weaknesses',
      title: 'Weaknesses',
      framework: 'Constraint -> Impact -> Mitigation direction',
      order: 2,
      minWords: 100,
      minEvidence: 1,
      requiredInputs: [],
      exitCriteria: ['Weaknesses have explicit risk linkage'],
      dependsOn: ['strengths'],
    },
    {
      key: 'opportunities',
      title: 'Opportunities',
      framework: 'External shift -> Opportunity fit -> Priority',
      order: 3,
      minWords: 100,
      minEvidence: 2,
      requiredInputs: [],
      exitCriteria: ['Opportunities are ranked and evidenced'],
      dependsOn: ['weaknesses'],
    },
    {
      key: 'threats',
      title: 'Threats',
      framework: 'Threat source -> Impact -> Protection move',
      order: 4,
      minWords: 100,
      minEvidence: 2,
      requiredInputs: [],
      exitCriteria: ['Threat mitigation moves are concrete'],
      dependsOn: ['opportunities'],
    },
  ],
};

const STANDARD_PACKS: Record<Phase2ArtifactType, ArtifactStandardPack> = {
  BUSINESS_STRATEGY: BUSINESS_STRATEGY_PACK,
  COMPETITOR_AUDIT: COMPETITOR_AUDIT_PACK,
  EXECUTIVE_SUMMARY: EXECUTIVE_SUMMARY_PACK,
  CONTENT_CALENDAR: CONTENT_CALENDAR_PACK,
  GO_TO_MARKET: GO_TO_MARKET_PACK,
  PLAYBOOK: PLAYBOOK_PACK,
  SWOT: SWOT_PACK,
};

const ARTIFACT_ALIASES: Record<string, Phase2ArtifactType> = {
  BUSINESS_STRATEGY: 'BUSINESS_STRATEGY',
  STRATEGY: 'BUSINESS_STRATEGY',
  STRATEGY_EXPORT: 'BUSINESS_STRATEGY',
  COMPETITOR_AUDIT: 'COMPETITOR_AUDIT',
  COMPETITOR_ANALYSIS: 'COMPETITOR_AUDIT',
  EXECUTIVE_SUMMARY: 'EXECUTIVE_SUMMARY',
  CONTENT_CALENDAR: 'CONTENT_CALENDAR',
  CALENDAR: 'CONTENT_CALENDAR',
  GO_TO_MARKET: 'GO_TO_MARKET',
  GTM_PLAN: 'GO_TO_MARKET',
  PLAYBOOK: 'PLAYBOOK',
  SWOT: 'SWOT',
  SWOT_ANALYSIS: 'SWOT',
};

export function normalizePhase2ArtifactType(value: unknown): Phase2ArtifactType | null {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  return ARTIFACT_ALIASES[raw] || null;
}

export function listSupportedPhase2ArtifactTypes(): Phase2ArtifactType[] {
  return [...PHASE2_ARTIFACT_TYPES];
}

export function getArtifactStandardPack(artifactType: Phase2ArtifactType): ArtifactStandardPack {
  return STANDARD_PACKS[artifactType];
}

export function getArtifactSection(pack: ArtifactStandardPack, sectionKey: string): StandardSectionDefinition | null {
  const normalized = String(sectionKey || '').trim().toLowerCase();
  if (!normalized) return null;
  return pack.sections.find((section) => section.key.toLowerCase() === normalized) || null;
}

export function defaultSectionDependencies(pack: ArtifactStandardPack): Record<string, string[]> {
  const sorted = [...pack.sections].sort((a, b) => a.order - b.order);
  const map: Record<string, string[]> = {};
  for (const section of sorted) {
    map[section.key] = section.dependsOn.length ? [...section.dependsOn] : [];
  }
  return map;
}
