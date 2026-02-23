import assert from 'node:assert/strict';
import { resolveModelForTask, resolveModelFromLegacy } from '../services/ai/model-router';

const snapshot = { ...process.env };

function resetEnv() {
  process.env = { ...snapshot };
}

try {
  resetEnv();
  delete process.env.AI_MODEL_WORKSPACE_CHAT;
  delete process.env.WORKSPACE_CHAT_MODEL;
  assert.equal(resolveModelForTask('workspace_chat'), 'gpt-4o-mini');

  process.env.AI_MODEL_WORKSPACE_CHAT = 'gpt-4.1-mini';
  assert.equal(resolveModelForTask('workspace_chat'), 'gpt-4.1-mini');

  delete process.env.AI_MODEL_WORKSPACE_CHAT;
  process.env.WORKSPACE_CHAT_MODEL = 'gpt-4o-mini-custom';
  assert.equal(resolveModelForTask('workspace_chat'), 'gpt-4o-mini-custom');

  resetEnv();
  process.env.AI_MODEL_ANALYSIS_QUALITY = 'gpt-4.1';
  assert.equal(resolveModelFromLegacy('gpt-4o'), 'gpt-4.1');

  delete process.env.AI_MODEL_ANALYSIS_QUALITY;
  process.env.AI_MODEL_DEFAULT_QUALITY = 'gpt-4.1';
  assert.equal(resolveModelFromLegacy('gpt-4o'), 'gpt-4.1');

  process.env.AI_MODEL_DEFAULT_FAST = 'gpt-4.1-mini';
  assert.equal(resolveModelFromLegacy('gpt-4o-mini'), 'gpt-4.1-mini');

  assert.equal(resolveModelFromLegacy('custom-model', 'analysis_fast'), 'custom-model');

  console.log('model-router tests passed');
} finally {
  resetEnv();
}
