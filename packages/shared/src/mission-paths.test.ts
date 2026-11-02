import { test } from 'node:test';
import assert from 'node:assert';
import { missionPathsToRoot } from './mission-paths.js';

const idea = (id: string, ...supportedIdeas: string[]) => ({ id, text: id, description: `about ${id}`, intrinsicValue: 0, supportedIdeas });

test('reports each root path, follows the strongest inflow, and skips cycles', () => {
  // leaf → {left, right} → root; right ↔ loop is a cycle with no root of its own.
  const ideas = [idea('root'), idea('left', 'root'), idea('right', 'root', 'loop'), idea('loop', 'right'), idea('leaf', 'left', 'right')];
  const ideaMap = new Map(ideas.map((entry) => [entry.id, entry]));
  const flows = new Map([['left->leaf', 0.2], ['right->leaf', 0.7], ['root->left', 1], ['root->right', 1]]);

  const { pathToRoot, pathsToRoot, truncated } = missionPathsToRoot(ideaMap, ideaMap.get('leaf')!, flows);

  // Strongest inflow first: right (0.7) before left (0.2).
  assert.deepEqual(pathsToRoot.map((path) => path.map((step) => step.id)), [['root', 'right'], ['root', 'left']]);
  assert.deepEqual(pathToRoot.map((step) => step.id), ['root', 'right']);
  assert.equal(pathToRoot[1]!.description, 'about right', 'the strongest path keeps descriptions');
  assert.ok(pathsToRoot.flat().every((step) => step.description === undefined), 'the path list stays lean');
  assert.equal(pathToRoot[1]!.valueInflow, 0.7);
  assert.equal(truncated, false);
});

test('keeps the 10 strongest of many root paths and reports the truncation', () => {
  // leaf has 30 parents, each its own root; parent i sends i to the leaf.
  const roots = Array.from({ length: 30 }, (_, index) => idea(`root${index}`));
  const ideaMap = new Map([...roots, idea('leaf', ...roots.map((root) => root.id))].map((entry) => [entry.id, entry]));
  const flows = new Map(roots.map((root, index) => [`${root.id}->leaf`, index]));

  const { pathsToRoot, truncated } = missionPathsToRoot(ideaMap, ideaMap.get('leaf')!, flows);

  assert.equal(truncated, true);
  assert.equal(pathsToRoot.length, 10);
  assert.deepEqual(pathsToRoot.map((path) => path[0]!.id), Array.from({ length: 10 }, (_, index) => `root${29 - index}`));
});
