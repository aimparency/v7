import { describe, expect, it, vi } from 'vitest';
import { selectAssociation } from './association-tools.js';

const candidates = [
  { id: 'related', score: 0.87654, idea: { id: 'related', text: 'A lateral idea', description: 'Useful context', status: { state: 'open' } } },
  { id: 'weaker', score: 0.5, idea: { id: 'weaker', text: 'A weaker idea' } }
];

describe('selectAssociation', () => {
  it('returns the strongest candidate when the stochastic gate passes', () => {
    expect(selectAssociation(candidates, 0.5, () => 0.1)).toMatchObject({
      id: 'related',
      score: 0.8765,
      chance: 0.5
    });
  });

  it('returns null when the stochastic gate rejects insertion', () => {
    expect(selectAssociation(candidates, 0.5, () => 0.5)).toBeNull();
  });

  it('does not sample randomness when associations are disabled', () => {
    const random = vi.fn(() => 0);
    expect(selectAssociation(candidates, 0, random)).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('skips excluded ideas instead of resurfacing the active idea', () => {
    expect(selectAssociation(candidates, 1, () => 0, ['related'])).toMatchObject({
      id: 'weaker'
    });
  });
});
