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

test('MCP Tools - Aims CRUD', async (t) => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Create
  await server.callTool('create_aim', { 
    projectPath: ctx.projectPath, 
    text: 'MCP Aim',
    tags: ['test']
  });

  let aims = await caller.aim.list({ projectPath: ctx.projectPath });
  assert.equal(aims.length, 1);
  const aimId = aims[0].id;
  assert.equal(aims[0].text, 'MCP Aim');

  // 2. Update
  await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId: aimId,
    text: 'Updated MCP Aim',
    status: { state: 'done' }
  });

  const updatedAim = await caller.aim.get({ projectPath: ctx.projectPath, aimId });
  assert.equal(updatedAim.text, 'Updated MCP Aim');
  assert.equal(updatedAim.status.state, 'done');

  // 3. Get
  const getResult = await server.callTool('get_aim', { projectPath: ctx.projectPath, aimId });
  const fetchedAim = JSON.parse(getResult.content[0].text);
  assert.equal(fetchedAim.id, aimId);

  // 4. Delete
  await server.callTool('delete_aim', { projectPath: ctx.projectPath, aimId });
  aims = await caller.aim.list({ projectPath: ctx.projectPath });
  assert.equal(aims.length, 0);
});

test('MCP Tools - list_phase_aims_recursive', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const phase = await caller.phase.create({
    projectPath: ctx.projectPath,
    phase: { name: 'P1', from: 0, to: 1000 }
  });

  const parent = await caller.aim.createAimInPhase({
    projectPath: ctx.projectPath,
    phaseId: phase.id,
    aim: { text: 'Parent', status: { state: 'open', comment: '', date: Date.now() } },
    insertionIndex: 0
  });

  await caller.aim.createSubAim({
    projectPath: ctx.projectPath,
    parentAimId: parent.id,
    aim: { text: 'Child', status: { state: 'open', comment: '', date: Date.now() } },
    positionInParent: 0
  });

  const result = await server.callTool('list_phase_aims_recursive', { 
    projectPath: ctx.projectPath, 
    phaseId: phase.id 
  });
  
  const tree = JSON.parse(result.content[0].text);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
});
