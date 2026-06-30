import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  consumeRelaunchRequest,
  getProjectRelaunchRequestFile,
  runRelaunchPass,
} from './relaunch-watch.js';

function mkProject(): string {
  // a repo root; the indicator lives under <root>/.bowman/runtime/
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relaunch-watch-'));
}

function writeIndicator(root: string, body?: string) {
  const file = getProjectRelaunchRequestFile(root);
  fs.ensureDirSync(path.dirname(file));
  fs.writeFileSync(file, body ?? '');
}

const indicatorExists = (root: string) => fs.existsSync(getProjectRelaunchRequestFile(root));

// --- consumeRelaunchRequest --------------------------------------------------

test('no indicator → not requested', () => {
  const root = mkProject();
  try {
    assert.deepEqual(consumeRelaunchRequest(root), { requested: false });
  } finally {
    fs.removeSync(root);
  }
});

test('empty indicator → requested (verified) and consumed', () => {
  const root = mkProject();
  try {
    writeIndicator(root);
    const req = consumeRelaunchRequest(root);
    assert.equal(req.requested, true);
    assert.equal(req.verify, undefined);
    assert.equal(indicatorExists(root), false, 'indicator should be deleted (one-shot)');
  } finally {
    fs.removeSync(root);
  }
});

test('indicator with {verify:false} → carries the override and is consumed', () => {
  const root = mkProject();
  try {
    writeIndicator(root, JSON.stringify({ verify: false }));
    const req = consumeRelaunchRequest(root);
    assert.deepEqual(req, { requested: true, verify: false });
    assert.equal(indicatorExists(root), false);
  } finally {
    fs.removeSync(root);
  }
});

test('non-JSON indicator body still counts as a (verified) request', () => {
  const root = mkProject();
  try {
    writeIndicator(root, 'please relaunch');
    const req = consumeRelaunchRequest(root);
    assert.equal(req.requested, true);
    assert.equal(req.verify, undefined);
    assert.equal(indicatorExists(root), false);
  } finally {
    fs.removeSync(root);
  }
});

// --- runRelaunchPass ---------------------------------------------------------

type Call = { projectPath: string; agentType: string; verify?: boolean };

function recordingRelaunch(sink: Call[], reject = false) {
  return (projectPath: string, agentType: any, opts: { verify?: boolean }) => {
    sink.push({ projectPath, agentType, verify: opts.verify });
    return reject ? Promise.reject(new Error('verify failed')) : Promise.resolve({});
  };
}

test('no indicators → relaunch never called', async () => {
  const calls: Call[] = [];
  await runRelaunchPass({
    instances: [{ projectPath: '/p/.bowman', agentType: 'claude' }],
    relaunch: recordingRelaunch(calls),
    consume: () => ({ requested: false }),
    log: () => {},
  });
  assert.equal(calls.length, 0);
});

test('indicator relaunches every session of that project, passing verify through', async () => {
  const calls: Call[] = [];
  const consumed: string[] = [];
  await runRelaunchPass({
    instances: [
      { projectPath: '/p/.bowman', agentType: 'claude' },
      { projectPath: '/p/.bowman', agentType: 'gemini' },
      { projectPath: '/other/.bowman', agentType: 'codex' },
    ],
    relaunch: recordingRelaunch(calls),
    consume: (p: string) => {
      consumed.push(p);
      return p === '/p/.bowman' ? { requested: true, verify: false } : { requested: false };
    },
    log: () => {},
  });

  // consumed once per distinct project
  assert.deepEqual(consumed.sort(), ['/other/.bowman', '/p/.bowman']);
  // relaunched both sessions of /p, neither of /other
  assert.deepEqual(
    calls.sort((a, b) => a.agentType.localeCompare(b.agentType)),
    [
      { projectPath: '/p/.bowman', agentType: 'claude', verify: false },
      { projectPath: '/p/.bowman', agentType: 'gemini', verify: false },
    ],
  );
});

test('a failing relaunch is isolated: it is logged and the pass still resolves', async () => {
  const calls: Call[] = [];
  const logs: string[] = [];
  await runRelaunchPass({
    instances: [
      { projectPath: '/p/.bowman', agentType: 'claude' },
      { projectPath: '/p/.bowman', agentType: 'gemini' },
    ],
    relaunch: recordingRelaunch(calls, /* reject */ true),
    consume: () => ({ requested: true }),
    log: (m: string) => logs.push(m),
  });
  // both attempted despite the first rejecting
  assert.equal(calls.length, 2);
  assert.ok(logs.some((l) => /FAILED/.test(l)), 'failure should be logged');
});

test('end-to-end with the real fs consume: indicator on disk drives a relaunch and is consumed', async () => {
  const root = mkProject();
  try {
    writeIndicator(root, JSON.stringify({ verify: false }));
    const calls: Call[] = [];
    await runRelaunchPass({
      instances: [{ projectPath: getNormalized(root), agentType: 'claude' }],
      relaunch: recordingRelaunch(calls),
      log: () => {},
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].verify, false);
    assert.equal(indicatorExists(root), false, 'real indicator consumed');
  } finally {
    fs.removeSync(root);
  }
});

// The broker stores already-normalized (.bowman) project paths; mirror that here.
function getNormalized(root: string): string {
  return path.join(root, '.bowman');
}
