import assert from 'node:assert/strict';
import test from 'node:test';
import type { Idea } from 'shared';
import { compareChildren, coverage, maskChildren, selectEvalParents } from './decomposition-eval.js';

const idea = (id: string, state: string, children: string[] = []) => ({
  id,
  text: id,
  description: '',
  status: { state, comment: `${id} outcome`, date: 0 },
  supportingConnections: children.map((ideaId) => ({ ideaId, relativePosition: [0, 0], weight: 1 })),
  supportedIdeas: []
}) as unknown as Idea;

test('only implemented parents with 3-7 implemented children are evaluated', () => {
  const ideas = [
    idea('good', 'implemented', ['a', 'b', 'c']),
    idea('open-parent', 'open', ['a', 'b', 'c']),
    idea('too-few', 'implemented', ['a', 'b']),
    idea('unfinished-child', 'implemented', ['a', 'b', 'x']),
    idea('a', 'implemented'), idea('b', 'implemented'), idea('c', 'implemented'), idea('x', 'open')
  ];
  assert.deepEqual(selectEvalParents(ideas, 5).map((parent) => parent.id), ['good']);
});

test('masking hides the real children and the outcome, so the planner cannot copy them', () => {
  const ideas = [idea('parent', 'implemented', ['a', 'b', 'c']), idea('a', 'implemented'), idea('b', 'implemented'), idea('c', 'implemented'), idea('other', 'open')];
  const byId = new Map(ideas.map((entry) => [entry.id, entry]));
  const { masked, hiddenIds } = maskChildren(byId, byId.get('parent')!);
  assert.deepEqual([...hiddenIds].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...masked.keys()].sort(), ['other', 'parent']);
  assert.equal(masked.get('parent')!.status.state, 'open');
  assert.equal(masked.get('parent')!.status.comment, '');
  assert.deepEqual(masked.get('parent')!.supportingConnections, []);
  assert.equal(byId.get('parent')!.status.state, 'implemented', 'the real graph is untouched');
});

test('each real child scores its closest proposal; coverage counts real children above a threshold', () => {
  const similarity = compareChildren([[1, 0], [0, 1]], [[1, 0], [0.6, 0.8]]);
  assert.deepEqual(similarity.bestPerReal.map((value) => Number(value.toFixed(2))), [1, 0.8]);
  assert.equal(Number(similarity.meanBest.toFixed(2)), 0.9);
  assert.equal(coverage(similarity.bestPerReal, 0.85), 0.5);
  assert.deepEqual(compareChildren([[1, 0]], []).bestPerReal, [0]);
});
