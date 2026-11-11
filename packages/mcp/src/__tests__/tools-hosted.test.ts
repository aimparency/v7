import { test } from 'node:test';
import assert from 'node:assert';
import { TOOLS } from '../tools/catalog.js';
import { availableTools } from '../tools/index.js';

// The hook tools write into a repository without asking the backend, so its
// access checks never see them: a hosted instance must not offer them.
test('a hosted MCP server leaves out the tools that touch the files directly', () => {
  const hosted = availableTools(true).map((tool) => tool.name);
  assert.ok(!hosted.includes('enable_continue_hook'));
  assert.ok(!hosted.includes('disable_continue_hook'));
  assert.equal(hosted.length, TOOLS.length - 2);
  assert.ok(availableTools(false).some((tool) => tool.name === 'enable_continue_hook'));
});
