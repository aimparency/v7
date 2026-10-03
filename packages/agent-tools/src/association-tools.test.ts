import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { selectAssociation } from './association-tools.js';

const candidates = [
  { id: 'related', score: 0.87654, idea: { id: 'related', text: 'A lateral idea', description: 'Useful context', status: { state: 'open' } } },
  { id: 'weaker', score: 0.5, idea: { id: 'weaker', text: 'A weaker idea' } }
];

test('selectAssociation returns the strongest candidate when the stochastic gate passes', () => {
  assert.partialDeepStrictEqual(selectAssociation(candidates, 0.5, () => 0.1), {
    id: 'related',
    score: 0.8765,
    chance: 0.5
  });
});

test('selectAssociation returns null when the stochastic gate rejects insertion', () => {
  assert.equal(selectAssociation(candidates, 0.5, () => 0.5), null);
});

test('selectAssociation does not sample randomness when associations are disabled', () => {
  const random = mock.fn(() => 0);
  assert.equal(selectAssociation(candidates, 0, random), null);
  assert.equal(random.mock.callCount(), 0);
});

test('selectAssociation skips excluded ideas instead of resurfacing the active idea', () => {
  assert.partialDeepStrictEqual(selectAssociation(candidates, 1, () => 0, ['related']), { id: 'weaker' });
});
