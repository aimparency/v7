import { test } from 'node:test';
import assert from 'node:assert';
import { isInPhaseSubtree } from './phase-tree.js';

// root ─┬─ a ── a1 ── a1x
//       └─ b
const parents: Record<string, string | null> = { a: null, a1: 'a', a1x: 'a1', b: null };
const parentOf = (id: string) => parents[id];

test('a phase and its descendants are in its subtree', () => {
  assert.deepEqual(['a', 'a1', 'a1x'].map((id) => isInPhaseSubtree(id, 'a', parentOf)), [true, true, true]);
});

test('ancestors, siblings and other branches are not', () => {
  assert.deepEqual(['a', 'b'].map((id) => isInPhaseSubtree(id, 'a1', parentOf)), [false, false]);
});

test('terminates on a loop already in the data', () => {
  const looped: Record<string, string> = { x: 'y', y: 'x' };
  assert.equal(isInPhaseSubtree('x', 'a', (id) => looped[id]), false);
});
