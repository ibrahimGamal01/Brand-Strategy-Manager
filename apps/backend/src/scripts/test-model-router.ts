import assert from 'node:assert/strict';
import { resolveFallbackModelsForTask, resolveModelForTask, resolveModelFromLegacy } from '../services/ai/model-router';

const snapshot = { ...process.env };

function resetEnv() {
  process.env = { ...snapshot };
}

try {
  resetEnv();
  delete process.env.AI_MODEL_WORKSPACE_CHAT;
  delete process.env.WORKSPACE_CHAT_MODEL;
  delete process.env.AI_MODEL_DEFAULT_FAST;
  delete process.env.AI_MODEL_DEFAULT_QUALITY;
  assert.equal(resolveModelForTask('workspace_chat'), 'gpt-5-mini');
  assert.equal(resolveModelForTask('workspace_chat_writer'), 'gpt-5.2');

  process.env.AI_MODEL_WORKSPACE_CHAT = 'gpt-4.1-mini';
  assert.equal(resolveModelForTask('workspace_chat'), 'gpt-4.1-mini');

  delete process.env.AI_MODEL_WORKSPACE_CHAT;
  delete process.env.AI_MODEL_WORKSPACE_CHAT_WRITER;
  process.env.AI_ALLOW_LEGACY_CHAT_MODEL_FALLBACK = 'false';
  process.env.WORKSPACE_CHAT_MODEL = 'gpt-4o-mini-custom';
  assert.equal(resolveModelForTask('workspace_chat'), 'gpt-4o-mini-custom');
  assert.equal(resolveModelForTask('workspace_chat_writer'), 'gpt-5.2');

  resetEnv();
  process.env.AI_ENABLE_LEGACY_MODEL_REMAPPING = 'true';
  process.env.AI_MODEL_ANALYSIS_QUALITY = 'gpt-4.1';
  assert.equal(resolveModelFromLegacy('gpt-4o'), 'gpt-4.1');

  process.env.AI_ENABLE_LEGACY_MODEL_REMAPPING = 'false';
  assert.equal(resolveModelFromLegacy('gpt-4o'), 'gpt-4o');

  delete process.env.AI_MODEL_ANALYSIS_QUALITY;
  process.env.AI_ENABLE_LEGACY_MODEL_REMAPPING = 'true';
  process.env.AI_MODEL_DEFAULT_QUALITY = 'gpt-4.1';
  assert.equal(resolveModelFromLegacy('gpt-4o'), 'gpt-4.1');

  process.env.AI_MODEL_DEFAULT_FAST = 'gpt-4.1-mini';
  assert.equal(resolveModelFromLegacy('gpt-4o-mini'), 'gpt-4.1-mini');

  process.env.AI_MODEL_WORKSPACE_CHAT_WRITER = 'gpt-5.2';
  process.env.AI_MODEL_WORKSPACE_CHAT_WRITER_FALLBACKS = 'gpt-5-mini,gpt-4o-mini';
  const writerFallbacks = resolveFallbackModelsForTask('workspace_chat_writer', 'gpt-5.2');
  assert.deepEqual(writerFallbacks.slice(0, 2), ['gpt-5-mini', 'gpt-4o-mini']);

  assert.equal(resolveModelFromLegacy('custom-model', 'analysis_fast'), 'custom-model');

  console.log('model-router tests passed');
} finally {
  resetEnv();
}
