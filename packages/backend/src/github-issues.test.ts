import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { appRouter } from './server';
import { clearIndices } from './search';
import { parseGithubRepository } from './github-issues';

const caller = appRouter.createCaller({});
let root = '';
let projectPath = '';
let openIssues: any[] = [];
const requested: string[] = [];

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  body: `Body of ${number}`,
  html_url: `https://github.com/acme/tool/issues/${number}`,
  labels: [{ name: 'bug' }],
  ...extra
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-gh-issues-'));
  projectPath = path.join(root, '.bowman');
  await fs.ensureDir(projectPath);
  requested.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    if (url.includes('/repos/acme/missing/')) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    const page = Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify(openIssues.slice((page - 1) * 100, page * 100)), { status: 200 });
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  clearIndices(projectPath);
  await fs.remove(root);
});

test('imports open issues under one parent idea, skips pull requests, and only adds new issues on re-run', async () => {
  openIssues = [issue(1), issue(2, { pull_request: {} }), issue(3, { body: null, labels: ['help wanted'] })];

  const first = await caller.idea.importGithubIssues({ projectPath, repository: 'https://github.com/acme/tool.git' });
  assert.deepEqual({ imported: first.imported, alreadyImported: first.alreadyImported }, { imported: 2, alreadyImported: 0 });

  const parent = await caller.idea.get({ projectPath, ideaId: first.parentId! });
  assert.equal(parent.text, 'Open GitHub issues of acme/tool');
  const children = await Promise.all(parent.supportingConnections.map((connection) => caller.idea.get({ projectPath, ideaId: connection.ideaId })));
  assert.deepEqual(children.map((child) => child.text).sort(), ['Issue 1', 'Issue 3']);
  const third = children.find((child) => child.text === 'Issue 3')!;
  assert.equal(third.description, 'GitHub issue #3: https://github.com/acme/tool/issues/3');
  assert.deepEqual(third.tags, ['github-issue', 'help wanted']);

  openIssues = [issue(1), issue(3), issue(4)];
  const second = await caller.idea.importGithubIssues({ projectPath, repository: 'acme/tool' });
  assert.deepEqual(second, { parentId: first.parentId, imported: 1, alreadyImported: 2 });
  assert.equal((await caller.idea.list({ projectPath })).length, 4);
});

test('pages through large issue lists', async () => {
  openIssues = Array.from({ length: 150 }, (_, index) => issue(index + 1));
  const result = await caller.idea.importGithubIssues({ projectPath, repository: 'acme/tool' });
  assert.equal(result.imported, 150);
  assert.equal(requested.length, 2);
}, 60_000);

test('explains a missing or private repository', async () => {
  await assert.rejects(caller.idea.importGithubIssues({ projectPath, repository: 'acme/missing' }), /404.*not found, or private without GITHUB_TOKEN/);
});

test('accepts owner/repo and github.com URLs only', () => {
  assert.deepEqual(parseGithubRepository('acme/tool'), { owner: 'acme', repo: 'tool' });
  assert.deepEqual(parseGithubRepository('git@github.com:acme/tool.git'), { owner: 'acme', repo: 'tool' });
  assert.equal(parseGithubRepository('https://gitlab.com/acme/tool'), null);
  assert.equal(parseGithubRepository('https://github.com/acme'), null);
});
