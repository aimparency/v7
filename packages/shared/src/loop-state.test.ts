import { test } from 'node:test';
import assert from 'node:assert';
import { loopInstanceSchema, pushLoopMessage } from './loop-state.js';

test('pushLoopMessage keeps only the newest 500 messages and stamps the instance', () => {
  const instance = loopInstanceSchema.parse({ id: 'i', loopId: 'l', name: 'n', createdAt: 0, updatedAt: 0 });
  for (let index = 1; index <= 502; index++) {
    pushLoopMessage(instance, { id: String(index), role: 'system', kind: 'text', content: '', timestamp: index });
  }
  assert.equal(instance.messages.length, 500);
  assert.equal(instance.messages[0]!.id, '3');
  assert.equal(instance.updatedAt, 502);
});
