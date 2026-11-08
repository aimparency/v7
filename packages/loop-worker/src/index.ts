import fs from 'fs-extra';
import path from 'path';
import {
  appendLoopEvent,
  connectGraph,
  normalizeBowmanPath,
  patchWorkerState,
  readWorkerState,
  type GraphTools,
  type LoopDefinition,
  type LoopInstance
} from 'agent-tools';
import { isOngoingState } from 'shared';
import { runCycle } from './cycle.js';
import { createRoleModels, roleModelSpec } from './models.js';
import { errorMessage, markInstanceStatus, markLoopPhase, readLoopAndInstance, sleep } from './worker-state.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let projectPath = '';
  let instanceId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--projectPath' && args[i + 1]) {
      projectPath = args[++i];
    } else if (args[i] === '--instanceId' && args[i + 1]) {
      instanceId = args[++i];
    }
  }
  if (!projectPath || !instanceId) {
    throw new Error('Usage: loop-worker --projectPath <project-or-.bowman> --instanceId <uuid>');
  }
  return { projectPath: normalizeBowmanPath(projectPath), instanceId };
}

async function readSecrets(projectPath: string): Promise<Record<string, string | undefined>> {
  try {
    return await fs.readJson(path.join(projectPath, 'secrets.json'));
  } catch {
    return {};
  }
}

async function evaluateStopPolicy(graph: GraphTools, instance: LoopInstance) {
  if (instance.stopPolicy === 'never') return null;
  if (instance.stopPolicy === 'asap') {
    return { status: 'stopped' as const, message: null };
  }

  if (instance.stopPolicy === 'target_halted') {
    if (!instance.targetIdeaId) return null;
    const ideas = await graph.listIdeas();
    const idea = ideas.find((candidate) => candidate.id === instance.targetIdeaId);
    if (idea?.status.state === 'halted') {
      return { status: 'done' as const, message: `Target idea halted: ${idea.text}` };
    }
    return null;
  }

  if (!instance.targetPhaseId) return null;
  const [ideas, phases] = await Promise.all([graph.listIdeas(), graph.listPhases()]);
  const phase = phases.find((candidate) => candidate.id === instance.targetPhaseId);
  if (!phase || (phase.commitments ?? []).length === 0) return null;
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const ongoing = (phase.commitments ?? [])
    .map((ideaId) => ideaById.get(ideaId))
    .filter((idea) => idea && isOngoingState(idea.status.state));
  if (ongoing.length === 0) {
    return { status: 'done' as const, message: `Target phase done: ${phase.name}` };
  }
  return null;
}

async function waitForNextCycle(projectPath: string, instanceId: string, loop: LoopDefinition, graph: GraphTools, signal: AbortSignal) {
  await markLoopPhase(projectPath, instanceId, `cooldown (${loop.intervalSeconds}s)`);
  const until = Date.now() + loop.intervalSeconds * 1000;
  while (!signal.aborted && Date.now() < until) {
    const workerState = await readWorkerState(projectPath, instanceId);
    if (workerState?.stopRequested) break;
    const { instance } = await readLoopAndInstance(projectPath, instanceId);
    const stopDecision = await evaluateStopPolicy(graph, instance);
    if (stopDecision) return stopDecision;
    await sleep(Math.min(1000, Math.max(0, until - Date.now())), signal);
  }
  return null;
}

async function main() {
  const { projectPath, instanceId } = parseArgs();
  const graph = connectGraph(projectPath);
  const abortController = new AbortController();
  let stopping = false;
  let finalStatus: LoopInstance['status'] = 'stopped';
  let finalMessage: string | null = 'Loop worker stopped.';
  const stop = () => {
    stopping = true;
    abortController.abort();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const startedAt = Date.now();
  await patchWorkerState(projectPath, instanceId, {
    status: 'running',
    pid: process.pid,
    startedAt,
    updatedAt: startedAt,
    heartbeatAt: startedAt,
    stopRequested: false,
    error: undefined
  });
  await markInstanceStatus(projectPath, instanceId, 'running');
  const startupLoop = (await readLoopAndInstance(projectPath, instanceId)).loop;
  const executionNote = startupLoop.worktreePath ? ` Coding tools use worktree ${startupLoop.worktreePath}.` : '';
  const verifier = roleModelSpec(startupLoop, 'verifier');
  const executor = roleModelSpec(startupLoop, 'executor');
  const verifierNote = verifier.provider === executor.provider && verifier.model === executor.model
    ? ' The verifier runs on the executor\'s model; set roles.verifier in loops.json to another model family for independent verification.'
    : ` Verifier: ${verifier.provider} / ${verifier.model}.`;
  await appendLoopEvent(projectPath, instanceId, { role: 'system', kind: 'event', content: `Loop worker started (pid ${process.pid}).${executionNote}${verifierNote}` });
  await markLoopPhase(projectPath, instanceId, 'started');

  const heartbeat = setInterval(() => {
    void patchWorkerState(projectPath, instanceId, {
      status: stopping ? 'stopped' : 'running',
      pid: process.pid,
      heartbeatAt: Date.now()
    }).catch(() => {});
  }, 5000);

  try {
    while (!abortController.signal.aborted) {
      const workerState = await readWorkerState(projectPath, instanceId);
      if (workerState?.stopRequested) break;
      const { loop, instance } = await readLoopAndInstance(projectPath, instanceId);
      if (instance.status === 'stopped') break;
      await markLoopPhase(projectPath, instanceId, 'checking stop policy');
      const stopDecision = await evaluateStopPolicy(graph, instance);
      if (stopDecision) {
        finalStatus = stopDecision.status;
        finalMessage = stopDecision.message;
        break;
      }
      if (instance.status !== 'running' && instance.status !== 'waiting_for_human' && instance.status !== 'waiting_for_external') {
        await markInstanceStatus(projectPath, instanceId, 'running');
      }
      await markLoopPhase(projectPath, instanceId, 'running cycle');
      const models = createRoleModels(loop, await readSecrets(projectPath));
      await runCycle({ projectPath, instanceId, loop, graph, signal: abortController.signal, models });
      const nextState = await readWorkerState(projectPath, instanceId);
      if (nextState?.stopRequested || abortController.signal.aborted) break;
      const { instance: refreshedInstance } = await readLoopAndInstance(projectPath, instanceId);
      const postCycleStopDecision = await evaluateStopPolicy(graph, refreshedInstance);
      if (postCycleStopDecision) {
        finalStatus = postCycleStopDecision.status;
        finalMessage = postCycleStopDecision.message;
        break;
      }
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'event',
        content: `Cycle complete. Waiting ${loop.intervalSeconds}s.`
      });
      const waitStopDecision = await waitForNextCycle(projectPath, instanceId, loop, graph, abortController.signal);
      if (waitStopDecision) {
        finalStatus = waitStopDecision.status;
        finalMessage = waitStopDecision.message;
        break;
      }
    }
    await markInstanceStatus(projectPath, instanceId, finalStatus);
    await patchWorkerState(projectPath, instanceId, { status: finalStatus, stopRequested: false });
    await markLoopPhase(projectPath, instanceId, finalStatus === 'done' ? 'done' : 'stopped');
    if (finalMessage) {
      await appendLoopEvent(projectPath, instanceId, { role: 'system', kind: 'event', content: finalMessage });
    }
  } catch (error) {
    // Provider errors were already described by the stage that hit them, with its role's model.
    const message = errorMessage(error);
    await markInstanceStatus(projectPath, instanceId, abortController.signal.aborted ? 'stopped' : 'error');
    await patchWorkerState(projectPath, instanceId, {
      status: abortController.signal.aborted ? 'stopped' : 'error',
      error: message
    });
    await appendLoopEvent(projectPath, instanceId, {
      role: 'system',
      kind: abortController.signal.aborted ? 'event' : 'error',
      content: abortController.signal.aborted ? 'Loop worker stopped.' : message
    });
    if (!abortController.signal.aborted) process.exitCode = 1;
  } finally {
    clearInterval(heartbeat);
    graph.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
