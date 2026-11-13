import { test } from 'node:test';
import assert from 'node:assert';
import { TOOLS } from '../tools/catalog.js';
import { availableTools } from '../tools/index.js';

// The hook tools write into a repository without asking the backend, so its
// access checks never see them: a server with accounts must not offer them.
test('the MCP server of a server with accounts leaves out the tools that touch the files directly', () => {
  const withAccounts = availableTools(true).map((tool) => tool.name);
  assert.ok(!withAccounts.includes('enable_continue_hook'));
  assert.ok(!withAccounts.includes('disable_continue_hook'));
  assert.equal(withAccounts.length, TOOLS.length - 2);
  assert.ok(availableTools(false).some((tool) => tool.name === 'enable_continue_hook'));
});
