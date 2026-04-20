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

test('MCP Tools - Phases CRUD', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Create
  const createResult = await server.callTool('create_phase', {
    projectPath: ctx.projectPath,
    name: 'Test Phase',
    from: 1000,
    to: 2000
  });
  // Output: "Created phase with ID: <uuid>"
  const phaseId = createResult.content[0].text.split('ID: ')[1];
  assert.ok(phaseId, 'Phase ID not found in output');

  let phases = await caller.phase.list({ projectPath: ctx.projectPath, all: true });
  assert.equal(phases.length, 1);
  assert.equal(phases[0].id, phaseId);

  // 2. Update
  await server.callTool('update_phase', {
    projectPath: ctx.projectPath,
    phaseId: phaseId,
    name: 'Updated Phase',
    to: 3000
  });

  const updatedPhase = await caller.phase.get({ projectPath: ctx.projectPath, phaseId });
  assert.equal(updatedPhase.name, 'Updated Phase');
  assert.equal(updatedPhase.to, 3000);

  // 3. Delete
  await server.callTool('delete_phase', { projectPath: ctx.projectPath, phaseId });
  phases = await caller.phase.list({ projectPath: ctx.projectPath, all: true });
  assert.equal(phases.length, 0);
});

test('MCP Tools - Phase Commitments', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const phase = await caller.phase.create({
    projectPath: ctx.projectPath,
    phase: { name: 'P1', from: 0, to: 1000 }
  });

  const aim = await caller.aim.createFloatingAim({
    projectPath: ctx.projectPath,
    aim: { text: 'Aim', status: { state: 'open', comment: '', date: Date.now() } }
  });

  // 1. Commit
  await server.callTool('commit_aim_to_phase', {
    projectPath: ctx.projectPath,
    aimId: aim.id,
    phaseId: phase.id
  });

  let fetchedPhase = await caller.phase.get({ projectPath: ctx.projectPath, phaseId: phase.id });
  assert.ok(fetchedPhase.commitments.includes(aim.id));

  let fetchedAim = await caller.aim.get({ projectPath: ctx.projectPath, aimId: aim.id });
  assert.ok(fetchedAim.committedIn.includes(phase.id));

  // 2. Remove
  await server.callTool('remove_aim_from_phase', {
    projectPath: ctx.projectPath,
    aimId: aim.id,
    phaseId: phase.id
  });

  fetchedPhase = await caller.phase.get({ projectPath: ctx.projectPath, phaseId: phase.id });
  assert.ok(!fetchedPhase.commitments.includes(aim.id));
});
