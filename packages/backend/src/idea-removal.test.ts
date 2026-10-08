import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server';
import { clearIndices } from './search';

// Deleting, detaching and disconnecting ideas. The cascade only takes
// descendants that nothing else anchors: a surviving parent or a phase
// commitment keeps an idea alive. Detaching never deletes.

const caller = appRouter.createCaller({});

let testRootPath = '';
let projectPath = '';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-idea-removal-test-'));
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

const exists = async (ideaId: string) => (await caller.idea.list({ projectPath, ids: [ideaId] })).length > 0;
const get = (ideaId: string) => caller.idea.get({ projectPath, ideaId });

test('detach from one of two parents keeps the idea and its whole subtree', async () => {
  // The reported case: "Martina" has two parents; its child is committed in a phase.
  const guitar = await makeIdea('Gitarre spielen');
  const other = await makeIdea('Other parent');
  const martina = await makeIdea('Martina');
  const discuss = await makeIdea('Ideen mit Martina besprechen');
  const plain = await makeIdea('Unanchored grandchild');
  await connect(guitar, martina);
  await connect(other, martina);
  await connect(martina, discuss);
  await connect(martina, plain);
  const phaseId = await makePhase();
  await caller.idea.commitToPhase({ projectPath, ideaId: discuss, phaseId });

  await caller.idea.detach({ projectPath, ideaId: martina, from: { parentId: guitar } });

  assert.deepStrictEqual((await get(guitar)).supportingConnections, []);
  assert.deepStrictEqual((await get(martina)).supportedIdeas, [other]);
  assert.deepStrictEqual((await get(martina)).supportingConnections.map((c) => c.ideaId), [discuss, plain]);
  assert.deepStrictEqual((await caller.phase.get({ projectPath, phaseId })).commitments, [discuss]);
});

test('cascade deletes orphaned descendants but spares anchored ones', async () => {
  const root = await makeIdea('Root');
  const doomed = await makeIdea('Doomed');
  const orphan = await makeIdea('Orphan grandchild');
  const committed = await makeIdea('Committed grandchild');
  const shared = await makeIdea('Shared grandchild');
  const outsider = await makeIdea('Outside parent');
  await connect(root, doomed);
  await connect(doomed, orphan);
  await connect(doomed, committed);
  await connect(doomed, shared);
  await connect(outsider, shared);
  const phaseId = await makePhase();
  await caller.idea.commitToPhase({ projectPath, ideaId: committed, phaseId });

  const preview = await caller.idea.delete({ projectPath, ideaIds: [doomed], cascade: true, dryRun: true });
  assert.deepStrictEqual(new Set(preview.deletedIds), new Set([doomed, orphan]));
  assert.strictEqual(await exists(orphan), true);

  const { deletedIds } = await caller.idea.delete({ projectPath, ideaIds: [doomed], cascade: true });

  assert.deepStrictEqual(new Set(deletedIds), new Set([doomed, orphan]));
  assert.strictEqual(await exists(orphan), false);
  assert.deepStrictEqual((await get(committed)).supportedIdeas, []);
  assert.deepStrictEqual((await get(shared)).supportedIdeas, [outsider]);
  assert.deepStrictEqual((await get(root)).supportingConnections, []);
});

test('cascade terminates on cycles and deletes an island only reachable through the root', async () => {
  const root = await makeIdea('Root');
  const loopA = await makeIdea('Loop A');
  const loopB = await makeIdea('Loop B');
  await connect(root, loopA);
  await connect(loopA, loopB);
  await connect(loopB, loopA);

  const { deletedIds } = await caller.idea.delete({ projectPath, ideaIds: [root], cascade: true });

  assert.deepStrictEqual(new Set(deletedIds), new Set([root, loopA, loopB]));
});

test('cascade keeps a loop that an outside parent anchors', async () => {
  const root = await makeIdea('Root');
  const outsider = await makeIdea('Outside parent');
  const loopA = await makeIdea('Loop A');
  const loopB = await makeIdea('Loop B');
  await connect(root, loopA);
  await connect(loopA, loopB);
  await connect(loopB, loopA);
  await connect(outsider, loopB);

  const { deletedIds } = await caller.idea.delete({ projectPath, ideaIds: [root], cascade: true });

  assert.deepStrictEqual(deletedIds, [root]);
  assert.deepStrictEqual(new Set((await get(loopA)).supportedIdeas), new Set([loopB]));
});

test('cascade deletes a diamond descendant reached through two deleted branches', async () => {
  const root = await makeIdea('Root');
  const left = await makeIdea('Left');
  const right = await makeIdea('Right');
  const bottom = await makeIdea('Bottom');
  await connect(root, left);
  await connect(root, right);
  await connect(left, bottom);
  await connect(right, bottom);

  const { deletedIds } = await caller.idea.delete({ projectPath, ideaIds: [root], cascade: true });

  assert.deepStrictEqual(new Set(deletedIds), new Set([root, left, right, bottom]));
});

test('delete without cascade only removes the idea and every reference to it', async () => {
  const parent = await makeIdea('Parent');
  const idea = await makeIdea('Idea');
  const child = await makeIdea('Child');
  await connect(parent, idea);
  await connect(idea, child);
  const phaseId = await makePhase();
  await caller.idea.commitToPhase({ projectPath, ideaId: idea, phaseId });

  const { deletedIds } = await caller.idea.delete({ projectPath, ideaIds: [idea] });

  assert.deepStrictEqual(deletedIds, [idea]);
  assert.deepStrictEqual((await get(parent)).supportingConnections, []);
  assert.deepStrictEqual((await get(child)).supportedIdeas, []);
  assert.deepStrictEqual((await caller.phase.get({ projectPath, phaseId })).commitments, []);
});

test('detach leaves an unanchored idea floating with its subtree', async () => {
  const parent = await makeIdea('Parent');
  const idea = await makeIdea('Only under this parent');
  const child = await makeIdea('Child');
  const lonely = await makeIdea('Only in the phase');
  await connect(parent, idea);
  await connect(idea, child);
  const phaseId = await makePhase();
  await caller.idea.commitToPhase({ projectPath, ideaId: lonely, phaseId });

  await caller.idea.detach({ projectPath, ideaId: idea, from: { parentId: parent } });
  await caller.idea.detach({ projectPath, ideaId: lonely, from: { phaseId } });

  assert.deepStrictEqual((await get(idea)).supportedIdeas, []);
  assert.deepStrictEqual((await get(idea)).supportingConnections.map((c) => c.ideaId), [child]);
  assert.deepStrictEqual((await get(lonely)).committedIn, []);
  assert.deepStrictEqual((await caller.phase.get({ projectPath, phaseId })).commitments, []);
});

test('disconnect removes the edge on both sides and keeps both ideas', async () => {
  const parent = await makeIdea('Parent');
  const child = await makeIdea('Child');
  await connect(parent, child);

  await caller.idea.disconnect({ projectPath, parentIdeaId: parent, childIdeaId: child });

  assert.deepStrictEqual((await get(parent)).supportingConnections, []);
  assert.deepStrictEqual((await get(child)).supportedIdeas, []);
});
