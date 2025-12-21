import { test, beforeEach, afterEach, after } from 'node:test';
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

after(() => process.exit(0));

test('MCP Tools - System Status & Work', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Get Status
  const statusRes = await server.callTool('get_system_status', { projectPath: ctx.projectPath });
  const status = JSON.parse(statusRes.content[0].text);
  assert.equal(typeof status.computeCredits, 'number');

  // 2. Perform Work
  const workRes = await server.callTool('perform_work', { projectPath: ctx.projectPath, workType: 'mining' });
  assert.ok(workRes.content[0].text.includes('Work completed successfully'));
  
  // Verify status updated
  const newStatusRes = await server.callTool('get_system_status', { projectPath: ctx.projectPath });
  const newStatus = JSON.parse(newStatusRes.content[0].text);
  assert.ok(newStatus.computeCredits > status.computeCredits);
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
