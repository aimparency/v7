import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools } from '../tools.js';
import { MockServer, caller, createCallerProxy, TEST_PROJECT_PATH, setupTestEnv, teardownTestEnv } from './test-utils.js';

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

test('MCP Tools - System Status & Work', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Get Status
  const statusRes = await server.callTool('get_system_status', { projectPath: TEST_PROJECT_PATH });
  const status = JSON.parse(statusRes.content[0].text);
  assert.equal(typeof status.computeCredits, 'number');

  // 2. Perform Work
  const workRes = await server.callTool('perform_work', { projectPath: TEST_PROJECT_PATH, workType: 'mining' });
  const workStatus = JSON.parse(workRes.content[0].text);
  assert.ok(workStatus.computeCredits > status.computeCredits);
});

test('MCP Tools - Project Meta', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await server.callTool('update_project_meta', { 
    projectPath: TEST_PROJECT_PATH, 
    name: 'New Name',
    color: '#ff0000'
  });

  const meta = await caller.project.getMeta({ projectPath: TEST_PROJECT_PATH });
  assert.equal(meta.name, 'New Name');
  assert.equal(meta.color, '#ff0000');
});

test('MCP Tools - Consistency', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Create Inconsistent State (Manually via backend helper if possible, or simulate)
  // Hard to simulate via public API. We can just run check_consistency on empty/valid project.
  
  const checkRes = await server.callTool('check_consistency', { projectPath: TEST_PROJECT_PATH });
  const check = JSON.parse(checkRes.content[0].text);
  assert.equal(check.valid, true);

  // 2. Fix Consistency (should return empty fixes)
  const fixRes = await server.callTool('fix_consistency', { projectPath: TEST_PROJECT_PATH });
  const fixes = JSON.parse(fixRes.content[0].text);
  assert.equal(fixes.length, 0);
});
