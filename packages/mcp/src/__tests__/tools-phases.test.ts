import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools } from '../tools.js';
import { MockServer, caller, createCallerProxy, TEST_PROJECT_PATH, setupTestEnv, teardownTestEnv } from './test-utils.js';

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

test('MCP Tools - Phases CRUD', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Create
  const createResult = await server.callTool('create_phase', {
    projectPath: TEST_PROJECT_PATH,
    name: 'Test Phase',
    from: 1000,
    to: 2000
  });
  const phaseId = JSON.parse(createResult.content[0].text).id;

  let phases = await caller.phase.list({ projectPath: TEST_PROJECT_PATH, all: true });
  assert.equal(phases.length, 1);
  assert.equal(phases[0].id, phaseId);

  // 2. Update
  await server.callTool('update_phase', {
    projectPath: TEST_PROJECT_PATH,
    phaseId: phaseId,
    name: 'Updated Phase',
    to: 3000
  });

  const updatedPhase = await caller.phase.get({ projectPath: TEST_PROJECT_PATH, phaseId });
  assert.equal(updatedPhase.name, 'Updated Phase');
  assert.equal(updatedPhase.to, 3000);

  // 3. Delete
  await server.callTool('delete_phase', { projectPath: TEST_PROJECT_PATH, phaseId });
  phases = await caller.phase.list({ projectPath: TEST_PROJECT_PATH, all: true });
  assert.equal(phases.length, 0);
});

test('MCP Tools - Phase Commitments', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const phase = await caller.phase.create({
    projectPath: TEST_PROJECT_PATH,
    phase: { name: 'P1', from: 0, to: 1000 }
  });

  const aim = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'Aim', status: { state: 'open', comment: '', date: Date.now() } }
  });

  // 1. Commit
  await server.callTool('commit_aim_to_phase', {
    projectPath: TEST_PROJECT_PATH,
    aimId: aim.id,
    phaseId: phase.id
  });

  let fetchedPhase = await caller.phase.get({ projectPath: TEST_PROJECT_PATH, phaseId: phase.id });
  assert.ok(fetchedPhase.commitments.includes(aim.id));

  let fetchedAim = await caller.aim.get({ projectPath: TEST_PROJECT_PATH, aimId: aim.id });
  assert.ok(fetchedAim.committedIn.includes(phase.id));

  // 2. Remove
  await server.callTool('remove_aim_from_phase', {
    projectPath: TEST_PROJECT_PATH,
    aimId: aim.id,
    phaseId: phase.id
  });

  fetchedPhase = await caller.phase.get({ projectPath: TEST_PROJECT_PATH, phaseId: phase.id });
  assert.ok(!fetchedPhase.commitments.includes(aim.id));
});
