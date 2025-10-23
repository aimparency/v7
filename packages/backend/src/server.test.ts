import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { appRouter } from './server';

// Create a test caller
const caller = appRouter.createCaller({});

const TEST_PROJECT_PATH = path.join(process.cwd(), 'test-project');

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
  const parentResult = await caller.aim.create({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Parent Aim',
      incoming: [],
      outgoing: [],
      committedIn: [],
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create child aim
  const childResult = await caller.aim.create({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Child Aim',
      incoming: [],
      outgoing: [],
      committedIn: [],
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect them
  await caller.aim.connectAims({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    childAimId: childResult.id,
    parentOutgoingIndex: 0,
    childIncomingIndex: 0
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

  assert.deepEqual(updatedParent.outgoing, [childResult.id]);
  assert.deepEqual(updatedChild.incoming, [parentResult.id]);
});

test('createSubAim - creates and connects sub-aim', async () => {

  // Create parent aim
  const parentResult = await caller.aim.create({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Parent Aim',
      incoming: [],
      outgoing: [],
      committedIn: [],
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create sub-aim
  const subAimResult = await caller.aim.createSubAim({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    aim: {
      text: 'Sub Aim',
      incoming: [],
      outgoing: [],
      committedIn: [],
      status: { state: 'open', comment: '', date: Date.now() }
    },
    parentOutgoingIndex: 0,
    childIncomingIndex: 0
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

  assert.deepEqual(updatedParent.outgoing, [subAimResult.id]);
  assert.deepEqual(subAim.incoming, [parentResult.id]);
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
  const aimResult = await caller.aim.createCommittedAim({
    projectPath: TEST_PROJECT_PATH,
    phaseId: phaseResult.id,
    aim: {
      text: 'Committed Aim',
      incoming: [],
      outgoing: [],
      committedIn: [],
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
  const parentResult = await caller.aim.create({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Parent Aim',
      incoming: [],
      outgoing: [],
      committedIn: [],
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Create two child aims
  const child1Result = await caller.aim.create({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Child 1',
      incoming: [],
      outgoing: [],
      committedIn: [],
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const child2Result = await caller.aim.create({
    projectPath: TEST_PROJECT_PATH,
    aim: {
      text: 'Child 2',
      incoming: [],
      outgoing: [],
      committedIn: [],
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Connect first child at position 0
  await caller.aim.connectAims({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    childAimId: child1Result.id,
    parentOutgoingIndex: 0,
    childIncomingIndex: 0
  });

  // Connect second child at position 0 (should move first child to position 1)
  await caller.aim.connectAims({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentResult.id,
    childAimId: child2Result.id,
    parentOutgoingIndex: 0,
    childIncomingIndex: 0
  });

  // Verify repositioning
  const updatedParent = await caller.aim.get({
    projectPath: TEST_PROJECT_PATH,
    aimId: parentResult.id
  });

  assert.deepEqual(updatedParent.outgoing, [child2Result.id, child1Result.id]);
});