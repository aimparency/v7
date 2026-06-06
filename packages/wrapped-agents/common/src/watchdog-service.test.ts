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
