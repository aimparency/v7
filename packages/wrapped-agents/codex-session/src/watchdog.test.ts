import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchdogService } from './watchdog';

const PROMPT_MARKER = 'Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).';

function createService(currentPromptMarker: string): WatchdogService {
  const service = new WatchdogService({} as any, {} as any, undefined, 1);
  (service as any).currentPromptMarker = currentPromptMarker;
  return service;
}

test('normalizeJsonForParse removes control chars and folds whitespace', () => {
  const service = createService('CURRENT_MARKER');
  const normalized = (service as any).normalizeJsonForParse(
    '{"action":{"type":"send-prompt","text":"a\\t b"}}\n\r\u0001\u0002'
  );

  assert.equal(normalized, '{"action":{"type":"send-prompt","text":"a\\t b"}}');
});

test('extractDecisionJson falls back across candidates when one fails', () => {
  const service = createService('CURRENT_MARKER');
  const screen = [
    `${PROMPT_MARKER}`,
    '{"action":{"type":"compact"}}',
    'CURRENT_MARKER',
    'partial response without json',
  ].join('\n');

  const json = (service as any).extractDecisionJson(screen);
  const parsed = JSON.parse(json);
  assert.equal(parsed.action.type, 'compact');
});

test('extractDecisionJson returns WAIT_FOR_RESPONSE_JSON when marker exists but json is incomplete', () => {
  const service = createService('CURRENT_MARKER');
  const screen = 'CURRENT_MARKER watchdog is still thinking...';

  assert.throws(
    () => (service as any).extractDecisionJson(screen),
    (err: any) => err instanceof Error && err.message === 'WAIT_FOR_RESPONSE_JSON'
  );
});

test('extractDecisionJson handles wrapped newline-in-string payloads', () => {
  const service = createService('CURRENT_MARKER');
  const screen =
    'CURRENT_MARKER {"action":{"type":"send-prompt","text":"Run follow-up 3 now:\nexecute codex watchdog e2e","instruct":true}}';

  const json = (service as any).extractDecisionJson(screen);
  const parsed = JSON.parse(json);
  assert.equal(parsed.action.type, 'send-prompt');
  assert.equal(parsed.action.instruct, true);
  assert.equal(parsed.action.text, 'Run follow-up 3 now: execute codex watchdog e2e');
});

test('shouldDeferResponseCompletion waits during grace when generation has not been seen', () => {
  const service = createService('CURRENT_MARKER');
  (service as any).responseRequestedAt = Date.now();
  (service as any).responseSawGenerating = false;

  const defer = (service as any).shouldDeferResponseCompletion(false, Date.now());
  assert.equal(defer, true);
});

test('shouldDeferResponseCompletion allows completion after grace when generation was not seen', () => {
  const service = createService('CURRENT_MARKER');
  (service as any).responseRequestedAt = Date.now() - 6000;
  (service as any).responseSawGenerating = false;

  const defer = (service as any).shouldDeferResponseCompletion(false, Date.now());
  assert.equal(defer, false);
});

test('shouldDeferResponseCompletion tracks generating state and then allows completion', () => {
  const service = createService('CURRENT_MARKER');
  (service as any).responseRequestedAt = Date.now();
  (service as any).responseSawGenerating = false;

  const first = (service as any).shouldDeferResponseCompletion(true, Date.now());
  const second = (service as any).shouldDeferResponseCompletion(false, Date.now());
  assert.equal(first, true);
  assert.equal(second, false);
});

test('isGenerating detects busy indicator outside last line', () => {
  const service = createService('CURRENT_MARKER');
  const agent = {
    getLastLine: () => 'plain status line',
    getLines: () => '...previous line...\nesc to interrupt\nplain status line',
  };

  const generating = service.isGenerating(agent as any);
  assert.equal(generating, true);
});

test('isGenerating detects cancel-style busy indicator', () => {
  const service = createService('CURRENT_MARKER');
  const agent = {
    getLastLine: () => 'plain status line',
    getLines: () => '... (esc to cancel, 15m 8s) ...',
  };

  const generating = service.isGenerating(agent as any);
  assert.equal(generating, true);
});

test('isGenerating ignores plain esc-to-cancel footer without timer or choice menu', () => {
  const service = createService('CURRENT_MARKER');
  const agent = {
    getLastLine: () => 'plain status line',
    getLines: () => 'some stale footer text\nesc to cancel\nplain status line',
  };

  const generating = service.isGenerating(agent as any);
  assert.equal(generating, false);
});

test('isGenerating treats visible numbered choice menu as not generating even with esc to cancel footer', () => {
  const service = createService('CURRENT_MARKER');
  const agent = {
    getLastLine: () => 'enter to submit | esc to cancel',
    getLines: () => `Allow the aimparency MCP server to run tool "search_aims"?

  limit: 10
  projectPath: /home/felix/dev/aimparency/v7/.bowman
  query: fix watchdog ideate guidance propagation so returned text...

  › 1. Allow                   Run the tool and continue.
    2. Allow for this session  Run the tool and remember this choice for this session.
    3. Always allow            Run the tool and remember this choice for future tool calls.
    4. Cancel                  Cancel this tool call
  enter to submit | esc to cancel`,
  };

  const generating = service.isGenerating(agent as any);
  assert.equal(generating, false);
});

test('hasVisibleChoiceMenu detects command approval prompt with shortcut keys', () => {
  const service = createService('CURRENT_MARKER');
  const agent = {
    getLines: () => `Would you like to run the following command?

  Reason: Do you want to allow me to stage the tracked watchdog changes and create the requested git commit?

  $ git add -u && git commit -m "Tighten codex watchdog wrap-up threshold"

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with \`git add -u\` (p)
  3. No, and tell Codex what to do differently (esc)`,
  };

  const detected = (service as any).hasVisibleChoiceMenu(agent);
  assert.equal(detected, true);
});

test('hasVisibleChoiceMenu detects MCP approval prompt with numbered options', () => {
  const service = createService('CURRENT_MARKER');
  const agent = {
    getLines: () => `Allow the aimparency MCP server to run tool "create_aim"?

description: Ensure every supported session runtime exposes the current...

> 1. Allow
  2. Allow for this session
  3. Always allow
  4. Cancel`,
  };

  const detected = (service as any).hasVisibleChoiceMenu(agent);
  assert.equal(detected, true);
});

test('hasVisibleChoiceMenu tolerates approval menus without a visible selected marker', () => {
  const service = createService('CURRENT_MARKER');
  const agent = {
    getLines: () => `Tool call needs your approval. Reason: Tool call in payload and encrypted reasoning present — need clarification/consent.

  1. Allow   Run the tool and continue.
  2. Cancel  Cancel this tool call
  enter to submit | esc to cancel`,
  };

  const detected = (service as any).hasVisibleChoiceMenu(agent);
  assert.equal(detected, true);
});

test('getWorkerProcessingDurationMs parses wrapped esc-to-cancel timer', () => {
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {
    getLines: () => 'some text (esc to cancel, 15m 8s) more text',
  };

  const durationMs = (service as any).getWorkerProcessingDurationMs();
  assert.equal(durationMs, 908000);
});

test('tick switches to response inspection when start timeout passes without busy indicator or response candidate', async () => {
  const worker = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const watchdog = {
    getLines: () => 'CURRENT_MARKER still thinking',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  (service as any).currentPromptMarker = 'CURRENT_MARKER';
  service.setEnabled(true);
  service.waitingForResponseStart = true;
  service.waitingForResponse = false;
  (service as any).responseRequestedAt = Date.now() - 9000;
  (service as any).nextCheckTime = 0;

  await service.tick();

  assert.equal(service.waitingForResponseStart, false);
  assert.equal(service.waitingForResponse, true);
});

test('tick asks watchdog when worker processing exceeds interrupt threshold', async () => {
  const worker = {
    getLines: () => 'still running... (esc to cancel, 15m 8s)',
    getLastLine: () => 'plain status line',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  let asked = false;
  (service as any).askWatchdog = async () => {
    asked = true;
  };
  (service as any).waitForIdle = async () => false;
  service.setEnabled(true);
  (service as any).nextCheckTime = 0;
  (service as any).lastLongProcessingEscalationAt = 0;

  await service.tick();

  assert.equal(asked, true);
});

test('tick asks watchdog immediately when worker shows a visible choice menu', async () => {
  const worker = {
    getLines: () => `Would you like to run the following command?

  Reason: Do you want to allow me to stage the tracked watchdog changes and create the requested git commit?

  $ git add -u && git commit -m "Tighten codex watchdog wrap-up threshold"

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with \`git add -u\` (p)
  3. No, and tell Codex what to do differently (esc)`,
    getLastLine: () => '  3. No, and tell Codex what to do differently (esc)',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  let asked = false;
  (service as any).askWatchdog = async () => {
    asked = true;
  };
  service.setEnabled(true);
  (service as any).nextCheckTime = 0;

  await service.tick();

  assert.equal(asked, true);
});

test('tick lets a worker choice prompt preempt stale supervisor waiting when watchdog is idle', async () => {
  const worker = {
    getLines: () => `Allow the aimparency MCP server to run tool "addReflection"?

  1. Allow
  2. Allow for this session
  3. Always allow
  4. Cancel`,
    getLastLine: () => '4. Cancel',
    write: () => {},
  };
  const watchdog = {
    getLines: () => 'plain idle watchdog screen',
    getLastLine: () => 'plain idle watchdog screen',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  let asked = false;
  (service as any).askWatchdog = async () => {
    asked = true;
  };
  service.setEnabled(true);
  service.waitingForResponseStart = true;
  service.waitingForResponse = false;
  (service as any).nextCheckTime = 0;

  await service.tick();

  assert.equal(asked, true);
  assert.equal(service.waitingForResponseStart, false);
  assert.equal(service.waitingForResponse, false);
});

test('tick asks watchdog after a busy-to-idle transition', async () => {
  const worker = {
    getLines: () => 'plain idle-ish screen without esc-to-interrupt marker',
    getLastLine: () => 'plain idle-ish screen without esc-to-interrupt marker',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  let asked = false;
  (service as any).askWatchdog = async () => {
    asked = true;
  };
  service.setEnabled(true);
  (service as any).workerActivity = {
    enabledAt: Date.now() - 10_000,
    observedBusySinceEnabled: true,
    lastBusyAt: Date.now() - 1000,
  };
  (service as any).nextCheckTime = 0;

  await service.tick();

  assert.equal(asked, true);
});

test('tick asks watchdog after bootstrap timeout when no busy phase has been observed', async () => {
  const worker = {
    getLines: () => 'plain idle-ish screen without esc-to-interrupt marker',
    getLastLine: () => 'plain idle-ish screen without esc-to-interrupt marker',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  let asked = false;
  (service as any).askWatchdog = async () => {
    asked = true;
  };
  service.setEnabled(true);
  (service as any).workerActivity = {
    enabledAt: Date.now() - 6000,
    observedBusySinceEnabled: false,
    lastBusyAt: 0,
  };
  (service as any).nextCheckTime = 0;

  await service.tick();

  assert.equal(asked, true);
});

test('tick treats stale busy-looking worker snapshot as idle after one interval', async () => {
  const worker = {
    getLines: () => 'status\n✻ processing\nesc to interrupt',
    getLastLine: () => 'esc to interrupt',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  let asked = false;
  (service as any).askWatchdog = async () => {
    asked = true;
  };
  service.setEnabled(true);
  (service as any).workerActivity = {
    enabledAt: Date.now() - 10_000,
    observedBusySinceEnabled: true,
    lastBusyAt: Date.now(),
    lastSnapshot: 'status\n✻ processing\nesc to interrupt',
    lastSnapshotAt: Date.now() - 1000,
  };
  (service as any).nextCheckTime = 0;

  await service.tick();

  assert.equal(asked, true);
});

test('tick executes wrapped JSON response after marker when output is zoom/wrap-like', async () => {
  const workerWrites: string[] = [];
  const watchdogWrites: string[] = [];
  const worker = {
    getLines: () => '',
    getLastLine: () => '',
    write: (chunk: string) => workerWrites.push(chunk),
  };
  const wrappedResponse =
    'CURRENT_MARKER {"action":{"type":"send-prompt","text":"Run follow-up 3 now:\nexecute codex watchdog e2e","instruct":true}}';
  const watchdog = {
    getLines: () => wrappedResponse,
    getLastLine: () => 'plain status line',
    write: () => {},
  };

  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  (service as any).currentPromptMarker = 'CURRENT_MARKER';
  (service as any).wait = async () => {};
  (service as any).waitForIdle = async () => true;
  (service as any).post = async (agent: any, text: string) => {
    if (agent === watchdog) watchdogWrites.push(text);
  };
  service.setEnabled(true);
  service.waitingForResponseStart = true;
  service.waitingForResponse = false;
  (service as any).responseRequestedAt = Date.now() - 9000;
  (service as any).nextCheckTime = 0;

  await service.tick();

  const fullWrite = workerWrites.join('');
  assert.equal(fullWrite, '');
  assert.match(watchdogWrites.join('\n'), /Action "send-prompt" is not valid/i);
  assert.equal(service.waitingForResponseStart, false);
  assert.equal(service.waitingForResponse, true);
});

test('tick processes visible start_work JSON even when watchdog screen still looks busy', async () => {
  const workerPosts: string[] = [];
  const worker = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const watchdog = {
    getLines: () => `CURRENT_MARKER {"action":{"type":"start_work","message":"run the requested review now"}}\n✻\nesc to interrupt`,
    getLastLine: () => 'esc to interrupt',
    write: () => {},
  };

  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  (service as any).currentPromptMarker = 'CURRENT_MARKER';
  (service as any).post = async (agent: any, text: string) => {
    if (agent === worker) workerPosts.push(text);
  };
  service.setEnabled(true);
  service.waitingForResponseStart = false;
  service.waitingForResponse = true;
  (service as any).responseRequestedAt = Date.now() - 9000;
  (service as any).responseSawGenerating = true;
  (service as any).watchdogSnapshotState = {
    lastSnapshot: `CURRENT_MARKER {"action":{"type":"start_work","message":"run the requested review now"}}\n✻\nesc to interrupt`,
    lastSnapshotAt: Date.now() - 1000,
  };
  (service as any).nextCheckTime = 0;

  await service.tick();

  assert.equal(workerPosts.length, 1);
  assert.match(workerPosts[0] || '', /run the requested review now/i);
  assert.equal(service.waitingForResponseStart, false);
  assert.equal(service.waitingForResponse, false);
});

test('executeAction interrupt sends double ESC to worker', async () => {
  const writes: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {
    write: (chunk: string) => writes.push(chunk),
  };
  (service as any).watchdog = {};
  (service as any).wait = async () => {};

  await service.executeAction({ type: 'interrupt' });

  assert.deepEqual(writes, ['\x1b', '\x1b']);
});

test('executeAction select-option supports shortcut keys', async () => {
  const writes: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {
    write: (chunk: string) => writes.push(chunk),
  };
  (service as any).watchdog = {};
  (service as any).wait = async () => {};

  await service.executeAction({ type: 'select-option', key: 'y' });

  assert.deepEqual(writes, ['y']);
});

test('executeAction choice supports numbered choices', async () => {
  const writes: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {
    getLines: () => '',
    write: (chunk: string) => writes.push(chunk),
  };
  (service as any).watchdog = {};
  (service as any).wait = async () => {};

  await service.executeAction({ type: 'choice', choice: '2' });

  assert.deepEqual(writes, ['2']);
});

test('executeAction does not suppress repeated choice actions within duplicate window', async () => {
  const writes: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {
    write: async (chunk: string) => writes.push(chunk),
  };
  (service as any).watchdog = {};
  (service as any).wait = async () => {};

  await service.executeAction({ type: 'choice', choice: '2' });
  await service.executeAction({ type: 'choice', choice: '2' });

  assert.deepEqual(writes, ['2', '2']);
});

test('executeActionSideEffects ideate includes returned text guidance', async () => {
  const posts: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {};
  (service as any).watchdog = {};
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };

  await service.executeActionSideEffects({
    type: 'ideate',
    text: 'look for follow-up cleanup or validation work after the three-state watchdog simplification'
  });

  assert.match(posts[0] || '', /Check Aimparency MCP for open aims and look for the next concrete task to start\./);
  assert.match(posts[0] || '', /follow-up cleanup or validation work/i);
});

test('executeAction select-option maps esc shortcut to escape byte', async () => {
  const writes: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {
    write: (chunk: string) => writes.push(chunk),
  };
  (service as any).watchdog = {};
  (service as any).wait = async () => {};

  await service.executeAction({ type: 'select-option', key: 'esc' });

  assert.deepEqual(writes, ['\x1b']);
});

test('executeAction wrap-up posts commit prompt and plans compact', async () => {
  const posts: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {};
  (service as any).watchdog = {};
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };

  await service.executeAction({ type: 'wrap-up' });

  assert.equal((service as any).workingTowardsCommit, true);
  assert.match(posts[0] || '', /deletion\/reduction pass/i);
  assert.match(posts[0] || '', /make a git commit/i);
  assert.match(posts[0] || '', /git add -u/i);
  assert.doesNotMatch(posts[0] || '', /wait for \/compact/i);
});

test('askWatchdog uses exploring prompt by default', async () => {
  const posts: string[] = [];
  const worker = {
    getLines: () => 'worker is between steps',
    getLastLine: () => 'plain status line',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => 'plain status line',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = posts[0] || '';
  assert.match(prompt, /You are guiding a worker\./);
  assert.match(prompt, /worker session:/);
  assert.match(prompt, /start_work - Use when the worker has found something concrete/i);
  assert.match(prompt, /break_down - Use when the worker needs to split vague or high-level work/i);
  assert.match(prompt, /ideate - Use when the worker should look for useful work/i);
});

test('askWatchdog wrapping-up prompt focuses on finishing wrap-up work', async () => {
  const posts: string[] = [];
  const worker = {
    getLines: () => 'git commit in progress',
    getLastLine: () => 'plain status line',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => 'plain status line',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  (service as any).workingTowardsCommit = true;
  (service as any).animatorState.transition('WRAPPING_UP', 'verify');
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = posts[0] || '';
  assert.match(prompt, /You are guiding a worker\./);
  assert.match(prompt, /git commit in progress/i);
  assert.match(prompt, /You are watching a coding agent wrapping up work/i);
  assert.match(prompt, /commit - Prompt the worker to create a git commit/i);
  assert.match(prompt, /waiting_for_committed - Use when the worker is in the middle of committing/i);
});

test('executeAction compact without wrap-up plan converts to wrap-up first', async () => {
  const posts: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {};
  (service as any).watchdog = {};
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };

  await service.executeAction({ type: 'compact' });

  assert.equal((service as any).workingTowardsCommit, true);
  assert.match(posts[0] || '', /make a git commit/i);
  assert.equal(posts.includes('/compact'), false);
});

test('executeAction compact after wrap-up sends /compact and clears commit mode', async () => {
  const posts: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {};
  (service as any).watchdog = {};
  (service as any).workingTowardsCommit = true;
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };

  await service.executeAction({ type: 'compact' });

  assert.equal((service as any).workingTowardsCommit, false);
  assert.equal(posts[0], '/compact');
});

test('executeAction commit-done compacts immediately and clears commit mode', async () => {
  const posts: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {};
  (service as any).watchdog = {};
  (service as any).workingTowardsCommit = true;
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };

  await service.executeAction({ type: 'commit-done' });

  assert.equal((service as any).workingTowardsCommit, false);
  assert.equal(posts[0], '/compact');
});

test('executeAction compact during commit mode behaves like commit-done', async () => {
  const posts: string[] = [];
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {};
  (service as any).watchdog = {};
  (service as any).workingTowardsCommit = true;
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };

  await service.executeAction({ type: 'compact' });

  assert.equal((service as any).workingTowardsCommit, false);
  assert.equal(posts[0], '/compact');
});

test('askWatchdog includes wrap-up guidance when commit mode is active', async () => {
  const prompts: string[] = [];
  const worker = {
    getLines: () => 'worker is asking about commit details',
    getLastLine: () => '',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  (service as any).workingTowardsCommit = true;
  (service as any).animatorState.transition('WRAPPING_UP', 'verify');
  (service as any).post = async (_agent: any, text: string) => {
    prompts.push(text);
  };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = prompts[0] || '';
  assert.match(prompt, /You are guiding a worker\./);
  assert.match(prompt, /worker is asking about commit details/i);
  assert.match(prompt, /wrap_up - Prompt the worker to update aim status\/comment and reflection only after the current repo state has been freshly checked/i);
  assert.match(prompt, /commit - Prompt the worker to create a git commit only after freshly checking the current repo state/i);
  assert.match(prompt, /waiting_for_committed - Use when the worker is in the middle of committing/i);
});

test('askWatchdog includes wrap-up rule when commit mode is inactive', async () => {
  const prompts: string[] = [];
  const worker = {
    getLines: () => 'major implementation finished and worker is idle',
    getLastLine: () => '',
    write: () => {},
  };
  const watchdog = {
    getLines: () => '',
    getLastLine: () => '',
    write: () => {},
  };
  const service = new WatchdogService(worker as any, watchdog as any, undefined, 1);
  (service as any).animatorState.transition('WRAPPING_UP', 'verify');
  (service as any).post = async (_agent: any, text: string) => {
    prompts.push(text);
  };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = prompts[0] || '';
  assert.match(prompt, /You are guiding a worker\./);
  assert.match(prompt, /major implementation finished and worker is idle/i);
  assert.match(prompt, /deletion\/reduction pass to remove dead code and simplify the diff/i);
  assert.match(prompt, /revisit - Return from wrapping up to implementation/i);
  assert.match(prompt, /explore - Prompt the worker to explore open work again/i);
});
