import assert from 'node:assert/strict';
import { resolveModelForTask, resolveModelFromLegacy } from '../services/ai/model-router';

const ENV_KEYS = [
  'AI_MODEL_WORKSPACE_CHAT_PLANNER',
  'AI_MODEL_WORKSPACE_CHAT_WRITER',
  'AI_MODEL_WORKSPACE_CHAT_VALIDATOR',
  'AI_MODEL_ANALYSIS_FAST',
  'AI_MODEL_VALIDATION_FAST',
  'AI_MODEL_WORKSPACE_CHAT',
  'WORKSPACE_CHAT_MODEL',
  'AI_MODEL_DEFAULT_FAST',
  'AI_MODEL_DEFAULT_QUALITY',
  'OPENAI_MODEL_DEFAULT_FAST',
  'OPENAI_MODEL_DEFAULT_QUALITY',
  'AI_ALLOW_LEGACY_CHAT_MODEL_FALLBACK',
  'AI_ENABLE_LEGACY_MODEL_REMAPPING',
];

function withCleanEnv(run: () => void) {
  const backup = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) backup.set(key, process.env[key]);
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = backup.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

withCleanEnv(() => {
  process.env.AI_MODEL_WORKSPACE_CHAT_PLANNER = 'planner-x';
  process.env.AI_MODEL_WORKSPACE_CHAT_WRITER = 'writer-x';
  process.env.AI_MODEL_WORKSPACE_CHAT_VALIDATOR = 'validator-x';

  assert.equal(resolveModelForTask('workspace_chat_planner'), 'planner-x');
  assert.equal(resolveModelForTask('workspace_chat_writer'), 'writer-x');
  assert.equal(resolveModelForTask('workspace_chat_validator'), 'validator-x');

  delete process.env.AI_MODEL_WORKSPACE_CHAT_PLANNER;
  delete process.env.AI_MODEL_WORKSPACE_CHAT_WRITER;
  delete process.env.AI_MODEL_WORKSPACE_CHAT_VALIDATOR;
  process.env.AI_MODEL_ANALYSIS_FAST = 'analysis-fast-x';
  process.env.AI_MODEL_VALIDATION_FAST = 'validation-fast-x';
  process.env.AI_MODEL_WORKSPACE_CHAT = 'workspace-chat-x';
  process.env.WORKSPACE_CHAT_MODEL = 'legacy-chat-x';
  process.env.AI_MODEL_DEFAULT_FAST = 'default-fast-x';
  process.env.AI_MODEL_DEFAULT_QUALITY = 'default-quality-x';
  process.env.AI_ALLOW_LEGACY_CHAT_MODEL_FALLBACK = 'false';

  assert.equal(resolveModelForTask('workspace_chat_planner'), 'analysis-fast-x');
  assert.equal(resolveModelForTask('workspace_chat_writer'), 'default-quality-x');
  assert.equal(resolveModelForTask('workspace_chat_validator'), 'validation-fast-x');

  process.env.AI_ALLOW_LEGACY_CHAT_MODEL_FALLBACK = 'true';
  assert.equal(resolveModelForTask('workspace_chat_writer'), 'workspace-chat-x');

  delete process.env.AI_MODEL_ANALYSIS_FAST;
  delete process.env.AI_MODEL_VALIDATION_FAST;
  delete process.env.AI_MODEL_WORKSPACE_CHAT;
  process.env.AI_ALLOW_LEGACY_CHAT_MODEL_FALLBACK = 'true';
  assert.equal(resolveModelForTask('workspace_chat_planner'), 'legacy-chat-x');
  assert.equal(resolveModelForTask('workspace_chat_writer'), 'legacy-chat-x');
  assert.equal(resolveModelForTask('workspace_chat_validator'), 'legacy-chat-x');

  delete process.env.WORKSPACE_CHAT_MODEL;
  assert.equal(resolveModelForTask('workspace_chat_planner'), 'default-fast-x');
  assert.equal(resolveModelForTask('workspace_chat_writer'), 'default-quality-x');
  assert.equal(resolveModelForTask('workspace_chat_validator'), 'default-fast-x');

  process.env.AI_ENABLE_LEGACY_MODEL_REMAPPING = 'false';
  assert.equal(resolveModelFromLegacy('gpt-4o'), 'gpt-4o');
  process.env.AI_ENABLE_LEGACY_MODEL_REMAPPING = 'true';
  assert.equal(resolveModelFromLegacy('gpt-4o'), 'default-quality-x');
});

console.log('Model routing test passed.');
