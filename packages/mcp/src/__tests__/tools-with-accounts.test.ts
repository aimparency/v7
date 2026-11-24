import { test } from 'node:test';
import assert from 'node:assert';
import { TOOLS } from '../tools/catalog.js';
import { argumentsWithSpace, availableTools, toolForSpace } from '../tools/index.js';

// The hook tools write into a repository without asking the backend, so its
// access checks never see them: a server with accounts must not offer them.
test('the MCP server of a server with accounts leaves out the tools that touch the files directly', () => {
  const withAccounts = availableTools(true).map((tool) => tool.name);
  assert.ok(!withAccounts.includes('enable_continue_hook'));
  assert.ok(!withAccounts.includes('disable_continue_hook'));
  assert.equal(withAccounts.length, TOOLS.length - 2);
  assert.ok(availableTools(false).some((tool) => tool.name === 'enable_continue_hook'));
});

test('a session for one space needs no space in its tool calls', () => {
  const tool = TOOLS.find((candidate) => candidate.name === 'get_idea')!;
  assert.deepEqual(toolForSpace(tool, undefined).inputSchema.required, ['space', 'ideaId']);
  const bound = toolForSpace(tool, 'hack-the-hub');
  assert.deepEqual(bound.inputSchema.required, ['ideaId']);
  assert.match(String((bound.inputSchema.properties!.space as { description: string }).description), /hack-the-hub/);
  assert.deepEqual(tool.inputSchema.required, ['space', 'ideaId'], 'the shared definition is untouched');
});

test('a call names its space with `space`, else it works on the session\'s', () => {
  assert.deepEqual(argumentsWithSpace({ space: 'mine', ideaId: 'x' }, undefined), { space: 'mine', ideaId: 'x' });
  assert.deepEqual(argumentsWithSpace({ ideaId: 'x' }, 'hack-the-hub'), { ideaId: 'x', space: 'hack-the-hub' });
  assert.deepEqual(argumentsWithSpace({ space: 'other', ideaId: 'x' }, 'hack-the-hub'), { space: 'other', ideaId: 'x' });
  assert.deepEqual(argumentsWithSpace({ agent: 'claude' }, undefined), { agent: 'claude' });
});
