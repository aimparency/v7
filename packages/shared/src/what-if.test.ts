import { test } from 'node:test';
import assert from 'node:assert';
import type { Idea } from './types.js';
import { applyWhatIf, whatIf } from './what-if.js';

const idea = (id: string, partial: Partial<Idea> = {}): Idea => ({
  id, text: id, intrinsicValue: 0, cost: 1, duration: 1, costVariance: 0, valueVariance: 0, selfWeight: 0,
  status: { state: 'open', comment: '', date: 0 }, supportingConnections: [], supportedIdeas: [], committedIn: [], tags: [], archived: false,
  ...partial
} as Idea);

// root (100) splits between a and b; b has one child c.
const graph = () => [
  idea('root', { intrinsicValue: 100, supportingConnections: [{ ideaId: 'a', weight: 1 }, { ideaId: 'b', weight: 1 }] as Idea['supportingConnections'] }),
  idea('a', { supportedIdeas: ['root'] }),
  idea('b', { supportedIdeas: ['root'], supportingConnections: [{ ideaId: 'c', weight: 1 }] as Idea['supportingConnections'] }),
  idea('c', { supportedIdeas: ['b'] })
];

test('removing an idea takes its connections with it and moves value to its siblings', () => {
  const changed = applyWhatIf(graph(), { kind: 'remove', ideaId: 'b' });
  assert.deepEqual(changed.map(i => i.id), ['root', 'a', 'c']);
  assert.deepEqual(changed.find(i => i.id === 'root')!.supportingConnections.map(c => c.ideaId), ['a']);
  assert.deepEqual(changed.find(i => i.id === 'c')!.supportedIdeas, []);

  const { shifts } = whatIf(graph(), { kind: 'remove', ideaId: 'b' });
  const a = shifts.find(s => s.id === 'a')!;
  assert.ok(a.valueAfter > a.valueBefore, 'a takes what b had');
  assert.equal(shifts.find(s => s.id === 'b')!.valueAfter, 0);
});

test('a heavier connection moves value toward that child; the input is left alone', () => {
  const ideas = graph();
  const { shifts, topAfter } = whatIf(ideas, { kind: 'weight', parentId: 'root', childId: 'a', weight: 3 });
  const a = shifts.find(s => s.id === 'a')!;
  const b = shifts.find(s => s.id === 'b')!;
  assert.ok(a.valueAfter > a.valueBefore && b.valueAfter < b.valueBefore);
  assert.ok(topAfter.indexOf('a') < topAfter.indexOf('b'), 'a now ranks above b');
  assert.equal(ideas[0]!.supportingConnections[0]!.weight, 1, 'nothing is written');
  assert.throws(() => whatIf(ideas, { kind: 'weight', parentId: 'a', childId: 'b', weight: 2 }), /No connection/);
});
