import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server';
import { clearIndices } from './search';

// Phase commitments are a read-modify-write of the phase file. Concurrent
// requests (e.g. Enter hit repeatedly while the backend is busy) must not
// overwrite each other's commitments.

const caller = appRouter.createCaller({});

let testRootPath = '';
let projectPath = '';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-commitments-test-'));
  projectPath = path.join(testRootPath, 'repo', '.bowman');
  await fs.ensureDir(projectPath);
});

afterEach(async () => {
  await fs.remove(testRootPath);
  clearIndices(projectPath);
});

test('concurrent creates in one phase keep every commitment', async () => {
  const phaseId = (await caller.phase.create({ projectPath, phase: { name: 'Oktober', parent: null, commitments: [] } })).id;

  const created = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      caller.idea.createIdeaInPhase({ projectPath, phaseId, idea: { text: `idea ${index}` } })
    )
  );

  const phase = await caller.phase.get({ projectPath, phaseId });
  assert.deepStrictEqual([...phase.commitments].sort(), created.map((idea) => idea.id).sort());
});

test('concurrent commit and removal in one phase do not lose each other', async () => {
  const phaseId = (await caller.phase.create({ projectPath, phase: { name: 'Oktober', parent: null, commitments: [] } })).id;
  const stays = await caller.idea.createIdeaInPhase({ projectPath, phaseId, idea: { text: 'stays' } });
  const leaves = await caller.idea.createIdeaInPhase({ projectPath, phaseId, idea: { text: 'leaves' } });
  const joins = await caller.idea.createFloatingIdea({ projectPath, idea: { text: 'joins' } });

  await Promise.all([
    caller.idea.removeFromPhase({ projectPath, ideaId: leaves.id, phaseId }),
    caller.idea.commitToPhase({ projectPath, ideaId: joins.id, phaseId })
  ]);

  const phase = await caller.phase.get({ projectPath, phaseId });
  assert.deepStrictEqual([...phase.commitments].sort(), [stays.id, joins.id].sort());
});

test('concurrent phase creates keep every sibling, under a parent and at the root', async () => {
  const parentId = (await caller.phase.create({ projectPath, phase: { name: '2026', parent: null, commitments: [] } })).id;
  const create = (name: string, parent: string | null) => caller.phase.create({ projectPath, phase: { name, parent, commitments: [] } });

  const children = await Promise.all(['Oktober', 'November', 'Dezember'].map((name) => create(name, parentId)));
  const roots = await Promise.all(['2027', '2028'].map((name) => create(name, null)));

  const parent = await caller.phase.get({ projectPath, phaseId: parentId });
  assert.deepStrictEqual([...parent.childPhaseIds!].sort(), children.map((phase) => phase.id).sort());
  const rootIds = (await caller.phase.list({ projectPath, parentPhaseId: null })).map((phase) => phase.id);
  assert.deepStrictEqual([...rootIds].sort(), [parentId, ...roots.map((phase) => phase.id)].sort());
});

test('renaming a phase while an idea is committed to it keeps the commitment', async () => {
  const phaseId = (await caller.phase.create({ projectPath, phase: { name: 'Oktober', parent: null, commitments: [] } })).id;
  const idea = await caller.idea.createFloatingIdea({ projectPath, idea: { text: 'joins' } });

  await Promise.all([
    caller.phase.update({ projectPath, phaseId, phase: { name: 'October' } }),
    caller.idea.commitToPhase({ projectPath, ideaId: idea.id, phaseId })
  ]);

  const phase = await caller.phase.get({ projectPath, phaseId });
  assert.strictEqual(phase.name, 'October');
  assert.deepStrictEqual(phase.commitments, [idea.id]);
});
