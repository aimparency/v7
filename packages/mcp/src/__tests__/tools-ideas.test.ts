import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools, countIdeaReferences, verificationHintForIdea } from '../tools/index.js';
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
    space: ctx.projectPath, 
    text: 'MCP Idea',
    tags: ['test']
  });

  let ideas = await caller.idea.list({ space: ctx.projectPath });
  assert.equal(ideas.length, 1);
  const ideaId = ideas[0].id;
  assert.equal(ideas[0].text, 'MCP Idea');

  // 2. Update
  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: ideaId,
    text: 'Updated MCP Idea',
    status: { state: 'implemented' }
  });

  const updatedIdea = await caller.idea.get({ space: ctx.projectPath, ideaId });
  assert.equal(updatedIdea.text, 'Updated MCP Idea');
  assert.equal(updatedIdea.status.state, 'implemented');

  // 3. Get
  const getResult = await server.callTool('get_idea', { space: ctx.projectPath, ideaId });
  const fetchedIdea = JSON.parse(getResult.content[0].text);
  assert.equal(fetchedIdea.id, ideaId);

  // 4. Delete
  await server.callTool('delete_idea', { space: ctx.projectPath, ideaId });
  ideas = await caller.idea.list({ space: ctx.projectPath });
  assert.equal(ideas.length, 0);
});

test('get_idea_context returns every distinct root path while preserving the highest-value path', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  await createIdea(server, { space: ctx.projectPath, text: 'Root A', intrinsicValue: 10 });
  await createIdea(server, { space: ctx.projectPath, text: 'Root B', intrinsicValue: 5 });
  const roots = await caller.idea.list({ space: ctx.projectPath });
  const rootA = roots.find((idea) => idea.text === 'Root A')!;
  const rootB = roots.find((idea) => idea.text === 'Root B')!;

  await createIdea(server, {
    space: ctx.projectPath,
    text: 'Middle',
    supportedIdeas: [rootA.id, rootB.id],
  });
  const middle = (await caller.idea.list({ space: ctx.projectPath }))
    .find((idea) => idea.text === 'Middle')!;
  await createIdea(server, {
    space: ctx.projectPath,
    text: 'Leaf',
    supportedIdeas: [middle.id, rootB.id],
  });
  const leaf = (await caller.idea.list({ space: ctx.projectPath }))
    .find((idea) => idea.text === 'Leaf')!;

  const result = await server.callTool('get_idea_context', {
    space: ctx.projectPath,
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

test('get_idea_context works for an idea whose description exceeds the search query limit', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const idea = await caller.idea.createFloatingIdea({
    space: ctx.projectPath,
    idea: { text: 'Long one', description: 'word '.repeat(1000), status: { state: 'open', comment: '', date: Date.now() } }
  });

  const result = await server.callTool('get_idea_context', { space: ctx.projectPath, ideaId: idea.id });
  assert.ok(!result.isError, result.content[0].text);
  assert.equal(JSON.parse(result.content[0].text).idea.text, 'Long one');
});

test('MCP Tools - create_idea requires review and surfaces cancelled context', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const cancelled = await caller.idea.createFloatingIdea({
    space: ctx.projectPath,
    idea: {
      text: 'Build explicit first-class workflow plans',
      status: {
        state: 'cancelled',
        comment: 'Rejected because contribution edges already express the relationship.',
      },
    },
  });
  const proposal = {
    space: ctx.projectPath,
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
  assert.equal((await caller.idea.list({ space: ctx.projectPath })).length, 1);

  const mismatch = await server.callTool('create_idea', {
    ...proposal,
    confirmationToken: 'wrong-token',
  });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.content[0].text, /does not match this idea text/);
  assert.equal((await caller.idea.list({ space: ctx.projectPath })).length, 1);

  const editedText = await server.callTool('create_idea', {
    ...proposal,
    text: 'Build explicit first-class workflow plans and templates',
    confirmationToken: payload.confirmationToken,
  });
  assert.equal(editedText.isError, true, 'a different text needs a fresh review');

  const created = await server.callTool('create_idea', {
    ...proposal,
    description: 'Added after reviewing the related ideas',
    confirmationToken: payload.confirmationToken,
  });
  assert.match(created.content[0].text, /Created idea with ID:/, 'other fields may change after the review');
  assert.equal((await caller.idea.list({ space: ctx.projectPath })).length, 2);
});

test('status date changes only on state transition; reviewedAt is independent', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const initialReview = 1_700_000_000_000;
  await createIdea(server, {
    space: ctx.projectPath,
    text: 'Long-standing intent',
    status: { state: 'open', reviewedAt: initialReview },
  });
  const created = (await caller.idea.list({ space: ctx.projectPath }))[0];
  assert.equal(created.status.reviewedAt, initialReview, 'create path preserves an explicit review time');
  const transitionDate = created.status.date;
  const reviewedAt = transitionDate + 10_000;

  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: created.id,
    status: { state: 'open', comment: 'Still strategically relevant', reviewedAt },
  });
  const reviewed = await caller.idea.get({ space: ctx.projectPath, ideaId: created.id });
  assert.equal(reviewed.status.date, transitionDate, 'same-state review preserves transition time');
  assert.equal(reviewed.status.reviewedAt, reviewedAt);

  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: created.id,
    status: { state: 'partially' },
  });
  const transitioned = await caller.idea.get({ space: ctx.projectPath, ideaId: created.id });
  assert.equal(transitioned.status.state, 'partially');
  assert.ok(transitioned.status.date >= transitionDate, 'state transition advances transition time');
  assert.equal(transitioned.status.reviewedAt, reviewedAt, 'transition preserves the last explicit review');
});

test('MCP Tools - update_idea nudges to verify when marking done without evidence', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  await createIdea(server, { space: ctx.projectPath, text: 'Verify me' });
  const ideaId = (await caller.idea.list({ space: ctx.projectPath }))[0].id;

  // Done without evidence -> nudge.
  const noEvidence = await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId,
    status: { state: 'implemented' },
  });
  assert.match(noEvidence.content[0].text, /verified-done/, 'nudges when done without evidence');

  // Done with evidence in the status comment -> no nudge.
  const withEvidence = await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId,
    status: { state: 'implemented', comment: 'focused test passes' },
  });
  assert.doesNotMatch(withEvidence.content[0].text, /verified-done/, 'no nudge once the comment holds evidence');

  // Non-done updates never nudge.
  const openUpdate = await server.callTool('update_idea', {
    space: ctx.projectPath,
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

  await createIdea(server, { space: ctx.projectPath, text: 'Fix the modal flicker bug', tags: ['ui'] });
  const ideaId = (await caller.idea.list({ space: ctx.projectPath }))[0].id;

  const res = await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId,
    status: { state: 'implemented' },
  });
  assert.match(res.content[0].text, /screenshot|interaction/, 'UI idea nudge asks for a screenshot/interaction proof');
});

test('MCP Tools - create_idea accepts edge metadata for parent and child links', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const parentId = idOf(await createIdea(server, { space: ctx.projectPath, text: 'Parent' }));
  const childId = idOf(await createIdea(server, { space: ctx.projectPath, text: 'Child' }));
  const ideaId = idOf(await createIdea(server, {
    space: ctx.projectPath,
    text: 'Middle',
    supportedIdeas: [{ ideaId: parentId, weight: 2, hypothesis: 'parent rationale' }],
    supportingConnections: [{ ideaId: childId, weight: 3, hypothesis: 'child rationale' }],
  }));

  const parent = await caller.idea.get({ space: ctx.projectPath, ideaId: parentId });
  const middle = await caller.idea.get({ space: ctx.projectPath, ideaId });
  const child = await caller.idea.get({ space: ctx.projectPath, ideaId: childId });

  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.weight, 2);
  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.hypothesis, 'parent rationale');
  assert.equal(middle.supportingConnections.find((c: any) => c.ideaId === childId)?.weight, 3);
  assert.equal(middle.supportingConnections.find((c: any) => c.ideaId === childId)?.hypothesis, 'child rationale');
  assert.ok(middle.supportedIdeas.includes(parentId));
  assert.ok(child.supportedIdeas.includes(ideaId));
});

test('MCP Tools - update_idea supports append and remove connection deltas', async () => {
  const server = new MockServer();
  const callerProxy = createCallerProxy(caller);
  registerTools(server as any, callerProxy as any);

  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const parentId = idOf(await createIdea(server, { space: ctx.projectPath, text: 'Parent' }));
  const child1Id = idOf(await createIdea(server, { space: ctx.projectPath, text: 'Child 1' }));
  const child2Id = idOf(await createIdea(server, { space: ctx.projectPath, text: 'Child 2' }));
  const ideaId = idOf(await createIdea(server, {
    space: ctx.projectPath,
    text: 'Target',
    supportingConnections: [child1Id],
  }));

  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId,
    addSupportedIdeas: [{ ideaId: parentId, weight: 4, hypothesis: 'added parent edge' }],
    addSupportingConnections: [{ ideaId: child2Id, weight: 5, hypothesis: 'added child edge' }],
  });

  let parent = await caller.idea.get({ space: ctx.projectPath, ideaId: parentId });
  let target = await caller.idea.get({ space: ctx.projectPath, ideaId });
  assert.ok(target.supportedIdeas.includes(parentId));
  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.weight, 4);
  assert.equal(parent.supportingConnections.find((c: any) => c.ideaId === ideaId)?.hypothesis, 'added parent edge');
  assert.deepEqual(
    target.supportingConnections.map((c: any) => c.ideaId).sort(),
    [child1Id, child2Id].sort(),
  );
  assert.equal(target.supportingConnections.find((c: any) => c.ideaId === child2Id)?.weight, 5);

  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId,
    removeSupportedIdeas: [parentId],
    removeSupportingConnections: [child1Id],
  });

  parent = await caller.idea.get({ space: ctx.projectPath, ideaId: parentId });
  target = await caller.idea.get({ space: ctx.projectPath, ideaId });
  const child1 = await caller.idea.get({ space: ctx.projectPath, ideaId: child1Id });
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
  const a = idOf(await createIdea(server, { space: ctx.projectPath, text: 'orphan' }));
  // B: committed to a phase.
  const phase = await caller.phase.create({ space: ctx.projectPath, phase: { name: 'P', from: 0, to: 1000 } });
  const b = idOf(await createIdea(server, { space: ctx.projectPath, text: 'phased', phaseId: phase.id }));
  // C: has a parent (B) but no phase -> uncommitted but NOT floating (the invisible class).
  const c = idOf(await createIdea(server, { space: ctx.projectPath, text: 'connected-unphased', supportedIdeas: [b] }));

  const uncommitted = JSON.parse((await server.callTool('list_ideas', {
    space: ctx.projectPath, status: 'open', uncommitted: true,
  })).content[0].text).map((x: any) => x.id);
  assert.ok(uncommitted.includes(a), 'uncommitted includes the orphan');
  assert.ok(uncommitted.includes(c), 'uncommitted includes the connected-but-unphased idea');
  assert.ok(!uncommitted.includes(b), 'uncommitted excludes the phased idea');

  const floating = JSON.parse((await server.callTool('list_ideas', {
    space: ctx.projectPath, floating: true,
  })).content[0].text).map((x: any) => x.id);
  assert.ok(floating.includes(a), 'floating includes the orphan');
  assert.ok(!floating.includes(c), 'floating MISSES the connected-but-unphased idea (the discoverability gap)');
});

test('get_prioritized_ideas falls back to connected uncommitted work when a phase has only containers', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const parentResult = await createIdea(server, {
    space: ctx.projectPath,
    text: 'Mission container',
    intrinsicValue: 10,
    cost: 1,
  });
  const parentId = /Created idea with ID: ([0-9a-f-]+)/.exec(parentResult.content[0].text)?.[1];
  assert.ok(parentId);

  const childResult = await createIdea(server, {
    space: ctx.projectPath,
    text: 'Executable hidden work',
    supportedIdeas: [parentId],
    cost: 1,
  });
  const childId = /Created idea with ID: ([0-9a-f-]+)/.exec(childResult.content[0].text)?.[1];
  assert.ok(childId);

  const phase = await caller.phase.create({
    space: ctx.projectPath,
    phase: { name: 'Active phase' },
  });
  await caller.idea.commitToPhase({
    space: ctx.projectPath,
    ideaId: parentId,
    phaseId: phase.id,
  });

  const result = await server.callTool('get_prioritized_ideas', {
    space: ctx.projectPath,
    phaseId: phase.id,
  });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.selectionScope, 'connected-uncommitted-leaves');
  assert.equal(payload.diagnostics.openLeafIdeas, 0);
  assert.equal(payload.diagnostics.uncommittedLeafIdeas, 1);
  assert.deepEqual(payload.ideas.map((idea: any) => idea.id), [childId]);
  // The top idea comes oriented, saving the loop a get_idea_context call.
  assert.equal(payload.topIdeaContext.idea.id, childId);
  assert.deepEqual(payload.topIdeaContext.parents.map((parent: any) => parent.id), [parentId]);
});

test('get_prioritized_ideas returns a space-native exploration contract when no actionable leaf exists', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);

  const missionResult = await createIdea(server, {
    space: ctx.projectPath,
    text: 'Permanent mission A',
    intrinsicValue: 10,
    cost: 1,
  });
  const missionId = /Created idea with ID: ([0-9a-f-]+)/.exec(missionResult.content[0].text)?.[1];
  assert.ok(missionId);
  const peerResult = await createIdea(server, {
    space: ctx.projectPath,
    text: 'Permanent mission B',
    supportedIdeas: [missionId],
    cost: 1,
  });
  const peerId = /Created idea with ID: ([0-9a-f-]+)/.exec(peerResult.content[0].text)?.[1];
  assert.ok(peerId);
  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: missionId,
    addSupportedIdeas: [peerId],
  });

  const phase = await caller.phase.create({
    space: ctx.projectPath,
    phase: { name: 'Exploration phase' },
  });
  await caller.idea.commitToPhase({
    space: ctx.projectPath,
    ideaId: missionId,
    phaseId: phase.id,
  });

  const result = await server.callTool('get_prioritized_ideas', {
    space: ctx.projectPath,
    phaseId: phase.id,
  });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.selectionScope, 'mission-containers-exploration');
  assert.equal(payload.diagnostics.openLeafIdeas, 0);
  assert.equal(payload.diagnostics.uncommittedLeafIdeas, 0);
  assert.equal(payload.exploration.required, true);
  assert.match(payload.exploration.objective, /actionable leaf/i);
  assert.ok(payload.exploration.moves.some((move: string) => /space_hygiene/.test(move)));
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
    'chore(space): split b03ad58e; also touched de22b7f3 followup',
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
    space: ctx.projectPath,
    phase: { name: 'P1', from: 0, to: 1000 }
  });

  const parent = await caller.idea.createIdeaInPhase({
    space: ctx.projectPath,
    phaseId: phase.id,
    idea: { text: 'Parent', status: { state: 'open', comment: '', date: Date.now() } },
    insertionIndex: 0
  });

  await caller.idea.createSubIdea({
    space: ctx.projectPath,
    parentIdeaId: parent.id,
    idea: { text: 'Child', status: { state: 'open', comment: '', date: Date.now() } },
    positionInParent: 0
  });

  const result = await server.callTool('list_phase_ideas_recursive', { 
    space: ctx.projectPath, 
    phaseId: phase.id 
  });
  
  const tree = JSON.parse(result.content[0].text);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
});

test('MCP Tools - settling an idea asks to reflect on its parent connections; reflecting keeps the weight', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);
  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const parentId = idOf(await createIdea(server, { space: ctx.projectPath, text: 'Parent' }));
  const childId = idOf(await createIdea(server, {
    space: ctx.projectPath,
    text: 'Child',
    supportedIdeas: [{ ideaId: parentId, weight: 3, hypothesis: 'should unblock the parent' }],
  }));
  const edge = async () => (await caller.idea.get({ space: ctx.projectPath, ideaId: parentId }))
    .supportingConnections.find((c: any) => c.ideaId === childId);

  const settled = await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: childId,
    status: { state: 'implemented', comment: 'verified' },
  });
  assert.match(settled.content[0].text, /reflect on each parent's hypothesis/);
  assert.match(settled.content[0].text, /hypothesis: "should unblock the parent"/);

  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: childId,
    addSupportedIdeas: [{ ideaId: parentId, reflection: 'it did, partly' }],
  });
  assert.deepEqual(
    { weight: (await edge()).weight, hypothesis: (await edge()).hypothesis, reflection: (await edge()).reflection },
    { weight: 3, hypothesis: 'should unblock the parent', reflection: 'it did, partly' },
  );

  const again = await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: childId,
    status: { state: 'implemented', comment: 'still' },
  });
  assert.doesNotMatch(again.content[0].text, /reflect on each parent's hypothesis/, 'reflected connections are not asked again');

  const reopened = await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: childId,
    status: { state: 'open', comment: '' },
  });
  assert.doesNotMatch(reopened.content[0].text, /hypothesis/, 'open does not prompt a reflection');
});

test('MCP Tools - updating a child edge\'s hypothesis keeps its weight', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);
  const idOf = (res: any): string => res.content[0].text.match(/ID:\s*([0-9a-f-]+)/i)[1];
  const childId = idOf(await createIdea(server, { space: ctx.projectPath, text: 'Child' }));
  const parentId = idOf(await createIdea(server, {
    space: ctx.projectPath,
    text: 'Parent',
    supportingConnections: [{ ideaId: childId, weight: 7 }],
  }));

  await server.callTool('update_idea', {
    space: ctx.projectPath,
    ideaId: parentId,
    addSupportingConnections: [{ ideaId: childId, hypothesis: 'now with a reason' }],
  });
  const connection = (await caller.idea.get({ space: ctx.projectPath, ideaId: parentId }))
    .supportingConnections.find((c: any) => c.ideaId === childId);
  assert.equal(connection.weight, 7);
  assert.equal(connection.hypothesis, 'now with a reason');
});

test('update_ideas applies several updates in order and stops at the first failure', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);
  const id = async (text: string) => /Created idea with ID: ([0-9a-f-]+)/.exec((await createIdea(server, { space: ctx.projectPath, text })).content[0].text)![1]!;
  const first = await id('Batch first');
  const second = await id('Batch second');

  const result = await server.callTool('update_ideas', {
    space: ctx.projectPath,
    updates: [
      { ideaId: first, status: { state: 'unclear', comment: 'Which color?' } },
      { ideaId: second, tags: ['batched'] },
    ],
  });
  assert.equal(result.isError, undefined);
  assert.equal((await caller.idea.get({ space: ctx.projectPath, ideaId: first })).status.state, 'unclear');
  assert.deepEqual((await caller.idea.get({ space: ctx.projectPath, ideaId: second })).tags, ['batched']);

  const failed = await server.callTool('update_ideas', {
    space: ctx.projectPath,
    updates: [
      { ideaId: first, tags: ['kept'] },
      { ideaId: '00000000-0000-4000-8000-000000000000', tags: ['missing'] },
      { ideaId: second, tags: ['never'] },
    ],
  });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /Failed on 00000000/);
  assert.deepEqual((await caller.idea.get({ space: ctx.projectPath, ideaId: first })).tags, ['kept']);
  assert.deepEqual((await caller.idea.get({ space: ctx.projectPath, ideaId: second })).tags, ['batched']);
});

test('a new idea takes a share of its parent in percent; the siblings and the loop fill the rest', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);
  const space = ctx.projectPath;

  await createIdea(server, { space, text: 'Share parent' });
  const parentId = (await caller.idea.list({ space })).find((idea) => idea.text === 'Share parent')!.id;
  await createIdea(server, { space, text: 'Older sibling', supportedIdeas: [parentId] });
  const siblingId = (await caller.idea.list({ space })).find((idea) => idea.text === 'Older sibling')!.id;

  const args = { space, text: 'Newcomer', supportedIdeas: [{ ideaId: parentId, share: 60 }] };
  const review = JSON.parse((await server.callTool('create_idea', args)).content[0].text);
  assert.match(review.parentSplits, /50% Older sibling/, 'the review shows the split the share is judged against');
  assert.match(review.parentSplits, /50% loop/);

  const created = await server.callTool('create_idea', { ...args, confirmationToken: review.confirmationToken });
  assert.match(created.content[0].text, /60% → Newcomer/);
  assert.match(created.content[0].text, /20% Older sibling/);

  const parent = await caller.idea.get({ space, ideaId: parentId });
  const newcomerId = parent.supportingConnections.find((conn) => conn.ideaId !== siblingId)!.ideaId;
  assert.strictEqual(parent.supportingConnections.find((conn) => conn.ideaId === newcomerId)!.weight, 60);
  assert.strictEqual(parent.supportingConnections.find((conn) => conn.ideaId === siblingId)!.weight, 20);
  assert.strictEqual(parent.selfWeight, 20);

  // Naming the sibling and the loop as well sets the whole split.
  const updated = await server.callTool('update_idea', {
    space,
    ideaId: newcomerId,
    addSupportedIdeas: [{ ideaId: parentId, share: 30, siblingShares: { [siblingId]: 70 }, loopShare: 0 }],
  });
  assert.match(updated.content[0].text, /30% → Newcomer/);
  const reshared = await caller.idea.get({ space, ideaId: parentId });
  assert.deepStrictEqual(
    reshared.supportingConnections.map((conn) => [conn.ideaId, conn.weight]).sort(),
    [[newcomerId, 30], [siblingId, 70]].sort(),
  );
  assert.strictEqual(reshared.selfWeight, 0);

  // A share that leaves nothing for the sibling is refused before anything is written.
  const refused = await server.callTool('update_idea', { space, ideaId: newcomerId, addSupportedIdeas: [{ ideaId: parentId, share: 100 }] });
  assert.ok(refused.isError);
  assert.match(refused.content[0].text, /nothing for its other children/);
  assert.strictEqual((await caller.idea.get({ space, ideaId: parentId })).supportingConnections.length, 2);
});

test('an idea sets its own children and loop share in percent', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);
  const space = ctx.projectPath;

  await createIdea(server, { space, text: 'Owner' });
  await createIdea(server, { space, text: 'Part' });
  const ideas = await caller.idea.list({ space });
  const ownerId = ideas.find((idea) => idea.text === 'Owner')!.id;
  const partId = ideas.find((idea) => idea.text === 'Part')!.id;

  const result = await server.callTool('update_idea', { space, ideaId: ownerId, addSupportingConnections: [{ ideaId: partId, share: 40 }] });
  assert.match(result.content[0].text, /40% Part/);
  assert.match(result.content[0].text, /60% loop/);
  const owner = await caller.idea.get({ space, ideaId: ownerId });
  assert.strictEqual(owner.supportingConnections[0]!.weight, 40);
  assert.strictEqual(owner.selfWeight, 60);
});
