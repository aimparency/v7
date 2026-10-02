import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools, countIdeaReferences, verificationHintForIdea } from '../tools.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

let ctx: ReturnType<typeof createTestContext>;

async function createIdea(server: MockServer, args: Record<string, unknown>) {
  const review = await server.callTool('create_idea', args);
  const confirmationToken = JSON.parse(review.content[0].text).confirmationToken;
  assert.ok(confirmationToken, 'create_idea review returns a confirmation token');
  return await server.callTool('create_idea', { ...args, confirmationToken });
}

beforeEach(async () => {
  ctx = createTestContext();
  await ctx.setup();
});

afterEach(async () => {
  await ctx.teardown();
});

test('MCP Tools - Ideas CRUD', async (t) => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  // 1. Create
  await createIdea(server, {
    projectPath: ctx.projectPath, 
    text: 'MCP Idea',
    tags: ['test']
  });

  let ideas = await caller.idea.list({ projectPath: ctx.projectPath });
  assert.equal(ideas.length, 1);
  const ideaId = ideas[0].id;
  assert.equal(ideas[0].text, 'MCP Idea');

  // 2. Update
  await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId: ideaId,
    text: 'Updated MCP Idea',
    status: { state: 'done' }
  });

  const updatedIdea = await caller.idea.get({ projectPath: ctx.projectPath, ideaId });
  assert.equal(updatedIdea.text, 'Updated MCP Idea');
  assert.equal(updatedIdea.status.state, 'done');

  // 3. Get
  const getResult = await server.callTool('get_idea', { projectPath: ctx.projectPath, ideaId });
  const fetchedIdea = JSON.parse(getResult.content[0].text);
  assert.equal(fetchedIdea.id, ideaId);

  // 4. Delete
  await server.callTool('delete_idea', { projectPath: ctx.projectPath, ideaId });
  ideas = await caller.idea.list({ projectPath: ctx.projectPath });
  assert.equal(ideas.length, 0);
});

test('get_idea_context returns every distinct root path while preserving the highest-value path', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  await createIdea(server, { projectPath: ctx.projectPath, text: 'Root A', intrinsicValue: 10 });
  await createIdea(server, { projectPath: ctx.projectPath, text: 'Root B', intrinsicValue: 5 });
  const roots = await caller.idea.list({ projectPath: ctx.projectPath });
  const rootA = roots.find((idea) => idea.text === 'Root A')!;
  const rootB = roots.find((idea) => idea.text === 'Root B')!;

  await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Middle',
    supportedIdeas: [rootA.id, rootB.id],
  });
  const middle = (await caller.idea.list({ projectPath: ctx.projectPath }))
    .find((idea) => idea.text === 'Middle')!;
  await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Leaf',
    supportedIdeas: [middle.id, rootB.id],
  });
  const leaf = (await caller.idea.list({ projectPath: ctx.projectPath }))
    .find((idea) => idea.text === 'Leaf')!;

  const result = await server.callTool('get_idea_context', {
    projectPath: ctx.projectPath,
    ideaId: leaf.id,
  });
  const payload = JSON.parse(result.content[0].text);
  const paths = payload.paths_to_root.map((path: any[]) => path.map((idea) => idea.text));

  assert.deepEqual(paths, [
    ['Root A', 'Middle'],
    ['Root B', 'Middle'],
    ['Root B'],
  ]);
  assert.equal(payload.paths_to_root_truncated, false);
  assert.ok(Array.isArray(payload.path_to_root), 'backward-compatible highest-value path remains');
  assert.equal(payload.path_to_root.at(-1).text, 'Middle');
});

test('MCP Tools - create_idea requires review and surfaces cancelled context', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const cancelled = await caller.idea.createFloatingIdea({
    projectPath: ctx.projectPath,
    idea: {
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

  const review = await server.callTool('create_idea', proposal);
  const payload = JSON.parse(review.content[0].text);
  assert.equal(payload.created, false);
  assert.equal(payload.reviewRequired, true);
  assert.ok(payload.confirmationToken);
  assert.ok(
    payload.relatedIdeas.some((idea: any) =>
      idea.id === cancelled.id &&
      idea.status.state === 'cancelled' &&
      /contribution edges/.test(idea.status.comment)
    ),
    'cancelled ideas and their rationale are included in creation context',
  );
  assert.equal((await caller.idea.list({ projectPath: ctx.projectPath })).length, 1);

  const mismatch = await server.callTool('create_idea', {
    ...proposal,
    confirmationToken: 'wrong-token',
  });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.content[0].text, /does not match this idea proposal/);
  assert.equal((await caller.idea.list({ projectPath: ctx.projectPath })).length, 1);

  const created = await server.callTool('create_idea', {
    ...proposal,
    confirmationToken: payload.confirmationToken,
  });
  assert.match(created.content[0].text, /Created idea with ID:/);
  assert.equal((await caller.idea.list({ projectPath: ctx.projectPath })).length, 2);
});

test('status date changes only on state transition; reviewedAt is independent', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const initialReview = 1_700_000_000_000;
  await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Long-standing intent',
    status: { state: 'open', reviewedAt: initialReview },
  });
  const created = (await caller.idea.list({ projectPath: ctx.projectPath }))[0];
  assert.equal(created.status.reviewedAt, initialReview, 'create path preserves an explicit review time');
  const transitionDate = created.status.date;
  const reviewedAt = transitionDate + 10_000;

  await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId: created.id,
    status: { state: 'open', comment: 'Still strategically relevant', reviewedAt },
  });
  const reviewed = await caller.idea.get({ projectPath: ctx.projectPath, ideaId: created.id });
  assert.equal(reviewed.status.date, transitionDate, 'same-state review preserves transition time');
  assert.equal(reviewed.status.reviewedAt, reviewedAt);

  await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId: created.id,
    status: { state: 'partially' },
  });
  const transitioned = await caller.idea.get({ projectPath: ctx.projectPath, ideaId: created.id });
  assert.equal(transitioned.status.state, 'partially');
  assert.ok(transitioned.status.date >= transitionDate, 'state transition advances transition time');
  assert.equal(transitioned.status.reviewedAt, reviewedAt, 'transition preserves the last explicit review');
});

test('MCP Tools - update_idea nudges to verify when marking done without a reflection', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await createIdea(server, { projectPath: ctx.projectPath, text: 'Verify me' });
  const ideaId = (await caller.idea.list({ projectPath: ctx.projectPath }))[0].id;

  // Done without a reflection -> nudge.
  const noReflection = await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId,
    status: { state: 'done' },
  });
  assert.match(noReflection.content[0].text, /verified-done/, 'nudges when done without reflection');

  // Add a reflection, then mark done again -> no nudge.
  await server.callTool('addReflection', {
    projectPath: ctx.projectPath,
    ideaId,
    reflection: {
      context: 'c', outcome: 'o', effectiveness: 'e', lesson: 'l',
    },
  });
  const withReflection = await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId,
    status: { state: 'done' },
  });
  assert.doesNotMatch(withReflection.content[0].text, /verified-done/, 'no nudge once a reflection exists');

  // Non-done updates never nudge.
  const openUpdate = await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId,
    status: { state: 'open' },
  });
  assert.doesNotMatch(openUpdate.content[0].text, /verified-done/, 'no nudge on non-done updates');
});

test('MCP Tools - verificationHintForIdea tailors evidence to idea type', () => {
  // UI/visual takes precedence — a visual change is best proven by seeing it run.
  assert.match(verificationHintForIdea({ text: 'Fix select dropdown flicker' }), /screenshot|interaction/);
  assert.match(verificationHintForIdea({ text: 'feature', tags: ['ui'] }), /screenshot|interaction/);
  // Bugfix/behavior -> a passing repro.
  assert.match(verificationHintForIdea({ text: 'Bug: watchdog connects to wrong project' }), /repro/);
  // Code/backend -> tests + typecheck.
  assert.match(verificationHintForIdea({ text: 'Implement the spin-off backend endpoint' }), /typecheck/);
  // Unknown -> generic fallback still asks for concrete evidence.
  assert.match(verificationHintForIdea({ text: 'Negotiate partnership' }), /tests|repro|screenshot/);
  assert.match(verificationHintForIdea(null), /tests|repro|screenshot/);
});

test('MCP Tools - done nudge surfaces the type-specific evidence hint', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await createIdea(server, { projectPath: ctx.projectPath, text: 'Fix the modal flicker bug', tags: ['ui'] });
  const ideaId = (await caller.idea.list({ projectPath: ctx.projectPath }))[0].id;

  const res = await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId,
    status: { state: 'done' },
  });
  assert.match(res.content[0].text, /screenshot|interaction/, 'UI idea nudge asks for a screenshot/interaction proof');
});

test('MCP Tools - update_idea stores free-text reflection with status', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await createIdea(server, { projectPath: ctx.projectPath, text: 'Reflectable idea' });
  const ideaId = (await caller.idea.list({ projectPath: ctx.projectPath }))[0].id;

  const result = await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId,
    status: { state: 'done' },
    reflection: 'Verified with the focused MCP idea test.',
  });

  const idea = await caller.idea.get({ projectPath: ctx.projectPath, ideaId });
  assert.equal(idea.status.state, 'done');
  assert.equal(idea.reflection, 'Verified with the focused MCP idea test.');
  assert.doesNotMatch(result.content[0].text, /verified-done/, 'free-text reflection satisfies done evidence nudge');
});

test('MCP Tools - create_idea accepts edge metadata for parent and child links', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const parentId = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'Parent' }));
  const childId = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'Child' }));
  const ideaId = idOf(await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Middle',
    supportedIdeas: [{ ideaId: parentId, weight: 2, explanation: 'parent rationale' }],
    supportingConnections: [{ ideaId: childId, weight: 3, explanation: 'child rationale' }],
  }));

  const parent = await caller.idea.get({ projectPath: ctx.projectPath, ideaId: parentId });
  const middle = await caller.idea.get({ projectPath: ctx.projectPath, ideaId });
  const child = await caller.idea.get({ projectPath: ctx.projectPath, ideaId: childId });

  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.weight, 2);
  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.explanation, 'parent rationale');
  assert.equal(middle.supportingConnections.find((c: any) => c.ideaId === childId)?.weight, 3);
  assert.equal(middle.supportingConnections.find((c: any) => c.ideaId === childId)?.explanation, 'child rationale');
  assert.ok(middle.supportedIdeas.includes(parentId));
  assert.ok(child.supportedIdeas.includes(ideaId));
});

test('MCP Tools - update_idea supports append and remove connection deltas', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const parentId = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'Parent' }));
  const child1Id = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'Child 1' }));
  const child2Id = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'Child 2' }));
  const ideaId = idOf(await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Target',
    supportingConnections: [child1Id],
  }));

  await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId,
    addSupportedIdeas: [{ ideaId: parentId, weight: 4, explanation: 'added parent edge' }],
    addSupportingConnections: [{ ideaId: child2Id, weight: 5, explanation: 'added child edge' }],
  });

  let parent = await caller.idea.get({ projectPath: ctx.projectPath, ideaId: parentId });
  let target = await caller.idea.get({ projectPath: ctx.projectPath, ideaId });
  assert.ok(target.supportedIdeas.includes(parentId));
  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.weight, 4);
  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.explanation, 'added parent edge');
  assert.deepEqual(
    target.supportingConnections.map((c: any) => c.ideaId).sort(),
    [child1Id, child2Id].sort(),
  );
  assert.equal(target.supportingConnections.find((c: any) => c.ideaId === child2Id)?.weight, 5);

  await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId,
    removeSupportedIdeas: [parentId],
    removeSupportingConnections: [child1Id],
  });

  parent = await caller.idea.get({ projectPath: ctx.projectPath, ideaId: parentId });
  target = await caller.idea.get({ projectPath: ctx.projectPath, ideaId });
  const child1 = await caller.idea.get({ projectPath: ctx.projectPath, ideaId: child1Id });
  assert.ok(!target.supportedIdeas.includes(parentId));
  assert.ok(!parent.supportingConnections.some((c: any) => c.ideaId === ideaId));
  assert.deepEqual(target.supportingConnections.map((c: any) => c.ideaId), [child2Id]);
  assert.ok(!child1.supportedIdeas.includes(ideaId));
});

test('MCP Tools - list_ideas uncommitted surfaces parented-but-unphased ideas that floating misses', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];

  // A: no phase, no parent -> floating AND uncommitted.
  const a = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'orphan' }));
  // B: committed to a phase.
  const phase = await caller.phase.create({ projectPath: ctx.projectPath, phase: { name: 'P', from: 0, to: 1000 } });
  const b = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'phased', phaseId: phase.id }));
  // C: has a parent (B) but no phase -> uncommitted but NOT floating (the invisible class).
  const c = idOf(await createIdea(server, { projectPath: ctx.projectPath, text: 'connected-unphased', supportedIdeas: [b] }));

  const uncommitted = JSON.parse((await server.callTool('list_ideas', {
    projectPath: ctx.projectPath, status: 'open', uncommitted: true,
  })).content[0].text).map((x: any) => x.id);
  assert.ok(uncommitted.includes(a), 'uncommitted includes the orphan');
  assert.ok(uncommitted.includes(c), 'uncommitted includes the connected-but-unphased idea');
  assert.ok(!uncommitted.includes(b), 'uncommitted excludes the phased idea');

  const floating = JSON.parse((await server.callTool('list_ideas', {
    projectPath: ctx.projectPath, floating: true,
  })).content[0].text).map((x: any) => x.id);
  assert.ok(floating.includes(a), 'floating includes the orphan');
  assert.ok(!floating.includes(c), 'floating MISSES the connected-but-unphased idea (the discoverability gap)');
});

test('get_prioritized_ideas falls back to connected uncommitted work when a phase has only containers', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const parentResult = await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Mission container',
    intrinsicValue: 10,
    cost: 1,
  });
  const parentId = /Created idea with ID: ([0-9a-f-]+)/.exec(parentResult.content[0].text)?.[1];
  assert.ok(parentId);

  const childResult = await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Executable hidden work',
    supportedIdeas: [parentId],
    cost: 1,
  });
  const childId = /Created idea with ID: ([0-9a-f-]+)/.exec(childResult.content[0].text)?.[1];
  assert.ok(childId);

  const phase = await caller.phase.create({
    projectPath: ctx.projectPath,
    phase: { name: 'Active phase' },
  });
  await caller.idea.commitToPhase({
    projectPath: ctx.projectPath,
    ideaId: parentId,
    phaseId: phase.id,
  });

  const result = await server.callTool('get_prioritized_ideas', {
    projectPath: ctx.projectPath,
    phaseId: phase.id,
  });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.selectionScope, 'connected-uncommitted-leaves');
  assert.equal(payload.diagnostics.openLeafIdeas, 0);
  assert.equal(payload.diagnostics.uncommittedLeafIdeas, 1);
  assert.deepEqual(payload.ideas.map((idea: any) => idea.id), [childId]);
});

test('get_prioritized_ideas returns a graph-native exploration contract when no actionable leaf exists', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const missionResult = await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Permanent mission A',
    intrinsicValue: 10,
    cost: 1,
  });
  const missionId = /Created idea with ID: ([0-9a-f-]+)/.exec(missionResult.content[0].text)?.[1];
  assert.ok(missionId);
  const peerResult = await createIdea(server, {
    projectPath: ctx.projectPath,
    text: 'Permanent mission B',
    supportedIdeas: [missionId],
    cost: 1,
  });
  const peerId = /Created idea with ID: ([0-9a-f-]+)/.exec(peerResult.content[0].text)?.[1];
  assert.ok(peerId);
  await server.callTool('update_idea', {
    projectPath: ctx.projectPath,
    ideaId: missionId,
    addSupportedIdeas: [peerId],
  });

  const phase = await caller.phase.create({
    projectPath: ctx.projectPath,
    phase: { name: 'Exploration phase' },
  });
  await caller.idea.commitToPhase({
    projectPath: ctx.projectPath,
    ideaId: missionId,
    phaseId: phase.id,
  });

  const result = await server.callTool('get_prioritized_ideas', {
    projectPath: ctx.projectPath,
    phaseId: phase.id,
  });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.selectionScope, 'mission-containers-exploration');
  assert.equal(payload.diagnostics.openLeafIdeas, 0);
  assert.equal(payload.diagnostics.uncommittedLeafIdeas, 0);
  assert.equal(payload.exploration.required, true);
  assert.match(payload.exploration.objective, /actionable leaf/i);
  assert.ok(payload.exploration.moves.some((move: string) => /graph_hygiene/.test(move)));
  assert.ok(payload.exploration.moves.some((move: string) => /hypothesis/.test(move)));
  assert.deepEqual(payload.ideas.map((idea: any) => idea.id), [missionId]);
});

test('countIdeaReferences counts commits referencing an idea id prefix (realized-cost signal)', () => {
  const ids = [
    'de22b7f3-ad77-4bcc-bd9f-aabbccddeeff', // referenced twice
    'b03ad58e-4518-4a35-9a35-36f58ee9b001', // referenced once
    '0622adb1-e79d-4837-b894-199d92ca199d', // not referenced
  ];
  const commits = [
    'feat(supervisor): real reflection (de22b7f3, approach B)\n\nbody text',
    'chore(graph): split b03ad58e; also touched de22b7f3 followup',
    'unrelated cleanup commit with no idea id',
  ];
  const counts = countIdeaReferences(commits, ids);
  assert.equal(counts.get(ids[0]), 2, 'de22b7f3 referenced in two commits');
  assert.equal(counts.get(ids[1]), 1, 'b03ad58e referenced once');
  assert.equal(counts.get(ids[2]) ?? 0, 0, 'unreferenced idea has zero');
});

test('MCP Tools - list_phase_ideas_recursive', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const phase = await caller.phase.create({
    projectPath: ctx.projectPath,
    phase: { name: 'P1', from: 0, to: 1000 }
  });

  const parent = await caller.idea.createIdeaInPhase({
    projectPath: ctx.projectPath,
    phaseId: phase.id,
    idea: { text: 'Parent', status: { state: 'open', comment: '', date: Date.now() } },
    insertionIndex: 0
  });

  await caller.idea.createSubIdea({
    projectPath: ctx.projectPath,
    parentIdeaId: parent.id,
    idea: { text: 'Child', status: { state: 'open', comment: '', date: Date.now() } },
    positionInParent: 0
  });

  const result = await server.callTool('list_phase_ideas_recursive', { 
    projectPath: ctx.projectPath, 
    phaseId: phase.id 
  });
  
  const tree = JSON.parse(result.content[0].text);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
});
