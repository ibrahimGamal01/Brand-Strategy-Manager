export type AiProvider = 'openai';

export type AiModelTask =
  | 'workspace_chat'
  | 'workspace_chat_planner'
  | 'workspace_chat_writer'
  | 'workspace_chat_validator'
  | 'strategy_doc_chat'
  | 'competitor_discovery'
  | 'competitor_planner'
  | 'content_generation'
  | 'analysis_quality'
  | 'analysis_fast'
  | 'validation_fast'
  | 'vision_ocr'
  | 'media_analysis'
  | 'intake_completion'
  | 'brain_command';

export const AI_MODEL_TASKS: AiModelTask[] = [
  'workspace_chat',
  'workspace_chat_planner',
  'workspace_chat_writer',
  'workspace_chat_validator',
  'strategy_doc_chat',
  'competitor_discovery',
  'competitor_planner',
  'content_generation',
  'analysis_quality',
  'analysis_fast',
  'validation_fast',
  'vision_ocr',
  'media_analysis',
  'intake_completion',
  'brain_command',
];

type ModelTier = 'fast' | 'quality';

const TASK_ENV_KEYS: Record<AiModelTask, string> = {
  workspace_chat: 'AI_MODEL_WORKSPACE_CHAT',
  workspace_chat_planner: 'AI_MODEL_WORKSPACE_CHAT_PLANNER',
  workspace_chat_writer: 'AI_MODEL_WORKSPACE_CHAT_WRITER',
  workspace_chat_validator: 'AI_MODEL_WORKSPACE_CHAT_VALIDATOR',
  strategy_doc_chat: 'AI_MODEL_STRATEGY_DOC_CHAT',
  competitor_discovery: 'AI_MODEL_COMPETITOR_DISCOVERY',
  competitor_planner: 'AI_MODEL_COMPETITOR_PLANNER',
  content_generation: 'AI_MODEL_CONTENT_GENERATION',
  analysis_quality: 'AI_MODEL_ANALYSIS_QUALITY',
  analysis_fast: 'AI_MODEL_ANALYSIS_FAST',
  validation_fast: 'AI_MODEL_VALIDATION_FAST',
  vision_ocr: 'AI_MODEL_VISION_OCR',
  media_analysis: 'AI_MODEL_MEDIA_ANALYSIS',
  intake_completion: 'AI_MODEL_INTAKE_COMPLETION',
  brain_command: 'AI_MODEL_BRAIN_COMMAND',
};

const TASK_TIERS: Record<AiModelTask, ModelTier> = {
  workspace_chat: 'fast',
  workspace_chat_planner: 'fast',
  workspace_chat_writer: 'quality',
  workspace_chat_validator: 'fast',
  strategy_doc_chat: 'fast',
  competitor_discovery: 'fast',
  competitor_planner: 'fast',
  content_generation: 'quality',
  analysis_quality: 'quality',
  analysis_fast: 'fast',
  validation_fast: 'fast',
  vision_ocr: 'fast',
  media_analysis: 'quality',
  intake_completion: 'fast',
  brain_command: 'fast',
};

const LEGACY_MODEL_TASK_HINTS: Record<string, AiModelTask> = {
  'gpt-4o-mini': 'analysis_fast',
  'gpt-4o': 'analysis_quality',
};

export function isAiModelTask(value: unknown): value is AiModelTask {
  return typeof value === 'string' && (AI_MODEL_TASKS as string[]).includes(value);
}

function readEnv(key: string): string | null {
  const raw = process.env[key];
  if (!raw) return null;
  const value = String(raw).trim();
  return value.length ? value : null;
}

function getDefaultModelForTier(tier: ModelTier): string {
  if (tier === 'quality') {
    return (
      readEnv('AI_MODEL_DEFAULT_QUALITY') ||
      readEnv('OPENAI_MODEL_DEFAULT_QUALITY') ||
      'gpt-4o'
    );
  }
  return (
    readEnv('AI_MODEL_DEFAULT_FAST') ||
    readEnv('OPENAI_MODEL_DEFAULT_FAST') ||
    'gpt-4o-mini'
  );
}

export function resolveProviderForTask(task: AiModelTask): AiProvider {
  const taskEnv = readEnv(`AI_PROVIDER_${task.toUpperCase()}`);
  const globalEnv = readEnv('AI_PROVIDER_DEFAULT');
  const requested = (taskEnv || globalEnv || 'openai').toLowerCase();

  // C-ready hook: only OpenAI is wired today, other providers can be plugged in without changing callers.
  if (requested !== 'openai') {
    return 'openai';
  }
  return 'openai';
}

export function resolveModelForTask(task: AiModelTask, fallbackModel?: string): string {
  const taskModel = readEnv(TASK_ENV_KEYS[task]);
  if (taskModel) return taskModel;

  // Backward-compatibility with existing env variables used before introducing the task router.
  if (task === 'workspace_chat') {
    return readEnv('WORKSPACE_CHAT_MODEL') || getDefaultModelForTier(TASK_TIERS[task]);
  }
  if (task === 'workspace_chat_planner') {
    return (
      readEnv('AI_MODEL_ANALYSIS_FAST') ||
      readEnv('WORKSPACE_CHAT_MODEL') ||
      getDefaultModelForTier(TASK_TIERS[task])
    );
  }
  if (task === 'workspace_chat_writer') {
    return (
      readEnv('AI_MODEL_WORKSPACE_CHAT') ||
      readEnv('WORKSPACE_CHAT_MODEL') ||
      getDefaultModelForTier(TASK_TIERS[task])
    );
  }
  if (task === 'workspace_chat_validator') {
    return (
      readEnv('AI_MODEL_VALIDATION_FAST') ||
      readEnv('AI_MODEL_ANALYSIS_FAST') ||
      readEnv('WORKSPACE_CHAT_MODEL') ||
      getDefaultModelForTier(TASK_TIERS[task])
    );
  }
  if (task === 'strategy_doc_chat') {
    return readEnv('STRATEGY_DOC_CHAT_MODEL') || getDefaultModelForTier(TASK_TIERS[task]);
  }
  if (task === 'competitor_discovery') {
    return readEnv('OPENAI_COMPETITOR_MODEL') || getDefaultModelForTier(TASK_TIERS[task]);
  }
  if (task === 'competitor_planner') {
    return (
      readEnv('OPENAI_COMPETITOR_PLANNER_MODEL') ||
      readEnv('OPENAI_COMPETITOR_MODEL') ||
      getDefaultModelForTier(TASK_TIERS[task])
    );
  }

  const tierDefault = getDefaultModelForTier(TASK_TIERS[task]);
  if (tierDefault) return tierDefault;
  if (fallbackModel && fallbackModel.trim()) return fallbackModel.trim();
  return getDefaultModelForTier('fast');
}

export function resolveModelFromLegacy(requestedModel: string, taskHint?: AiModelTask): string {
  const requested = String(requestedModel || '').trim();
  const normalized = requested.toLowerCase();
  const isLegacy4o = normalized === 'gpt-4o' || normalized === 'gpt-4o-mini';

  if (taskHint) {
    if (!requested || isLegacy4o) {
      return resolveModelForTask(taskHint);
    }
    return requested;
  }

  const mappedTask = LEGACY_MODEL_TASK_HINTS[normalized];
  if (mappedTask) {
    return resolveModelForTask(mappedTask);
  }

  return requested || getDefaultModelForTier('fast');
}
