import { test } from 'node:test';
import assert from 'node:assert';
import { childBrief } from './idea-context.js';

test('open children keep their description, settled ones become one line with their state', () => {
  const child = (state: string) => ({ id: 'c', text: 'Child', description: 'long text', status: { state, comment: '', date: 0 } });
  assert.deepEqual(childBrief(child('partially')), { id: 'c', text: 'Child', status: 'partially', description: 'long text' });
  assert.deepEqual(childBrief(child('human-dependent')), { id: 'c', text: 'Child', status: 'human-dependent', description: 'long text' });
  assert.deepEqual(childBrief(child('open')), { id: 'c', text: 'Child', status: 'open', description: 'long text' });
  for (const state of ['implemented', 'cancelled', 'failed', 'archived']) {
    assert.deepEqual(childBrief(child(state)), { id: 'c', text: 'Child', status: state }, state);
  }
});
