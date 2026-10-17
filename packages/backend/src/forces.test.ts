import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { getSemanticGraph, NEAREST_NEIGHBOURS, FURTHEST_NEIGHBOURS } from './forces.js';
import { EMBEDDING_DIMENSION, invalidateVectorCache, removeEmbedding, saveEmbeddings } from './embeddings.js';
import { bumpVectorsVersion, closeDb, encodeVector, getDb } from './db.js';

let testDir = '';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-forces-'));
  await fs.ensureDir(path.join(testDir, '.bowman'));
});

afterEach(async () => {
  closeDb(testDir);
  invalidateVectorCache(testDir);
  await fs.remove(testDir);
});

// Deterministic pseudo-random embeddings.
function randomVectors(count: number, seed: number, prefix = 'idea') {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
  return Array.from({ length: count }, (_, index) => ({
    ideaId: `${prefix}-${index}`,
    vector: Array.from({ length: EMBEDDING_DIMENSION }, random)
  }));
}

// What the lists must be: every pair compared, rows fully sorted.
function bruteForce(vectors: Map<string, number[]>) {
  const unit = new Map([...vectors].map(([id, vector]) => {
    const norm = Math.hypot(...vector);
    return [id, vector.map(value => value / norm)];
  }));
  const expected = new Map<string, { nearest: string[], furthest: string[] }>();
  for (const [id, vector] of unit) {
    const row = [...unit].filter(([other]) => other !== id).map(([other, otherVector]) => ({
      id: other,
      distance: 1 - vector.reduce((sum, value, index) => sum + value * otherVector[index]!, 0)
    })).sort((a, b) => a.distance - b.distance);
    expected.set(id, {
      nearest: row.slice(0, NEAREST_NEIGHBOURS).map(entry => entry.id),
      furthest: row.slice(-FURTHEST_NEIGHBOURS).reverse().map(entry => entry.id)
    });
  }
  return expected;
}

async function actualLists() {
  const graph = await getSemanticGraph(testDir);
  const lists = new Map<string, { nearest: string[], furthest: string[] }>();
  for (const link of graph.links) {
    if (!lists.has(link.source)) lists.set(link.source, { nearest: [], furthest: [] });
    lists.get(link.source)![link.type].push(link.target);
  }
  return lists;
}

const sorted = (lists: Map<string, unknown>) => new Map([...lists].sort(([a], [b]) => a.localeCompare(b)));

test('lists every idea\'s nearest and furthest ideas, exactly', async () => {
  const entries = randomVectors(30, 1);
  await saveEmbeddings(testDir, entries);
  assert.deepEqual(sorted(await actualLists()), sorted(bruteForce(new Map(entries.map(entry => [entry.ideaId, entry.vector])))));
});

test('incremental updates give the same lists as a full build', async () => {
  const entries = randomVectors(40, 2);
  const current = new Map(entries.map(entry => [entry.ideaId, entry.vector]));
  await saveEmbeddings(testDir, entries);
  await getSemanticGraph(testDir); // index loaded: later changes apply incrementally

  const changed = randomVectors(3, 3).map((entry, index) => ({ ideaId: `idea-${index * 7}`, vector: entry.vector }));
  const added = randomVectors(2, 4, 'new');
  await saveEmbeddings(testDir, [...changed, ...added]);
  for (const entry of [...changed, ...added]) current.set(entry.ideaId, entry.vector);
  for (const id of ['idea-1', 'idea-20', 'new-0']) {
    await removeEmbedding(testDir, id);
    current.delete(id);
  }

  assert.deepEqual(sorted(await actualLists()), sorted(bruteForce(current)));
});

test('rebuilds when vectors changed behind its back (another process)', async () => {
  await saveEmbeddings(testDir, randomVectors(10, 5));
  assert.equal((await actualLists()).size, 10);

  const db = getDb(testDir);
  db.transaction(() => {
    db.prepare('INSERT INTO vectors (id, vector) VALUES (?, ?)').run('outside', encodeVector(randomVectors(1, 6)[0]!.vector));
    bumpVectorsVersion(db);
  })();
  assert.ok((await actualLists()).has('outside'));
});

test('persists the lists with the vectors version they reflect', async () => {
  await saveEmbeddings(testDir, randomVectors(8, 7));
  await getSemanticGraph(testDir);
  const db = getDb(testDir);
  const rows = db.prepare('SELECT nearest, furthest FROM semantic_neighbours').all() as { nearest: string, furthest: string }[];
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(JSON.parse(row.nearest).length, 7); // 7 others: fewer than NEAREST_NEIGHBOURS
    assert.equal(JSON.parse(row.furthest).length, FURTHEST_NEIGHBOURS);
  }
  const meta = (key: string) => (db.prepare('SELECT value FROM cache_meta WHERE key = ?').get(key) as { value: string }).value;
  assert.equal(meta('neighbours_version'), meta('vectors_version'));
});

test('handles fewer than two ideas and ignores vectors of another dimension', async () => {
  assert.deepEqual((await getSemanticGraph(testDir)).links, []);
  await saveEmbeddings(testDir, [{ ideaId: 'only', vector: randomVectors(1, 8)[0]!.vector }, { ideaId: 'legacy', vector: [1, 0, 0] }]);
  const graph = await getSemanticGraph(testDir);
  assert.deepEqual(graph.links, []);
  assert.equal(graph.averageDistance, 0);
});
