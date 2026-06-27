import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools, countAimReferences, verificationHintForAim } from '../tools.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(async () => {
  ctx = createTestContext();
  await ctx.setup();
});

afterEach(async () => {
  await ctx.teardown();
});

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

test('MCP Tools - update_aim nudges to verify when marking done without a reflection', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await server.callTool('create_aim', { projectPath: ctx.projectPath, text: 'Verify me' });
  const aimId = (await caller.aim.list({ projectPath: ctx.projectPath }))[0].id;

  // Done without a reflection -> nudge.
  const noReflection = await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    status: { state: 'done' },
  });
  assert.match(noReflection.content[0].text, /verified-done/, 'nudges when done without reflection');

  // Add a reflection, then mark done again -> no nudge.
  await server.callTool('addReflection', {
    projectPath: ctx.projectPath,
    aimId,
    reflection: {
      context: 'c', outcome: 'o', effectiveness: 'e', lesson: 'l',
    },
  });
  const withReflection = await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    status: { state: 'done' },
  });
  assert.doesNotMatch(withReflection.content[0].text, /verified-done/, 'no nudge once a reflection exists');

  // Non-done updates never nudge.
  const openUpdate = await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    status: { state: 'open' },
  });
  assert.doesNotMatch(openUpdate.content[0].text, /verified-done/, 'no nudge on non-done updates');
});

test('MCP Tools - verificationHintForAim tailors evidence to aim type', () => {
  // UI/visual takes precedence — a visual change is best proven by seeing it run.
  assert.match(verificationHintForAim({ text: 'Fix select dropdown flicker' }), /screenshot|interaction/);
  assert.match(verificationHintForAim({ text: 'feature', tags: ['ui'] }), /screenshot|interaction/);
  // Bugfix/behavior -> a passing repro.
  assert.match(verificationHintForAim({ text: 'Bug: watchdog connects to wrong project' }), /repro/);
  // Code/backend -> tests + typecheck.
  assert.match(verificationHintForAim({ text: 'Implement the spin-off backend endpoint' }), /typecheck/);
  // Unknown -> generic fallback still asks for concrete evidence.
  assert.match(verificationHintForAim({ text: 'Negotiate partnership' }), /tests|repro|screenshot/);
  assert.match(verificationHintForAim(null), /tests|repro|screenshot/);
});

test('MCP Tools - done nudge surfaces the type-specific evidence hint', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await server.callTool('create_aim', { projectPath: ctx.projectPath, text: 'Fix the modal flicker bug', tags: ['ui'] });
  const aimId = (await caller.aim.list({ projectPath: ctx.projectPath }))[0].id;

  const res = await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    status: { state: 'done' },
  });
  assert.match(res.content[0].text, /screenshot|interaction/, 'UI aim nudge asks for a screenshot/interaction proof');
});

test('MCP Tools - list_aims uncommitted surfaces parented-but-unphased aims that floating misses', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];

  // A: no phase, no parent -> floating AND uncommitted.
  const a = idOf(await server.callTool('create_aim', { projectPath: ctx.projectPath, text: 'orphan' }));
  // B: committed to a phase.
  const phase = await caller.phase.create({ projectPath: ctx.projectPath, phase: { name: 'P', from: 0, to: 1000 } });
  const b = idOf(await server.callTool('create_aim', { projectPath: ctx.projectPath, text: 'phased', phaseId: phase.id }));
  // C: has a parent (B) but no phase -> uncommitted but NOT floating (the invisible class).
  const c = idOf(await server.callTool('create_aim', { projectPath: ctx.projectPath, text: 'connected-unphased', supportedAims: [b] }));

  const uncommitted = JSON.parse((await server.callTool('list_aims', {
    projectPath: ctx.projectPath, status: 'open', uncommitted: true,
  })).content[0].text).map((x: any) => x.id);
  assert.ok(uncommitted.includes(a), 'uncommitted includes the orphan');
  assert.ok(uncommitted.includes(c), 'uncommitted includes the connected-but-unphased aim');
  assert.ok(!uncommitted.includes(b), 'uncommitted excludes the phased aim');

  const floating = JSON.parse((await server.callTool('list_aims', {
    projectPath: ctx.projectPath, floating: true,
  })).content[0].text).map((x: any) => x.id);
  assert.ok(floating.includes(a), 'floating includes the orphan');
  assert.ok(!floating.includes(c), 'floating MISSES the connected-but-unphased aim (the discoverability gap)');
});

test('countAimReferences counts commits referencing an aim id prefix (realized-cost signal)', () => {
  const ids = [
    'de22b7f3-ad77-4bcc-bd9f-aabbccddeeff', // referenced twice
    'b03ad58e-4518-4a35-9a35-36f58ee9b001', // referenced once
    '0622adb1-e79d-4837-b894-199d92ca199d', // not referenced
  ];
  const commits = [
    'feat(supervisor): real reflection (de22b7f3, approach B)\n\nbody text',
    'chore(graph): split b03ad58e; also touched de22b7f3 followup',
    'unrelated cleanup commit with no aim id',
  ];
  const counts = countAimReferences(commits, ids);
  assert.equal(counts.get(ids[0]), 2, 'de22b7f3 referenced in two commits');
  assert.equal(counts.get(ids[1]), 1, 'b03ad58e referenced once');
  assert.equal(counts.get(ids[2]) ?? 0, 0, 'unreferenced aim has zero');
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
