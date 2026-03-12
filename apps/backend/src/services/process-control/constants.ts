export const PROCESS_RUN_STAGES = [
  'INTAKE_READY',
  'METHOD_SELECTED',
  'RESEARCHING',
  'SECTION_PLANNING',
  'SECTION_DRAFTING',
  'SECTION_VALIDATING',
  'WAITING_USER',
  'COMPOSING',
  'FINAL_GATE',
  'READY',
  'NEEDS_HUMAN_REVIEW',
  'FAILED',
] as const;

export type ProcessRunStageLiteral = (typeof PROCESS_RUN_STAGES)[number];

export const PROCESS_ROLE_PERMISSIONS = {
  Manager: ['workflow.select', 'run.pause', 'run.resume', 'run.escalate', 'decision.log'],
  Researcher: ['research.web_search', 'research.scraply', 'evidence.capture'],
  Drafter: ['section.plan', 'section.draft', 'section.revise'],
  FactChecker: ['factcheck.run', 'claim.verify'],
  Editor: ['section.edit', 'section.lock'],
  Publisher: ['compose.document', 'publish.final_gate'],
} as const;

export type ProcessRole = keyof typeof PROCESS_ROLE_PERMISSIONS;

export const PROCESS_EVENT_TYPES = {
  STAGE_CHANGED: 'process.stage_changed',
  QUESTION_CREATED: 'process.question_created',
  QUESTION_RESOLVED: 'process.question_resolved',
  SECTION_READY: 'process.section_ready',
  READY: 'process.ready',
  ESCALATED: 'process.escalated',
  LOG: 'process.log',
} as const;

export type ProcessEventTypeLiteral = (typeof PROCESS_EVENT_TYPES)[keyof typeof PROCESS_EVENT_TYPES];

export const QUESTION_SURFACES = ['global_inbox', 'inline_section', 'chat_fallback'] as const;

export type QuestionSurface = (typeof QUESTION_SURFACES)[number];

export const BLOCKER_SEVERITIES = new Set(['BLOCKER']);

export function assertRolePermission(role: ProcessRole, permission: string): void {
  const allowed = PROCESS_ROLE_PERMISSIONS[role] as readonly string[];
  if (!allowed.includes(permission)) {
    throw new Error(`Role ${role} is not allowed to perform ${permission}`);
  }
}

const ALLOWED_STAGE_TRANSITIONS: Record<ProcessRunStageLiteral, ProcessRunStageLiteral[]> = {
  INTAKE_READY: ['METHOD_SELECTED', 'WAITING_USER', 'FAILED'],
  METHOD_SELECTED: ['RESEARCHING', 'FAILED', 'NEEDS_HUMAN_REVIEW'],
  RESEARCHING: ['SECTION_PLANNING', 'FAILED', 'WAITING_USER'],
  SECTION_PLANNING: ['SECTION_DRAFTING', 'FAILED'],
  SECTION_DRAFTING: ['SECTION_VALIDATING', 'WAITING_USER', 'FAILED'],
  SECTION_VALIDATING: ['WAITING_USER', 'COMPOSING', 'NEEDS_HUMAN_REVIEW', 'FAILED'],
  WAITING_USER: ['SECTION_DRAFTING', 'SECTION_VALIDATING', 'COMPOSING', 'FAILED', 'NEEDS_HUMAN_REVIEW'],
  COMPOSING: ['FINAL_GATE', 'FAILED'],
  FINAL_GATE: ['READY', 'WAITING_USER', 'NEEDS_HUMAN_REVIEW', 'FAILED'],
  READY: [],
  NEEDS_HUMAN_REVIEW: ['SECTION_DRAFTING', 'SECTION_VALIDATING', 'COMPOSING', 'FAILED'],
  FAILED: [],
};

export function assertStageTransition(from: ProcessRunStageLiteral, to: ProcessRunStageLiteral): void {
  if (from === to) return;
  const allowed = ALLOWED_STAGE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid stage transition: ${from} -> ${to}`);
  }
}
