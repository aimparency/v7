import { test } from 'vitest';
import assert from 'node:assert';
import type { Idea } from 'shared';
import { isDirectParentChild, findDuplicatePairs, clusterDuplicates } from './duplicate-detection';

// Minimal idea shaped just enough for the link-adjacency checks.
function mkIdea(id: string, opts: { parents?: string[]; children?: string[] } = {}): Idea {
  return {
    id,
    text: id,
    supportedIdeas: opts.parents ?? [],
    supportingConnections: (opts.children ?? []).map((ideaId) => ({ ideaId, weight: 1, relativePosition: [0, 0] })),
  } as unknown as Idea;
}

// A:[1,0] and B:[4,1] are near-duplicates (cos ≈ 0.970) and NOT adjacent.
// E:[0,1] and F:[0,1] are identical (cos = 1.0) but E is the parent of F.
const A = mkIdea('A');
const B = mkIdea('B');
const E = mkIdea('E', { children: ['F'] });
const F = mkIdea('F', { parents: ['E'] });
const ideaMap = new Map<string, Idea>([['A', A], ['B', B], ['E', E], ['F', F]]);

const VEC: Record<string, number[]> = { A: [1, 0], B: [4, 1], E: [0, 1], F: [0, 1] };
const indexed = Object.entries(VEC).map(([id, vector]) => ({ id, vector }));

test('isDirectParentChild detects adjacency from either link array, both directions', () => {
  assert.equal(isDirectParentChild(ideaMap, 'E', 'F'), true, 'via supportingConnections (parent→child)');
  assert.equal(isDirectParentChild(ideaMap, 'F', 'E'), true, 'via supportedIdeas (child→parent)');
  assert.equal(isDirectParentChild(ideaMap, 'A', 'B'), false, 'unrelated ideas are not adjacent');
  assert.equal(isDirectParentChild(ideaMap, 'A', 'missing'), false, 'unknown id is safe');
});

test('findDuplicatePairs reports a non-adjacent near-duplicate but excludes the parent-child pair', () => {
  const pairs = findDuplicatePairs(indexed, ideaMap, 0.9);
  const key = (p: { aId: string; bId: string }) => [p.aId, p.bId].sort().join('-');
  const keys = pairs.map(key);

  assert.ok(keys.includes('A-B'), 'A/B (cos ~0.97, not adjacent) is reported');
  assert.ok(!keys.includes('E-F'), 'E/F (cos 1.0) is excluded because they are parent-child');
  assert.ok(pairs.every((p) => p.score >= 0.9), 'every reported pair is above threshold');
});

test('findDuplicatePairs returns pairs sorted by score descending', () => {
  // Add C:[1,0] identical to A so A-C scores 1.0, above A-B's ~0.97.
  const withC = [...indexed, { id: 'C', vector: [1, 0] }];
  const map2 = new Map(ideaMap);
  map2.set('C', mkIdea('C'));
  const pairs = findDuplicatePairs(withC, map2, 0.9);
  for (let i = 1; i < pairs.length; i++) {
    assert.ok(pairs[i - 1]!.score >= pairs[i]!.score, 'scores are non-increasing');
  }
  assert.equal([pairs[0]!.aId, pairs[0]!.bId].sort().join('-'), 'A-C', 'the perfect match ranks first');
});

test('clusterDuplicates groups non-adjacent dupes but never clusters a parent-child pair', () => {
  const clusters = clusterDuplicates(['A', 'B', 'E', 'F'], (id) => VEC[id], ideaMap, 0.9);

  assert.equal(clusters.length, 1, 'exactly one cluster forms');
  assert.deepEqual([...clusters[0]!].sort(), ['A', 'B'], 'A and B cluster together');
  const clustered = new Set(clusters.flat());
  assert.ok(!clustered.has('E') && !clustered.has('F'), 'the parent-child pair stays unclustered');
});

test('clusterDuplicates links transitively through a shared near-duplicate', () => {
  // A~B and B~G (both ≥0.9) ⇒ all three land in one cluster even if A~G is lower.
  const map3 = new Map(ideaMap);
  map3.set('G', mkIdea('G'));
  const vec3: Record<string, number[]> = { ...VEC, G: [5, 1] }; // cos(B[4,1],G[5,1]) ≈ 0.998
  const clusters = clusterDuplicates(['A', 'B', 'G'], (id) => vec3[id], map3, 0.9);
  assert.equal(clusters.length, 1);
  assert.deepEqual([...clusters[0]!].sort(), ['A', 'B', 'G']);
});
