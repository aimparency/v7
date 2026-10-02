import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { appRouter } from './server.js';
import { clearIndices } from './search.js';

const caller = appRouter.createCaller({});
let testRoot = '';
let source = '';
let target = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-spin-off-test-'));
  source = path.join(testRoot, 'source', '.bowman');
  target = path.join(testRoot, 'target', '.bowman');
});

afterEach(async () => {
  await fs.remove(testRoot);
  clearIndices(source);
  clearIndices(target);
});

test('spin-off merges into an existing graph, preserves metadata, and remaps collisions', async () => {
  const sourceRoot = await caller.idea.createFloatingAim({
    projectPath: source,
    idea: { text: 'Imported branch root' },
  });
  await caller.project.updateMeta({
    projectPath: target,
    meta: { name: 'Existing target', color: '#123456' },
  });

  // Put an unrelated target idea at the same durable id to exercise collision handling.
  await fs.ensureDir(path.join(target, 'ideas'));
  await fs.copy(
    path.join(source, 'ideas', `${sourceRoot.id}.json`),
    path.join(target, 'ideas', `${sourceRoot.id}.json`),
  );
  const collision = await fs.readJson(path.join(target, 'ideas', `${sourceRoot.id}.json`));
  collision.text = 'Pre-existing target idea';
  await fs.writeJson(path.join(target, 'ideas', `${sourceRoot.id}.json`), collision);

  const result = await caller.spinOff.execute({
    projectPath: source,
    rootIds: [sourceRoot.id],
    targetPath: target,
    removeFromSource: false,
    preserveInflow: false,
  });

  assert.equal(result.integratedIntoExisting, true);
  const importedId = result.remappedIds[sourceRoot.id];
  assert.ok(importedId);
  assert.notEqual(importedId, sourceRoot.id);

  const targetMeta = await caller.project.getMeta({ projectPath: target });
  assert.equal(targetMeta.name, 'Existing target');
  const original = await caller.idea.get({ projectPath: target, ideaId: sourceRoot.id });
  const imported = await caller.idea.get({ projectPath: target, ideaId: importedId });
  assert.equal(original.text, 'Pre-existing target idea');
  assert.equal(imported.text, 'Imported branch root');
  assert.deepEqual(imported.supportedAims, []);
  assert.deepEqual(imported.committedIn, []);
});

test('spin-off refuses to target its source graph', async () => {
  const root = await caller.idea.createFloatingAim({
    projectPath: source,
    idea: { text: 'Root' },
  });
  await assert.rejects(
    () => caller.spinOff.execute({
      projectPath: source,
      rootIds: [root.id],
      targetPath: source,
      removeFromSource: false,
      preserveInflow: false,
    }),
    /different .bowman graph/i,
  );
});
