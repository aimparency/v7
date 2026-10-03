import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'fs-extra';
import { registerTools } from '../tools/index.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(async () => {
  ctx = createTestContext();
  await ctx.setup();
});

afterEach(async () => {
  await ctx.teardown();
});

test('MCP Tools - Removed system/market tools are not exposed', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const list = await server.listTools();
  const names = list.tools.map((tool: any) => tool.name);

  assert.ok(!names.includes('perform_work'));
  assert.ok(!names.includes('update_system_status'));
  assert.ok(!names.includes('update_market_config'));
});

test('MCP Tools - Consistency', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);
  const call = async (name: string) =>
    JSON.parse((await server.callTool(name, { projectPath: ctx.projectPath })).content[0].text);

  const idea = await caller.idea.createFloatingIdea({
    projectPath: ctx.projectPath,
    idea: { text: 'Idea', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const clean = await call('check_consistency');
  assert.equal(clean.valid, true);
  assert.deepEqual((await call('fix_consistency')).fixes, []);

  // Break it on disk: the idea claims a phase that does not exist.
  const ideaFile = path.join(ctx.projectPath, 'ideas', `${idea.id}.json`);
  const stored = await fs.readJson(ideaFile);
  stored.committedIn = ['00000000-0000-4000-8000-000000000000'];
  await fs.writeJson(ideaFile, stored);

  const broken = await call('check_consistency');
  assert.equal(broken.valid, false);
  assert.deepEqual(broken.issues.map((issue: any) => issue.code), ['idea_nonexistent_phase']);

  const fixed = await call('fix_consistency');
  assert.equal(fixed.success, true);
  assert.equal(fixed.fixes.length, 1);

  assert.equal((await call('check_consistency')).valid, true);
  assert.deepEqual((await fs.readJson(ideaFile)).committedIn, []);
});
