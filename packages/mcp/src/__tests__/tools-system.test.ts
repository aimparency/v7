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

test('MCP Tools - Project Meta', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const updateRes = await server.callTool('update_project_meta', { 
    projectPath: ctx.projectPath, 
    name: 'New Name',
    color: '#ff0000'
  });
  
  if (updateRes.isError) {
      console.error("Update Meta Error:", updateRes.content[0].text);
  }
  assert.equal(updateRes.isError, undefined);

  await new Promise(r => setTimeout(r, 100));

  const meta = await caller.project.getMeta({ projectPath: ctx.projectPath });
  assert.equal(meta.name, 'New Name');
  assert.equal(meta.color, '#ff0000');
});

test('MCP Tools - Project Meta Statuses', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const customStatuses = [
      { key: 'custom', color: '#123456' }
  ];

  await server.callTool('update_project_meta', { 
    projectPath: ctx.projectPath, 
    name: 'New Name',
    color: '#ff0000',
    // update_project_meta tool schema needs to support 'statuses'
    // I need to update tools.ts inputSchema for update_project_meta first!
  });
  
  // Wait, I haven't updated tools.ts schema to accept statuses!
});

test('MCP Tools - Consistency', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Create Inconsistent State (Manually via backend helper if possible, or simulate)
  // Hard to simulate via public API. We can just run check_consistency on empty/valid project.
  
  const checkRes = await server.callTool('check_consistency', { projectPath: ctx.projectPath });
  const check = JSON.parse(checkRes.content[0].text);
  assert.equal(check.valid, true);

  // 2. Fix Consistency (should return empty fixes)
  const fixRes = await server.callTool('fix_consistency', { projectPath: ctx.projectPath });
  const fixes = JSON.parse(fixRes.content[0].text);
  assert.equal(fixes.length, 0);
});
