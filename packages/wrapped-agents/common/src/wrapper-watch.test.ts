import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findChangedWrapperSources, latestWrapperSourceMtime } from './wrapper-watch';
import { WatchdogService, buildWrapperRelaunchPrompt } from './watchdog-service';
import { type AgentProfile, COMMON_CHOICE_MENU_PATTERNS } from './agent-profile';

function writeFile(root: string, rel: string, content = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Build a fake wrapped-agents layout. Returns the root dir.
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapper-watch-'));
  writeFile(root, 'common/src/a.ts');
  writeFile(root, 'common/src/a.test.ts');
  writeFile(root, 'common/src/nested/c.ts');
  writeFile(root, 'codex-session/src/b.ts');
  // Should all be ignored:
  writeFile(root, 'common/node_modules/dep/src/x.ts'); // vendored
  writeFile(root, 'common/dist/built.ts');             // build output
  writeFile(root, 'client/src/ui.ts');                 // browser UI, not runtime
  writeFile(root, 'common/README.md');                 // non-.ts
  return root;
}

const relSet = (root: string, files: string[]) =>
  new Set(files.map((f) => path.relative(root, f).split(path.sep).join('/')));

test('collects only package src .ts, pruning node_modules/dist/client and non-ts', () => {
  const root = makeRoot();
  try {
    const all = findChangedWrapperSources(root, 0); // mtime > 0 ⇒ everything collected
    assert.deepEqual(
      relSet(root, all),
      new Set(['common/src/a.ts', 'common/src/a.test.ts', 'common/src/nested/c.ts', 'codex-session/src/b.ts']),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('nothing is newer than the launch baseline initially', () => {
  const root = makeRoot();
  try {
    const baseline = latestWrapperSourceMtime(root);
    assert.equal(findChangedWrapperSources(root, baseline).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detects exactly the source file edited after the baseline', () => {
  const root = makeRoot();
  try {
    const baseline = latestWrapperSourceMtime(root);
    const future = new Date(baseline + 60_000);
    fs.utimesSync(path.join(root, 'common/src/a.ts'), future, future);

    const changed = findChangedWrapperSources(root, baseline);
    assert.deepEqual(relSet(root, changed), new Set(['common/src/a.ts']));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pruned dirs never flag dirty even when newer than baseline', () => {
  const root = makeRoot();
  try {
    const baseline = latestWrapperSourceMtime(root);
    const future = new Date(baseline + 60_000);
    for (const rel of ['client/src/ui.ts', 'common/dist/built.ts', 'common/node_modules/dep/src/x.ts']) {
      fs.utimesSync(path.join(root, rel), future, future);
    }
    assert.equal(findChangedWrapperSources(root, baseline).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- WatchdogService integration -------------------------------------------

const testProfile: AgentProfile = {
  agentType: 'codex',
  command: 'test',
  bannerName: 'Test',
  buildWorkerArgs: () => [],
  buildWatchdogArgs: () => [],
  resumeFailurePatterns: [],
  spinnerPattern: /x/,
  busyPatterns: [],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};

function makeService(root: string): WatchdogService {
  return new WatchdogService({} as any, {} as any, testProfile, { wrappedAgentsRoot: root });
}

test('WatchdogService is clean at launch and latches dirty on a self-edit', () => {
  const root = makeRoot();
  try {
    const svc = makeService(root);
    assert.equal(svc.isWrapperDirty(), false);

    // No change yet → still clean after a check.
    svc.checkWrapperDirty(Date.now());
    assert.equal(svc.isWrapperDirty(), false);

    // Edit our own source after launch.
    const baseline = latestWrapperSourceMtime(root);
    const future = new Date(baseline + 60_000);
    fs.utimesSync(path.join(root, 'codex-session/src/b.ts'), future, future);

    // Advance past the throttle window, then check.
    svc.checkWrapperDirty(Date.now() + 20_000);
    assert.equal(svc.isWrapperDirty(), true);
    assert.equal(svc.changedWrapperFiles.length, 1);
    assert.ok(svc.changedWrapperFiles[0].endsWith('b.ts'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dirty check is throttled within the interval', () => {
  const root = makeRoot();
  try {
    const svc = makeService(root);
    const t0 = Date.now();
    svc.checkWrapperDirty(t0); // first check sets lastWrapperCheckAt = t0

    // Edit after the first check…
    const baseline = latestWrapperSourceMtime(root);
    const future = new Date(baseline + 60_000);
    fs.utimesSync(path.join(root, 'common/src/a.ts'), future, future);

    // …but a check within the throttle window must NOT scan yet.
    svc.checkWrapperDirty(t0 + 1_000);
    assert.equal(svc.isWrapperDirty(), false);

    // Past the window it catches up.
    svc.checkWrapperDirty(t0 + 20_000);
    assert.equal(svc.isWrapperDirty(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- relaunch prompt (aim 310878de) ----------------------------------------

test('buildWrapperRelaunchPrompt is actionable: lists changed files and explains relaunch', () => {
  const root = '/repo/wrapped-agents';
  const prompt = buildWrapperRelaunchPrompt([path.join(root, 'common/src/watchdog-service.ts')], root);
  assert.match(prompt, /common\/src\/watchdog-service\.ts/);
  assert.match(prompt, /relaunch/i);
  assert.match(prompt, /commit/i);
  assert.match(prompt, /stale/i);
});

test('buildWrapperRelaunchPrompt truncates long file lists', () => {
  const root = '/r';
  const files = Array.from({ length: 7 }, (_, i) => path.join(root, `common/src/f${i}.ts`));
  const prompt = buildWrapperRelaunchPrompt(files, root);
  assert.match(prompt, /\(\+2 more\)/); // shows 5, hides 2
});

function makeServiceWithWorker(root: string, worker: any): WatchdogService {
  return new WatchdogService(worker, {} as any, testProfile, { wrappedAgentsRoot: root });
}

test('injects the relaunch warning to the worker exactly once', async () => {
  const root = makeRoot();
  try {
    let written = '';
    const worker = { write: (s: string) => { written += s; }, getLines: () => '', getLastLine: () => '' };
    const svc = makeServiceWithWorker(root, worker);
    svc.enabled = true;
    (svc as any).wrapperDirty = true;
    (svc as any).changedWrapperFiles = [path.join(root, 'codex-session/src/b.ts')];

    const first = await (svc as any).maybeWarnWrapperDirty();
    assert.equal(first, true);
    assert.match(written, /relaunch/i);
    assert.match(written, /b\.ts/);

    const lenAfterFirst = written.length;
    const second = await (svc as any).maybeWarnWrapperDirty();
    assert.equal(second, false);
    assert.equal(written.length, lenAfterFirst, 'must not re-warn on the next halt');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
