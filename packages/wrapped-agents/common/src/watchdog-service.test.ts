import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchdogService } from './watchdog-service';
import { type AgentProfile, COMMON_CHOICE_MENU_PATTERNS } from './agent-profile';

// Minimal profile exercising the parameterized detection + compact behavior.
const testProfile: AgentProfile = {
  agentType: 'codex',
  command: 'test',
  bannerName: 'Test',
  buildWorkerArgs: () => [],
  buildWatchdogArgs: () => [],
  resumeFailurePatterns: [],
  spinnerPattern: /[⠋⠙⠹]/,
  busyPatterns: [
    /esc to interrupt/i,
    /esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i,
  ],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};

function makeService(worker: any = {}, watchdog: any = {}): WatchdogService {
  return new WatchdogService(worker as any, watchdog as any, testProfile, { compactEvery: 1 });
}

function agentShowing(content: string) {
  return { getLines: () => content, getLastLine: () => content, write: () => {} };
}

test('isGenerating: profile busy pattern (esc to interrupt) reads as generating', () => {
  const service = makeService();
  assert.equal(service.isGenerating(agentShowing('working...\nesc to interrupt') as any), true);
});

test('isGenerating: plain idle screen reads as not generating', () => {
  const service = makeService();
  assert.equal(service.isGenerating(agentShowing('done. what next?') as any), false);
});

test('isGenerating: a visible choice menu suppresses the busy signal', () => {
  const service = makeService();
  const menu = '› 1. Allow\n  2. Cancel\n  enter to submit | esc to cancel';
  assert.equal(service.isGenerating(agentShowing(menu) as any), false);
});

// Regression: Claude's spinner glyph ✻ is reused in the *completed* turn
// summary ("✻ Baked for 6s"). The ellipsis-gated spinner pattern must treat
// the live spinner as busy but the past-tense summary as idle, otherwise idle
// detection never fires after a turn ends.
const claudeLikeProfile: AgentProfile = {
  ...testProfile,
  agentType: 'claude',
  spinnerPattern: /[✻✢○◎◯][^\n]*…/,
};

function makeClaudeService(): WatchdogService {
  return new WatchdogService({} as any, {} as any, claudeLikeProfile, { compactEvery: 1 });
}

test('isGenerating: live Claude spinner ("✻ Baking…") reads as generating', () => {
  const service = makeClaudeService();
  assert.equal(service.isGenerating(agentShowing('✻ Baking… (3s · esc to interrupt)') as any), true);
});

test('isGenerating: completed Claude summary ("✻ Baked for 6s") reads as idle', () => {
  const service = makeClaudeService();
  assert.equal(service.isGenerating(agentShowing('● done\n\n✻ Baked for 6s\n\n❯ ') as any), false);
});

test('post: reports "sending message to supervisor" while typing, clears after', async () => {
  const statuses: string[] = [];
  const watchdog = agentShowing('');
  const service = makeService({}, watchdog);
  service.enabled = true;
  service.onCommStatusChange = (s) => statuses.push(s);
  (service as any).wait = async () => {};

  await service.post(service.watchdog, 'a longish supervisor prompt');

  assert.equal(statuses[0], 'sending message to supervisor');
  assert.equal(statuses[statuses.length - 1], 'waiting for main agent halt');
});

test('post: aborts mid-message (no Enter) when disabled, for a snappy stop', async () => {
  const writes: string[] = [];
  const watchdog = { getLines: () => '', getLastLine: () => '', write: (d: string) => writes.push(d) };
  const service = makeService({}, watchdog);
  service.enabled = true;
  // Disable as soon as the first chunk is written.
  (service as any).wait = async () => { service.enabled = false; };

  await service.post(service.watchdog, 'x'.repeat(200));

  assert.ok(!writes.includes('\r'), 'must not submit a partial message');
});

test('askWatchdog posts an EXPLORING prompt listing the available actions', async () => {
  const posts: string[] = [];
  const worker = agentShowing('worker is between steps');
  const watchdog = agentShowing('');
  const service = makeService(worker, watchdog);
  (service as any).post = async (_agent: any, text: string) => { posts.push(text); };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = posts[0] || '';
  assert.match(prompt, /You are guiding a worker\./);
  assert.match(prompt, /start_work - Use when the worker has found something concrete/i);
  assert.match(prompt, /ideate - Use when the worker should look for useful work/i);
});

test('executeActionSideEffects ideate includes the returned guidance text', async () => {
  const posts: string[] = [];
  const service = makeService();
  (service as any).post = async (_agent: any, text: string) => { posts.push(text); };

  await service.executeActionSideEffects({ type: 'ideate', text: 'scan for the next concrete task' });

  assert.match(posts[0] || '', /Check Aimparency MCP for open aims and look for the next concrete task to start\./);
  assert.match(posts[0] || '', /scan for the next concrete task/i);
});

test('compact after wrap-up uses the profile compactCommand', async () => {
  const posts: string[] = [];
  const service = makeService();
  (service as any).workingTowardsCommit = true;
  (service as any).post = async (_agent: any, text: string) => { posts.push(text); };

  await service.executeAction({ type: 'compact' });

  assert.equal(posts[0], '/compact');
});

// Regression: the supervisor prompt marker is a single logical line, but Claude's
// TUI hard-wraps and indents it in the rendered prompt block. An exact substring
// match then fails and the parse loop re-polls forever despite the JSON being on
// screen. locateResponseAfterMarker must normalize whitespace on both sides.
test('locateResponseAfterMarker: finds reply after a hard-wrapped/indented marker', () => {
  const service = makeService();
  const marker = 'Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks). [1781451809723-m9ro3]';
  // As rendered: wrapped between "no code" and "blocks)", each row indented.
  const screen = [
    '  Respond ONLY with the raw JSON action object (single line, no markdown, no code',
    '  blocks). [1781451809723-m9ro3]',
    '',
    '● {"action": {"type": "start_work", "message": "go"}}',
    '',
    '✻ Cogitated for 6s',
  ].join('\n');

  const content = (service as any).locateResponseAfterMarker(screen, marker) as string | null;
  assert.ok(content, 'marker should be located despite wrapping');
  const json = (service as any).extractJson(content);
  assert.deepEqual(JSON.parse(json), { action: { type: 'start_work', message: 'go' } });
});

test('locateResponseAfterMarker: returns null when the marker is absent', () => {
  const service = makeService();
  assert.equal((service as any).locateResponseAfterMarker('no marker here', 'MARKER'), null);
});

// The full INSTRUCT guide is heavy and the worker is a continuous session, so it
// should be sent once per context epoch: on the first start_work, then again only
// after a /compact wipes the worker's context.
test('start_work sends the full instruct once, re-armed after compact', async () => {
  const posts: string[] = [];
  const service = makeService();
  (service as any).instructTextWithMemory = 'FULL_GUIDE_TEXT';
  (service as any).post = async (_agent: any, text: string) => { posts.push(text); };

  await service.executeActionSideEffects({ type: 'start_work', message: 'do X' });
  await service.executeActionSideEffects({ type: 'start_work', message: 'do Y' });

  assert.match(posts[0] || '', /FULL_GUIDE_TEXT/);          // first carries the guide
  assert.doesNotMatch(posts[1] || '', /FULL_GUIDE_TEXT/);   // second: short pointer only
  assert.match(posts[1] || '', /Check Aimparency MCP/);

  await service.executeActionSideEffects({ type: 'compact' }); // wipes worker context
  await service.executeActionSideEffects({ type: 'start_work', message: 'do Z' });
  assert.match(posts[posts.length - 1] || '', /FULL_GUIDE_TEXT/); // re-armed
});

test('enabling clears a stuck ERROR state (automate = fresh restart)', () => {
  const service = makeService();
  const supervisorState = (service as any).supervisorState;

  supervisorState.triggerError('simulated wedge');
  assert.equal(supervisorState.getState(), 'ERROR');

  service.setEnabled(true);
  assert.equal(supervisorState.getState(), 'EXPLORING');
  assert.equal(supervisorState.getContext().errorCount, 0);
});

const TEN_MINUTES_MS = 10 * 60 * 1000; // matches AUTO_RETRY_AFTER_ERROR_MS default

test('error auto-retry re-enables a fresh EXPLORING run after the delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = makeService();
  (service as any).logErrorDiagnostics = () => {}; // avoid terminal reads / file IO
  service.enabled = true;

  (service as any).enterError('Worker session stuck');
  assert.equal(service.enabled, false, 'error stops the loop');
  assert.notEqual((service as any).errorRetryTimeout, null, 'auto-retry is scheduled');

  t.mock.timers.tick(TEN_MINUTES_MS);
  assert.equal(service.enabled, true, 'auto-retry re-enabled the loop unattended');
  assert.equal((service as any).supervisorState.getState(), 'EXPLORING');
});

test('a manual stop cancels the pending auto-retry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = makeService();
  (service as any).logErrorDiagnostics = () => {};
  service.enabled = true;

  (service as any).enterError('Worker session stuck');
  service.setEnabled(false); // operator stops it during the backoff window
  assert.equal((service as any).errorRetryTimeout, null, 'pending retry was cleared');

  t.mock.timers.tick(TEN_MINUTES_MS);
  assert.equal(service.enabled, false, 'no auto-retry after a manual stop');
});

// Busy-timeout decision: must trip only on a frozen screen, never on an idle
// session or a worker that is actively producing output. Locks in the two
// fixes that kept the supervisor falsely erroring with "busy timeout 300s".
const SIX_MINUTES_MS = 6 * 60 * 1000; // > MAX_BUSY_TIMEOUT (300s default)

test('busy-timeout: an idle worker resets the timer (never accrues while idle)', () => {
  const service = makeService();
  (service as any).busyStartedAt = 1000;
  const r = (service as any).advanceWorkerBusyTimeout(true, 'ignored', 5000);
  assert.equal((service as any).busyStartedAt, 0);
  assert.equal(r.frozen, false);
});

test('busy-timeout: a changing screen (progress) keeps re-anchoring, never frozen', () => {
  const service = makeService();
  (service as any).advanceWorkerBusyTimeout(false, 'frame-1', 0); // first busy tick anchors
  // Six minutes later — past the cap — but the screen changed → progress, not stuck.
  const r = (service as any).advanceWorkerBusyTimeout(false, 'frame-2', SIX_MINUTES_MS);
  assert.equal(r.frozen, false);
  assert.equal((service as any).busyStartedAt, SIX_MINUTES_MS, 're-anchored on progress');
});

test('busy-timeout: a busy worker with a frozen screen trips after the cap', () => {
  const service = makeService();
  const t0 = 1_000_000; // realistic Date.now()-style base (never the 0 sentinel)
  (service as any).advanceWorkerBusyTimeout(false, 'frozen', t0); // anchor
  assert.equal((service as any).advanceWorkerBusyTimeout(false, 'frozen', t0 + 200000).frozen, false, 'within window');
  const r = (service as any).advanceWorkerBusyTimeout(false, 'frozen', t0 + SIX_MINUTES_MS);
  assert.equal(r.frozen, true, 'static screen past the cap is frozen');
  assert.ok(r.frozenForMs >= 300000);
});

test('busy-timeout: going idle mid-work clears the timer so the next busy starts fresh', () => {
  const service = makeService();
  (service as any).advanceWorkerBusyTimeout(false, 'work', 0);      // busy
  (service as any).advanceWorkerBusyTimeout(true, '', 100000);      // idle → reset
  assert.equal((service as any).busyStartedAt, 0);
  const r = (service as any).advanceWorkerBusyTimeout(false, 'work', SIX_MINUTES_MS); // busy again
  assert.equal(r.frozen, false, 'fresh anchor, not carried over from before the idle');
  assert.equal((service as any).busyStartedAt, SIX_MINUTES_MS);
});
