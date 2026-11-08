import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getHarnessConfigPath, loadHarnessConfig } from './harness-config.js';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-config-'));
  fs.mkdirSync(path.join(root, '.bowman'));
  return root;
}

test('no file means the defaults', () => {
  const { config, version } = loadHarnessConfig(project());
  assert.equal(version, 'defaults');
  assert.deepEqual(config.stepBudgets, { decompose: 8, execute: 20, verify: 10, reflect: 2 });
  assert.equal(config.decomposition.landingState, 'open');
});

test('a partial file overrides only what it names, and its hash is the version', () => {
  const root = project();
  fs.writeFileSync(getHarnessConfigPath(root), JSON.stringify({ stepBudgets: { execute: 30 }, decomposition: { landingState: 'ai-proposition' } }));
  const first = loadHarnessConfig(root);
  assert.equal(first.config.stepBudgets.execute, 30);
  assert.equal(first.config.stepBudgets.verify, 10);
  assert.equal(first.config.decomposition.landingState, 'ai-proposition');
  assert.match(first.version, /^[0-9a-f]{12}$/);
  fs.writeFileSync(getHarnessConfigPath(root), JSON.stringify({ stepBudgets: { execute: 31 } }));
  assert.notEqual(loadHarnessConfig(root).version, first.version);
});

test('an invalid or misspelled field fails loudly instead of being ignored', () => {
  const root = project();
  fs.writeFileSync(getHarnessConfigPath(root), JSON.stringify({ stepBudget: { execute: 30 } }));
  assert.throws(() => loadHarnessConfig(root), /Invalid .*harness\.json/);
  fs.writeFileSync(getHarnessConfigPath(root), JSON.stringify({ decomposition: { maxChildren: 50 } }));
  assert.throws(() => loadHarnessConfig(root), /decomposition\.maxChildren/);
});
