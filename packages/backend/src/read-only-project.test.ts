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
  const phase = await caller.phase.create({ projectPath, phase: { name: 'Now' } }) as { id: string };
  const parent = await caller.idea.createIdeaInPhase({ projectPath, phaseId: phase.id, idea: { text: 'Parent' } });
  const child = await caller.idea.createSubIdea({ projectPath, parentIdeaId: parent.id, idea: { text: 'Child' } });
  assert.deepEqual(await caller.project.getAccess({ projectPath }), { writable: true, reason: null });

  await fs.writeFile(path.join(projectPath, READ_ONLY_MARKER), '');
  const before = await snapshot();

  const attempts: Record<string, () => Promise<unknown>> = {
    createFloatingIdea: () => caller.idea.createFloatingIdea({ projectPath, idea: { text: 'New' } }),
    createSubIdea: () => caller.idea.createSubIdea({ projectPath, parentIdeaId: parent.id, idea: { text: 'New child' } }),
    update: () => caller.idea.update({ projectPath, ideaId: child.id, idea: { text: 'Renamed' } }),
    delete: () => caller.idea.delete({ projectPath, ideaIds: [child.id] }),
    disconnect: () => caller.idea.disconnect({ projectPath, parentIdeaId: parent.id, childIdeaId: child.id }),
    removeFromPhase: () => caller.idea.removeFromPhase({ projectPath, ideaId: parent.id, phaseId: phase.id }),
    addReflection: () => caller.idea.addReflection({ projectPath, ideaId: child.id, reflection: { context: 'c', outcome: 'o', effectiveness: 'e', lesson: 'l' } }),
    phaseCreate: () => caller.phase.create({ projectPath, phase: { name: 'Later' } }),
    phaseUpdate: () => caller.phase.update({ projectPath, phaseId: phase.id, phase: { name: 'Renamed' } }),
    updateMeta: () => caller.project.updateMeta({ projectPath, meta: { name: 'Renamed', color: '#123456' } })
  };
  for (const [name, attempt] of Object.entries(attempts)) {
    await assert.rejects(attempt, /open read-only/, name);
  }

  assert.deepEqual(await snapshot(), before);
  assert.equal((await caller.idea.list({ projectPath })).length, 2);
  assert.equal((await caller.phase.list({ projectPath })).length, 1);
  // Navigating phases is not a graph change: it is allowed and not persisted.
  assert.deepEqual(await caller.phase.setCursor({ projectPath, cursors: { '0': phase.id }, activeLevel: 0 }), { success: false });
  assert.deepEqual(await caller.project.getAccess({ projectPath }), {
    writable: false,
    reason: 'This project is open read-only. Its ideas, phases and settings cannot be changed here.'
  });
});
