import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { appRouter } from './server.js';
import { clearIndices } from './search.js';
import { generateEmbedding, loadVectorStore, saveEmbedding } from './embeddings.js';

const caller = appRouter.createCaller({});
const TEST_ROOT_PATH = path.join(process.cwd(), 'test-project-embeddings');
const TEST_PROJECT_PATH = path.join(TEST_ROOT_PATH, '.bowman');

beforeEach(async () => {
  await fs.remove(TEST_ROOT_PATH);
  await fs.ensureDir(TEST_PROJECT_PATH);
});

afterEach(async () => {
  await fs.remove(TEST_ROOT_PATH);
  clearIndices(TEST_ROOT_PATH);
  clearIndices(TEST_PROJECT_PATH);
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
  const vectorPath = path.join(TEST_PROJECT_PATH, 'vectors.json');
  await fs.writeJson(vectorPath, {
    legacy: [0.1, 0.2, 0.3],
    broken: ['x', 1, 2],
  }, { spaces: 0 });

  const store = await loadVectorStore(TEST_ROOT_PATH);
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
    projectPath: TEST_ROOT_PATH,
    aim: { text: 'Open source release checklist', status: { state: 'open', comment: '', date: Date.now() } }
  });
  const gardenAim = await caller.aim.createFloatingAim({
    projectPath: TEST_ROOT_PATH,
    aim: { text: 'Water the balcony tomatoes', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const releaseVector = await generateEmbedding('Open source release checklist');
  const gardenVector = await generateEmbedding('Water the balcony tomatoes');

  assert.ok(releaseVector);
  assert.ok(gardenVector);

  await saveEmbedding(TEST_ROOT_PATH, releaseAim.id, releaseVector);
  await saveEmbedding(TEST_ROOT_PATH, gardenAim.id, gardenVector);

  const results = await caller.aim.searchSemantic({
    projectPath: TEST_ROOT_PATH,
    query: 'release docs open source',
    limit: 2,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.id, releaseAim.id);
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});
