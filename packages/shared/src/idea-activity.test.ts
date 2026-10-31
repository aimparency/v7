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
  assert.ok(red === 1 && green > blue);
});
