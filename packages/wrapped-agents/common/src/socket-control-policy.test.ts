import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchTerminalInput,
  dispatchTerminalResize,
  dispatchWatchdogToggle,
  isWatchdogTogglePayload,
  MAX_TERMINAL_INPUT_BYTES,
  parseTerminalDimensions,
  parseTerminalInput,
} from './socket-control-policy';

test('accepts only literal booleans for watchdog toggles', () => {
  assert.equal(isWatchdogTogglePayload(true), true);
  assert.equal(isWatchdogTogglePayload(false), true);
  for (const value of [0, 1, 'true', null, undefined, {}, []]) {
    assert.equal(isWatchdogTogglePayload(value), false);
  }
});

test('accepts ordinary terminal input, control sequences, and the exact byte limit', () => {
  for (const value of ['', 'hello', '\u001b[A', 'x'.repeat(MAX_TERMINAL_INPUT_BYTES)]) {
    assert.equal(parseTerminalInput(value), value);
  }
});

test('rejects non-string and over-limit terminal input using UTF-8 bytes', () => {
  for (const value of [null, undefined, Buffer.from('x'), {}, 42]) {
    assert.equal(parseTerminalInput(value), undefined);
  }
  assert.equal(parseTerminalInput('x'.repeat(MAX_TERMINAL_INPUT_BYTES + 1)), undefined);
  assert.equal(parseTerminalInput('€'.repeat(22_000)), undefined);
});

test('accepts integer terminal dimensions throughout the bounded range', () => {
  assert.deepEqual(parseTerminalDimensions({ cols: 1, rows: 500 }), { cols: 1, rows: 500 });
  assert.deepEqual(parseTerminalDimensions({ cols: 120, rows: 40 }), { cols: 120, rows: 40 });
});

test('rejects malformed, fractional, non-finite, and out-of-range dimensions', () => {
  for (const value of [
    null,
    [],
    {},
    { cols: 80 },
    { cols: '80', rows: 24 },
    { cols: 80.5, rows: 24 },
    { cols: Number.NaN, rows: 24 },
    { cols: Number.POSITIVE_INFINITY, rows: 24 },
    { cols: 0, rows: 24 },
    { cols: 80, rows: 501 },
  ]) {
    assert.equal(parseTerminalDimensions(value), undefined);
  }
});

test('returns a canonical copy without retaining extra fields', () => {
  const payload = { cols: 90, rows: 30, injected: 'ignored' };
  const parsed = parseTerminalDimensions(payload);
  assert.deepEqual(parsed, { cols: 90, rows: 30 });
  assert.notEqual(parsed, payload);
});

test('dispatches valid payloads exactly once in canonical form', () => {
  const toggles: boolean[] = [];
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];

  assert.equal(dispatchWatchdogToggle(false, (value) => toggles.push(value)), true);
  assert.equal(dispatchTerminalInput('\u001b[B', (value) => writes.push(value)), true);
  assert.equal(
    dispatchTerminalResize({ cols: 100, rows: 35, ignored: true }, (value) => resizes.push(value)),
    true,
  );
  assert.deepEqual(toggles, [false]);
  assert.deepEqual(writes, ['\u001b[B']);
  assert.deepEqual(resizes, [{ cols: 100, rows: 35 }]);
});

test('invalid payloads invoke no control, write, or resize effect', () => {
  let effectCount = 0;
  const effect = () => { effectCount += 1; };

  assert.equal(dispatchWatchdogToggle('true', effect), false);
  assert.equal(dispatchTerminalInput('x'.repeat(MAX_TERMINAL_INPUT_BYTES + 1), effect), false);
  assert.equal(dispatchTerminalResize({ cols: 0, rows: 24 }, effect), false);
  assert.equal(effectCount, 0);
});
