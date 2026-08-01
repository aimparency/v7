import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools, countAimReferences, verificationHintForAim } from '../tools.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

let ctx: ReturnType<typeof createTestContext>;

async function createAim(server: MockServer, args: Record<string, unknown>) {
  const review = await server.callTool('create_aim', args);
  const confirmationToken = JSON.parse(review.content[0].text).confirmationToken;
  assert.ok(confirmationToken, 'create_aim review returns a confirmation token');
  return await server.callTool('create_aim', { ...args, confirmationToken });
}

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
  await createAim(server, {
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

test('get_aim_context returns every distinct root path while preserving the highest-value path', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  await createAim(server, { projectPath: ctx.projectPath, text: 'Root A', intrinsicValue: 10 });
  await createAim(server, { projectPath: ctx.projectPath, text: 'Root B', intrinsicValue: 5 });
  const roots = await caller.aim.list({ projectPath: ctx.projectPath });
  const rootA = roots.find((aim) => aim.text === 'Root A')!;
  const rootB = roots.find((aim) => aim.text === 'Root B')!;

  await createAim(server, {
    projectPath: ctx.projectPath,
    text: 'Middle',
    supportedAims: [rootA.id, rootB.id],
  });
  const middle = (await caller.aim.list({ projectPath: ctx.projectPath }))
    .find((aim) => aim.text === 'Middle')!;
  await createAim(server, {
    projectPath: ctx.projectPath,
    text: 'Leaf',
    supportedAims: [middle.id, rootB.id],
  });
  const leaf = (await caller.aim.list({ projectPath: ctx.projectPath }))
    .find((aim) => aim.text === 'Leaf')!;

  const result = await server.callTool('get_aim_context', {
    projectPath: ctx.projectPath,
    aimId: leaf.id,
  });
  const payload = JSON.parse(result.content[0].text);
  const paths = payload.paths_to_root.map((path: any[]) => path.map((aim) => aim.text));

  assert.deepEqual(paths, [
    ['Root A', 'Middle'],
    ['Root B', 'Middle'],
    ['Root B'],
  ]);
  assert.equal(payload.paths_to_root_truncated, false);
  assert.ok(Array.isArray(payload.path_to_root), 'backward-compatible highest-value path remains');
  assert.equal(payload.path_to_root.at(-1).text, 'Middle');
});

test('MCP Tools - create_aim requires review and surfaces cancelled context', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const cancelled = await caller.aim.createFloatingAim({
    projectPath: ctx.projectPath,
    aim: {
      text: 'Build explicit first-class workflow plans',
      status: {
        state: 'cancelled',
        comment: 'Rejected because contribution edges already express the relationship.',
      },
    },
  });
  const proposal = {
    projectPath: ctx.projectPath,
    text: 'Build explicit first-class workflow plans',
  };

  const review = await server.callTool('create_aim', proposal);
  const payload = JSON.parse(review.content[0].text);
  assert.equal(payload.created, false);
  assert.equal(payload.reviewRequired, true);
  assert.ok(payload.confirmationToken);
  assert.ok(
    payload.relatedAims.some((aim: any) =>
      aim.id === cancelled.id &&
      aim.status.state === 'cancelled' &&
      /contribution edges/.test(aim.status.comment)
    ),
    'cancelled aims and their rationale are included in creation context',
  );
  assert.equal((await caller.aim.list({ projectPath: ctx.projectPath })).length, 1);

  const mismatch = await server.callTool('create_aim', {
    ...proposal,
    confirmationToken: 'wrong-token',
  });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.content[0].text, /does not match this aim proposal/);
  assert.equal((await caller.aim.list({ projectPath: ctx.projectPath })).length, 1);

  const created = await server.callTool('create_aim', {
    ...proposal,
    confirmationToken: payload.confirmationToken,
  });
  assert.match(created.content[0].text, /Created aim with ID:/);
  assert.equal((await caller.aim.list({ projectPath: ctx.projectPath })).length, 2);
});

test('status date changes only on state transition; reviewedAt is independent', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const initialReview = 1_700_000_000_000;
  await createAim(server, {
    projectPath: ctx.projectPath,
    text: 'Long-standing intent',
    status: { state: 'open', reviewedAt: initialReview },
  });
  const created = (await caller.aim.list({ projectPath: ctx.projectPath }))[0];
  assert.equal(created.status.reviewedAt, initialReview, 'create path preserves an explicit review time');
  const transitionDate = created.status.date;
  const reviewedAt = transitionDate + 10_000;

  await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId: created.id,
    status: { state: 'open', comment: 'Still strategically relevant', reviewedAt },
  });
  const reviewed = await caller.aim.get({ projectPath: ctx.projectPath, aimId: created.id });
  assert.equal(reviewed.status.date, transitionDate, 'same-state review preserves transition time');
  assert.equal(reviewed.status.reviewedAt, reviewedAt);

  await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId: created.id,
    status: { state: 'partially' },
  });
  const transitioned = await caller.aim.get({ projectPath: ctx.projectPath, aimId: created.id });
  assert.equal(transitioned.status.state, 'partially');
  assert.ok(transitioned.status.date >= transitionDate, 'state transition advances transition time');
  assert.equal(transitioned.status.reviewedAt, reviewedAt, 'transition preserves the last explicit review');
});

test('MCP Tools - update_aim nudges to verify when marking done without a reflection', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await createAim(server, { projectPath: ctx.projectPath, text: 'Verify me' });
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

  await createAim(server, { projectPath: ctx.projectPath, text: 'Fix the modal flicker bug', tags: ['ui'] });
  const aimId = (await caller.aim.list({ projectPath: ctx.projectPath }))[0].id;

  const res = await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    status: { state: 'done' },
  });
  assert.match(res.content[0].text, /screenshot|interaction/, 'UI aim nudge asks for a screenshot/interaction proof');
});

test('MCP Tools - update_aim stores free-text reflection with status', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await createAim(server, { projectPath: ctx.projectPath, text: 'Reflectable aim' });
  const aimId = (await caller.aim.list({ projectPath: ctx.projectPath }))[0].id;

  const result = await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    status: { state: 'done' },
    reflection: 'Verified with the focused MCP aim test.',
  });

  const aim = await caller.aim.get({ projectPath: ctx.projectPath, aimId });
  assert.equal(aim.status.state, 'done');
  assert.equal(aim.reflection, 'Verified with the focused MCP aim test.');
  assert.doesNotMatch(result.content[0].text, /verified-done/, 'free-text reflection satisfies done evidence nudge');
});

test('MCP Tools - create_aim accepts edge metadata for parent and child links', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const parentId = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'Parent' }));
  const childId = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'Child' }));
  const aimId = idOf(await createAim(server, {
    projectPath: ctx.projectPath,
    text: 'Middle',
    supportedAims: [{ aimId: parentId, weight: 2, explanation: 'parent rationale' }],
    supportingConnections: [{ aimId: childId, weight: 3, explanation: 'child rationale' }],
  }));

  const parent = await caller.aim.get({ projectPath: ctx.projectPath, aimId: parentId });
  const middle = await caller.aim.get({ projectPath: ctx.projectPath, aimId });
  const child = await caller.aim.get({ projectPath: ctx.projectPath, aimId: childId });

  assert.equal(parent.supportingConnections.find((c: any) => c.aimId === aimId)?.weight, 2);
  assert.equal(parent.supportingConnections.find((c: any) => c.aimId === aimId)?.explanation, 'parent rationale');
  assert.equal(middle.supportingConnections.find((c: any) => c.aimId === childId)?.weight, 3);
  assert.equal(middle.supportingConnections.find((c: any) => c.aimId === childId)?.explanation, 'child rationale');
  assert.ok(middle.supportedAims.includes(parentId));
  assert.ok(child.supportedAims.includes(aimId));
});

test('MCP Tools - update_aim supports append and remove connection deltas', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const parentId = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'Parent' }));
  const child1Id = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'Child 1' }));
  const child2Id = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'Child 2' }));
  const aimId = idOf(await createAim(server, {
    projectPath: ctx.projectPath,
    text: 'Target',
    supportingConnections: [child1Id],
  }));

  await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    addSupportedAims: [{ aimId: parentId, weight: 4, explanation: 'added parent edge' }],
    addSupportingConnections: [{ aimId: child2Id, weight: 5, explanation: 'added child edge' }],
  });

  let parent = await caller.aim.get({ projectPath: ctx.projectPath, aimId: parentId });
  let target = await caller.aim.get({ projectPath: ctx.projectPath, aimId });
  assert.ok(target.supportedAims.includes(parentId));
  assert.equal(parent.supportingConnections.find((c: any) => c.aimId === aimId)?.weight, 4);
  assert.equal(parent.supportingConnections.find((c: any) => c.aimId === aimId)?.explanation, 'added parent edge');
  assert.deepEqual(
    target.supportingConnections.map((c: any) => c.aimId).sort(),
    [child1Id, child2Id].sort(),
  );
  assert.equal(target.supportingConnections.find((c: any) => c.aimId === child2Id)?.weight, 5);

  await server.callTool('update_aim', {
    projectPath: ctx.projectPath,
    aimId,
    removeSupportedAims: [parentId],
    removeSupportingConnections: [child1Id],
  });

  parent = await caller.aim.get({ projectPath: ctx.projectPath, aimId: parentId });
  target = await caller.aim.get({ projectPath: ctx.projectPath, aimId });
  const child1 = await caller.aim.get({ projectPath: ctx.projectPath, aimId: child1Id });
  assert.ok(!target.supportedAims.includes(parentId));
  assert.ok(!parent.supportingConnections.some((c: any) => c.aimId === aimId));
  assert.deepEqual(target.supportingConnections.map((c: any) => c.aimId), [child2Id]);
  assert.ok(!child1.supportedAims.includes(aimId));
});

test('MCP Tools - list_aims uncommitted surfaces parented-but-unphased aims that floating misses', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];

  // A: no phase, no parent -> floating AND uncommitted.
  const a = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'orphan' }));
  // B: committed to a phase.
  const phase = await caller.phase.create({ projectPath: ctx.projectPath, phase: { name: 'P', from: 0, to: 1000 } });
  const b = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'phased', phaseId: phase.id }));
  // C: has a parent (B) but no phase -> uncommitted but NOT floating (the invisible class).
  const c = idOf(await createAim(server, { projectPath: ctx.projectPath, text: 'connected-unphased', supportedAims: [b] }));

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

test('get_prioritized_aims falls back to connected uncommitted work when a phase has only containers', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const parentResult = await createAim(server, {
    projectPath: ctx.projectPath,
    text: 'Mission container',
    intrinsicValue: 10,
    cost: 1,
  });
  const parentId = /Created aim with ID: ([0-9a-f-]+)/.exec(parentResult.content[0].text)?.[1];
  assert.ok(parentId);

  const childResult = await createAim(server, {
    projectPath: ctx.projectPath,
    text: 'Executable hidden work',
    supportedAims: [parentId],
    cost: 1,
  });
  const childId = /Created aim with ID: ([0-9a-f-]+)/.exec(childResult.content[0].text)?.[1];
  assert.ok(childId);

  const phase = await caller.phase.create({
    projectPath: ctx.projectPath,
    phase: { name: 'Active phase' },
  });
  await caller.aim.commitToPhase({
    projectPath: ctx.projectPath,
    aimId: parentId,
    phaseId: phase.id,
  });

  const result = await server.callTool('get_prioritized_aims', {
    projectPath: ctx.projectPath,
    phaseId: phase.id,
  });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.selectionScope, 'connected-uncommitted-fallback');
  assert.equal(payload.diagnostics.openLeafAims, 0);
  assert.equal(payload.diagnostics.uncommittedFallbackAims, 1);
  assert.deepEqual(payload.aims.map((aim: any) => aim.id), [childId]);
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
