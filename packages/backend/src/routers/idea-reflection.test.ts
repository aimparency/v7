import { test, beforeEach, afterEach } from 'vitest';
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

test('addReflection adds a new reflection to an idea', async () => {
  // Create test idea
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Test Idea for Reflection',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Verify it starts with empty reflections
  const loadedIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaResult.id
  });
  assert.deepStrictEqual(loadedIdea.reflections, [], 'Should start with empty reflections array');

  // Add a reflection
  const reflection = {
    context: 'I was trying to implement feature X',
    outcome: 'Successfully implemented with minimal bugs',
    effectiveness: 'The approach worked well',
    lesson: 'Start with tests next time',
    pattern: 'This is similar to previous implementation of feature Y'
  };

  await caller.idea.addReflection({
    projectPath: testProjectPath,
    ideaId: ideaResult.id,
    reflection
  });

  // Verify reflection was saved
  const updatedIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaResult.id
  });
  assert.strictEqual(updatedIdea.reflections!.length, 1, 'Should have one reflection');
  assert.strictEqual(updatedIdea.reflections![0]!.context, reflection.context);
  assert.strictEqual(updatedIdea.reflections![0]!.outcome, reflection.outcome);
  assert.strictEqual(updatedIdea.reflections![0]!.effectiveness, reflection.effectiveness);
  assert.strictEqual(updatedIdea.reflections![0]!.lesson, reflection.lesson);
  assert.strictEqual(updatedIdea.reflections![0]!.pattern, reflection.pattern);
});

test('addReflection handles multiple reflections', async () => {
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Test Idea with Multiple Reflections',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Add first reflection
  await caller.idea.addReflection({
    projectPath: testProjectPath,
    ideaId: ideaResult.id,
    reflection: {
      context: 'First attempt',
      outcome: 'Partial success',
      effectiveness: 'Moderate',
      lesson: 'Need better planning'
    }
  });

  // Add second reflection
  await caller.idea.addReflection({
    projectPath: testProjectPath,
    ideaId: ideaResult.id,
    reflection: {
      context: 'Second attempt with better planning',
      outcome: 'Full success',
      effectiveness: 'Very effective',
      lesson: 'Planning pays off',
      pattern: 'Consistent pattern: planning improves outcomes'
    }
  });

  // Verify both reflections exist
  const finalIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaResult.id
  });
  assert.strictEqual(finalIdea.reflections!.length, 2, 'Should have two reflections');
  assert.strictEqual(finalIdea.reflections![0]!.context, 'First attempt');
  assert.strictEqual(finalIdea.reflections![1]!.context, 'Second attempt with better planning');
});

test('reflections field is initialized on idea creation', async () => {
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'New Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  const loadedIdea = await caller.idea.get({
    projectPath: testProjectPath,
    ideaId: ideaResult.id
  });
  assert.ok(Array.isArray(loadedIdea.reflections), 'reflections should be an array');
  assert.strictEqual(loadedIdea.reflections!.length, 0, 'reflections should start empty');
});

test('reflections persist across multiple reads', async () => {
  const ideaResult = await caller.idea.createFloatingIdea({
    projectPath: testProjectPath,
    idea: {
      text: 'Persistence Test Idea',
      status: { state: 'open', comment: '', date: Date.now() }
    }
  });

  // Add reflection
  await caller.idea.addReflection({
    projectPath: testProjectPath,
    ideaId: ideaResult.id,
    reflection: {
      context: 'Testing persistence',
      outcome: 'Should work',
      effectiveness: 'High',
      lesson: 'File-based storage is reliable'
    }
  });

  // Read multiple times
  for (let i = 0; i < 3; i++) {
    const reloadedIdea = await caller.idea.get({
      projectPath: testProjectPath,
      ideaId: ideaResult.id
    });
    assert.strictEqual(reloadedIdea.reflections!.length, 1, `Read ${i + 1}: Should still have one reflection`);
    assert.strictEqual(reloadedIdea.reflections![0]!.lesson, 'File-based storage is reliable');
  }
});
