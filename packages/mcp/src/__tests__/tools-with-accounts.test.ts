import { test } from 'node:test';
import assert from 'node:assert';
import { TOOLS } from '../tools/catalog.js';
import { availableTools, toolForGraph } from '../tools/index.js';

// The hook tools write into a repository without asking the backend, so its
// access checks never see them: a server with accounts must not offer them.
test('the MCP server of a server with accounts leaves out the tools that touch the files directly', () => {
  const withAccounts = availableTools(true).map((tool) => tool.name);
  assert.ok(!withAccounts.includes('enable_continue_hook'));
  assert.ok(!withAccounts.includes('disable_continue_hook'));
  assert.equal(withAccounts.length, TOOLS.length - 2);
  assert.ok(availableTools(false).some((tool) => tool.name === 'enable_continue_hook'));
});

test('a session for one graph needs no projectPath in its tools', () => {
  const tool = TOOLS.find((candidate) => candidate.name === 'get_idea')!;
  assert.deepEqual(toolForGraph(tool, undefined).inputSchema.required, ['projectPath', 'ideaId']);
  const bound = toolForGraph(tool, 'hack-the-hub');
  assert.deepEqual(bound.inputSchema.required, ['ideaId']);
  assert.match(String((bound.inputSchema.properties!.projectPath as { description: string }).description), /hack-the-hub/);
  assert.deepEqual(tool.inputSchema.required, ['projectPath', 'ideaId'], 'the shared definition is untouched');
});
