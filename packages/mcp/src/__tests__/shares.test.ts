import { test } from 'node:test';
import assert from 'node:assert';
import { applyShares, describeShares } from '../tools/shares.js';

const edge = (ideaId: string, weight: number) => ({ ideaId, weight, relativePosition: [0, 0] as [number, number] });
const parent = (selfWeight: number, ...children: ReturnType<typeof edge>[]) => ({ id: 'parent', text: 'Parent', selfWeight, supportingConnections: children });
const weights = (result: ReturnType<typeof applyShares>) =>
  Object.fromEntries([...result.supportingConnections.map((conn) => [conn.ideaId, conn.weight]), ['loop', result.selfWeight]]);

test('a share alone scales the unnamed siblings and the loop into the rest', () => {
  const result = applyShares(parent(2, edge('a', 2), edge('b', 6), edge('new', 1)), { shares: new Map([['new', 30]]) });
  assert.deepStrictEqual(weights(result), { a: 14, b: 42, new: 30, loop: 14 });
});

test('named children need not add up to 100%: the rest becomes the loop share', () => {
  const result = applyShares(parent(0, edge('a', 5), edge('new', 1)), { shares: new Map([['a', 40], ['new', 20]]) });
  assert.deepStrictEqual(weights(result), { a: 40, new: 20, loop: 40 });
});

test('siblings and the loop can all be named', () => {
  const result = applyShares(parent(1, edge('a', 1), edge('new', 1)), { shares: new Map([['a', 50], ['new', 30]]), loopShare: 20 });
  assert.deepStrictEqual(weights(result), { a: 50, new: 30, loop: 20 });
});

test('linked repos keep their proportion next to the other unnamed children', () => {
  const result = applyShares(
    { ...parent(0, edge('a', 1), edge('new', 1)), supportingRepos: [{ repoId: 'repo', weight: 1, relativePosition: [0, 0] }] },
    { shares: new Map([['new', 50]]) },
  );
  assert.deepStrictEqual(weights(result), { a: 25, new: 50, loop: 0 });
  assert.strictEqual(result.supportingRepos![0]!.weight, 25);
});

test('impossible shares are refused', () => {
  const twoChildren = parent(1, edge('a', 1), edge('new', 1));
  assert.throws(() => applyShares(twoChildren, { shares: new Map([['new', 70]]), loopShare: 40 }), /more than 100%/);
  assert.throws(() => applyShares(twoChildren, { shares: new Map([['new', 100]]) }), /nothing for its other children/);
  assert.throws(() => applyShares(twoChildren, { shares: new Map([['a', 30], ['new', 30]]), loopShare: 10 }), /must add up to 100%/);
  assert.throws(() => applyShares(twoChildren, { shares: new Map([['stranger', 10]]) }), /neither a child nor a linked repo/);
  assert.throws(() => applyShares(twoChildren, { shares: new Map([['new', 0]]) }), /percentage above 0/);
});

test('the split reads as percent of the parent, the loop included', () => {
  const text = describeShares(parent(1, edge('a', 1), edge('new', 2)), new Map([['a', 'Sibling'], ['new', 'New idea']]), 'new');
  assert.match(text, /25% Sibling \(a\)/);
  assert.match(text, /50% → New idea \(new\)/);
  assert.match(text, /25% loop/);
});
