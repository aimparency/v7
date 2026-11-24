import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spaceOfDirectory } from '../working-space.js';

test('the working space is the nearest .bowman upwards, never beyond the repo root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'working-space-'));
  const withSpace = path.join(root, 'with-space');
  const nested = path.join(withSpace, 'packages', 'app');
  const withoutSpace = path.join(root, 'without-space', 'src');
  fs.mkdirSync(path.join(withSpace, '.bowman'), { recursive: true });
  fs.mkdirSync(path.join(withSpace, '.git'));
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(root, 'without-space', '.git'), { recursive: true });
  fs.mkdirSync(withoutSpace, { recursive: true });
  // A space above a repository is not that repository's space.
  fs.mkdirSync(path.join(root, '.bowman'));

  try {
    assert.strictEqual(spaceOfDirectory(withSpace), withSpace);
    assert.strictEqual(spaceOfDirectory(nested), withSpace);
    assert.strictEqual(spaceOfDirectory(withoutSpace), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
