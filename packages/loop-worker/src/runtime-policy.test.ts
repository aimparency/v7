import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCycleTarget, throwIfStreamFailed } from './runtime-policy.js';

test('selects an explicit target even when it is below the first five priorities', () => {
  const prioritized = Array.from({ length: 8 }, (_, index) => ({
    idea: { id: `idea-${index}` }
  })) as any;
  assert.equal(selectCycleTarget(prioritized, 'idea-7')?.idea.id, 'idea-7');
  assert.equal(selectCycleTarget(prioritized, 'completed-idea')?.idea.id, 'idea-0');
  assert.equal(selectCycleTarget(prioritized)?.idea.id, 'idea-0');
});

test('turns streamed provider errors into a failed cycle', () => {
  assert.doesNotThrow(() => throwIfStreamFailed([]));
  assert.throws(() => throwIfStreamFailed(['Unauthorized']), /Unauthorized/);
});
