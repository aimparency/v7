import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerResources } from '../resources.js';
import { MockServer, caller, createCallerProxy, TEST_PROJECT_PATH, setupTestEnv, teardownTestEnv } from './test-utils.js';

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

test('MCP Resources - List & Read', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerResources(server as any, callerProxy as any);

  // 1. Create Data
  const aim = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'Resource Aim', status: { state: 'open', comment: '', date: Date.now() } }
  });

  // 2. List Resources (should return templates)
  const listRes = await server.listResources();
  assert.ok(listRes.resources.length > 0);
  
  const aimTemplate = listRes.resources.find((r: any) => r.uri.startsWith('aim://{uuid}'));
  assert.ok(aimTemplate, 'Aim template not found in list');

  // 3. Read Aim Resource
  // URI format: aim://{uuid}?projectPath=...
  const aimUri = `aim://${aim.id}?projectPath=${encodeURIComponent(TEST_PROJECT_PATH)}`;
  const readAim = await server.readResource(aimUri);
  
  const aimContent = JSON.parse(readAim.contents[0].text);
  assert.equal(aimContent.text, 'Resource Aim');
});
