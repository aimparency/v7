import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server';
import { clearIndices } from './search';
import type { Phase, ProjectMeta } from 'shared';

import { v4 as uuidv4 } from 'uuid';

// Create a test caller
const caller = appRouter.createCaller({});

let testRootPath = '';
let testProjectPath = '';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-server-test-'));
  testProjectPath = path.join(testRootPath, '.bowman');
  await fs.ensureDir(testProjectPath);
});

afterEach(async () => {
  await fs.remove(testRootPath);
  // Clear in-memory search indices
  clearIndices(testProjectPath);
});

test('connectIdeas - connects two existing ideas', async () => {

  // Create parent idea
  const parentResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Parent Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create child idea
  const childResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Child Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect them
  await caller.idea.connectIdeas({
    projectPath: testProjectPath,
    parentIdeaId: parentResult.id,
    childIdeaId: childResult.id,
    parentIncomingIndex: 0, 
    childSupportedIdeasIndex: 0
  });

  // Verify connection
  const updatedParent = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: parentResult.id
  });
  const updatedChild = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: childResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].ideaId, childResult.id);
  assert.deepEqual(updatedChild.supportedIdeas, [parentResult.id]);
});

test('createSubIdea - creates and connects sub-idea', async () => {

  // Create parent idea
  const parentResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Parent Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create sub-idea
  const subIdeaResult = await caller.idea.createSubIdea({
    projectPath: testProjectPath,
    parentIdeaId: parentResult.id,
    idea: {
      text: 'Sub Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    },
    positionInParent: 0 
  });

  // Verify creation and connection
  const updatedParent = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: parentResult.id
  });
  const subIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: subIdeaResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].ideaId, subIdeaResult.id);
  assert.deepEqual(subIdea.supportedIdeas, [parentResult.id]);
  assert.equal(subIdea.text, 'Sub Idea');
});

test('idea creation assigns grey roots and distinct parent-derived child colors', async () => {
  const parent = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Root' }
  });
  const firstChild = await caller.idea.createSubIdea({
    projectPath: testProjectPath,
    parentIdeaId: parent.id,
    idea: { text: 'First child' }
  });
  const secondChild = await caller.idea.createSubIdea({
    projectPath: testProjectPath,
    parentIdeaId: parent.id,
    idea: { text: 'Second child' }
  });
  const explicitChild = await caller.idea.createSubIdea({
    projectPath: testProjectPath,
    parentIdeaId: parent.id,
    idea: { text: 'Explicit child', color: '#123456' }
  });

  assert.equal(parent.color, '#666666');
  assert.match(firstChild.color ?? '', /^#[0-9a-f]{6}$/);
  assert.notEqual(firstChild.color, parent.color);
  assert.notEqual(secondChild.color, firstChild.color);
  assert.equal(explicitChild.color, '#123456');
});

test('createCommittedIdea - creates and commits idea to phase', async () => {

  // Create phase
  const phaseResult = await caller.phase.create({
    projectPath: testProjectPath,
    phase: {
      name: 'Test Phase',
      parent: null,
      commitments: []
    }
  });

  // Create committed idea
  const ideaResult = await caller.idea.createIdeaInPhase({
    projectPath: testProjectPath,
    phaseId: phaseResult.id,
    idea: {
      text: 'Committed Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    },
    insertionIndex: 0
  });

  // Verify creation and commitment
  const updatedPhase = await caller.phase.get({
    projectPath: testProjectPath,
    phaseId: phaseResult.id
  });
  const idea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaResult.id
  });

  assert.deepEqual(updatedPhase.commitments, [ideaResult.id]);
  assert.deepEqual(idea.committedIn, [phaseResult.id]);
  assert.equal(idea.text, 'Committed Idea');
});

test('getMany - skips missing ideas instead of failing the full batch', async () => {
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Existing Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const results = await caller.idea.getMany({
    projectPath: testProjectPath,
    ideaIds: [
      ideaResult.id,
      '00000000-0000-4000-8000-000000000000'
    ]
  });

  assert.deepEqual(results.map((idea) => idea.id), [ideaResult.id]);
});

test('approveIdeaSubtree persists the approved structure once and safely replays retries', async () => {
  const parent = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Existing parent' }
  });
  const phase = await caller.phase.create({
    projectPath: testProjectPath,
    phase: { name: 'Now', parent: null, commitments: [] }
  });
  const proposal = {
    revision: 'revision-1',
    sourceText: 'Make the festival easier to operate',
    existingParentIds: [parent.id],
    phaseId: phase.id,
    assumptions: [],
    questions: [],
    root: {
      proposalId: 'root',
      text: 'Improve festival operations',
      children: [{
        weight: 2,
        explanation: 'Reduces repetitive coordination',
        child: {
          proposalId: 'child',
          text: 'Automate volunteer reminders',
          children: [{
            weight: 1,
            child: {
              proposalId: 'leaf',
              text: 'Map the reminder workflow',
              children: []
            }
          }]
        }
      }]
    }
  };

  const first = await caller.idea.approveIdeaSubtree({
    projectPath: testProjectPath,
    proposal,
    revision: proposal.revision,
    idempotencyKey: 'approval-test-key'
  });
  const replay = await caller.idea.approveIdeaSubtree({
    projectPath: testProjectPath,
    proposal,
    revision: proposal.revision,
    idempotencyKey: 'approval-test-key'
  });

  assert.equal(first.complete, true);
  assert.equal(first.replayed, false);
  assert.equal(replay.complete, true);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.idMap, first.idMap);

  const ideas = await caller.idea.list({ projectPath: testProjectPath });
  assert.equal(ideas.length, 4);
  const root = await caller.idea.get({ projectPath: testProjectPath, ideaId: first.rootIdeaId });
  const child = await caller.idea.get({ projectPath: testProjectPath, ideaId: first.idMap.child });
  assert.deepEqual(root.supportedIdeas, [parent.id]);
  assert.equal(root.supportingConnections[0].ideaId, child.id);
  assert.equal(root.supportingConnections[0].weight, 2);
  assert.equal(root.supportingConnections[0].explanation, 'Reduces repetitive coordination');
  assert.deepEqual(child.supportedIdeas, [root.id]);

  const updatedParent = await caller.idea.get({ projectPath: testProjectPath, ideaId: parent.id });
  assert.equal(updatedParent.supportingConnections.filter(connection => connection.ideaId === root.id).length, 1);
  const updatedPhase = await caller.phase.get({ projectPath: testProjectPath, phaseId: phase.id });
  assert.deepEqual(updatedPhase.commitments, [root.id]);
});

test('approveIdeaSubtree validates references and exact revision before graph writes', async () => {
  const proposal = {
    revision: 'revision-2',
    sourceText: 'A proposed goal',
    existingParentIds: ['00000000-0000-4000-8000-000000000000'],
    assumptions: [],
    questions: [],
    root: { proposalId: 'root', text: 'Proposed root', children: [] }
  };

  await assert.rejects(
    caller.idea.approveIdeaSubtree({
      projectPath: testProjectPath,
      proposal,
      revision: 'stale-revision',
      idempotencyKey: 'approval-stale-key'
    }),
    /Stale approval revision/
  );
  await assert.rejects(
    caller.idea.approveIdeaSubtree({
      projectPath: testProjectPath,
      proposal,
      revision: proposal.revision,
      idempotencyKey: 'approval-missing-parent-key'
    })
  );
  assert.deepEqual(await caller.idea.list({ projectPath: testProjectPath }), []);
});

test('connectIdeas - repositioning existing connections', async () => {

  // Create parent idea
  const parentResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Parent Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create two child ideas
  const child1Result = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Child 1',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const child2Result = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Child 2',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect first child at position 0
  await caller.idea.connectIdeas({
    projectPath: testProjectPath,
    parentIdeaId: parentResult.id,
    childIdeaId: child1Result.id,
    parentIncomingIndex: 0,
    childSupportedIdeasIndex: 0
  });

  // Connect second child at position 0 (should move first child to position 1)
  await caller.idea.connectIdeas({
    projectPath: testProjectPath,
    parentIdeaId: parentResult.id,
    childIdeaId: child2Result.id,
    parentIncomingIndex: 0, 
    childSupportedIdeasIndex: 0
  });

  // Verify repositioning
  const updatedParent = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: parentResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 2);
  assert.equal(updatedParent.supportingConnections[0].ideaId, child2Result.id);
  assert.equal(updatedParent.supportingConnections[1].ideaId, child1Result.id);
});

test('list - filters ideas by status and phase', async () => {
  // Create phase
  const phaseResult = await caller.phase.create({
    projectPath: testProjectPath,
    phase: {
      name: 'Test Phase',
      parent: null,
      commitments: []
    }
  });

  // Create open idea in phase
  await caller.idea.createIdeaInPhase({
    projectPath: testProjectPath,
    phaseId: phaseResult.id,
    idea: {
      text: 'Open Idea In Phase',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create done idea floating
  await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Done Floating Idea',
      status: { state: 'implemented', comment: '', date: Date.now() }
    }
  });

  // Test status filter
  const openIdeas = await caller.idea.list({
    projectPath: testProjectPath,
    status: 'open'
  });
  assert.equal(openIdeas.length, 1);
  assert.equal(openIdeas[0].text, 'Open Idea In Phase');

  // Test phase filter
  const phaseIdeas = await caller.idea.list({
    projectPath: testProjectPath,
    phaseId: phaseResult.id
  });
  assert.equal(phaseIdeas.length, 1);
  assert.equal(phaseIdeas[0].text, 'Open Idea In Phase');

  // Test combined filter
  const filteredIdeas = await caller.idea.list({
    projectPath: testProjectPath,
    status: 'open',
    phaseId: phaseResult.id
  });
  assert.equal(filteredIdeas.length, 1);
});

test('phase.list skips malformed phase files', async () => {
  const validPhase = await caller.phase.create({
    projectPath: testProjectPath,
    phase: {
      name: 'Valid Phase',
      parent: null,
      commitments: []
    }
  });

  const malformedPhaseId = uuidv4();
  const malformedPhasePath = path.join(testProjectPath, 'phases', `${malformedPhaseId}.json`);
  await fs.ensureDir(path.dirname(malformedPhasePath));
  await fs.writeFile(malformedPhasePath, '{');

  const phases = await caller.phase.list({
    projectPath: testProjectPath,
    parentPhaseId: null
  });

  assert.equal(phases.length, 1);
  assert.equal(phases[0]?.id, validPhase.id);
});

test('reading a phase mid-move does not persist a re-derived child list', async () => {
  const projectPath = testProjectPath;
  const oldParent = await caller.phase.create({ projectPath, phase: { name: 'Old', parent: null, commitments: [] } });
  const moving = await caller.phase.create({ projectPath, phase: { name: 'Moving', parent: oldParent.id, commitments: [] } });
  const oldParentFile = path.join(projectPath, 'phases', `${oldParent.id}.json`);

  // State between phase.update's writes: old parent no longer lists the phase,
  // whose own file still points at it.
  await fs.writeJson(oldParentFile, { ...(await fs.readJson(oldParentFile)), childPhaseIds: [] });
  await caller.phase.get({ projectPath, phaseId: oldParent.id });
  await caller.phase.list({ projectPath });

  assert.deepEqual((await fs.readJson(oldParentFile) as Phase).childPhaseIds, []);
  assert.equal((await fs.readJson(path.join(projectPath, 'phases', `${moving.id}.json`)) as Phase).parent, oldParent.id);
});

test('phase update moves a phase into a new parent at insertionIndex in one mutation', async () => {
  const projectPath = testProjectPath;
  const create = (name: string, parent: string | null) =>
    caller.phase.create({ projectPath, phase: { name, parent, commitments: [] } });

  const oldParent = await create('Old parent', null);
  const newParent = await create('New parent', null);
  const moved = await create('Moved', oldParent.id);
  const first = await create('First', newParent.id);
  const second = await create('Second', newParent.id);

  await caller.phase.update({ projectPath, phaseId: moved.id, phase: { parent: newParent.id }, insertionIndex: 1 });

  assert.deepEqual((await caller.phase.get({ projectPath, phaseId: newParent.id })).childPhaseIds, [first.id, moved.id, second.id]);
  assert.deepEqual((await caller.phase.get({ projectPath, phaseId: oldParent.id })).childPhaseIds, []);

  // Moving to the root level honours the index too.
  await caller.phase.update({ projectPath, phaseId: moved.id, phase: { parent: null }, insertionIndex: 0 });
  const meta = await fs.readJson(path.join(projectPath, 'meta.json')) as ProjectMeta;
  assert.equal(meta.rootPhaseIds?.[0], moved.id);
});

test('phase reorder preserves canonical parent-owned order for roots and children', async () => {
  const projectPath = testProjectPath;

  const rootA = await caller.phase.create({
    projectPath,
    phase: {
      name: 'A',
      parent: null,
      commitments: []
    }
  });

  const rootB = await caller.phase.create({
    projectPath,
    phase: {
      name: 'B',
      parent: null,
      commitments: []
    }
  });

  const childC = await caller.phase.create({
    projectPath,
    phase: {
      name: 'C',
      parent: rootA.id,
      commitments: []
    }
  });

  const rootAAfterC = await caller.phase.get({
    projectPath,
    phaseId: rootA.id
  });
  const rootAFileAfterC = await fs.readJson(path.join(projectPath, 'phases', `${rootA.id}.json`)) as Phase;
  assert.deepEqual(rootAAfterC.childPhaseIds, [childC.id]);

  const childD = await caller.phase.create({
    projectPath,
    phase: {
      name: 'D',
      parent: rootA.id,
      commitments: []
    }
  });

  const rootAAfterD = await caller.phase.get({
    projectPath,
    phaseId: rootA.id
  });
  const rootAFile = await fs.readJson(path.join(projectPath, 'phases', `${rootA.id}.json`)) as Phase;
  const metaFile = await fs.readJson(path.join(projectPath, 'meta.json')) as ProjectMeta;
  assert.deepEqual(rootAAfterD.childPhaseIds, [childC.id, childD.id]);
  assert.deepEqual(rootAFile.childPhaseIds, [childC.id, childD.id]);
  assert.deepEqual(metaFile.rootPhaseIds, [rootA.id, rootB.id]);

  const rootsInitial = await caller.phase.list({
    projectPath,
    parentPhaseId: null
  });
  assert.deepEqual(rootsInitial.map((phase) => phase.name), ['A', 'B']);

  const childrenInitial = await caller.phase.list({
    projectPath,
    parentPhaseId: rootA.id
  });
  assert.deepEqual(childrenInitial.map((phase) => phase.name), ['C', 'D']);

  await caller.phase.reorder({
    projectPath,
    phaseId: rootA.id,
    newIndex: 1
  });

  const rootsAfterRootReorder = await caller.phase.list({
    projectPath,
    parentPhaseId: null
  });
  assert.deepEqual(rootsAfterRootReorder.map((phase) => phase.name), ['B', 'A']);

  await caller.phase.reorder({
    projectPath,
    phaseId: childC.id,
    newIndex: 1
  });

  const childrenAfterChildReorder = await caller.phase.list({
    projectPath,
    parentPhaseId: rootA.id
  });
  assert.deepEqual(childrenAfterChildReorder.map((phase) => phase.name), ['D', 'C']);

  const rootAAfter = await caller.phase.get({
    projectPath,
    phaseId: rootA.id
  });
  assert.deepEqual(rootAAfter.childPhaseIds, [childD.id, childC.id]);

  const meta = await caller.project.getMeta({
    projectPath
  });
  assert.deepEqual(meta.rootPhaseIds, [rootB.id, rootA.id]);
});

test('phase reads derive legacy root and child ordering in memory; fixConsistency persists it', async () => {
  const rootEarlyId = uuidv4();
  const rootLateId = uuidv4();
  const childEarlyId = uuidv4();
  const childLateId = uuidv4();
  const phasesDir = path.join(testProjectPath, 'phases');
  await fs.ensureDir(phasesDir);
  await fs.writeJson(path.join(testProjectPath, 'meta.json'), {
    name: 'Legacy project',
    color: '#007acc',
    statuses: []
  });

  const legacyPhases = [
    { id: rootLateId, name: 'Root late', parent: null, order: 2, commitments: [] },
    { id: rootEarlyId, name: 'Root early', parent: null, order: 1, commitments: [] },
    { id: childLateId, name: 'Child late', parent: rootEarlyId, from: 200, commitments: [] },
    { id: childEarlyId, name: 'Child early', parent: rootEarlyId, from: 100, commitments: [] }
  ];
  for (const phase of legacyPhases) {
    await fs.writeJson(path.join(phasesDir, `${phase.id}.json`), phase);
  }

  const newRoot = await caller.phase.create({
    projectPath: testProjectPath,
    phase: { name: 'New root', parent: null, commitments: [] }
  });
  const expectedRootIds = [rootEarlyId, rootLateId, newRoot.id];
  const meta = await caller.project.getMeta({ projectPath: testProjectPath });
  assert.deepEqual(meta.rootPhaseIds, expectedRootIds);
  assert.deepEqual(
    (await fs.readJson(path.join(testProjectPath, 'meta.json')) as ProjectMeta).rootPhaseIds,
    expectedRootIds
  );

  const parent = await caller.phase.get({
    projectPath: testProjectPath,
    phaseId: rootEarlyId
  });
  assert.deepEqual(parent.childPhaseIds, [childEarlyId, childLateId]);
  const parentFile = path.join(phasesDir, `${rootEarlyId}.json`);
  assert.equal((await fs.readJson(parentFile) as Phase).childPhaseIds, undefined, 'reads must not write');

  await caller.project.fixConsistency({ projectPath: testProjectPath });
  assert.deepEqual((await fs.readJson(parentFile) as Phase).childPhaseIds, [childEarlyId, childLateId]);
});

test('phase migration preserves canonical order while repairing missing and stale links', async () => {
  const rootFirstId = uuidv4();
  const rootSecondId = uuidv4();
  const staleId = uuidv4();
  const childFirstId = uuidv4();
  const childSecondId = uuidv4();
  const phasesDir = path.join(testProjectPath, 'phases');
  await fs.ensureDir(phasesDir);
  await fs.writeJson(path.join(testProjectPath, 'meta.json'), {
    name: 'Partially migrated project',
    color: '#007acc',
    statuses: [],
    rootPhaseIds: [rootSecondId, staleId]
  });

  const phases = [
    {
      id: rootFirstId,
      name: 'Root first by legacy order',
      parent: null,
      order: 1,
      childPhaseIds: [childSecondId, staleId],
      commitments: []
    },
    { id: rootSecondId, name: 'Canonical first root', parent: null, order: 2, commitments: [] },
    { id: childFirstId, name: 'Missing child', parent: rootFirstId, order: 1, commitments: [] },
    { id: childSecondId, name: 'Canonical first child', parent: rootFirstId, order: 2, commitments: [] }
  ];
  for (const phase of phases) {
    await fs.writeJson(path.join(phasesDir, `${phase.id}.json`), phase);
  }

  // Reads return what is stored; the repair is explicit.
  assert.deepEqual((await caller.project.getMeta({ projectPath: testProjectPath })).rootPhaseIds, [rootSecondId, staleId]);
  await caller.project.fixConsistency({ projectPath: testProjectPath });

  const meta = await caller.project.getMeta({ projectPath: testProjectPath });
  assert.deepEqual(meta.rootPhaseIds, [rootSecondId, rootFirstId]);

  const parent = await caller.phase.get({
    projectPath: testProjectPath,
    phaseId: rootFirstId
  });
  assert.deepEqual(parent.childPhaseIds, [childSecondId, childFirstId]);
});

test('search - matches ideas using search index', async () => {
  // Create test ideas
  await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Apple Pie', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Banana Split', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Apple Cider', status: { state: 'open', comment: '', date: Date.now() } }
  });

  // Build index (usually happens on project load, but we can trigger it or trust createFloatingIdea updates it)
  // createFloatingIdea calls addIdeaToIndex, so it should be immediate.
  
  // Search for "Apple"
  const results = await caller.idea.search({
    projectPath: testProjectPath,
    query: 'Apple'
  });

  // Hybrid search may return additional semantically similar results
  // So we verify the expected ideas are present, not that they're the only results
  const texts = results.map(r => r.text);
  assert.ok(texts.includes('Apple Pie'), 'Should find Apple Pie');
  assert.ok(texts.includes('Apple Cider'), 'Should find Apple Cider');
});

test('search - finds ideas created after the index was built, whichever path form was used', async () => {
  // Build the index first (the live server does this on the first search).
  await caller.idea.search({ projectPath: testProjectPath, query: 'anything' });

  await caller.idea.createFloatingIdea({
    projectPath: testRootPath,
    idea: { text: 'Neustart. Ich bin 33. Aber ich gebe das Leben auf', status: { state: 'open', comment: '', date: Date.now() } }
  });

  for (const projectPath of [testProjectPath, testRootPath]) {
    const results = await caller.idea.search({ projectPath, query: 'Neustart' });
    assert.equal(results[0]?.text, 'Neustart. Ich bin 33. Aber ich gebe das Leben auf');
  }
  // Literal matches in the middle of a title count too.
  const midTitle = await caller.idea.search({ projectPath: testProjectPath, query: 'Leben' });
  assert.equal(midTitle[0]?.text, 'Neustart. Ich bin 33. Aber ich gebe das Leben auf');
});

test('search - returns idea id prefix matches first with match metadata', async () => {
  const target = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Unrelated target', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Target by text only', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const query = target.id.slice(0, 8);
  const results = await caller.idea.search({
    projectPath: testProjectPath,
    query
  });

  assert.equal(results[0]?.id, target.id);
  assert.equal(results[0]?.idMatch?.prefix, query);

  const rootPathResults = await caller.idea.search({
    projectPath: testRootPath,
    query
  });
  assert.equal(rootPathResults[0]?.id, target.id);
  assert.equal(rootPathResults[0]?.idMatch?.prefix, query);

  const shortResults = await caller.idea.search({
    projectPath: testProjectPath,
    query: target.id.slice(0, 7)
  });
  assert.ok(shortResults.every(result => !result.idMatch));
});

test('createFloatingIdea - persists intrinsic value and its human rationale', async () => {
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Valuable Idea',
      status: { state: 'open', comment: '', date: Date.now() },
      intrinsicValue: 42,
      valueRationale: 'Based on a validated customer saving ten hours per week.'
    }
  });

  const idea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaResult.id
  });

  assert.equal(idea.intrinsicValue, 42);
  assert.equal(idea.valueRationale, 'Based on a validated customer saving ten hours per week.');
});

test('createFloatingIdea - first idea defaults intrinsicValue to 1000', async () => {
  // First idea in empty project should default to 1000
  const firstIdeaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'First Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const firstIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: firstIdeaResult.id
  });

  assert.equal(firstIdea.intrinsicValue, 1000);

  // Second idea should default to 0
  const secondIdeaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Second Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const secondIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: secondIdeaResult.id
  });

  assert.equal(secondIdea.intrinsicValue, 0);
});

test('readIdea - upgrades legacy incoming array in memory; fixConsistency persists it', async () => {
  // Manually create a file with legacy structure
  const ideaId = uuidv4();
  const child1Id = uuidv4();
  const child2Id = uuidv4();
  const newChildId = uuidv4();

  const legacyIdea = {
    id: ideaId,
    text: 'Legacy Idea',
    status: { state: 'open', comment: '', date: Date.now() },
    incoming: [child1Id, child2Id], // Legacy field
    supportingConnections: [
      { ideaId: newChildId, relativePosition: [0, 0], weight: 1 } // New field existing
    ],
    outgoing: [],
    committedIn: []
  };

  await fs.ensureDir(path.join(testProjectPath, 'ideas'));
  await fs.writeJson(path.join(testProjectPath, 'ideas', `${ideaId}.json`), legacyIdea);

  // Read the idea (should trigger migration)
  const migratedIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaId
  });

  // Verify in-memory result
  assert.equal(migratedIdea.supportingConnections.length, 3);
  // Order: legacy (prepended) then existing
  assert.equal(migratedIdea.supportingConnections[0].ideaId, child1Id);
  assert.equal(migratedIdea.supportingConnections[1].ideaId, child2Id);
  assert.equal(migratedIdea.supportingConnections[2].ideaId, newChildId);
  assert.equal((migratedIdea as any).incoming, undefined);

  // Reads must not write
  const ideaFile = path.join(testProjectPath, 'ideas', `${ideaId}.json`);
  assert.deepEqual(await fs.readJson(ideaFile), legacyIdea);

  // The referenced children don't exist, so later consistency fixes drop the
  // links again; this only checks that the upgrade itself was persisted.
  const { fixes } = await caller.project.fixConsistency({ projectPath: testProjectPath });
  assert.ok(fixes.some((fix: string) => fix.startsWith('Upgraded') && fix.includes(ideaId)));
  assert.equal((await fs.readJson(ideaFile)).incoming, undefined);
});

test('readIdea - upgrades legacy outgoing array in memory; fixConsistency persists it', async () => {
  const ideaId = uuidv4();
  const parent1Id = uuidv4();
  const parent2Id = uuidv4();

  const legacyIdea = {
    id: ideaId,
    text: 'Legacy Idea',
    status: { state: 'open', comment: '', date: Date.now() },
    supportingConnections: [],
    outgoing: [parent1Id, parent2Id], // Legacy field
    committedIn: []
  };

  await fs.ensureDir(path.join(testProjectPath, 'ideas'));
  await fs.writeJson(path.join(testProjectPath, 'ideas', `${ideaId}.json`), legacyIdea);

  // Read the idea (should trigger migration)
  const migratedIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaId
  });

  // Verify in-memory result
  assert.deepEqual(migratedIdea.supportedIdeas, [parent1Id, parent2Id]);
  assert.equal((migratedIdea as any).outgoing, undefined);

  // Reads must not write
  const ideaFile = path.join(testProjectPath, 'ideas', `${ideaId}.json`);
  assert.deepEqual(await fs.readJson(ideaFile), legacyIdea);

  const { fixes } = await caller.project.fixConsistency({ projectPath: testProjectPath });
  assert.ok(fixes.some((fix: string) => fix.startsWith('Upgraded') && fix.includes(ideaId)));
  assert.equal((await fs.readJson(ideaFile)).outgoing, undefined);
});

test('readIdea leaves unplaced [0,0] connections on disk; fixConsistency places them', async () => {
  const parentId = uuidv4();
  const childId = uuidv4();
  const base = { status: { state: 'open', comment: '', date: Date.now() }, committedIn: [] };
  const parentFile = path.join(testProjectPath, 'ideas', `${parentId}.json`);
  await fs.ensureDir(path.join(testProjectPath, 'ideas'));
  await fs.writeJson(parentFile, {
    ...base, id: parentId, text: 'Parent', supportedIdeas: [],
    supportingConnections: [{ ideaId: childId, relativePosition: [0, 0], weight: 1 }]
  });
  await fs.writeJson(path.join(testProjectPath, 'ideas', `${childId}.json`), {
    ...base, id: childId, text: 'Child', supportedIdeas: [parentId], supportingConnections: []
  });
  const before = await fs.readFile(parentFile, 'utf8');

  await caller.idea.get({ projectPath: testProjectPath, ideaId: parentId });
  await caller.idea.list({ projectPath: testProjectPath });
  assert.equal(await fs.readFile(parentFile, 'utf8'), before);

  await caller.project.fixConsistency({ projectPath: testProjectPath });
  const [connection] = (await fs.readJson(parentFile)).supportingConnections;
  assert.equal(connection.ideaId, childId);
  assert.notDeepEqual(connection.relativePosition, [0, 0]);
});

test('connectIdeas - connects with relative position', async () => {

  // Create parent idea
  const parentResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Parent Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create child idea
  const childResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Child Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const relativePosition: [number, number] = [0.5, 0.8];

  // Connect them
  await caller.idea.connectIdeas({
    projectPath: testProjectPath,
    parentIdeaId: parentResult.id,
    childIdeaId: childResult.id,
    relativePosition: relativePosition
  });

  // Verify connection
  const updatedParent = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: parentResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].ideaId, childResult.id);
  assert.deepEqual(updatedParent.supportingConnections[0].relativePosition, relativePosition);
});

test('idea.update - persists explanation on supportingConnections', async () => {
  const parentResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Parent', status: { state: 'open', comment: '', date: Date.now() } }
  });
  const childResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Child', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.idea.connectIdeas({
    projectPath: testProjectPath,
    parentIdeaId: parentResult.id,
    childIdeaId: childResult.id
  });

  const before = await caller.idea.get({ projectPath: testProjectPath, ideaId: parentResult.id });
  const conn = before.supportingConnections[0]!;

  await caller.idea.update({
    projectPath: testProjectPath,
    ideaId: parentResult.id,
    idea: {
      supportingConnections: [{ ...conn, explanation: 'because it helps' }]
    }
  });

  const after = await caller.idea.get({ projectPath: testProjectPath, ideaId: parentResult.id });
  assert.strictEqual(after.supportingConnections[0]!.explanation, 'because it helps');
});

test('idea.update - persists custom color', async () => {
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Color test', status: { state: 'open', comment: '', date: Date.now() }, color: '#ff8800' }
  });
  
  assert.strictEqual(ideaResult.color, '#ff8800');

  const updatedIdea = await caller.idea.update({
    projectPath: testProjectPath,
    ideaId: ideaResult.id,
    idea: {
      color: '#00ff00'
    }
  });

  assert.strictEqual(updatedIdea.color, '#00ff00');

  const fetchedIdea = await caller.idea.get({ projectPath: testProjectPath, ideaId: ideaResult.id });
  assert.strictEqual(fetchedIdea.color, '#00ff00');
});

test('idea.update - persists edit-modal reflection and archive fields', async () => {
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Reflection test',
      status: { state: 'implemented', comment: '', date: Date.now() }
    }
  });

  await caller.idea.update({
    projectPath: testProjectPath,
    ideaId: ideaResult.id,
    idea: {
      reflection: 'This worked better after reducing scope.',
      archived: true
    }
  });

  const fetchedIdea = await caller.idea.get({ projectPath: testProjectPath, ideaId: ideaResult.id });
  assert.strictEqual(fetchedIdea.reflection, 'This worked better after reducing scope.');
  assert.strictEqual(fetchedIdea.archived, true);
});

test('idea.merge - preserves source knowledge and archives it consistently', async () => {
  const parent = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: { text: 'Parent', status: { state: 'open', comment: '', date: Date.now() } }
  });
  const target = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Canonical idea',
      tags: ['canonical'],
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });
  const source = await caller.idea.createSubIdea({
    projectPath: testProjectPath,
    parentIdeaId: parent.id,
    idea: {
      text: 'Duplicate idea',
      tags: ['duplicate', 'canonical'],
      status: { state: 'implemented', comment: '', date: Date.now() }
    }
  });
  await caller.idea.update({
    projectPath: testProjectPath,
    ideaId: target.id,
    idea: { reflection: 'Target legacy reflection' }
  });
  await caller.idea.update({
    projectPath: testProjectPath,
    ideaId: source.id,
    idea: { reflection: 'Source legacy reflection' }
  });
  await caller.idea.addReflection({
    projectPath: testProjectPath,
    ideaId: target.id,
    reflection: {
      context: 'target context',
      outcome: 'target outcome',
      effectiveness: 'target effectiveness',
      lesson: 'target lesson'
    }
  });
  await caller.idea.addReflection({
    projectPath: testProjectPath,
    ideaId: source.id,
    reflection: {
      context: 'source context',
      outcome: 'source outcome',
      effectiveness: 'source effectiveness',
      lesson: 'source lesson'
    }
  });
  const phase = await caller.phase.create({
    projectPath: testProjectPath,
    phase: { name: 'Merge phase' }
  });
  await caller.idea.commitToPhase({
    projectPath: testProjectPath,
    ideaId: source.id,
    phaseId: phase.id
  });

  const result = await caller.idea.merge({
    projectPath: testProjectPath,
    targetId: target.id,
    sourceId: source.id
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.reflectionsCopied, 1);

  const merged = await caller.idea.get({ projectPath: testProjectPath, ideaId: target.id });
  assert.deepEqual(merged.supportedIdeas, [parent.id]);
  assert.deepEqual(merged.committedIn, [phase.id]);
  assert.deepEqual(merged.tags, ['canonical', 'duplicate']);
  assert.match(merged.reflection ?? '', /Target legacy reflection/);
  assert.match(merged.reflection ?? '', /Source legacy reflection/);
  assert.strictEqual(merged.reflections.length, 2);

  const mergedParent = await caller.idea.get({ projectPath: testProjectPath, ideaId: parent.id });
  assert.deepEqual(mergedParent.supportingConnections.map((connection) => connection.ideaId), [target.id]);

  const archivedSource = await caller.idea.get({ projectPath: testProjectPath, ideaId: source.id });
  assert.strictEqual(archivedSource.status.state, 'archived');
  assert.strictEqual(archivedSource.archived, true);
  assert.deepEqual(archivedSource.supportedIdeas, []);
  assert.deepEqual(archivedSource.supportingConnections, []);
  assert.deepEqual(archivedSource.committedIn, []);
  assert.strictEqual(await fs.pathExists(path.join(testProjectPath, 'ideas', `${source.id}.json`)), false);
  assert.strictEqual(await fs.pathExists(path.join(testProjectPath, 'archived-ideas', `${source.id}.json`)), true);
});

test('discoverLocalProjects - finds nearby repositories with .bowman directories', async () => {
  const workspaceRoot = path.join(testRootPath, 'workspace');
  const repoA = path.join(workspaceRoot, 'repo-a');
  const repoB = path.join(workspaceRoot, 'nested', 'repo-b');
  const plainDir = path.join(workspaceRoot, 'plain-dir');

  await fs.ensureDir(path.join(repoA, '.bowman'));
  await fs.ensureDir(path.join(repoB, '.bowman'));
  await fs.ensureDir(plainDir);

  const result = await caller.project.discoverLocalProjects({
    roots: [workspaceRoot],
    maxDepth: 3
  });

  assert.deepEqual(result.rootsScanned, [workspaceRoot]);
  assert.deepEqual(
    result.projects.map((project) => project.path).sort(),
    [repoA, repoB].sort()
  );
  assert.deepEqual(
    result.projects.map((project) => project.bowmanPath).sort(),
    [path.join(repoA, '.bowman'), path.join(repoB, '.bowman')].sort()
  );
});

test('inspectPath - distinguishes an existing .bowman from a new project path', async () => {
  const existingRoot = path.join(testRootPath, 'existing');
  await fs.ensureDir(path.join(existingRoot, '.bowman'));
  await fs.writeJson(path.join(existingRoot, '.bowman', 'meta.json'), {
    name: 'Existing',
    color: '#123456',
  });

  const existing = await caller.project.inspectPath({ projectPath: existingRoot });
  const fresh = await caller.project.inspectPath({ projectPath: path.join(testRootPath, 'fresh') });

  assert.equal(existing.bowmanExists, true);
  assert.equal(existing.bowmanPath, path.join(existingRoot, '.bowman'));
  assert.equal(fresh.bowmanExists, false);
});

test('phase.delete - child phases take the deleted phase slot in order', async () => {
  const create = async (name: string, parent: string | null) =>
    (await caller.phase.create({ projectPath: testProjectPath, phase: { name, parent } })).id;
  const root = await create('Root', null);
  const before = await create('Before', root);
  const doomed = await create('Doomed', root);
  const after = await create('After', root);
  const childA = await create('Child A', doomed);
  const childB = await create('Child B', doomed);

  await caller.phase.delete({ projectPath: testProjectPath, phaseId: doomed });

  const rootPhase = await caller.phase.get({ projectPath: testProjectPath, phaseId: root });
  assert.deepStrictEqual(rootPhase.childPhaseIds, [before, childA, childB, after]);
  for (const childId of [childA, childB]) {
    const child = await caller.phase.get({ projectPath: testProjectPath, phaseId: childId });
    assert.strictEqual(child.parent, root);
  }
});

test('history.restore - restores snapshots, and refuses when an entity changed since', async () => {
  const create = async (name: string, parent: string | null) =>
    (await caller.phase.create({ projectPath: testProjectPath, phase: { name, parent } })).id;
  const root = await create('Root', null);
  const doomed = await create('Doomed', root);
  const child = await create('Child', doomed);

  const files = {
    root: path.join(testProjectPath, 'phases', `${root}.json`),
    doomed: path.join(testProjectPath, 'phases', `${doomed}.json`),
    child: path.join(testProjectPath, 'phases', `${child}.json`)
  };
  const read = async (file: string) => (await fs.pathExists(file)) ? fs.readJson(file) : null;
  const before = { root: await read(files.root), doomed: await read(files.doomed), child: await read(files.child) };

  await caller.phase.delete({ projectPath: testProjectPath, phaseId: doomed });
  const after = { root: await read(files.root), doomed: await read(files.doomed), child: await read(files.child) };
  assert.strictEqual(after.doomed, null);

  const undoChanges = [
    { type: 'phase' as const, id: root, expected: after.root, target: before.root },
    { type: 'phase' as const, id: doomed, expected: after.doomed, target: before.doomed },
    { type: 'phase' as const, id: child, expected: after.child, target: before.child }
  ];

  // Another client renames the promoted child: undo must be blocked, nothing written.
  await caller.phase.update({ projectPath: testProjectPath, phaseId: child, phase: { name: 'Renamed elsewhere' } });
  const blocked = await caller.history.restore({ projectPath: testProjectPath, changes: undoChanges });
  assert.strictEqual(blocked.ok, false);
  assert.deepStrictEqual(blocked.conflicts, [{ type: 'phase', id: child }]);
  assert.strictEqual(await read(files.doomed), null);

  // Without the interfering edit the undo restores the exact prior state.
  await fs.writeJson(files.child, after.child, { spaces: 2 });
  const undone = await caller.history.restore({ projectPath: testProjectPath, changes: undoChanges });
  assert.strictEqual(undone.ok, true);
  assert.deepStrictEqual(await read(files.root), before.root);
  assert.deepStrictEqual(await read(files.doomed), before.doomed);
  assert.deepStrictEqual(await read(files.child), before.child);
});

test('a pre-rename .bowman (aims/, done) is migrated on first access and read as ideas', async () => {
  const parentId = uuidv4();
  const childId = uuidv4();
  const legacyAim = (id: string, state: string, extra: object) => ({
    id, text: `legacy ${state}`, tags: [], committedIn: [], status: { state, comment: '', date: 1 }, ...extra
  });
  await fs.outputJson(path.join(testProjectPath, 'aims', `${parentId}.json`),
    legacyAim(parentId, 'done', { supportedAims: [], supportingConnections: [{ aimId: childId, relativePosition: [0, 0], weight: 1 }] }));
  await fs.outputJson(path.join(testProjectPath, 'aims', `${childId}.json`),
    legacyAim(childId, 'open', { supportedAims: [parentId], supportingConnections: [] }));
  await fs.outputJson(path.join(testProjectPath, 'meta.json'),
    { name: 'Legacy', color: '#007acc', statuses: [{ key: 'open', color: '#fff' }, { key: 'done', color: '#0f0' }] });

  const [ideas, meta] = await Promise.all([
    caller.idea.list({ projectPath: testProjectPath }),
    caller.project.getMeta({ projectPath: testProjectPath })
  ]);

  const parent = ideas.find((idea) => idea.id === parentId)!;
  assert.equal(parent.status.state, 'implemented');
  assert.equal(parent.supportingConnections[0]!.ideaId, childId);
  assert.deepStrictEqual(ideas.find((idea) => idea.id === childId)!.supportedIdeas, [parentId]);
  assert.deepStrictEqual(meta.statuses!.map((status) => status.key), ['open', 'implemented']);
  assert.equal(await fs.pathExists(path.join(testProjectPath, 'aims')), false);
});
