import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import os from 'node:os';
import path from 'path';
import fs from 'fs-extra';
import { closeDb, saveIdeaValues, getIdeaValues } from './db.js';

let testProjectPath = '';

beforeEach(async () => {
  testProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-db-test-'));
});

afterEach(async () => {
  closeDb(testProjectPath);
  await fs.remove(testProjectPath);
});

test('saveIdeaValues and getIdeaValues', () => {
  const values = new Map();
  values.set('idea-1', { value: 10, cost: 5, doneCost: 2 });
  values.set('idea-2', { value: 20, cost: 10, doneCost: 0 });

  saveIdeaValues(testProjectPath, values);

  const retrieved = getIdeaValues(testProjectPath);
  
  assert.equal(retrieved.size, 2);
  
  const idea1 = retrieved.get('idea-1');
  assert.ok(idea1);
  assert.equal(idea1.value, 10);
  assert.equal(idea1.cost, 5);
  assert.equal(idea1.doneCost, 2);

  const idea2 = retrieved.get('idea-2');
  assert.ok(idea2);
  assert.equal(idea2.value, 20);
});

test('saveIdeaValues replaces existing values', () => {
  const values1 = new Map();
  values1.set('idea-1', { value: 10, cost: 5, doneCost: 0 });
  saveIdeaValues(testProjectPath, values1);

  const values2 = new Map();
  values2.set('idea-1', { value: 15, cost: 6, doneCost: 1 }); // Updated
  values2.set('idea-3', { value: 30, cost: 1, doneCost: 0 }); // New
  // idea-2 missing, should be removed if we are doing full snapshot replace
  
  saveIdeaValues(testProjectPath, values2);

  const retrieved = getIdeaValues(testProjectPath);
  
  assert.equal(retrieved.size, 2);
  
  const idea1 = retrieved.get('idea-1');
  assert.equal(idea1!.value, 15);
  
  const idea3 = retrieved.get('idea-3');
  assert.equal(idea3!.value, 30);
});
