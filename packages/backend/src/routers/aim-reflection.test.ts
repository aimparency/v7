import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import * as path from 'path';
import { appRouter } from '../server.js';
import { clearIndices } from '../search.js';

const caller = appRouter.createCaller({});
let testRootPath = '';
let testProjectPath = '';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-reflection-test-'));
  testProjectPath = path.join(testRootPath, '.bowman');
  await fs.ensureDir(testProjectPath);
});

afterEach(async () => {
  await fs.remove(testRootPath);
  clearIndices(testProjectPath);
});

test('addReflection adds a new reflection to an aim', async () => {
  // Create test aim
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Test Aim for Reflection',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Verify it starts with empty reflections
  const loadedAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimResult.id
  });
  assert.deepStrictEqual(loadedAim.reflections, [], 'Should start with empty reflections array');

  // Add a reflection
  const reflection = {
    context: 'I was trying to implement feature X',
    outcome: 'Successfully implemented with minimal bugs',
    effectiveness: 'The approach worked well',
    lesson: 'Start with tests next time',
    pattern: 'This is similar to previous implementation of feature Y'
  };

  await caller.aim.addReflection({
    projectPath: testProjectPath,
    aimId: aimResult.id,
    reflection
  });

  // Verify reflection was saved
  const updatedAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimResult.id
  });
  assert.strictEqual(updatedAim.reflections!.length, 1, 'Should have one reflection');
  assert.strictEqual(updatedAim.reflections![0]!.context, reflection.context);
  assert.strictEqual(updatedAim.reflections![0]!.outcome, reflection.outcome);
  assert.strictEqual(updatedAim.reflections![0]!.effectiveness, reflection.effectiveness);
  assert.strictEqual(updatedAim.reflections![0]!.lesson, reflection.lesson);
  assert.strictEqual(updatedAim.reflections![0]!.pattern, reflection.pattern);
});

test('addReflection handles multiple reflections', async () => {
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Test Aim with Multiple Reflections',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Add first reflection
  await caller.aim.addReflection({
    projectPath: testProjectPath,
    aimId: aimResult.id,
    reflection: {
      context: 'First attempt',
      outcome: 'Partial success',
      effectiveness: 'Moderate',
      lesson: 'Need better planning'
    }
  });

  // Add second reflection
  await caller.aim.addReflection({
    projectPath: testProjectPath,
    aimId: aimResult.id,
    reflection: {
      context: 'Second attempt with better planning',
      outcome: 'Full success',
      effectiveness: 'Very effective',
      lesson: 'Planning pays off',
      pattern: 'Consistent pattern: planning improves outcomes'
    }
  });

  // Verify both reflections exist
  const finalAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimResult.id
  });
  assert.strictEqual(finalAim.reflections!.length, 2, 'Should have two reflections');
  assert.strictEqual(finalAim.reflections![0]!.context, 'First attempt');
  assert.strictEqual(finalAim.reflections![1]!.context, 'Second attempt with better planning');
});

test('reflections field is initialized on aim creation', async () => {
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'New Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const loadedAim = await caller.aim.get({
    projectPath: testProjectPath,
    aimId: aimResult.id
  });
  assert.ok(Array.isArray(loadedAim.reflections), 'reflections should be an array');
  assert.strictEqual(loadedAim.reflections!.length, 0, 'reflections should start empty');
});

test('reflections persist across multiple reads', async () => {
  const aimResult = await caller.aim.createFloatingAim({
    projectPath: testProjectPath,
    aim: {
      text: 'Persistence Test Aim',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Add reflection
  await caller.aim.addReflection({
    projectPath: testProjectPath,
    aimId: aimResult.id,
    reflection: {
      context: 'Testing persistence',
      outcome: 'Should work',
      effectiveness: 'High',
      lesson: 'File-based storage is reliable'
    }
  });

  // Read multiple times
  for (let i = 0; i < 3; i++) {
    const reloadedAim = await caller.aim.get({
      projectPath: testProjectPath,
      aimId: aimResult.id
    });
    assert.strictEqual(reloadedAim.reflections!.length, 1, `Read ${i + 1}: Should still have one reflection`);
    assert.strictEqual(reloadedAim.reflections![0]!.lesson, 'File-based storage is reliable');
  }
});
