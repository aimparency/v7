import { test } from 'node:test';
import assert from 'node:assert';
import { currentPhaseCursors } from './phase-cursors.js';

test('levels below the marked phase are dropped', () => {
  assert.deepEqual(
    currentPhaseCursors({ phaseCursors: { '0': 'root', '1': 'child', '2': 'grandchild' }, phaseActiveLevel: 1 }),
    { '0': 'root', '1': 'child' }
  );
});

test('missing meta yields no cursors', () => {
  assert.deepEqual(currentPhaseCursors(undefined), {});
});
