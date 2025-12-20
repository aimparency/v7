import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { getDb, closeDb, saveAimValues, getAimValues } from './db.js';

const TEST_PROJECT_PATH = path.join(process.cwd(), 'test-db-project');

beforeEach(async () => {
  await fs.remove(TEST_PROJECT_PATH);
  await fs.ensureDir(TEST_PROJECT_PATH);
});

afterEach(async () => {
  closeDb(TEST_PROJECT_PATH);
  await fs.remove(TEST_PROJECT_PATH);
});

test('saveAimValues and getAimValues', () => {
  const values = new Map();
  values.set('aim-1', { value: 10, cost: 5, doneCost: 2 });
  values.set('aim-2', { value: 20, cost: 10, doneCost: 0 });

  saveAimValues(TEST_PROJECT_PATH, values);

  const retrieved = getAimValues(TEST_PROJECT_PATH);
  
  assert.equal(retrieved.size, 2);
  
  const aim1 = retrieved.get('aim-1');
  assert.ok(aim1);
  assert.equal(aim1.value, 10);
  assert.equal(aim1.cost, 5);
  assert.equal(aim1.doneCost, 2);

  const aim2 = retrieved.get('aim-2');
  assert.ok(aim2);
  assert.equal(aim2.value, 20);
});

test('saveAimValues replaces existing values', () => {
  const values1 = new Map();
  values1.set('aim-1', { value: 10, cost: 5, doneCost: 0 });
  saveAimValues(TEST_PROJECT_PATH, values1);

  const values2 = new Map();
  values2.set('aim-1', { value: 15, cost: 6, doneCost: 1 }); // Updated
  values2.set('aim-3', { value: 30, cost: 1, doneCost: 0 }); // New
  // aim-2 missing, should be removed if we are doing full snapshot replace
  
  saveAimValues(TEST_PROJECT_PATH, values2);

  const retrieved = getAimValues(TEST_PROJECT_PATH);
  
  assert.equal(retrieved.size, 2);
  
  const aim1 = retrieved.get('aim-1');
  assert.equal(aim1.value, 15);
  
  const aim3 = retrieved.get('aim-3');
  assert.equal(aim3.value, 30);
});
