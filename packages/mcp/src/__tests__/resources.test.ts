import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerResources } from '../resources.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(async () => {
  ctx = createTestContext();
  await ctx.setup();
});

afterEach(async () => {
  await ctx.teardown();
});

test('MCP Resources - List & Read', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerResources(server as any, callerProxy as any);

  // 1. Create Data
  const idea = await caller.idea.createFloatingIdea({
    projectPath: ctx.projectPath,
    idea: { text: 'Resource Idea', status: { state: 'open', comment: '', date: Date.now() } }
  });

  // 2. List Resources (should return templates)
  const listRes = await server.listResources();
  assert.ok(listRes.resources.length > 0);
  
  const ideaTemplate = listRes.resources.find((r: any) => r.uri.startsWith('idea://{uuid}'));
  assert.ok(ideaTemplate, 'Idea template not found in list');

  // 3. Read Idea Resource
  // URI format: idea://{uuid}?projectPath=...
  const ideaUri = `idea://${idea.id}?projectPath=${encodeURIComponent(ctx.projectPath)}`;
  const readIdea = await server.readResource(ideaUri);
  
  const ideaContent = JSON.parse(readIdea.contents[0].text);
  assert.equal(ideaContent.text, 'Resource Idea');
});
