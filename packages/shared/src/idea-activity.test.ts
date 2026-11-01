import test from 'node:test';
import assert from 'node:assert/strict';
import { accessStrength, addAccess, addLevels, ideaActivityColor } from './idea-activity.js';

const halfLife = 15 * 60_000;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

test('an access fades to half its weight after one half-life', () => {
  const { read } = addAccess(undefined, 'read', 0);
  close(accessStrength('read', read!, 0), 0.8);
  close(accessStrength('read', read!, halfLife), 0.4);
});

test('accesses add up, each decayed by its own age', () => {
  // Today's timestamps: levels are large, the arithmetic must stay exact.
  const start = 1_800_000_000_000;
  const twice = addAccess(addAccess(undefined, 'read', start), 'read', start + halfLife);
  close(accessStrength('read', twice.read!, start + halfLife), 0.8 * (0.5 + 1));
});

test('merging records is order-free addition', () => {
  close(addLevels(addLevels(3, 5), 7), addLevels(3, addLevels(7, 5)));
  close(addLevels(4, 4), 5);
});

test('an idea without activity stays idle grey; fresh writes glow amber', () => {
  assert.deepEqual(ideaActivityColor(undefined, 0), [0.16, 0.16, 0.16]);
  const [red, green, blue] = ideaActivityColor(addAccess(undefined, 'write', 0), 0);
  assert.ok(red > green && green > blue);
});

test('activity never adds more than #888 to a channel, so white labels stay readable', () => {
  const everything = { found: 10, contextRead: 10, read: 10, write: 10, statusChange: 10, manualEdit: 10 };
  for (const channel of ideaActivityColor(everything, 0)) assert.ok(channel <= 0.16 + 0x88 / 0xff + 1e-9);
});
