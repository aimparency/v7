import assert from 'node:assert/strict';
import test from 'node:test';
import { filterToolsByCapabilities } from './capabilities.js';

test('keeps core tools and loads only enabled capability packs', () => {
  const tools = {
    get_aim_context: 1,
    list_files: 2,
    experiment: 3,
    code_intelligence: 4
  };
  assert.deepEqual(filterToolsByCapabilities(tools, ['experiments']), {
    get_aim_context: 1,
    experiment: 3
  });
  assert.deepEqual(filterToolsByCapabilities(tools, []), {
    get_aim_context: 1
  });
});
