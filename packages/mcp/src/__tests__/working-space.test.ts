import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spaceOfDirectory } from '../working-space.js';

test('the working space is the nearest .bowman upwards, never beyond the repo root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'working-space-'));
  const withGraph = path.join(root, 'with-graph');
  const nested = path.join(withGraph, 'packages', 'app');
  const withoutGraph = path.join(root, 'without-graph', 'src');
  fs.mkdirSync(path.join(withGraph, '.bowman'), { recursive: true });
  fs.mkdirSync(path.join(withGraph, '.git'));
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(root, 'without-graph', '.git'), { recursive: true });
  fs.mkdirSync(withoutGraph, { recursive: true });
  // A space above a repository is not that repository's space.
  fs.mkdirSync(path.join(root, '.bowman'));

  try {
    assert.strictEqual(spaceOfDirectory(withGraph), withGraph);
    assert.strictEqual(spaceOfDirectory(nested), withGraph);
    assert.strictEqual(spaceOfDirectory(withoutGraph), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
