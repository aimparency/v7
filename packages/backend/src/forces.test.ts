import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { calculateSemanticGraph, invalidateSemanticCache, getSemanticGraph } from './forces.js';
import { saveEmbedding } from './embeddings.js';

test('calculateSemanticGraph: assigns 3 nearest and 3 furthest aims for each aim', async () => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-forces-'));

  try {
    // Create .bowman directory
    await fs.ensureDir(path.join(testDir, '.bowman'));

    // Create a vectors.json with 10 aims
    const vectors: Record<string, number[]> = {};
    const aimIds: string[] = [];

    // Generate 10 different embeddings (simplified 3D vectors)
    for (let i = 0; i < 10; i++) {
      const id = `aim-${i}`;
      aimIds.push(id);
      // Create distinct embeddings: spread them in 3D space
      const angle = (i / 10) * Math.PI * 2;
      vectors[id] = [Math.cos(angle), Math.sin(angle), i * 0.1];
    }

    await fs.writeJson(path.join(testDir, '.bowman', 'vectors.json'), vectors);

    // Calculate semantic graph
    const graph = await calculateSemanticGraph(testDir);

    // Check structure
    assert.ok(graph.links.length > 0, 'Should have links');
    assert.ok(typeof graph.averageDistance === 'number', 'Should have average distance');
    assert.ok(typeof graph.lastUpdated === 'number', 'Should have timestamp');

    // Each aim should have 6 links (3 nearest + 3 furthest)
    const linksBySource = new Map<string, any[]>();
    for (const link of graph.links) {
      if (!linksBySource.has(link.source)) {
        linksBySource.set(link.source, []);
      }
      linksBySource.get(link.source)!.push(link);
    }

    for (const aimId of aimIds) {
      const links = linksBySource.get(aimId) || [];
      assert.equal(links.length, 6, `Aim ${aimId} should have exactly 6 links (3 nearest + 3 furthest)`);

      const nearest = links.filter(l => l.type === 'nearest');
      const furthest = links.filter(l => l.type === 'furthest');

      assert.equal(nearest.length, 3, `Aim ${aimId} should have 3 nearest links`);
      assert.equal(furthest.length, 3, `Aim ${aimId} should have 3 furthest links`);
    }

    // Verify cache was saved to disk
    const cacheFile = path.join(testDir, '.bowman', 'semantic-graph.json');
    assert.ok(await fs.pathExists(cacheFile), 'Should save semantic graph to disk');

  } finally {
    await fs.remove(testDir);
  }
});

test('calculateSemanticGraph: handles < 2 aims gracefully', async () => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-forces-'));

  try {
    // Create .bowman directory
    await fs.ensureDir(path.join(testDir, '.bowman'));

    // Empty vectors
    await fs.writeJson(path.join(testDir, '.bowman', 'vectors.json'), {});

    const graph = await calculateSemanticGraph(testDir);

    assert.equal(graph.links.length, 0, 'Should have no links for empty project');
    assert.equal(graph.averageDistance, 0, 'Should have 0 average distance');

    // Single aim
    await fs.writeJson(path.join(testDir, '.bowman', 'vectors.json'), {
      'aim-1': [1, 0, 0]
    });

    const graph2 = await calculateSemanticGraph(testDir);

    assert.equal(graph2.links.length, 0, 'Should have no links for single aim');

  } finally {
    await fs.remove(testDir);
  }
});

test('invalidateSemanticCache: clears memory cache', async () => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-forces-'));

  try {
    // Create .bowman directory
    await fs.ensureDir(path.join(testDir, '.bowman'));

    // Create initial vectors
    const vectors = {
      'aim-1': [1, 0, 0],
      'aim-2': [0, 1, 0],
      'aim-3': [0, 0, 1]
    };
    await fs.writeJson(path.join(testDir, '.bowman', 'vectors.json'), vectors);

    // Get semantic graph (caches it)
    const graph1 = await getSemanticGraph(testDir);
    assert.ok(graph1.links.length > 0, 'Should have links');

    // Modify vectors.json directly
    const newVectors = {
      ...vectors,
      'aim-4': [1, 1, 0],
      'aim-5': [1, 0, 1]
    };
    await fs.writeJson(path.join(testDir, '.bowman', 'vectors.json'), newVectors);

    // WITHOUT invalidation, we'd get the old cached result
    // But first let's verify the cache is working (get same result)
    const graph2 = await getSemanticGraph(testDir);
    // Note: timestamps might differ, so compare structure not exact object
    assert.equal(graph2.links.length, graph1.links.length, 'Should return same number of links (cached)');

    // Invalidate cache
    invalidateSemanticCache(testDir);

    // Now we should get a fresh calculation with new aims
    const graph3 = await getSemanticGraph(testDir);

    // Graph should be different (has more aims now)
    assert.notDeepEqual(graph1, graph3, 'Should recalculate after invalidation');

    // Verify new aims are included
    const sources = new Set(graph3.links.map(l => l.source));
    assert.ok(sources.has('aim-4'), 'Should include newly added aim-4');
    assert.ok(sources.has('aim-5'), 'Should include newly added aim-5');

  } finally {
    await fs.remove(testDir);
  }
});

test('semantic graph regression: cache invalidation on aim creation', async () => {
  // This is a regression test for the bug where newly created aims
  // didn't appear in the semantic force UI because the cache wasn't invalidated

  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-forces-'));

  try {
    // Start with 3 aims
    await saveEmbedding(testDir, 'aim-1', [1, 0, 0]);
    await saveEmbedding(testDir, 'aim-2', [0, 1, 0]);
    await saveEmbedding(testDir, 'aim-3', [0, 0, 1]);

    // Get semantic graph (this caches it)
    const graphBefore = await getSemanticGraph(testDir);
    const sourcesBefore = new Set(graphBefore.links.map(l => l.source));

    assert.equal(sourcesBefore.size, 3, 'Should have 3 aims initially');

    // Simulate creating a new aim (what happens in server.ts createFloatingAim)
    await saveEmbedding(testDir, 'aim-4-new', [1, 1, 0]);
    invalidateSemanticCache(testDir); // This is the fix!

    // Get semantic graph again
    const graphAfter = await getSemanticGraph(testDir);
    const sourcesAfter = new Set(graphAfter.links.map(l => l.source));

    assert.equal(sourcesAfter.size, 4, 'Should have 4 aims after creation');
    assert.ok(sourcesAfter.has('aim-4-new'), 'Should include the newly created aim');

    // Verify the new aim has its relationships
    const newAimLinks = graphAfter.links.filter(l => l.source === 'aim-4-new');
    assert.equal(newAimLinks.length, 6, 'New aim should have 6 links (3 nearest + 3 furthest)');

  } finally {
    await fs.remove(testDir);
  }
});
