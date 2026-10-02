import { test } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_IDEA_COST, defaultIdeaCost } from './constants.js';

test('defaultIdeaCost uses a valid project default and falls back to 1 otherwise', () => {
  assert.equal(DEFAULT_IDEA_COST, 1);
  assert.equal(defaultIdeaCost({ defaultCost: 2.5 }), 2.5);
  for (const meta of [null, undefined, {}, { defaultCost: 0 }, { defaultCost: -1 }, { defaultCost: Number.NaN }, { defaultCost: '3' }]) {
    assert.equal(defaultIdeaCost(meta as any), DEFAULT_IDEA_COST);
  }
});
