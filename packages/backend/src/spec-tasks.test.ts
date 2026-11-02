import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { appRouter } from './server';
import { clearIndices } from './search';
import { parseSpecTasks } from './spec-tasks';

const caller = appRouter.createCaller({});
let root = '';
let projectPath = '';

// GitHub spec-kit style: phase headings, T-numbered tasks.
const SPEC_KIT = `# Tasks: User signup

## Phase 3.1: Setup
- [x] T001 Create project structure per implementation plan
- [ ] T002 [P] Contract test POST /api/users in tests/contract/test_users_post.py

## Phase 3.2: Core
- [ ] T003 User model in src/models/user.py
`;

// spec-workflow-mcp style: numbered tasks with indented details, [-] in progress.
const SPEC_WORKFLOW = `# Tasks Document

- [x] 1. Create core interfaces in src/types/feature.ts
  - File: src/types/feature.ts
  - _Requirements: 1.1_

- [-] 2. Implement the feature service
  - Purpose: business logic
- [ ] 3. Add tests
`;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-spec-tasks-'));
  projectPath = path.join(root, '.bowman');
  await fs.ensureDir(projectPath);
  await fs.outputFile(path.join(root, 'specs', '001-user-signup', 'tasks.md'), SPEC_KIT);
  await fs.outputFile(path.join(root, '.spec-workflow', 'specs', 'feature', 'tasks.md'), SPEC_WORKFLOW);
});

afterEach(async () => {
  clearIndices(projectPath);
  await fs.remove(root);
});

test('parses spec-kit and spec-workflow checklists: ids, checkbox state, indented details', () => {
  assert.deepEqual(parseSpecTasks(SPEC_KIT).map((task) => [task.key, task.state]), [['T001', 'implemented'], ['T002', 'open'], ['T003', 'open']]);
  const workflow = parseSpecTasks(SPEC_WORKFLOW);
  assert.deepEqual(workflow.map((task) => [task.key, task.state]), [['1', 'implemented'], ['2', 'partially'], ['3', 'open']]);
  assert.equal(workflow[0]!.details, '- File: src/types/feature.ts\n- _Requirements: 1.1_');
  assert.equal(workflow[2]!.details, '');
});

test('imports every tasks.md below a directory, one parent per spec, and only adds new tasks on re-run', async () => {
  const first = await caller.idea.importSpecTasks({ projectPath, specPath: '.' });
  assert.deepEqual(first.files.map((file) => [file.file, file.imported]), [
    ['.spec-workflow/specs/feature/tasks.md', 3],
    ['specs/001-user-signup/tasks.md', 3]
  ]);

  const parent = await caller.idea.get({ projectPath, ideaId: first.files[1]!.parentId! });
  assert.equal(parent.text, 'Spec tasks: 001-user-signup');
  const children = await Promise.all(parent.supportingConnections.map((connection) => caller.idea.get({ projectPath, ideaId: connection.ideaId })));
  const done = children.find((child) => child.text.startsWith('T001'))!;
  assert.equal(done.status.state, 'implemented');
  assert.equal(done.description, 'Spec task specs/001-user-signup/tasks.md#T001');

  await fs.appendFile(path.join(root, 'specs', '001-user-signup', 'tasks.md'), '- [ ] T004 Signup endpoint\n');
  const second = await caller.idea.importSpecTasks({ projectPath, specPath: 'specs/001-user-signup/tasks.md' });
  assert.deepEqual(second.files, [{ file: 'specs/001-user-signup/tasks.md', parentId: parent.id, imported: 1, alreadyImported: 3, advanced: 0 }]);
  assert.equal((await caller.idea.list({ projectPath })).length, 9);
});

test('a re-import moves ticked tasks forward and never moves an idea back', async () => {
  const file = path.join(root, 'specs', '001-user-signup', 'tasks.md');
  const first = await caller.idea.importSpecTasks({ projectPath, specPath: 'specs' });
  const parent = await caller.idea.get({ projectPath, ideaId: first.files[0]!.parentId! });
  const byKey = async () => Object.fromEntries(await Promise.all(parent.supportingConnections.map(async (connection) => {
    const idea = await caller.idea.get({ projectPath, ideaId: connection.ideaId });
    return [idea.text.split(' ')[0], idea.status.state];
  })));

  // T002 ticked in the file; T001 unticked again (the graph stays ahead).
  await fs.writeFile(file, SPEC_KIT.replace('- [ ] T002', '- [x] T002').replace('- [x] T001', '- [ ] T001'));
  const second = await caller.idea.importSpecTasks({ projectPath, specPath: 'specs' });
  assert.equal(second.files[0]!.advanced, 1);
  assert.deepEqual(await byKey(), { T001: 'implemented', T002: 'implemented', T003: 'open' });
});

test('refuses paths outside the repository', async () => {
  await assert.rejects(caller.idea.importSpecTasks({ projectPath, specPath: '../elsewhere' }), /inside the repository/);
});
