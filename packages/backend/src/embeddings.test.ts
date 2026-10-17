import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server.js';
import { clearIndices } from './search.js';
import { generateEmbedding, invalidateVectorCache, loadVectorStore, saveEmbedding } from './embeddings.js';
import { cacheDatabasePath, closeDb } from './db.js';

const caller = appRouter.createCaller({});
let testRootPath = '';
let testProjectPath = '';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-embeddings-test-'));
  testProjectPath = path.join(testRootPath, '.bowman');
  await fs.ensureDir(testProjectPath);
});

afterEach(async () => {
  closeDb(testRootPath);
  invalidateVectorCache(testRootPath);
  await fs.remove(testRootPath);
  clearIndices(testRootPath);
  clearIndices(testProjectPath);
});

test('generateEmbedding returns stable normalized vectors', async () => {
  const first = await generateEmbedding('Write release docs for local startup');
  const second = await generateEmbedding('Write release docs for local startup');

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.length, 384);
  assert.deepEqual(first, second);

  const magnitude = Math.sqrt(first.reduce((sum, value) => sum + (value * value), 0));
  assert.ok(Math.abs(magnitude - 1) < 0.00001);
});

test('imports a legacy vectors.json into the cache database once, dropping malformed vectors', async () => {
  const legacyPath = path.join(testProjectPath, 'vectors.json');
  await fs.writeJson(legacyPath, { legacy: [0.5, 0.25, -1], broken: ['x', 1, 2] }, { spaces: 0 });
  await fs.writeFile(path.join(testProjectPath, 'semantic-graph.json'), '{}');

  const store = await loadVectorStore(testRootPath);
  assert.deepEqual(store, { legacy: [0.5, 0.25, -1] });
  assert.equal(await fs.pathExists(legacyPath), false);
  assert.equal(await fs.pathExists(path.join(testProjectPath, 'semantic-graph.json')), false);
  assert.ok(await fs.pathExists(cacheDatabasePath(testRootPath)));
});

test('moves a legacy cache.db into the cache folder', async () => {
  closeDb(testRootPath);
  const Database = (await import('better-sqlite3')).default;
  const legacy = new Database(path.join(testProjectPath, 'cache.db'));
  legacy.exec("CREATE TABLE idea_values (id TEXT PRIMARY KEY, value REAL DEFAULT 0, cost REAL DEFAULT 0, done_cost REAL DEFAULT 0, priority REAL DEFAULT 0); INSERT INTO idea_values (id, value) VALUES ('kept', 7)");
  legacy.close();

  const { getIdeaValues } = await import('./db.js');
  assert.equal(getIdeaValues(testRootPath).get('kept')?.value, 7);
  assert.equal(await fs.pathExists(path.join(testProjectPath, 'cache.db')), false);
});

test('stores vectors one row each and reads them back', async () => {
  await saveEmbedding(testRootPath, 'a', [0.5, -0.25]);
  invalidateVectorCache(testRootPath);
  assert.deepEqual(await loadVectorStore(testRootPath), { a: [0.5, -0.25] });
});

test('semantic search works with local embeddings', async () => {
  const releaseIdea = await caller.idea.createFloatingIdea({
    projectPath: testRootPath,
    idea: { text: 'Open source release checklist', status: { state: 'open', comment: '', date: Date.now() } }
  });
  const gardenIdea = await caller.idea.createFloatingIdea({
    projectPath: testRootPath,
    idea: { text: 'Water the balcony tomatoes', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const releaseVector = await generateEmbedding('Open source release checklist');
  const gardenVector = await generateEmbedding('Water the balcony tomatoes');

  assert.ok(releaseVector);
  assert.ok(gardenVector);

  await saveEmbedding(testRootPath, releaseIdea.id, releaseVector);
  await saveEmbedding(testRootPath, gardenIdea.id, gardenVector);

  const results = await caller.idea.searchSemantic({
    projectPath: testRootPath,
    query: 'release docs open source',
    limit: 2,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.id, releaseIdea.id);
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});
