import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCycleTarget, throwIfStreamFailed } from './runtime-policy.js';

test('selects an explicit target even when it is below the first five priorities', () => {
  const prioritized = Array.from({ length: 8 }, (_, index) => ({
    aim: { id: `aim-${index}` }
  })) as any;
  assert.equal(selectCycleTarget(prioritized, 'aim-7')?.aim.id, 'aim-7');
  assert.equal(selectCycleTarget(prioritized)?.aim.id, 'aim-0');
});

test('turns streamed provider errors into a failed cycle', () => {
  assert.doesNotThrow(() => throwIfStreamFailed([]));
  assert.throws(() => throwIfStreamFailed(['Unauthorized']), /Unauthorized/);
});
