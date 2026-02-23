import {
  allowLegacyModelRemapping,
  isAiModelTask,
  resolveTaskPolicy,
  type AiModelTask,
  type AiProvider,
} from './model-config';

const LEGACY_MODEL_TASK_HINTS: Record<string, AiModelTask> = {
  'gpt-4o-mini': 'analysis_fast',
  'gpt-4o': 'analysis_quality',
};

export { AI_MODEL_TASKS, isAiModelTask, type AiModelTask, type AiProvider } from './model-config';

export function resolveProviderForTask(task: AiModelTask): AiProvider {
  return resolveTaskPolicy(task).provider;
}

export function resolveModelForTask(task: AiModelTask, fallbackModel?: string): string {
  return resolveTaskPolicy(task, { fallbackModel }).model;
}

export function resolveFallbackModelsForTask(task: AiModelTask, primaryModel?: string): string[] {
  const policy = resolveTaskPolicy(task, { fallbackModel: primaryModel });
  return policy.fallbacks.filter((candidate) => candidate !== primaryModel);
}

export function resolveModelFromLegacy(requestedModel: string, taskHint?: AiModelTask): string {
  const requested = String(requestedModel || '').trim();
  const normalized = requested.toLowerCase();
  const shouldRemap = allowLegacyModelRemapping();
  const isLegacy4o = normalized === 'gpt-4o' || normalized === 'gpt-4o-mini';

  if (taskHint && (!requested || (shouldRemap && isLegacy4o))) {
    return resolveModelForTask(taskHint);
  }
  if (taskHint) return requested;

  if (shouldRemap) {
    const mappedTask = LEGACY_MODEL_TASK_HINTS[normalized];
    if (mappedTask) return resolveModelForTask(mappedTask);
  }

  return requested || resolveModelForTask('analysis_fast');
}
