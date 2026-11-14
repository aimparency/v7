import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { READ_ONLY_MARKER } from 'shared/bowman-migration';
import { appRouter } from './server';
import { clearIndices } from './search';

const caller = appRouter.createCaller({});
let root = '';
let projectPath = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-read-only-'));
  projectPath = path.join(root, '.bowman');
  await fs.ensureDir(projectPath);
});

afterEach(async () => {
  clearIndices(projectPath);
  await fs.remove(root);
});

const snapshot = async () => {
  const files: Record<string, string> = {};
  for (const dir of ['ideas', 'archived-ideas', 'phases']) {
    for (const file of await fs.readdir(path.join(projectPath, dir)).catch(() => [] as string[])) {
      files[`${dir}/${file}`] = await fs.readFile(path.join(projectPath, dir, file), 'utf8');
    }
  }
  files['meta.json'] = await fs.readFile(path.join(projectPath, 'meta.json'), 'utf8');
  return files;
};

test('a read-only project refuses every graph change with one message, and stays readable', async () => {
  const phase = await caller.phase.create({ graph: projectPath, phase: { name: 'Now' } }) as { id: string };
  const parent = await caller.idea.createIdeaInPhase({ graph: projectPath, phaseId: phase.id, idea: { text: 'Parent' } });
  const child = await caller.idea.createSubIdea({ graph: projectPath, parentIdeaId: parent.id, idea: { text: 'Child' } });
  assert.deepEqual(await caller.project.getAccess({ graph: projectPath }), { writable: true, reason: null, user: null, role: 'owner', serverAdmin: true });

  await fs.writeFile(path.join(projectPath, READ_ONLY_MARKER), '');
  const before = await snapshot();

  const attempts: Record<string, () => Promise<unknown>> = {
    createFloatingIdea: () => caller.idea.createFloatingIdea({ graph: projectPath, idea: { text: 'New' } }),
    createSubIdea: () => caller.idea.createSubIdea({ graph: projectPath, parentIdeaId: parent.id, idea: { text: 'New child' } }),
    update: () => caller.idea.update({ graph: projectPath, ideaId: child.id, idea: { text: 'Renamed' } }),
    delete: () => caller.idea.delete({ graph: projectPath, ideaIds: [child.id] }),
    disconnect: () => caller.idea.disconnect({ graph: projectPath, parentIdeaId: parent.id, childIdeaId: child.id }),
    setConnectionPositions: () => caller.idea.setConnectionPositions({ graph: projectPath, changes: [{ parentId: parent.id, childId: child.id, relativePosition: [1, 1] }] }),
    removeFromPhase: () => caller.idea.removeFromPhase({ graph: projectPath, ideaId: parent.id, phaseId: phase.id }),
    phaseCreate: () => caller.phase.create({ graph: projectPath, phase: { name: 'Later' } }),
    phaseUpdate: () => caller.phase.update({ graph: projectPath, phaseId: phase.id, phase: { name: 'Renamed' } }),
    updateMeta: () => caller.project.updateMeta({ graph: projectPath, meta: { name: 'Renamed', color: '#123456' } }),
    injectAgentInstructions: () => caller.project.injectAgentInstructions({ graph: projectPath })
  };
  for (const [name, attempt] of Object.entries(attempts)) {
    await assert.rejects(attempt, /open read-only/, name);
  }

  assert.deepEqual(await snapshot(), before);
  assert.equal((await caller.idea.list({ graph: projectPath })).length, 2);
  assert.equal((await caller.phase.list({ graph: projectPath })).length, 1);
  // Navigating phases is not a graph change: it is allowed and not persisted.
  assert.deepEqual(await caller.phase.setCursor({ graph: projectPath, cursors: { '0': phase.id }, activeLevel: 0 }), { success: false });
  assert.deepEqual(await caller.project.getAccess({ graph: projectPath }), {
    writable: false,
    reason: 'This project is open read-only. Its ideas, phases and settings cannot be changed here.',
    user: null,
    role: 'owner',
    serverAdmin: true
  });
});
