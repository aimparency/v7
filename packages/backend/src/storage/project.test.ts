import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import os from 'node:os';
import path from 'path';
import fs from 'fs-extra';
import { CURRENT_DATA_MODEL_VERSION } from 'shared';
import { forgetProjectChecks, migrateProject } from './project.js';

let projectPath = '';

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-project-test-'));
  await fs.writeJson(path.join(projectPath, 'meta.json'), { name: 'p', dataModelVersion: CURRENT_DATA_MODEL_VERSION });
  await fs.ensureDir(path.join(projectPath, 'ideas'));
});

afterEach(async () => {
  await fs.remove(projectPath);
});

test('migrateProject scans for legacy data once per project until the checks are forgotten', async () => {
  await migrateProject(projectPath);

  // Legacy data coming back (e.g. through git) after the first check.
  const ideaFile = path.join(projectPath, 'ideas', 'legacy.json');
  await fs.writeJson(ideaFile, { id: 'legacy', supportingConnections: [{ ideaId: 'child', explanation: 'because' }] });

  await migrateProject(projectPath);
  assert.equal((await fs.readJson(ideaFile)).supportingConnections[0].explanation, 'because');

  forgetProjectChecks();
  await migrateProject(projectPath);
  assert.deepEqual((await fs.readJson(ideaFile)).supportingConnections[0], { ideaId: 'child', hypothesis: 'because' });
});
