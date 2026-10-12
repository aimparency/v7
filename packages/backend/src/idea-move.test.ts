import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server';
import { clearIndices } from './search';

// idea.move: cut/paste and keyboard moves as one operation that returns the
// touched ideas and phases.

const caller = appRouter.createCaller({});

let testRootPath = '';
let projectPath = '';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-idea-move-test-'));
  projectPath = path.join(testRootPath, 'repo', '.bowman');
  await fs.ensureDir(projectPath);
});

afterEach(async () => {
  await fs.remove(testRootPath);
  clearIndices(projectPath);
});

async function makeIdea(text: string): Promise<string> {
  return (await caller.idea.createFloatingIdea({ projectPath, idea: { text } })).id;
}

async function connect(parentIdeaId: string, childIdeaId: string) {
  await caller.idea.connectIdeas({ projectPath, parentIdeaId, childIdeaId });
}

async function makePhase(): Promise<string> {
  return (await caller.phase.create({ projectPath, phase: { name: 'April', parent: null, commitments: [] } })).id;
}

const get = (ideaId: string) => caller.idea.get({ projectPath, ideaId });
const children = async (ideaId: string) => (await get(ideaId)).supportingConnections.map((c) => c.ideaId);

test('moves between parents, keeping the parent slot and returning both parents', async () => {
  const first = await makeIdea('First parent');
  const oldParent = await makeIdea('Old parent');
  const newParent = await makeIdea('New parent');
  const sibling = await makeIdea('Sibling');
  const moved = await makeIdea('Moved');
  await connect(newParent, sibling);
  await connect(oldParent, moved);
  await connect(first, moved);

  const result = await caller.idea.move({
    projectPath,
    ideaId: moved,
    from: { parentId: oldParent },
    to: { parentId: newParent },
    index: 0
  });

  assert.deepEqual(await children(oldParent), []);
  assert.deepEqual(await children(newParent), [moved, sibling]);
  assert.deepEqual((await get(moved)).supportedIdeas, [newParent, first]);
  assert.deepEqual(result.ideas.map((idea) => idea.id).sort(), [moved, oldParent, newParent].sort());
  assert.deepEqual(result.phases, []);
});

test('reorders within the same parent without detaching', async () => {
  const parent = await makeIdea('Parent');
  const otherParent = await makeIdea('Other parent');
  const [a, b, c] = [await makeIdea('a'), await makeIdea('b'), await makeIdea('c')];
  for (const child of [a, b, c]) await connect(parent, child);
  await connect(otherParent, a);

  await caller.idea.move({ projectPath, ideaId: a, from: { parentId: parent }, to: { parentId: parent }, index: 2 });

  assert.deepEqual(await children(parent), [b, c, a]);
  assert.deepEqual((await get(a)).supportedIdeas, [parent, otherParent]);
});

test('moves from a phase to a parent and from a parent into a phase', async () => {
  const phase = await makePhase();
  const parent = await makeIdea('Parent');
  const moved = (await caller.idea.createIdeaInPhase({ projectPath, phaseId: phase, idea: { text: 'Moved' } })).id;

  const toParent = await caller.idea.move({ projectPath, ideaId: moved, from: { phaseId: phase }, to: { parentId: parent } });
  assert.deepEqual(toParent.phases[0]!.commitments, []);
  assert.deepEqual(await children(parent), [moved]);
  assert.deepEqual((await get(moved)).committedIn, []);

  const toPhase = await caller.idea.move({ projectPath, ideaId: moved, from: { parentId: parent }, to: { phaseId: phase }, index: 0 });
  assert.deepEqual(toPhase.phases[0]!.commitments, [moved]);
  assert.deepEqual(await children(parent), []);
  assert.deepEqual((await get(moved)).committedIn, [phase]);
});

test('without from it only attaches, without to it only detaches', async () => {
  const keep = await makeIdea('Keeps it');
  const other = await makeIdea('Other');
  const idea = await makeIdea('Idea');
  await connect(keep, idea);

  await caller.idea.move({ projectPath, ideaId: idea, to: { parentId: other } });
  assert.deepEqual((await get(idea)).supportedIdeas, [keep, other]);

  await caller.idea.move({ projectPath, ideaId: idea, from: { parentId: other } });
  assert.deepEqual((await get(idea)).supportedIdeas, [keep]);
  assert.deepEqual(await children(other), []);
});
