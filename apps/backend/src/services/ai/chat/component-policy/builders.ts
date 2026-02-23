import type { ChatBlock } from '../../../chat/chat-types';
import { INTERACTIVE_BLOCK_TYPES } from './types';
import type { ChatComponentPlan } from './types';
import { asRecord, asString, clamp } from './utils';

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function buildSelectionOptions(
  plan: ChatComponentPlan | null,
  followUp: string[]
): Array<{ id: string; label: string; description?: string }> {
  const propOptions = Array.isArray(plan?.props?.options) ? plan?.props?.options : [];
  const optionsFromProps = propOptions
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const label = entry.trim();
        if (!label) return null;
        return { id: `opt-${index + 1}`, label };
      }
      const record = asRecord(entry);
      if (!record) return null;
      const label = asString(record.label || record.title || record.value);
      if (!label) return null;
      return {
        id: asString(record.id) || `opt-${index + 1}`,
        label,
        description: asString(record.description) || undefined,
      };
    })
    .filter(isNonNull);

  if (optionsFromProps.length >= 2) return optionsFromProps.slice(0, 6);

  const fromActions = (plan?.actions || [])
    .map((action, index) => {
      const label = asString(action.label || action.value);
      if (!label) return null;
      return {
        id: asString(action.id) || `act-${index + 1}`,
        label,
        description: asString(action.description) || undefined,
      };
    })
    .filter(isNonNull);
  if (fromActions.length >= 2) return fromActions.slice(0, 6);

  return followUp.map((question, index) => ({ id: `fu-${index + 1}`, label: question }));
}

export function hasInteractiveBlock(blocks: ChatBlock[]): boolean {
  return blocks.some((block) => INTERACTIVE_BLOCK_TYPES.has(String(block.type || '').toLowerCase()));
}

export function createProgressBlock(plan: ChatComponentPlan | null): ChatBlock {
  const rawStep = plan?.step;
  let currentStep = 1;
  let totalSteps = plan?.totalSteps || 1;
  let phase = plan?.intent || 'guided_discovery';
  let status = 'collecting';
  if (typeof rawStep === 'number') {
    currentStep = Math.max(1, rawStep);
  } else if (rawStep && typeof rawStep === 'object') {
    currentStep = Math.max(1, Number(rawStep.current || 1));
    totalSteps = Math.max(1, Number(rawStep.total || totalSteps));
    phase = asString(rawStep.label) || phase;
    status = asString(rawStep.status) || status;
  }
  totalSteps = Math.max(totalSteps, currentStep);
  return {
    type: 'progress_stepper',
    blockId: 'progress-stepper',
    title: 'Progress',
    currentStep,
    totalSteps,
    phase,
    status,
  };
}

export function createGuidedQuestionBlock(plan: ChatComponentPlan | null, followUp: string[]): ChatBlock {
  const options = buildSelectionOptions(plan, followUp);
  const questionFromProps = asString(plan?.props?.question || plan?.props?.prompt);
  return {
    type: 'guided_question_card',
    blockId: 'guided-question',
    title: 'Choose next step',
    question: questionFromProps || 'Pick the direction you want to work on now.',
    hint: 'You can revise this later from the recap.',
    options,
    allowFreeText: true,
  };
}

export function createChoiceChipsBlock(plan: ChatComponentPlan | null, followUp: string[]): ChatBlock {
  return {
    type: 'choice_chips',
    blockId: 'choice-chips',
    title: 'Make a selection',
    prompt: asString(plan?.props?.prompt) || 'Select one option to continue.',
    selectionMode: asString(plan?.props?.selectionMode) === 'multiple' ? 'multiple' : 'single',
    choices: buildSelectionOptions(plan, followUp),
    allowSkip: true,
    allowUnsure: true,
  };
}

export function createOptionCardsBlock(plan: ChatComponentPlan | null, followUp: string[]): ChatBlock {
  const cards = buildSelectionOptions(plan, followUp).map((option) => ({
    id: option.id,
    title: option.label,
    summary: option.description || 'Explore this direction with generated examples.',
    tags: [],
  }));
  return {
    type: 'option_cards',
    blockId: 'option-cards',
    title: 'Explore directions',
    prompt: asString(plan?.props?.prompt) || 'Choose a path to explore.',
    selectionMode: 'single',
    cards,
  };
}

export function createRecapBlock(plan: ChatComponentPlan | null): ChatBlock {
  const slots = asRecord(plan?.props?.slots);
  const items = slots
    ? Object.entries(slots)
      .map(([key, value]) => {
        const display = Array.isArray(value) ? value.join(', ') : String(value ?? '').trim();
        return display ? { key, label: key.replace(/_/g, ' '), value: display, editable: true } : null;
      })
      .filter(isNonNull)
    : [];
  return {
    type: 'recap_editor',
    blockId: 'recap-editor',
    title: 'Current selections',
    summary: 'Review and edit any choice before generation.',
    items: items.length
      ? items
      : [
        { key: 'goal', label: 'goal', value: 'Not selected', editable: true },
        { key: 'audience', label: 'audience', value: 'Not selected', editable: true },
      ],
    ctaLabel: 'Generate draft',
  };
}

export function createQuickReplyBlock(followUp: string[]): ChatBlock {
  return {
    type: 'quick_reply_bar',
    blockId: 'quick-replies',
    title: 'Quick actions',
    suggestions: followUp.slice(0, 3),
  };
}

export function createActionButtonsFromPlan(plan: ChatComponentPlan | null): ChatBlock | null {
  const rawActions = Array.isArray(plan?.actions) ? plan.actions : [];
  const buttons = rawActions
    .map((entry, index) => {
      const action = asString(entry.action);
      const href = asString(entry.href);
      if (!action && !href) return null;
      const label = asString(entry.label || entry.value) || `Action ${index + 1}`;
      return {
        label,
        sublabel: asString(entry.description) || undefined,
        action: action || undefined,
        href: href || undefined,
        intent: index === 0 ? 'primary' : 'secondary',
        payload: entry.payload && Object.keys(entry.payload).length ? entry.payload : undefined,
      };
    })
    .filter(isNonNull)
    .slice(0, 4);

  if (!buttons.length) return null;
  return {
    type: 'action_buttons',
    blockId: 'plan-actions',
    title: 'Actions',
    buttons,
  };
}

export function createCompareModesBlock(plan: ChatComponentPlan | null, followUp: string[]): ChatBlock {
  const options = buildSelectionOptions(plan, followUp);
  const modes = options.slice(0, 3).map((option, index) => ({
    id: option.id,
    title: option.label,
    summary: option.description || 'Compare this option against alternatives.',
    pros: ['Clear messaging', 'Fast to execute'],
    cons: index === 0 ? ['May need stronger proof'] : ['Requires tighter constraints'],
  }));
  return {
    type: 'compare_modes',
    blockId: 'compare-modes',
    title: 'Compare options',
    modes,
  };
}

export function createScenarioSimulatorBlock(plan: ChatComponentPlan | null, followUp: string[]): ChatBlock {
  const options = buildSelectionOptions(plan, followUp);
  return {
    type: 'scenario_simulator',
    blockId: 'scenario-simulator',
    title: 'Scenario simulation',
    scenarioPrompt: 'Preview likely outcomes before committing.',
    scenarios: options.slice(0, 3).map((option) => ({
      id: option.id,
      label: option.label,
      impact: 'High clarity, medium effort',
      risk: 'Low risk when constraints are explicit',
    })),
  };
}

export function createConstraintBuilderBlock(plan: ChatComponentPlan | null): ChatBlock {
  const defaults = ['Avoid unsupported claims', 'Keep tone human and direct', 'Focus on one CTA per draft'];
  const incoming = Array.isArray(plan?.props?.constraints) ? plan?.props?.constraints : defaults;
  const constraints = incoming
    .map((value, index) => {
      const label = typeof value === 'string' ? value.trim() : asString((value as any)?.label);
      if (!label) return null;
      return {
        id: typeof value === 'object' ? asString((value as any)?.id) || `constraint-${index + 1}` : `constraint-${index + 1}`,
        label,
        description: typeof value === 'object' ? asString((value as any)?.description) || undefined : undefined,
        selected: typeof value === 'object' ? Boolean((value as any)?.selected) : true,
      };
    })
    .filter(isNonNull);
  return {
    type: 'constraint_builder',
    blockId: 'constraint-builder',
    title: 'Set constraints',
    prompt: 'Toggle constraints before generation.',
    constraints,
    allowCustom: true,
  };
}

export function createExamplesGalleryBlock(plan: ChatComponentPlan | null): ChatBlock {
  const incoming = Array.isArray(plan?.props?.examples) ? plan?.props?.examples : [];
  const examples = incoming
    .map((entry, index) => {
      const record = asRecord(entry);
      if (!record) return null;
      const title = asString(record.title || record.label);
      if (!title) return null;
      return {
        id: asString(record.id) || `example-${index + 1}`,
        title,
        summary: asString(record.summary || record.description) || undefined,
        source: asString(record.source) || undefined,
      };
    })
    .filter(isNonNull);
  return {
    type: 'examples_gallery',
    blockId: 'examples-gallery',
    title: 'Example references',
    examples: examples.length
      ? examples
      : [{ id: 'example-1', title: 'No examples attached yet', summary: 'Add references to improve output quality.' }],
  };
}

export function createTradeoffMatrixBlock(plan: ChatComponentPlan | null, followUp: string[]): ChatBlock {
  const options = buildSelectionOptions(plan, followUp).slice(0, 3);
  return {
    type: 'tradeoff_matrix',
    blockId: 'tradeoff-matrix',
    title: 'Tradeoffs',
    criteria: ['speed', 'clarity', 'risk'],
    options: options.map((option, index) => ({
      id: option.id,
      label: option.label,
      scores: [index === 0 ? 9 : 7, index === 1 ? 9 : 8, index === 2 ? 6 : 8],
      summary: option.description || 'Balanced option',
    })),
  };
}

export function createDraftPreviewCardBlock(plan: ChatComponentPlan | null): ChatBlock {
  return {
    type: 'draft_preview_card',
    blockId: 'draft-preview',
    title: 'Draft preview',
    preview:
      asString(plan?.props?.preview) ||
      'You are ready to generate. This draft will reflect the selected audience, tone, and constraints.',
    checks: ['Goal selected', 'Audience selected', 'Tone selected'],
    primaryActionLabel: 'Generate now',
    secondaryActionLabel: 'Edit recap',
  };
}

export function createConfidenceCheckBlock(plan: ChatComponentPlan | null): ChatBlock {
  const confidence = Number.isFinite(Number(plan?.confidence))
    ? clamp(Number(plan?.confidence), 0, 1)
    : 0.7;
  return {
    type: 'confidence_check',
    blockId: 'confidence-check',
    title: 'Assumption check',
    assumption:
      asString(plan?.props?.assumption) ||
      'The selected direction matches your highest-priority business goal.',
    confidence,
    options: ['Confirm', 'Adjust assumptions', 'Switch direction'],
  };
}

export function buildComponentBlock(
  component: string,
  plan: ChatComponentPlan | null,
  followUp: string[]
): ChatBlock | null {
  switch (component) {
    case 'guided_question_card':
      return createGuidedQuestionBlock(plan, followUp);
    case 'choice_chips':
      return createChoiceChipsBlock(plan, followUp);
    case 'option_cards':
      return createOptionCardsBlock(plan, followUp);
    case 'recap_editor':
      return createRecapBlock(plan);
    case 'quick_reply_bar':
      return createQuickReplyBlock(followUp);
    case 'progress_stepper':
      return createProgressBlock(plan);
    case 'compare_modes':
      return createCompareModesBlock(plan, followUp);
    case 'scenario_simulator':
      return createScenarioSimulatorBlock(plan, followUp);
    case 'constraint_builder':
      return createConstraintBuilderBlock(plan);
    case 'examples_gallery':
      return createExamplesGalleryBlock(plan);
    case 'tradeoff_matrix':
      return createTradeoffMatrixBlock(plan, followUp);
    case 'draft_preview_card':
      return createDraftPreviewCardBlock(plan);
    case 'confidence_check':
      return createConfidenceCheckBlock(plan);
    default:
      return null;
  }
}

export function enforceNarrativeContent(content: string, hasInteractive: boolean): string {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const noTables = raw
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\|.*\|$/.test(trimmed)) return false;
      if (/^\|?[-:\s|]{3,}\|?$/.test(trimmed)) return false;
      return true;
    })
    .join(' ');
  const noHeadings = noTables.replace(/#{1,6}\s*/g, '');
  const cleaned = noHeadings
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = cleaned.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = compact.split(/(?<=[.!?])\s+/).filter(Boolean);
  let short = sentences.slice(0, hasInteractive ? 1 : 2).join(' ').trim();
  if (!short) short = compact;
  const maxLength = hasInteractive ? 180 : 240;
  if (short.length > maxLength) short = `${short.slice(0, maxLength - 3)}...`;
  return short;
}
