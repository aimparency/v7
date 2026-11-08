import assert from 'node:assert/strict';
import test from 'node:test';
import type { LoopDefinition } from 'agent-tools';
import { createRoleModels, roleModelSpec } from './models.js';

const loop = {
  provider: 'nvidia',
  model: 'z-ai/glm-5.2',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  roles: {
    verifier: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    planner: { provider: 'openrouter', model: 'cheap/planner' }
  }
} as unknown as LoopDefinition;

test('an unset role runs on the loop model, a set role on its own provider with its default endpoint', () => {
  assert.deepEqual(roleModelSpec(loop, 'executor'), { provider: 'nvidia', model: 'z-ai/glm-5.2', baseUrl: 'https://integrate.api.nvidia.com/v1' });
  assert.deepEqual(roleModelSpec(loop, 'verifier'), { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1' });
  assert.equal(roleModelSpec(loop, 'planner').baseUrl, 'https://openrouter.ai/api/v1');
  const custom = { ...loop, roles: { reflector: { provider: 'openai-compatible', model: 'local' } } } as unknown as LoopDefinition;
  assert.throws(() => roleModelSpec(custom, 'reflector'), /needs a baseUrl/);
});

test('every role gets a model up front, and a missing key names the role and the secret', () => {
  const models = createRoleModels(loop, { NVIDIA_API_KEY: 'n', OPENROUTER_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' });
  assert.equal(models.verifier.spec.provider, 'anthropic');
  assert.equal((models.verifier.model as { modelId: string }).modelId, 'claude-sonnet-5-5');
  assert.throws(() => createRoleModels(loop, { NVIDIA_API_KEY: 'n', OPENROUTER_API_KEY: 'o' }), /Missing ANTHROPIC_API_KEY for the verifier role/);
});
