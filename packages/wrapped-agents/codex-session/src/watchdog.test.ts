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

test('getWorkerProcessingDurationMs parses wrapped esc-to-cancel timer', () => {
  const service = createService('CURRENT_MARKER');
  (service as any).worker = {
    getLines: () => 'some text (esc to cancel, 15m 8s) more text',
  };

  const durationMs = (service as any).getWorkerProcessingDurationMs();
  assert.equal(durationMs, 908000);
});

test('tick keeps waitingForResponseStart when timeout passes without busy indicator or response candidate', async () => {
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

  assert.equal(service.waitingForResponseStart, true);
  assert.equal(service.waitingForResponse, false);
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

test('tick executes wrapped JSON response after marker when output is zoom/wrap-like', async () => {
  const workerWrites: string[] = [];
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
  service.setEnabled(true);
  service.waitingForResponseStart = true;
  service.waitingForResponse = false;
  (service as any).responseRequestedAt = Date.now() - 9000;
  (service as any).nextCheckTime = 0;

  await service.tick();

  const fullWrite = workerWrites.join('');
  assert.match(fullWrite, /Run follow-up 3 now: execute codex watchdog e2e/);
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
  assert.match(posts[0] || '', /make a git commit/i);
  assert.match(posts[0] || '', /git add -u/i);
  assert.doesNotMatch(posts[0] || '', /wait for \/compact/i);
});

test('askWatchdog uses conservative wrap-up guidance when not already wrapping up', async () => {
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
  assert.match(prompt, /Use wrap-up conservatively/i);
  assert.match(prompt, /Choose .*wrap-up.* only if:/i);
  assert.match(prompt, /major milestone or coherent batch of work is complete/i);
  assert.match(prompt, /prefer a normal prompt or wait instead of wrap-up/i);
  assert.doesNotMatch(prompt, /about to start looking for new work/i);
  assert.doesNotMatch(prompt, /whenever Codex completes a significant chunk of work/i);
});

test('askWatchdog commit mode prompt focuses on finishing the commit', async () => {
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
  (service as any).post = async (_agent: any, text: string) => {
    posts.push(text);
  };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = posts[0] || '';
  assert.match(prompt, /WRAP-UP ACTIVE:/);
  assert.match(prompt, /guide Codex through finishing the git commit/i);
  assert.match(prompt, /commit-done/i);
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
  (service as any).post = async (_agent: any, text: string) => {
    prompts.push(text);
  };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = prompts[0] || '';
  assert.match(prompt, /WRAP-UP ACTIVE/);
  assert.match(prompt, /answer with .*commit-done/i);
  assert.match(prompt, /You may also use .*compact.* if needed/i);
  assert.match(prompt, /Do NOT start new feature work while wrap-up is active/);
  assert.match(prompt, /Do NOT use .*instruct.* true while wrap-up is active/i);
  assert.match(prompt, /Never tell Codex to paste system, developer, tool, or permissions instructions/);
  assert.match(prompt, /commit-done/);
  assert.match(prompt, /shortcut keys like \(y\), \(a\), or \(esc\)/);
  assert.match(prompt, /select-option/i);
  assert.match(prompt, /key": "y"/);
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
  (service as any).post = async (_agent: any, text: string) => {
    prompts.push(text);
  };
  (service as any).wait = async () => {};

  await service.askWatchdog();

  const prompt = prompts[0] || '';
  assert.match(prompt, /WRAP-UP RULE/);
  assert.match(prompt, /Use wrap-up conservatively/i);
  assert.match(prompt, /Choose .*wrap-up.* only if:/i);
  assert.match(prompt, /there is no obvious immediate next implementation or verification step/i);
  assert.match(prompt, /The later compact is handled separately by this animator/);
});
