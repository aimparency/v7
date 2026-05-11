import { test, beforeEach, afterEach } from 'node:test';
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

test('connectAims - connects two existing aims', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create child aim
  const childResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Child Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect them
  await caller.aim.connectAims({
    projectPath: testProjectPath,
    parentAimId: parentResult.id,
    childAimId: childResult.id,
    parentIncomingIndex: 0, 
    childSupportedAimsIndex: 0
  });

  // Verify connection
  const updatedParent = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: parentResult.id
  });
  const updatedChild = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: childResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].aimId, childResult.id);
  assert.deepEqual(updatedChild.supportedAims, [parentResult.id]);
});

test('createSubAim - creates and connects sub-aim', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create sub-aim
  const subAimResult = await caller.aim.createSubAim({
    projectPath: testProjectPath,
    parentAimId: parentResult.id,
    aim: {
      text: 'Sub Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    },
    positionInParent: 0 
  });

  // Verify creation and connection
  const updatedParent = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: parentResult.id
  });
  const subAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: subAimResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].aimId, subAimResult.id);
  assert.deepEqual(subAim.supportedAims, [parentResult.id]);
  assert.equal(subAim.text, 'Sub Aim');
});

test('createCommittedAim - creates and commits aim to phase', async () => {

  // Create phase
  const phaseResult = await caller.phase.create({
    projectPath: testProjectPath,
    phase: {
      name: 'Test Phase',
      from: Date.now(),
      to: Date.now() + 86400000, // +1 day
      parent: null,
      commitments: []
    }
  });

  // Create committed aim
  const aimResult = await caller.aim.createAimInPhase({
    projectPath: testProjectPath,
    phaseId: phaseResult.id,
    aim: {
      text: 'Committed Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    },
    insertionIndex: 0
  });

  // Verify creation and commitment
  const updatedPhase = await caller.phase.get({
    projectPath: testProjectPath,
    phaseId: phaseResult.id
  });
  const aim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimResult.id
  });

  assert.deepEqual(updatedPhase.commitments, [aimResult.id]);
  assert.deepEqual(aim.committedIn, [phaseResult.id]);
  assert.equal(aim.text, 'Committed Aim');
});

test('getMany - skips missing aims instead of failing the full batch', async () => {
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Existing Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const results = await caller.aim.getMany({
    projectPath: testProjectPath,
    aimIds: [
      aimResult.id,
      '00000000-0000-4000-8000-000000000000'
    ]
  });

  assert.deepEqual(results.map((aim) => aim.id), [aimResult.id]);
});

test('connectAims - repositioning existing connections', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create two child aims
  const child1Result = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Child 1',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const child2Result = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Child 2',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect first child at position 0
  await caller.aim.connectAims({
    projectPath: testProjectPath,
    parentAimId: parentResult.id,
    childAimId: child1Result.id,
    parentIncomingIndex: 0,
    childSupportedAimsIndex: 0
  });

  // Connect second child at position 0 (should move first child to position 1)
  await caller.aim.connectAims({
    projectPath: testProjectPath,
    parentAimId: parentResult.id,
    childAimId: child2Result.id,
    parentIncomingIndex: 0, 
    childSupportedAimsIndex: 0
  });

  // Verify repositioning
  const updatedParent = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: parentResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 2);
  assert.equal(updatedParent.supportingConnections[0].aimId, child2Result.id);
  assert.equal(updatedParent.supportingConnections[1].aimId, child1Result.id);
});

test('list - filters aims by status and phase', async () => {
  // Create phase
  const phaseResult = await caller.phase.create({
    projectPath: testProjectPath,
    phase: {
      name: 'Test Phase',
      from: Date.now(),
      to: Date.now() + 86400000,
      parent: null,
      commitments: []
    }
  });

  // Create open aim in phase
  await caller.aim.createAimInPhase({
    projectPath: testProjectPath,
    phaseId: phaseResult.id,
    aim: {
      text: 'Open Aim In Phase',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create done aim floating
  await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Done Floating Aim',
      status: { state: 'done', comment: '', date: Date.now() }
    }
  });

  // Test status filter
  const openAims = await caller.aim.list({
    projectPath: testProjectPath,
    status: 'open'
  });
  assert.equal(openAims.length, 1);
  assert.equal(openAims[0].text, 'Open Aim In Phase');

  // Test phase filter
  const phaseAims = await caller.aim.list({
    projectPath: testProjectPath,
    phaseId: phaseResult.id
  });
  assert.equal(phaseAims.length, 1);
  assert.equal(phaseAims[0].text, 'Open Aim In Phase');

  // Test combined filter
  const filteredAims = await caller.aim.list({
    projectPath: testProjectPath,
    status: 'open',
    phaseId: phaseResult.id
  });
  assert.equal(filteredAims.length, 1);
});

test('phase.list skips malformed phase files', async () => {
  const validPhase = await caller.phase.create({
    projectPath: testProjectPath,
    phase: {
      name: 'Valid Phase',
      from: Date.now(),
      to: Date.now() + 1000,
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

test('phase reorder preserves canonical parent-owned order for roots and children', async () => {
  const projectPath = testProjectPath;

  const rootA = await caller.phase.create({
    projectPath,
    phase: {
      name: 'A',
      from: 0,
      to: 0,
      parent: null,
      commitments: []
    }
  });

  const rootB = await caller.phase.create({
    projectPath,
    phase: {
      name: 'B',
      from: 0,
      to: 0,
      parent: null,
      commitments: []
    }
  });

  const childC = await caller.phase.create({
    projectPath,
    phase: {
      name: 'C',
      from: 0,
      to: 0,
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
      from: 0,
      to: 0,
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

test('search - matches aims using search index', async () => {
  // Create test aims
  await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: { text: 'Apple Pie', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: { text: 'Banana Split', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: { text: 'Apple Cider', status: { state: 'open', comment: '', date: Date.now() } }
  });

  // Build index (usually happens on project load, but we can trigger it or trust createFloatingAim updates it)
  // createFloatingAim calls addAimToIndex, so it should be immediate.
  
  // Search for "Apple"
  const results = await caller.aim.search({
    projectPath: testProjectPath,
    query: 'Apple'
  });

  // Hybrid search may return additional semantically similar results
  // So we verify the expected aims are present, not that they're the only results
  const texts = results.map(r => r.text);
  assert.ok(texts.includes('Apple Pie'), 'Should find Apple Pie');
  assert.ok(texts.includes('Apple Cider'), 'Should find Apple Cider');
});

test('search - returns aim id prefix matches first with match metadata', async () => {
  const target = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: { text: 'Unrelated target', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: { text: 'Target by text only', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const query = target.id.slice(0, 8);
  const results = await caller.aim.search({
    projectPath: testProjectPath,
    query
  });

  assert.equal(results[0]?.id, target.id);
  assert.equal(results[0]?.idMatch?.prefix, query);

  const rootPathResults = await caller.aim.search({
    projectPath: testRootPath,
    query
  });
  assert.equal(rootPathResults[0]?.id, target.id);
  assert.equal(rootPathResults[0]?.idMatch?.prefix, query);

  const shortResults = await caller.aim.search({
    projectPath: testProjectPath,
    query: target.id.slice(0, 7)
  });
  assert.ok(shortResults.every(result => !result.idMatch));
});

test('createFloatingAim - sets and persists intrinsicValue', async () => {
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Valuable Aim',
      status: { state: 'open', comment: '', date: Date.now() },
      intrinsicValue: 42
    }
  });

  const aim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimResult.id
  });

  assert.equal(aim.intrinsicValue, 42);
});

test('createFloatingAim - first aim defaults intrinsicValue to 1000', async () => {
  // First aim in empty project should default to 1000
  const firstAimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'First Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const firstAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: firstAimResult.id
  });

  assert.equal(firstAim.intrinsicValue, 1000);

  // Second aim should default to 0
  const secondAimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Second Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const secondAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: secondAimResult.id
  });

  assert.equal(secondAim.intrinsicValue, 0);
});

test('readAim - performs lazy migration of incoming array', async () => {
  // Manually create a file with legacy structure
  const aimId = uuidv4();
  const child1Id = uuidv4();
  const child2Id = uuidv4();
  const newChildId = uuidv4();

  const legacyAim = {
    id: aimId,
    text: 'Legacy Aim',
    status: { state: 'open', comment: '', date: Date.now() },
    incoming: [child1Id, child2Id], // Legacy field
    supportingConnections: [
      { aimId: newChildId, relativePosition: [0, 0], weight: 1 } // New field existing
    ],
    outgoing: [],
    committedIn: []
  };

  await fs.ensureDir(path.join(testProjectPath, 'aims'));
  await fs.writeJson(path.join(testProjectPath, 'aims', `${aimId}.json`), legacyAim);

  // Read the aim (should trigger migration)
  const migratedAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimId
  });

  // Verify in-memory result
  assert.equal(migratedAim.supportingConnections.length, 3);
  // Order: legacy (prepended) then existing
  assert.equal(migratedAim.supportingConnections[0].aimId, child1Id);
  assert.equal(migratedAim.supportingConnections[1].aimId, child2Id);
  assert.equal(migratedAim.supportingConnections[2].aimId, newChildId);
  assert.equal((migratedAim as any).incoming, undefined);

  // Verify persistence
  const persistedAim = await fs.readJson(path.join(testProjectPath, 'aims', `${aimId}.json`));
  assert.equal(persistedAim.supportingConnections.length, 3);
  assert.equal(persistedAim.incoming, undefined);
});

test('readAim - performs lazy migration of outgoing array', async () => {
  const aimId = uuidv4();
  const parent1Id = uuidv4();
  const parent2Id = uuidv4();

  const legacyAim = {
    id: aimId,
    text: 'Legacy Aim',
    status: { state: 'open', comment: '', date: Date.now() },
    supportingConnections: [],
    outgoing: [parent1Id, parent2Id], // Legacy field
    committedIn: []
  };

  await fs.ensureDir(path.join(testProjectPath, 'aims'));
  await fs.writeJson(path.join(testProjectPath, 'aims', `${aimId}.json`), legacyAim);

  // Read the aim (should trigger migration)
  const migratedAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimId
  });

  // Verify in-memory result
  assert.deepEqual(migratedAim.supportedAims, [parent1Id, parent2Id]);
  assert.equal((migratedAim as any).outgoing, undefined);

  // Verify persistence
  const persistedAim = await fs.readJson(path.join(testProjectPath, 'aims', `${aimId}.json`));
  assert.deepEqual(persistedAim.supportedAims, [parent1Id, parent2Id]);
  assert.equal(persistedAim.outgoing, undefined);
});

test('connectAims - connects with relative position', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create child aim
  const childResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Child Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const relativePosition: [number, number] = [0.5, 0.8];

  // Connect them
  await caller.aim.connectAims({
    projectPath: testProjectPath,
    parentAimId: parentResult.id,
    childAimId: childResult.id,
    relativePosition: relativePosition
  });

  // Verify connection
  const updatedParent = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: parentResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].aimId, childResult.id);
  assert.deepEqual(updatedParent.supportingConnections[0].relativePosition, relativePosition);
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
