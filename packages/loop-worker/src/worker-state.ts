import {
  drainInbox,
  mutateLoopRuntimeState,
  patchWorkerState,
  readLoopRuntimeState,
  readWorkerState,
  setLoopActivity,
  type LoopInstance
} from 'agent-tools';

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export async function markInstanceStatus(projectPath: string, instanceId: string, status: LoopInstance['status']) {
  await mutateLoopRuntimeState(projectPath, (state) => {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return;
    instance.status = status;
    instance.updatedAt = Date.now();
  });
  await patchWorkerState(projectPath, instanceId, { status, updatedAt: Date.now() });
}

export async function markLoopPhase(projectPath: string, instanceId: string, phase: string) {
  await setLoopActivity(projectPath, instanceId, phase);
}

export async function readLoopAndInstance(projectPath: string, instanceId: string) {
  const runtime = await readLoopRuntimeState(projectPath);
  const instance = runtime.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error(`Loop instance not found: ${instanceId}`);
  const loop = runtime.loops.find((candidate) => candidate.id === instance.loopId);
  if (!loop) throw new Error(`Loop definition not found: ${instance.loopId}`);
  return { loop, instance };
}

export async function waitForHumanAnswer(projectPath: string, instanceId: string, requestId: string, signal: AbortSignal) {
  while (!signal.aborted) {
    const state = await readWorkerState(projectPath, instanceId);
    if (state?.stopRequested) return null;
    const messages = await drainInbox(projectPath, instanceId);
    const answer = messages.find((message) => !message.replyToRequestId || message.replyToRequestId === requestId) ?? messages[0];
    if (answer) return answer;
    await sleep(1500, signal);
  }
  return null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
