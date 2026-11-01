import test from 'node:test';
import assert from 'node:assert/strict';
import { accessStrength, ideaActivityColor } from './idea-activity.js';

test('an access fades to half its weight after one half-life', () => {
  const halfLife = 15 * 60_000;
  assert.equal(accessStrength('read', 0, 0), 0.8);
  assert.equal(accessStrength('read', 0, halfLife), 0.4);
});

test('an idea without activity stays idle grey; fresh writes glow amber', () => {
  assert.deepEqual(ideaActivityColor(undefined, 0), [0.16, 0.16, 0.16]);
  const [red, green, blue] = ideaActivityColor({ write: 0 }, 0);
  assert.ok(red > green && green > blue);
});

test('activity never adds more than #888 to a channel, so white labels stay readable', () => {
  const everything = { found: 0, contextRead: 0, read: 0, write: 0, statusChange: 0, manualEdit: 0 };
  for (const channel of ideaActivityColor(everything, 0)) assert.ok(channel <= 0.16 + 0x88 / 0xff + 1e-9);
});
