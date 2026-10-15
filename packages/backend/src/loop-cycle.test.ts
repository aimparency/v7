// End-to-end loop tests: the real backend router serves a temp project on a
// private WebSocket port, loop.startInstance spawns the real loop-worker, and a
// scripted fake OpenAI-compatible model answers it. Deterministic, offline, free.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import { getLoopWorkerStatePath, type LoopInstance } from 'shared/loop-state';
import { appRouter } from './server';
import { createContext } from './trpc';
import { clearIndices } from './search';

type ModelReply =
  | { toolCall: { name: string; arguments: Record<string, unknown> } }
  | { text: string }
  | { httpError: number; body: string };

const caller = appRouter.createCaller({});
let root = '';
let projectPath = '';
let script: ModelReply[] = [];
let modelRequests: any[] = [];
let modelServer: http.Server;
let wss: WebSocketServer;
let closeWss: () => void;
let previousWsPort: string | undefined;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function chunk(delta: Record<string, unknown>, finishReason: string | null) {
  return `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

// Answers each chat completion request with the next scripted reply, streamed.
function startFakeModel(): Promise<string> {
  modelServer = http.createServer((request, response) => {
    let body = '';
    request.on('data', (data) => { body += data; });
    request.on('end', () => {
      modelRequests.push(JSON.parse(body));
      const reply = script.shift() ?? { text: 'Nothing left to do.' };
      if ('httpError' in reply) {
        response.writeHead(reply.httpError, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: reply.body } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if ('toolCall' in reply) {
        const call = { index: 0, id: `call_${modelRequests.length}`, type: 'function', function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.arguments) } };
        response.write(chunk({ role: 'assistant', tool_calls: [call] }, null));
        response.write(chunk({}, 'tool_calls'));
      } else {
        response.write(chunk({ role: 'assistant', content: reply.text }, null));
        response.write(chunk({}, 'stop'));
      }
      response.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => modelServer.listen(0, '127.0.0.1', () => {
    resolve(`http://127.0.0.1:${(modelServer.address() as AddressInfo).port}/v1`);
  }));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-loop-cycle-'));
  projectPath = path.join(root, '.bowman');
  await fs.ensureDir(projectPath);
  script = [];
  modelRequests = [];

  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  closeWss = applyWSSHandler({ wss, router: appRouter, createContext }).broadcastReconnectNotification;
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  // The spawned worker inherits the environment and reaches this server.
  previousWsPort = process.env.PORT_BACKEND_WS;
  process.env.PORT_BACKEND_WS = String((wss.address() as AddressInfo).port);
  process.env.BACKEND_WS_HOST = '127.0.0.1';
});

afterEach(async () => {
  // Stop the workers and wait until they exited: they write into the project.
  const state = await caller.loop.getState({ projectPath }).catch(() => null);
  for (const instance of state?.instances ?? []) {
    await caller.loop.stopInstance({ projectPath, instanceId: instance.id }).catch(() => {});
    const pid = (await fs.readJson(getLoopWorkerStatePath(projectPath, instance.id)).catch(() => null))?.pid;
    while (pid && isAlive(pid)) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (previousWsPort === undefined) delete process.env.PORT_BACKEND_WS;
  else process.env.PORT_BACKEND_WS = previousWsPort;
  delete process.env.BACKEND_WS_HOST;
  void closeWss;
  for (const client of wss.clients) client.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => modelServer?.listening ? modelServer.close(() => resolve()) : resolve());
  clearIndices(projectPath);
  await fs.remove(root);
});

// One phase with one committed open idea, and a loop instance that stops when
// the phase has no ongoing commitments left.
async function setUpLoop() {
  const baseUrl = await startFakeModel();
  const phase = await caller.phase.create({ projectPath, phase: { name: 'Now' } }) as { id: string };
  const idea = await caller.idea.createIdeaInPhase({ projectPath, phaseId: phase.id, idea: { text: 'Fix the flaky test' } });
  await caller.loop.updateSecrets({ projectPath, secrets: { LOOP_API_KEY: 'fake' } });
  await caller.loop.create({ projectPath, name: 'test loop' });
  const loopId = (await caller.loop.getState({ projectPath })).loops[0]!.id;
  await caller.loop.update({ projectPath, loopId, provider: 'openai-compatible', model: 'fake', baseUrl, intervalSeconds: 5, associationChance: 0, capabilities: [] });
  await caller.loop.createInstance({ projectPath, loopId });
  const instanceId = (await caller.loop.getState({ projectPath })).instances[0]!.id;
  await caller.loop.updateInstance({ projectPath, instanceId, targetPhaseId: phase.id, stopPolicy: 'phase_done' });
  return { ideaId: idea.id, instanceId };
}

async function waitForInstance(instanceId: string, done: (instance: LoopInstance) => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let instance: LoopInstance | undefined;
  while (Date.now() < deadline) {
    instance = (await caller.loop.getState({ projectPath })).instances.find((candidate) => candidate.id === instanceId);
    if (instance && done(instance)) return instance;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const log = await fs.readFile(path.join(projectPath, 'runtime', 'loops', instanceId, 'logs', 'err.log'), 'utf8').catch(() => '');
  throw new Error(`instance stayed ${instance?.status}: ${JSON.stringify(instance?.messages.slice(-3))}\n${log}`);
}

test('a cycle executes the model\'s tool call through the backend and the phase_done policy ends the instance', async () => {
  const { ideaId, instanceId } = await setUpLoop();
  script = [
    { toolCall: { name: 'update_idea', arguments: { ideaId, status: { state: 'implemented', comment: 'fixed by the fake model' } } } },
    { text: 'Marked the idea implemented.' }
  ];

  await caller.loop.startInstance({ projectPath, instanceId });
  const instance = await waitForInstance(instanceId, (candidate) => candidate.status === 'done');

  const idea = await caller.idea.get({ projectPath, ideaId });
  assert.equal(idea.status.state, 'implemented');
  assert.equal(idea.status.comment, 'fixed by the fake model');
  assert.ok(instance.messages.some((message) => message.content.includes('Target phase done: Now')));
  // The worker offered the model the graph tools.
  const toolNames = (modelRequests[0].tools ?? []).map((tool: any) => tool.function.name);
  assert.ok(toolNames.includes('update_idea') && toolNames.includes('get_prioritized_ideas'), toolNames.join(','));
}, 60_000);

test('a rejected API key ends the instance in error with a hint where the key lives', async () => {
  const { instanceId } = await setUpLoop();
  script = [{ httpError: 401, body: 'invalid api key' }];

  await caller.loop.startInstance({ projectPath, instanceId });
  const instance = await waitForInstance(instanceId, (candidate) => candidate.status === 'error');

  const errors = instance.messages.filter((message) => message.kind === 'error').map((message) => message.content).join('\n');
  assert.match(errors, /LOOP_API_KEY/);
}, 60_000);

test('human_action_required pauses the instance until the human answers, then the cycle continues', async () => {
  const { ideaId, instanceId } = await setUpLoop();
  script = [
    { toolCall: { name: 'human_action_required', arguments: { message: 'Which test runner should I use?' } } },
    { toolCall: { name: 'update_idea', arguments: { ideaId, status: { state: 'implemented', comment: 'used vitest as told' } } } },
    { text: 'Done.' }
  ];

  await caller.loop.startInstance({ projectPath, instanceId });
  const waiting = await waitForInstance(instanceId, (candidate) => candidate.status === 'waiting_for_human');
  assert.ok(waiting.messages.some((message) => message.kind === 'human_action_required' && message.content === 'Which test runner should I use?'), JSON.stringify(waiting.messages.map((message) => [message.kind, message.content.slice(0, 80)])));
  assert.equal((await caller.idea.get({ projectPath, ideaId })).status.state, 'open');

  await caller.loop.sendHumanMessage({ projectPath, instanceId, content: 'vitest' });
  await waitForInstance(instanceId, (candidate) => candidate.status === 'done');

  assert.equal((await caller.idea.get({ projectPath, ideaId })).status.comment, 'used vitest as told');
  // The answer reached the model as the tool result.
  assert.match(JSON.stringify(modelRequests[1].messages), /vitest/);
}, 60_000);
