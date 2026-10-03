import { test } from 'node:test';
import assert from 'node:assert';
import { toBowmanPath, toProjectRoot } from './project-path.js';

test('a project root and its .bowman directory resolve to the same pair', () => {
  for (const input of ['/home/me/project', '/home/me/project/', '/home/me/project/.bowman', '/home/me/project/.bowman/']) {
    assert.equal(toProjectRoot(input), '/home/me/project', input);
    assert.equal(toBowmanPath(input), '/home/me/project/.bowman', input);
  }
});

test('a doubled .bowman/.bowman collapses to the outer project', () => {
  assert.equal(toProjectRoot('/home/me/project/.bowman/.bowman'), '/home/me/project');
  assert.equal(toBowmanPath('/home/me/project/.bowman/.bowman/'), '/home/me/project/.bowman');
});

test('only a whole trailing .bowman segment counts', () => {
  assert.equal(toBowmanPath('/home/me/not.bowman'), '/home/me/not.bowman/.bowman');
  assert.equal(toBowmanPath('/home/me/.bowman/project'), '/home/me/.bowman/project/.bowman');
});

test('relative, root and Windows paths keep their form', () => {
  assert.equal(toBowmanPath('.bowman'), './.bowman');
  assert.equal(toProjectRoot('project/.bowman'), 'project');
  assert.equal(toBowmanPath('/.bowman'), '/.bowman');
  assert.equal(toProjectRoot('C:\\work\\project\\.bowman'), 'C:\\work\\project');
  assert.equal(toBowmanPath('C:\\work\\project'), 'C:\\work\\project\\.bowman');
  assert.equal(toBowmanPath(''), '');
});
