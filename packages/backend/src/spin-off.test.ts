import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { appRouter } from './server.js';
import { clearIndices } from './search.js';
import { listGraphs } from './graphs/registry.js';

const caller = appRouter.createCaller({});
let testRoot = '';
let source = '';
let target = '';
const testServerDir = process.env.AIMPARENCY_SERVER_DIR;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-spin-off-test-'));
  process.env.AIMPARENCY_SERVER_DIR = path.join(testRoot, 'server');
  source = path.join(testRoot, 'source', '.bowman');
  target = path.join(testRoot, 'target', '.bowman');
});

afterEach(async () => {
  process.env.AIMPARENCY_SERVER_DIR = testServerDir;
  await fs.remove(testRoot);
  clearIndices(source);
  clearIndices(target);
});

test('spin-off merges into an existing graph, preserves metadata, and remaps collisions', async () => {
  const sourceRoot = await caller.idea.createFloatingIdea({
    graph: source,
    idea: { text: 'Imported branch root' },
  });
  await caller.project.updateMeta({
    graph: target,
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
    graph: source,
    rootIds: [sourceRoot.id],
    targetPath: target,
    removeFromSource: false,
    preserveInflow: false,
  });

  assert.equal(result.integratedIntoExisting, true);
  const importedId = result.remappedIds[sourceRoot.id];
  assert.ok(importedId);
  assert.notEqual(importedId, sourceRoot.id);

  const targetMeta = await caller.project.getMeta({ graph: target });
  assert.equal(targetMeta.name, 'Existing target');
  const original = await caller.idea.get({ graph: target, ideaId: sourceRoot.id });
  const imported = await caller.idea.get({ graph: target, ideaId: importedId });
  assert.equal(original.text, 'Pre-existing target idea');
  assert.equal(imported.text, 'Imported branch root');
  assert.deepEqual(imported.supportedIdeas, []);
  assert.deepEqual(imported.committedIn, []);
});

test('spin-off refuses to target its source graph', async () => {
  const root = await caller.idea.createFloatingIdea({
    graph: source,
    idea: { text: 'Root' },
  });
  await assert.rejects(
    () => caller.spinOff.execute({
      graph: source,
      rootIds: [root.id],
      targetPath: source,
      removeFromSource: false,
      preserveInflow: false,
    }),
    /different .bowman space/i,
  );
});

test('a fresh spin-off joins the spaces: in the spaces directory with a repository of its own, elsewhere as a checkout', async () => {
  const root = await caller.idea.createFloatingIdea({ graph: source, idea: { text: 'Branch' } });
  const spaces = await caller.spinOff.spacesDirectory();
  assert.equal(spaces, path.join(testRoot, 'server', 'spaces'));

  const inSpaces = path.join(spaces, 'branch');
  await caller.spinOff.execute({ graph: source, rootIds: [root.id], targetPath: inSpaces, removeFromSource: false });
  assert.ok(await fs.pathExists(path.join(inSpaces, '.git')), 'a repository of its own');
  await caller.spinOff.execute({ graph: source, rootIds: [root.id], targetPath: target, removeFromSource: false });
  assert.equal(await fs.pathExists(path.join(testRoot, 'target', '.git')), false, 'a path elsewhere is left as it is');

  assert.deepEqual(listGraphs().map(({ slug, kind, path }) => ({ slug, kind, path })), [
    { slug: 'branch', kind: 'created', path: inSpaces },
    { slug: 'target', kind: 'checkout', path: path.join(testRoot, 'target') },
  ]);
  for (const graph of listGraphs()) clearIndices(path.join(graph.path, '.bowman'));
});
