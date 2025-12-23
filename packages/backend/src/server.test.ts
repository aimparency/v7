import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { appRouter } from './server';

import { v4 as uuidv4 } from 'uuid';

// Create a test caller
const caller = appRouter.createCaller({});

const TEST_PROJECT_PATH = path.join(process.cwd(), 'test-project', '.bowman');

beforeEach(async () => {
  // Clean up any existing test project
  await fs.remove(TEST_PROJECT_PATH);
  await fs.ensureDir(TEST_PROJECT_PATH);
});

afterEach(async () => {
  // Clean up test project
  await fs.remove(TEST_PROJECT_PATH);
});

test('connectAims - connects two existing aims', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create child aim
  const childResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Child Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect them
  await caller.aim.connectAims({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    childAimId: childResult.id,
    parentIncomingIndex: 0, 
    childSupportedAimsIndex: 0
  });

  // Verify connection
  const updatedParent = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: parentResult.id
  });
  const updatedChild = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: childResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].aimId, childResult.id);
  assert.deepEqual(updatedChild.supportedAims, [parentResult.id]);
});

test('createSubAim - creates and connects sub-aim', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create sub-aim
  const subAimResult = await caller.aim.createSubAim({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    aim: {
      text: 'Sub Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    },
    positionInParent: 0 
  });

  // Verify creation and connection
  const updatedParent = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: parentResult.id
  });
  const subAim = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
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
    projectPath: TEST_PROJECT_PATH,
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
    projectPath: TEST_PROJECT_PATH,
    phaseId: phaseResult.id,
    aim: {
      text: 'Committed Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    },
    insertionIndex: 0
  });

  // Verify creation and commitment
  const updatedPhase = await caller.phase.get({
    projectPath: TEST_PROJECT_PATH,
    phaseId: phaseResult.id
  });
  const aim = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: aimResult.id
  });

  assert.deepEqual(updatedPhase.commitments, [aimResult.id]);
  assert.deepEqual(aim.committedIn, [phaseResult.id]);
  assert.equal(aim.text, 'Committed Aim');
});

test('connectAims - repositioning existing connections', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create two child aims
  const child1Result = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Child 1',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const child2Result = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Child 2',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect first child at position 0
  await caller.aim.connectAims({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    childAimId: child1Result.id,
    parentIncomingIndex: 0,
    childSupportedAimsIndex: 0
  });

  // Connect second child at position 0 (should move first child to position 1)
  await caller.aim.connectAims({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    childAimId: child2Result.id,
    parentIncomingIndex: 0, 
    childSupportedAimsIndex: 0
  });

  // Verify repositioning
  const updatedParent = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: parentResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 2);
  assert.equal(updatedParent.supportingConnections[0].aimId, child2Result.id);
  assert.equal(updatedParent.supportingConnections[1].aimId, child1Result.id);
});

test('list - filters aims by status and phase', async () => {
  // Create phase
  const phaseResult = await caller.phase.create({
    projectPath: TEST_PROJECT_PATH,
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
    projectPath: TEST_PROJECT_PATH,
    phaseId: phaseResult.id,
    aim: {
      text: 'Open Aim In Phase',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create done aim floating
  await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Done Floating Aim',
      status: { state: 'done', comment: '', date: Date.now() }
    }
  });

  // Test status filter
  const openAims = await caller.aim.list({
    projectPath: TEST_PROJECT_PATH,
    status: 'open'
  });
  assert.equal(openAims.length, 1);
  assert.equal(openAims[0].text, 'Open Aim In Phase');

  // Test phase filter
  const phaseAims = await caller.aim.list({
    projectPath: TEST_PROJECT_PATH,
    phaseId: phaseResult.id
  });
  assert.equal(phaseAims.length, 1);
  assert.equal(phaseAims[0].text, 'Open Aim In Phase');

  // Test combined filter
  const filteredAims = await caller.aim.list({
    projectPath: TEST_PROJECT_PATH,
    status: 'open',
    phaseId: phaseResult.id
  });
  assert.equal(filteredAims.length, 1);
});

test('search - matches aims using search index', async () => {
  // Create test aims
  await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'Apple Pie', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'Banana Split', status: { state: 'open', comment: '', date: Date.now() } }
  });
  await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'Apple Cider', status: { state: 'open', comment: '', date: Date.now() } }
  });

  // Build index (usually happens on project load, but we can trigger it or trust createFloatingAim updates it)
  // createFloatingAim calls addAimToIndex, so it should be immediate.
  
  // Search for "Apple"
  const results = await caller.aim.search({
    projectPath: TEST_PROJECT_PATH,
    query: 'Apple'
  });

  assert.equal(results.length, 2);
  const texts = results.map(r => r.text).sort();
  assert.deepEqual(texts, ['Apple Cider', 'Apple Pie']);
});

test('createFloatingAim - sets and persists intrinsicValue', async () => {
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Valuable Aim',
      status: { state: 'open', comment: '', date: Date.now() },
      intrinsicValue: 42
    }
  });

  const aim = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: aimResult.id
  });

  assert.equal(aim.intrinsicValue, 42);
});

test('createFloatingAim - defaults intrinsicValue to 0', async () => {
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Default Value Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const aim = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: aimResult.id
  });

  assert.equal(aim.intrinsicValue, 0);
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

  await fs.ensureDir(path.join(TEST_PROJECT_PATH, 'aims'));
  await fs.writeJson(path.join(TEST_PROJECT_PATH, 'aims', `${aimId}.json`), legacyAim);

  // Read the aim (should trigger migration)
  const migratedAim = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
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
  const persistedAim = await fs.readJson(path.join(TEST_PROJECT_PATH, 'aims', `${aimId}.json`));
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

  await fs.ensureDir(path.join(TEST_PROJECT_PATH, 'aims'));
  await fs.writeJson(path.join(TEST_PROJECT_PATH, 'aims', `${aimId}.json`), legacyAim);

  // Read the aim (should trigger migration)
  const migratedAim = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: aimId
  });

  // Verify in-memory result
  assert.deepEqual(migratedAim.supportedAims, [parent1Id, parent2Id]);
  assert.equal((migratedAim as any).outgoing, undefined);

  // Verify persistence
  const persistedAim = await fs.readJson(path.join(TEST_PROJECT_PATH, 'aims', `${aimId}.json`));
  assert.deepEqual(persistedAim.supportedAims, [parent1Id, parent2Id]);
  assert.equal(persistedAim.outgoing, undefined);
});

test('connectAims - connects with relative position', async () => {

  // Create parent aim
  const parentResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Parent Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create child aim
  const childResult = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Child Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const relativePosition: [number, number] = [0.5, 0.8];

  // Connect them
  await caller.aim.connectAims({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    childAimId: childResult.id,
    relativePosition: relativePosition
  });

  // Verify connection
  const updatedParent = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: parentResult.id
  });

  assert.equal(updatedParent.supportingConnections.length, 1);
  assert.equal(updatedParent.supportingConnections[0].aimId, childResult.id);
  assert.deepEqual(updatedParent.supportingConnections[0].relativePosition, relativePosition);
});
