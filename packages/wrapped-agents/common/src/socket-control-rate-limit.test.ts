import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchTerminalInput } from './socket-control-policy';
import { SocketControlRateLimiter, type SocketControlCategory } from './socket-control-rate-limit';

function consume(limiter: SocketControlRateLimiter, category: SocketControlCategory, count: number): boolean[] {
  return Array.from({ length: count }, () => limiter.allow(category));
}

test('enforces each declared burst capacity', () => {
  const limiter = new SocketControlRateLimiter(() => 0);
  assert.deepEqual(consume(limiter, 'terminal-input', 201).slice(-2), [true, false]);
  assert.deepEqual(consume(limiter, 'terminal-resize', 31).slice(-2), [true, false]);
  assert.deepEqual(consume(limiter, 'watchdog-toggle', 6).slice(-2), [true, false]);
});

test('refills each category at its configured rate without exceeding capacity', () => {
  let now = 0;
  const limiter = new SocketControlRateLimiter(() => now);
  consume(limiter, 'terminal-input', 200);
  consume(limiter, 'terminal-resize', 30);
  consume(limiter, 'watchdog-toggle', 5);

  now = 1000;
  assert.equal(consume(limiter, 'terminal-input', 101)[100], false);
  assert.equal(consume(limiter, 'terminal-resize', 31)[30], false);
  assert.deepEqual(consume(limiter, 'watchdog-toggle', 2), [true, false]);

  now = 100_000;
  assert.equal(consume(limiter, 'watchdog-toggle', 6)[5], false);
});

test('clock rollback grants no capacity and recovers from the prior anchor', () => {
  let now = 1000;
  const limiter = new SocketControlRateLimiter(() => now);
  consume(limiter, 'watchdog-toggle', 5);
  now = 500;
  assert.equal(limiter.allow('watchdog-toggle'), false);
  now = 2000;
  assert.equal(limiter.allow('watchdog-toggle'), true);
});

test('categories are isolated while worker and watchdog variants share one category budget', () => {
  const limiter = new SocketControlRateLimiter(() => 0);
  consume(limiter, 'terminal-input', 200);
  assert.equal(limiter.allow('terminal-input'), false);
  assert.equal(limiter.allow('terminal-resize'), true);
  assert.equal(limiter.allow('watchdog-toggle'), true);
});

test('an over-budget valid payload invokes no terminal effect', () => {
  const limiter = new SocketControlRateLimiter(() => 0);
  consume(limiter, 'terminal-input', 200);
  let writes = 0;
  dispatchTerminalInput('valid', () => {
    if (limiter.allow('terminal-input')) writes += 1;
  });
  assert.equal(writes, 0);
});
