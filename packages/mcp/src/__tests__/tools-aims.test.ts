import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools } from '../tools.js';
import { MockServer, caller, createCallerProxy, TEST_PROJECT_PATH, setupTestEnv, teardownTestEnv } from './test-utils.js';

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

test('MCP Tools - Aims CRUD', async (t) => {
  try {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Create
  await server.callTool('create_aim', { 
    projectPath: TEST_PROJECT_PATH, 
    text: 'MCP Aim',
    tags: ['test']
  });

  let aims = await caller.aim.list({ projectPath: TEST_PROJECT_PATH });
  assert.equal(aims.length, 1);
  const aimId = aims[0].id;
  assert.equal(aims[0].text, 'MCP Aim');

  // 2. Update
  await server.callTool('update_aim', {
    projectPath: TEST_PROJECT_PATH,
    aimId: aimId,
    text: 'Updated MCP Aim',
    status: { state: 'done' }
  });

  const updatedAim = await caller.aim.get({ projectPath: TEST_PROJECT_PATH, aimId });
  assert.equal(updatedAim.text, 'Updated MCP Aim');
  assert.equal(updatedAim.status.state, 'done');

  // 3. Get
  const getResult = await server.callTool('get_aim', { projectPath: TEST_PROJECT_PATH, aimId });
  const fetchedAim = JSON.parse(getResult.content[0].text);
  assert.equal(fetchedAim.id, aimId);

  // 4. Delete
  await server.callTool('delete_aim', { projectPath: TEST_PROJECT_PATH, aimId });
  aims = await caller.aim.list({ projectPath: TEST_PROJECT_PATH });
  assert.equal(aims.length, 0);
  } catch (e) {
      console.error("Test Failed:", e);
      throw e;
  }
});

test('MCP Tools - list_phase_aims_recursive', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const phase = await caller.phase.create({
    projectPath: TEST_PROJECT_PATH,
    phase: { name: 'P1', from: 0, to: 1000 }
  });

  const parent = await caller.aim.createAimInPhase({
    projectPath: TEST_PROJECT_PATH,
    phaseId: phase.id,
    aim: { text: 'Parent', status: { state: 'open', comment: '', date: Date.now() } },
    insertionIndex: 0
  });

  await caller.aim.createSubAim({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parent.id,
    aim: { text: 'Child', status: { state: 'open', comment: '', date: Date.now() } },
    positionInParent: 0
  });

  const result = await server.callTool('list_phase_aims_recursive', { 
    projectPath: TEST_PROJECT_PATH, 
    phaseId: phase.id 
  });
  
  const tree = JSON.parse(result.content[0].text);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
});
