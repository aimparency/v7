import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server';
import { clearIndices } from './search';

// Data-model slice of repo-level cross-repo links (aim 8ae69400):
// an aim can be supported by a WHOLE external repo via a {repoId}-only edge
// stored in its own supportingRepos array — no aimId, no back-reference. These
// tests pin the persistence round-trip and that the consistency checker leaves
// repo edges alone (it only walks supportingConnections/supportedAims).

const caller = appRouter.createCaller({});

let testRootPath = '';
let projectPath = '';

// A repo we link to as a black box. It never needs to be checked out for the
// edge to persist — that's the point of an opaque repo link.
const EXTERNAL_REPO_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-repo-conn-test-'));
  projectPath = path.join(testRootPath, 'repo', '.bowman');
  await fs.ensureDir(projectPath);
});

afterEach(async () => {
  await fs.remove(testRootPath);
  clearIndices(projectPath);
});

async function makeAim(text: string): Promise<string> {
  const aim = await caller.aim.createFloatingAim({ projectPath, aim: { text } });
  return aim.id;
}

test('update persists a {repoId}-only supportingRepos edge with defaults', async () => {
  const aimId = await makeAim('local aim that leans on an external project');

  await caller.aim.update({
    projectPath,
    aimId,
    aim: { supportingRepos: [{ repoId: EXTERNAL_REPO_ID, weight: 2 }] },
  });

  const reloaded = await caller.aim.get({ projectPath, aimId });
  assert.equal(reloaded.supportingRepos?.length, 1);
  const edge = reloaded.supportingRepos![0];
  assert.equal(edge.repoId, EXTERNAL_REPO_ID);
  assert.equal(edge.weight, 2);
  assert.deepEqual(edge.relativePosition, [0, 0]); // defaulted
  assert.equal((edge as any).aimId, undefined, 'a repo edge must not carry an aimId');
});

test('an unrelated update does not wipe an existing repo edge', async () => {
  const aimId = await makeAim('aim');
  await caller.aim.update({ projectPath, aimId, aim: { supportingRepos: [{ repoId: EXTERNAL_REPO_ID }] } });

  // Touch a different field; supportingRepos is absent from this payload.
  await caller.aim.update({ projectPath, aimId, aim: { intrinsicValue: 5 } });

  const reloaded = await caller.aim.get({ projectPath, aimId });
  assert.equal(reloaded.intrinsicValue, 5);
  assert.equal(reloaded.supportingRepos?.length, 1, 'repo edge preserved across an unrelated update');
});

test('consistency check ignores repo edges (no phantom non-existent-child issue)', async () => {
  const aimId = await makeAim('aim with a black-box repo supporter');
  await caller.aim.update({ projectPath, aimId, aim: { supportingRepos: [{ repoId: EXTERNAL_REPO_ID }] } });

  const report = await caller.project.checkConsistency({ projectPath });
  const messages = (report.issues ?? []).map((i: any) => `${i.code} ${i.message}`).join('\n');
  assert.ok(
    !messages.includes(EXTERNAL_REPO_ID),
    `repo edge must not be flagged by consistency, got:\n${messages}`,
  );
});

test('fixConsistency does not prune a repo edge', async () => {
  const aimId = await makeAim('aim');
  await caller.aim.update({ projectPath, aimId, aim: { supportingRepos: [{ repoId: EXTERNAL_REPO_ID }] } });

  await caller.project.fixConsistency({ projectPath });

  const reloaded = await caller.aim.get({ projectPath, aimId });
  assert.equal(reloaded.supportingRepos?.length, 1, 'fix must not strip the repo edge');
});

test('linkRepo attaches a {repoId}-only edge with a defaulted position', async () => {
  const aimId = await makeAim('aim that will lean on a repo');

  await caller.aim.linkRepo({ projectPath, aimId, repoId: EXTERNAL_REPO_ID, weight: 3 });

  const reloaded = await caller.aim.get({ projectPath, aimId });
  assert.equal(reloaded.supportingRepos?.length, 1);
  const edge = reloaded.supportingRepos![0];
  assert.equal(edge.repoId, EXTERNAL_REPO_ID);
  assert.equal(edge.weight, 3);
  assert.equal((edge as any).aimId, undefined, 'a repo edge must carry no aimId');
  assert.ok(Array.isArray(edge.relativePosition) && edge.relativePosition.length === 2, 'gets a relative position');
});

test('linkRepo is idempotent on repoId (upsert, not duplicate)', async () => {
  const aimId = await makeAim('aim');
  await caller.aim.linkRepo({ projectPath, aimId, repoId: EXTERNAL_REPO_ID, weight: 1 });
  await caller.aim.linkRepo({ projectPath, aimId, repoId: EXTERNAL_REPO_ID, weight: 5, explanation: 'leans harder now' });

  const reloaded = await caller.aim.get({ projectPath, aimId });
  assert.equal(reloaded.supportingRepos?.length, 1, 'no duplicate edge for the same repo');
  assert.equal(reloaded.supportingRepos![0].weight, 5, 'weight updated on re-link');
  assert.equal(reloaded.supportingRepos![0].explanation, 'leans harder now');
});

test('linkRepo preserves an existing edge to a different repo', async () => {
  const OTHER_REPO_ID = '22222222-2222-4222-8222-222222222222';
  const aimId = await makeAim('aim leaning on two repos');
  await caller.aim.linkRepo({ projectPath, aimId, repoId: EXTERNAL_REPO_ID });
  await caller.aim.linkRepo({ projectPath, aimId, repoId: OTHER_REPO_ID });

  const reloaded = await caller.aim.get({ projectPath, aimId });
  assert.equal(reloaded.supportingRepos?.length, 2, 'both distinct repo edges kept');
});

test('unlinkRepo removes only the matching repo edge', async () => {
  const OTHER_REPO_ID = '22222222-2222-4222-8222-222222222222';
  const aimId = await makeAim('aim');
  await caller.aim.linkRepo({ projectPath, aimId, repoId: EXTERNAL_REPO_ID });
  await caller.aim.linkRepo({ projectPath, aimId, repoId: OTHER_REPO_ID });

  await caller.aim.unlinkRepo({ projectPath, aimId, repoId: EXTERNAL_REPO_ID });

  const reloaded = await caller.aim.get({ projectPath, aimId });
  assert.equal(reloaded.supportingRepos?.length, 1);
  assert.equal(reloaded.supportingRepos![0].repoId, OTHER_REPO_ID, 'the other edge survives');
});
