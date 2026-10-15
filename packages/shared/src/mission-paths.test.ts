import { test } from 'node:test';
import assert from 'node:assert';
import { missionPathsToRoot } from './mission-paths.js';

const idea = (id: string, ...supportedIdeas: string[]) => ({ id, text: id, intrinsicValue: 0, supportedIdeas });

test('reports each root path, follows the strongest inflow, and skips cycles', () => {
  // leaf → {left, right} → root; right ↔ loop is a cycle with no root of its own.
  const ideas = [idea('root'), idea('left', 'root'), idea('right', 'root', 'loop'), idea('loop', 'right'), idea('leaf', 'left', 'right')];
  const ideaMap = new Map(ideas.map((entry) => [entry.id, entry]));
  const flows = new Map([['left->leaf', 0.2], ['right->leaf', 0.7], ['root->left', 1], ['root->right', 1]]);

  const { pathToRoot, pathsToRoot, truncated } = missionPathsToRoot(ideaMap, ideaMap.get('leaf')!, flows);

  assert.deepEqual(pathsToRoot.map((path) => path.map((step) => step.id)), [['root', 'left'], ['root', 'right']]);
  assert.deepEqual(pathToRoot.map((step) => step.id), ['root', 'right']);
  assert.equal(pathToRoot[1]!.valueInflow, 0.7);
  assert.equal(truncated, false);
});
