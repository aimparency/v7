import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server.js';
import { clearIndices } from './search.js';
import { generateEmbedding, loadVectorStore, saveEmbedding } from './embeddings.js';

const caller = appRouter.createCaller({});
let testRootPath = '';
let testProjectPath = '';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-embeddings-test-'));
  testProjectPath = path.join(testRootPath, '.bowman');
  await fs.ensureDir(testProjectPath);
});

afterEach(async () => {
  await fs.remove(testRootPath);
  clearIndices(testRootPath);
  clearIndices(testProjectPath);
});

test('generateEmbedding returns stable normalized vectors', async () => {
  const first = await generateEmbedding('Write release docs for local startup');
  const second = await generateEmbedding('Write release docs for local startup');

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.length, 256);
  assert.deepEqual(first, second);

  const magnitude = Math.sqrt(first.reduce((sum, value) => sum + (value * value), 0));
  assert.ok(Math.abs(magnitude - 1) < 0.00001);
});

test('loadVectorStore drops malformed vectors but keeps numeric ones', async () => {
  const vectorPath = path.join(testProjectPath, 'vectors.json');
  await fs.writeJson(vectorPath, {
    legacy: [0.1, 0.2, 0.3],
    broken: ['x', 1, 2],
  }, { spaces: 0 });

  const store = await loadVectorStore(testRootPath);
  assert.deepEqual(store, {
    legacy: [0.1, 0.2, 0.3],
  });

  const persisted = await fs.readJson(vectorPath);
  assert.deepEqual(persisted, {
    legacy: [0.1, 0.2, 0.3],
  });
});

test('semantic search works with local embeddings', async () => {
  const releaseAim = await caller.aim.createFloatingAim({
    projectPath: testRootPath,
    aim: { text: 'Open source release checklist', status: { state: 'open', comment: '', date: Date.now() } }
  });
  const gardenAim = await caller.aim.createFloatingAim({
    projectPath: testRootPath,
    aim: { text: 'Water the balcony tomatoes', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const releaseVector = await generateEmbedding('Open source release checklist');
  const gardenVector = await generateEmbedding('Water the balcony tomatoes');

  assert.ok(releaseVector);
  assert.ok(gardenVector);

  await saveEmbedding(testRootPath, releaseAim.id, releaseVector);
  await saveEmbedding(testRootPath, gardenAim.id, gardenVector);

  const results = await caller.aim.searchSemantic({
    projectPath: testRootPath,
    query: 'release docs open source',
    limit: 2,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.id, releaseAim.id);
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});
