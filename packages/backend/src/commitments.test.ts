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
