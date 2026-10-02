import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools } from '../tools.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(async () => {
  ctx = createTestContext();
  await ctx.setup();
});

afterEach(async () => {
  await ctx.teardown();
});

test('MCP Tools - Search', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await caller.idea.createFloatingAim({
    projectPath: ctx.projectPath,
    idea: { text: 'Find Me', status: { state: 'open', comment: '', date: Date.now() } }
  });

  await caller.phase.create({
    projectPath: ctx.projectPath,
    phase: { name: 'Search Phase', from: 0, to: 1000 }
  });

  // 1. Build Index (optional now, but good to test)
  await server.callTool('build_search_index', { projectPath: ctx.projectPath });

  // 2. Search Ideas
  const ideaRes = await server.callTool('search_ideas', { projectPath: ctx.projectPath, query: 'Find' });
  const ideas = JSON.parse(ideaRes.content[0].text);
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].text, 'Find Me');

  // 3. Search Phases
  const phaseRes = await server.callTool('search_phases', { projectPath: ctx.projectPath, query: 'Search' });
  const phases = JSON.parse(phaseRes.content[0].text);
  assert.equal(phases.length, 1);
  assert.equal(phases[0].name, 'Search Phase');
});
