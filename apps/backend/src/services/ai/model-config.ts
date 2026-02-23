export type AiProvider = 'openai' | 'openrouter' | 'bedrock';

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

export type ModelTier = 'fast' | 'quality';

export const TASK_ENV_KEYS: Record<AiModelTask, string> = {
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

export const TASK_TIERS: Record<AiModelTask, ModelTier> = {
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

export type TaskModelPolicy = {
  task: AiModelTask;
  provider: AiProvider;
  model: string;
  fallbacks: string[];
  temperature: number;
  maxTokens: number;
};

export type ModelPolicy = {
  tasks: Record<AiModelTask, TaskModelPolicy>;
  pricing: Record<string, { input: number; output: number }>;
};

function readEnv(key: string): string | null {
  const raw = process.env[key];
  if (!raw) return null;
  const value = String(raw).trim();
  return value.length ? value : null;
}

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function getDefaultModelForTier(tier: ModelTier): string {
  if (tier === 'quality') {
    return (
      readEnv('AI_MODEL_DEFAULT_QUALITY') ||
      readEnv('OPENAI_MODEL_DEFAULT_QUALITY') ||
      'gpt-5.2'
    );
  }
  return (
    readEnv('AI_MODEL_DEFAULT_FAST') ||
    readEnv('OPENAI_MODEL_DEFAULT_FAST') ||
    'gpt-5-mini'
  );
}

export function isAiModelTask(value: unknown): value is AiModelTask {
  return typeof value === 'string' && (AI_MODEL_TASKS as string[]).includes(value);
}

export function isAiProvider(value: unknown): value is AiProvider {
  const provider = String(value || '').trim().toLowerCase();
  return provider === 'openai' || provider === 'openrouter' || provider === 'bedrock';
}

export function allowLegacyChatModelFallback(): boolean {
  return envFlag('AI_ALLOW_LEGACY_CHAT_MODEL_FALLBACK', false);
}

export function allowLegacyModelRemapping(): boolean {
  return envFlag('AI_ENABLE_LEGACY_MODEL_REMAPPING', false);
}

function resolveProvider(task: AiModelTask): AiProvider {
  const taskEnv = readEnv(`AI_PROVIDER_${task.toUpperCase()}`);
  const globalEnv = readEnv('AI_PROVIDER_DEFAULT');
  const requested = (taskEnv || globalEnv || 'openai').toLowerCase();
  return isAiProvider(requested) ? requested : 'openai';
}

function resolveTaskTemperature(task: AiModelTask): number {
  const explicit = readEnv(`AI_TEMPERATURE_${task.toUpperCase()}`);
  const parsed = Number(explicit);
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
  return TASK_TIERS[task] === 'quality' ? 0.3 : 0;
}

function resolveTaskMaxTokens(task: AiModelTask): number {
  const explicit = readEnv(`AI_MAX_TOKENS_${task.toUpperCase()}`);
  const parsed = Number(explicit);
  if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  return TASK_TIERS[task] === 'quality' ? 1200 : 600;
}

function resolveLegacyTaskFallback(task: AiModelTask, allowLegacyFallback: boolean): string[] {
  if (task === 'workspace_chat') {
    return parseCsv(readEnv('WORKSPACE_CHAT_MODEL'));
  }
  if (task === 'workspace_chat_planner') {
    return parseCsv(readEnv('AI_MODEL_ANALYSIS_FAST') || readEnv('WORKSPACE_CHAT_MODEL'));
  }
  if (task === 'workspace_chat_writer') {
    if (!allowLegacyFallback) return [];
    return parseCsv(readEnv('AI_MODEL_WORKSPACE_CHAT') || readEnv('WORKSPACE_CHAT_MODEL'));
  }
  if (task === 'workspace_chat_validator') {
    return parseCsv(
      readEnv('AI_MODEL_VALIDATION_FAST') || readEnv('AI_MODEL_ANALYSIS_FAST') || readEnv('WORKSPACE_CHAT_MODEL'),
    );
  }
  if (task === 'strategy_doc_chat') {
    return parseCsv(readEnv('STRATEGY_DOC_CHAT_MODEL'));
  }
  if (task === 'competitor_discovery') {
    return parseCsv(readEnv('OPENAI_COMPETITOR_MODEL'));
  }
  if (task === 'competitor_planner') {
    return parseCsv(readEnv('OPENAI_COMPETITOR_PLANNER_MODEL') || readEnv('OPENAI_COMPETITOR_MODEL'));
  }
  return [];
}

function dedupeModels(models: Array<string | null | undefined>, exclude?: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const candidate of models) {
    const model = String(candidate || '').trim();
    if (!model || model === exclude || seen.has(model)) continue;
    seen.add(model);
    output.push(model);
  }
  return output;
}

export function resolveTaskPolicy(task: AiModelTask, options: { fallbackModel?: string } = {}): TaskModelPolicy {
  const allowLegacyFallback = allowLegacyChatModelFallback();
  const direct = readEnv(TASK_ENV_KEYS[task]);
  const defaults = getDefaultModelForTier(TASK_TIERS[task]);
  const legacyFallback = resolveLegacyTaskFallback(task, allowLegacyFallback);
  const explicitFallbacks = parseCsv(readEnv(`${TASK_ENV_KEYS[task]}_FALLBACKS`));
  const tierFallbacks = parseCsv(
    TASK_TIERS[task] === 'quality'
      ? readEnv('AI_MODEL_DEFAULT_QUALITY_FALLBACKS')
      : readEnv('AI_MODEL_DEFAULT_FAST_FALLBACKS'),
  );
  const primary = direct || legacyFallback[0] || defaults || options.fallbackModel || getDefaultModelForTier('fast');
  const fallbacks = dedupeModels(
    [options.fallbackModel, ...explicitFallbacks, ...legacyFallback, ...tierFallbacks, defaults],
    primary,
  );

  return {
    task,
    provider: resolveProvider(task),
    model: primary,
    fallbacks,
    temperature: resolveTaskTemperature(task),
    maxTokens: resolveTaskMaxTokens(task),
  };
}

export function resolvePricingMap(): Record<string, { input: number; output: number }> {
  const defaults: Record<string, { input: number; output: number }> = {
    'gpt-5.2': { input: 0.005, output: 0.015 },
    'gpt-5-mini': { input: 0.00015, output: 0.0006 },
  };
  const raw = readEnv('AI_MODEL_PRICING_JSON');
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
    for (const [model, value] of Object.entries(parsed || {})) {
      const input = Number(value?.input);
      const output = Number(value?.output);
      if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
        defaults[model] = { input, output };
      }
    }
  } catch {
    // Keep default pricing if parsing fails.
  }
  return defaults;
}

export function buildModelPolicy(): ModelPolicy {
  const tasks = AI_MODEL_TASKS.reduce<Record<AiModelTask, TaskModelPolicy>>((acc, task) => {
    acc[task] = resolveTaskPolicy(task);
    return acc;
  }, {} as Record<AiModelTask, TaskModelPolicy>);

  return {
    tasks,
    pricing: resolvePricingMap(),
  };
}
