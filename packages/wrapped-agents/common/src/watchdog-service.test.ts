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

test('locateResponseAfterMarker: finds JSON after SUPERVISOR_JSON marker with prose prefix', () => {
  const service = makeService();
  const marker = '<<SUPERVISOR_JSON:abc123>>';
  const screen = [
    'Sure, here is the action.',
    `${marker}{"action":{"type":"start_work","message":"go"}}`,
    '❯ ',
  ].join('\n');

  const content = (service as any).locateResponseAfterMarker(screen, marker) as string | null;
  assert.ok(content);
  assert.deepEqual(JSON.parse((service as any).extractJson(content)), {
    action: { type: 'start_work', message: 'go' },
  });
});

test('locateResponseAfterMarker: finds JSON in markdown fences without the marker', () => {
  const service = makeService();
  const screen = [
    'Here you go:',
    '```json',
    '{"action":{"type":"ideate","text":"scan"}}',
    '```',
    '❯ ',
  ].join('\n');

  const content = (service as any).locateResponseAfterMarker(screen, '<<SUPERVISOR_JSON:missing>>') as string | null;
  assert.ok(content);
  assert.deepEqual(JSON.parse((service as any).extractJson(content)), {
    action: { type: 'ideate', text: 'scan' },
  });
});

test('locateResponseAfterMarker: finds {"action"} even when marker was omitted', () => {
  const service = makeService();
  const screen = 'Some explanation\n{"action":{"type":"explore","text":"check aims"}}\n❯ ';

  const content = (service as any).locateResponseAfterMarker(screen, '<<SUPERVISOR_JSON:nope>>') as string | null;
  assert.ok(content);
  assert.deepEqual(JSON.parse((service as any).extractJson(content)), {
    action: { type: 'explore', text: 'check aims' },
  });
});

test('locateResponseAfterMarker: parses Grok hard-wrapped JSON with timestamps and block fillers', () => {
  const grokProfile: AgentProfile = {
    ...testProfile,
    agentType: 'grok',
    idleFooterPatterns: [/Turn completed in/i],
  };
  const service = new WatchdogService({} as any, {} as any, grokProfile, { compactEvery: 1 });

  const screen = [
    '◆ Thought for 2.4s',
    '{"action": {"type": "start_work", "message": "harden locateResponseAfterMarker (strip',
    'ANSI/fences, loose SUPERVISOR_JSON, fallback to {\\"action\\"), add optional',
    'watchdogIdleStabilityMs to AgentProfile."}}      3:17 PM   █',
    'Turn completed in 5.2s.                                                                                                   █',
    '❯ ',
  ].join('\n');

  const content = (service as any).locateResponseAfterMarker(screen, '<<SUPERVISOR_JSON:missing>>') as string | null;
  assert.ok(content, 'should locate Grok-wrapped supervisor JSON');
  const parsed = JSON.parse((service as any).extractJson(content));
  assert.equal(parsed.action.type, 'start_work');
  assert.match(parsed.action.message, /fallback to \{"action"\)/);
});

test('isGenerating: Grok "Turn completed" footer reads as idle', () => {
  const grokProfile: AgentProfile = {
    ...testProfile,
    agentType: 'grok',
    idleFooterPatterns: [/Turn completed in/i],
  };
  const service = new WatchdogService({} as any, {} as any, grokProfile, { compactEvery: 1 });
  const screen = '{"action":{"type":"ideate"}}\nTurn completed in 13s.\n❯ ';
  assert.equal(service.isGenerating(agentShowing(screen) as any), false);
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

test('emergency stop (quota / usage limit) auto-retries despite the emergency flag', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = makeService();
  service.enabled = true;

  service.triggerEmergencyStop();
  assert.equal(service.enabled, false, 'emergency stop halts the loop');
  assert.equal(service.emergencyStopped, true, 'emergency flag is set');
  assert.notEqual((service as any).errorRetryTimeout, null, 'auto-retry is scheduled even for an emergency stop');

  t.mock.timers.tick(TEN_MINUTES_MS);
  assert.equal(service.enabled, true, 'usage-limit hit recovers itself after the delay');
  assert.equal(service.emergencyStopped, false, 're-enabling clears the emergency flag');
  assert.equal(service.emergencyRetryCount, 1, 'counts the recovery attempt');
  assert.equal((service as any).supervisorState.getState(), 'EXPLORING');
});

test('repeated quota hits keep retrying (unbounded by default) and tally the count', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = makeService();

  // Simulate three consecutive 10-min windows where the limit is still in force:
  // each retry re-enables, the limit re-trips the emergency stop, repeat.
  for (let attempt = 1; attempt <= 3; attempt++) {
    service.enabled = true;
    service.triggerEmergencyStop();
    t.mock.timers.tick(TEN_MINUTES_MS);
    assert.equal(service.enabled, true, `recovered on attempt ${attempt}`);
    assert.equal(service.emergencyRetryCount, attempt, `tally is ${attempt}`);
  }
});

test('WATCHDOG_MAX_EMERGENCY_RETRIES caps the retries and then stays stopped', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prev = process.env.WATCHDOG_MAX_EMERGENCY_RETRIES;
  process.env.WATCHDOG_MAX_EMERGENCY_RETRIES = '2';
  t.after(() => {
    if (prev === undefined) delete process.env.WATCHDOG_MAX_EMERGENCY_RETRIES;
    else process.env.WATCHDOG_MAX_EMERGENCY_RETRIES = prev;
  });
  const service = makeService();

  // Attempts 1 and 2 recover; attempt 3 exceeds the cap and stays stopped.
  for (let attempt = 1; attempt <= 2; attempt++) {
    service.enabled = true;
    service.triggerEmergencyStop();
    t.mock.timers.tick(TEN_MINUTES_MS);
    assert.equal(service.enabled, true, `recovered within cap on attempt ${attempt}`);
  }

  service.enabled = true;
  service.triggerEmergencyStop();
  t.mock.timers.tick(TEN_MINUTES_MS);
  assert.equal(service.enabled, false, 'past the cap, the loop stays stopped');

  // A manual restart resets the tally so a fresh quota stretch gets its own budget.
  service.setEnabled(true);
  assert.equal(service.emergencyRetryCount, 0, 'manual restart clears the emergency tally');
});

test('a manual stop cancels a pending emergency-stop auto-retry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = makeService();
  service.enabled = true;

  service.triggerEmergencyStop();
  service.setEnabled(false); // operator intervenes during the backoff window
  assert.equal((service as any).errorRetryTimeout, null, 'pending emergency retry was cleared');

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
