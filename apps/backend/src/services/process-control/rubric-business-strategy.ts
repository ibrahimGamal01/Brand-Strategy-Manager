export type RubricFieldAnswerType = 'single_select' | 'multi_select' | 'text';

export type RubricFieldOption = {
  value: string;
  label: string;
};

export type RubricFieldRequirement = {
  key: string;
  label: string;
  severity: 'BLOCKER' | 'IMPORTANT' | 'OPTIONAL';
  question: string;
  answerType?: RubricFieldAnswerType;
  options?: RubricFieldOption[];
  suggestedAnswers?: string[];
};

export type BusinessStrategySectionRubric = {
  key: string;
  title: string;
  framework: string;
  order: number;
  minWords: number;
  minEvidence: number;
  requiredInputs: RubricFieldRequirement[];
  exitCriteria: string[];
};

export const BUSINESS_STRATEGY_RUBRIC: BusinessStrategySectionRubric[] = [
  {
    key: 'executive_summary',
    title: 'Executive Summary',
    framework: 'Context -> Thesis -> Outcomes',
    order: 1,
    minWords: 140,
    minEvidence: 2,
    requiredInputs: [
      {
        key: 'primaryGoal',
        label: 'Primary goal',
        severity: 'BLOCKER',
        question: 'What is the primary business goal for the next 90 days?',
        suggestedAnswers: ['Increase qualified leads', 'Increase conversion rate', 'Improve retention'],
      },
      {
        key: 'oneSentenceDescription',
        label: 'Business description',
        severity: 'BLOCKER',
        question: 'How would you describe your business in one sentence?',
      },
      {
        key: 'targetAudience',
        label: 'Target audience',
        severity: 'IMPORTANT',
        question: 'Who is the most important audience segment for this strategy?',
        suggestedAnswers: ['Decision makers', 'Small business owners', 'Niche community segment'],
      },
    ],
    exitCriteria: [
      'States objective, target market, and success metric clearly',
      'Includes at least two evidence references',
      'No placeholder claims or unresolved blockers',
    ],
  },
  {
    key: 'market_context',
    title: 'Market Context',
    framework: 'Signal scan -> Segment lens -> Position opportunity',
    order: 2,
    minWords: 180,
    minEvidence: 3,
    requiredInputs: [
      {
        key: 'niche',
        label: 'Niche',
        severity: 'BLOCKER',
        question: 'What niche or category do you compete in?',
      },
      {
        key: 'operateWhere',
        label: 'Current geography',
        severity: 'IMPORTANT',
        question: 'Where do you currently operate?',
      },
      {
        key: 'wantClientsWhere',
        label: 'Target geography',
        severity: 'IMPORTANT',
        question: 'Where do you want to win clients next?',
      },
    ],
    exitCriteria: [
      'Includes current market signals with citations',
      'Defines key constraints and opportunities by geography/segment',
      'Avoids unsupported generalizations',
    ],
  },
  {
    key: 'audience_and_problem',
    title: 'Audience and Problem Definition',
    framework: 'Audience -> Pain -> Buying questions',
    order: 3,
    minWords: 160,
    minEvidence: 2,
    requiredInputs: [
      {
        key: 'idealAudience',
        label: 'Ideal audience',
        severity: 'BLOCKER',
        question: 'Who is your ideal customer profile?',
      },
      {
        key: 'topProblems',
        label: 'Top problems',
        severity: 'BLOCKER',
        question: 'What are the top problems your customers need solved?',
      },
      {
        key: 'questionsBeforeBuying',
        label: 'Pre-buying questions',
        severity: 'IMPORTANT',
        question: 'What common questions do prospects ask before they buy?',
      },
    ],
    exitCriteria: [
      'Names audience and pain points concretely',
      'Maps pains to buying friction points',
      'Cites evidence supporting audience/problem assumptions',
    ],
  },
  {
    key: 'offer_and_positioning',
    title: 'Offer and Positioning',
    framework: 'Offer map -> Positioning statement -> Differentiation',
    order: 4,
    minWords: 170,
    minEvidence: 2,
    requiredInputs: [
      {
        key: 'mainOffer',
        label: 'Main offer',
        severity: 'BLOCKER',
        question: 'What is your primary offer?',
      },
      {
        key: 'servicesList',
        label: 'Services list',
        severity: 'IMPORTANT',
        question: 'What services/products should this strategy include?',
      },
      {
        key: 'brandPrimaryLogo',
        label: 'Primary logo',
        severity: 'IMPORTANT',
        question: 'Which detected logo should be treated as the primary brand mark?',
        answerType: 'single_select',
      },
      {
        key: 'brandTypography',
        label: 'Primary typography',
        severity: 'IMPORTANT',
        question: 'Which typography family should strategy visuals prioritize?',
        answerType: 'single_select',
      },
      {
        key: 'brandTone',
        label: 'Brand tone',
        severity: 'OPTIONAL',
        question: 'How should the brand voice feel in strategic messaging?',
      },
    ],
    exitCriteria: [
      'Defines offer architecture and positioning statement',
      'Documents strategic differentiation against alternatives',
      'Grounds claims with evidence references',
    ],
  },
  {
    key: 'competitive_strategy',
    title: 'Competitive Strategy',
    framework: 'Competitor map -> Gap analysis -> Counter-positioning',
    order: 5,
    minWords: 190,
    minEvidence: 3,
    requiredInputs: [
      {
        key: 'competitorInspirationLinks',
        label: 'Competitor references',
        severity: 'IMPORTANT',
        question: 'Who are your top competitors or inspiration brands?',
      },
      {
        key: 'secondaryGoals',
        label: 'Secondary goals',
        severity: 'OPTIONAL',
        question: 'Which secondary outcomes should the competitive strategy support?',
      },
    ],
    exitCriteria: [
      'Includes direct and adjacent competitor positioning',
      'Identifies defendable strategic wedge',
      'Backs assertions with evidence references',
    ],
  },
  {
    key: 'go_to_market_execution',
    title: 'Go-to-Market Execution',
    framework: 'Channel mix -> Sequencing -> Delivery system',
    order: 6,
    minWords: 190,
    minEvidence: 2,
    requiredInputs: [
      {
        key: 'language',
        label: 'Language',
        severity: 'IMPORTANT',
        question: 'What language should market-facing communication prioritize?',
        answerType: 'single_select',
        options: [
          { value: 'english', label: 'English' },
          { value: 'arabic', label: 'Arabic' },
          { value: 'bilingual', label: 'Bilingual (English + Arabic)' },
        ],
      },
      {
        key: 'planningHorizon',
        label: 'Planning horizon',
        severity: 'IMPORTANT',
        question: 'What planning horizon should this strategy prioritize?',
        answerType: 'single_select',
        options: [
          { value: '30_days', label: '30 days' },
          { value: '60_days', label: '60 days' },
          { value: '90_days', label: '90 days' },
          { value: '180_days', label: '180 days' },
        ],
      },
      {
        key: 'brandColorPalette',
        label: 'Core color palette',
        severity: 'IMPORTANT',
        question: 'Which color palette should execution assets stay aligned with?',
        answerType: 'single_select',
      },
      {
        key: 'autonomyLevel',
        label: 'Autonomy level',
        severity: 'OPTIONAL',
        question: 'Should execution be mostly assistive or mostly autonomous?',
        answerType: 'single_select',
        options: [
          { value: 'assistive', label: 'Assistive' },
          { value: 'hybrid', label: 'Hybrid' },
          { value: 'autonomous', label: 'Autonomous' },
        ],
      },
    ],
    exitCriteria: [
      'Defines channel priorities and sequencing',
      'Specifies handoff points between automation and human review',
      'Contains measurable milestones',
    ],
  },
  {
    key: 'measurement_and_risk',
    title: 'Measurement and Risk',
    framework: 'KPI tree -> Risk register -> Governance cadence',
    order: 7,
    minWords: 160,
    minEvidence: 2,
    requiredInputs: [
      {
        key: 'resultsIn90Days',
        label: '90-day outcomes',
        severity: 'BLOCKER',
        question: 'What outcomes should be achieved in 90 days?',
      },
      {
        key: 'constraints',
        label: 'Constraints',
        severity: 'IMPORTANT',
        question: 'What constraints or risks must this strategy respect?',
      },
      {
        key: 'budgetSensitivity',
        label: 'Budget sensitivity',
        severity: 'IMPORTANT',
        question: 'How budget-constrained is execution?',
        answerType: 'single_select',
        options: [
          { value: 'high_constraint', label: 'High constraint' },
          { value: 'moderate_constraint', label: 'Moderate constraint' },
          { value: 'low_constraint', label: 'Low constraint' },
        ],
      },
    ],
    exitCriteria: [
      'Defines KPI tree with ownership and cadence',
      'Documents risks and mitigation actions',
      'Includes explicit escalation policy',
    ],
  },
  {
    key: 'execution_roadmap',
    title: 'Execution Roadmap',
    framework: 'Now -> Next -> Later with decision checkpoints',
    order: 8,
    minWords: 190,
    minEvidence: 2,
    requiredInputs: [
      {
        key: 'engineGoal',
        label: 'Engine goal',
        severity: 'IMPORTANT',
        question: 'What long-term growth engine should this roadmap build?',
      },
      {
        key: 'futureGoal',
        label: 'Future goal',
        severity: 'IMPORTANT',
        question: 'What future-state outcome should this roadmap unlock?',
      },
    ],
    exitCriteria: [
      'Includes phased roadmap with clear ownership',
      'Contains dependencies and blockers by phase',
      'Includes user-question checkpoints for missing critical data',
    ],
  },
];

export function findBusinessStrategyRubricSection(sectionKey: string): BusinessStrategySectionRubric | null {
  const normalized = String(sectionKey || '').trim().toLowerCase();
  if (!normalized) return null;
  return BUSINESS_STRATEGY_RUBRIC.find((section) => section.key === normalized) || null;
}
