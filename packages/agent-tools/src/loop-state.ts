import fs from 'fs-extra';
import path from 'path';
import { toBowmanPath } from 'shared';
import { withProcessFileLock } from 'shared/node-entry';
import {
  getLoopEventsPath,
  getLoopInboxPath,
  getLoopInstanceDir,
  getLoopRuntimePath,
  getLoopWorkerStatePath,
  loopInboxMessageSchema,
  loopRuntimeStateSchema,
  loopWorkerStateSchema,
  pushLoopMessage,
  type LoopInboxMessage,
  type LoopMessage,
  type LoopRuntimeState,
  type LoopWorkerState
} from 'shared/loop-state';
import { v4 as uuidv4 } from 'uuid';

export * from 'shared/loop-state';

export function normalizeBowmanPath(rawProjectPath: string): string {
  return toBowmanPath(path.resolve(rawProjectPath));
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await fs.writeJson(tempPath, data, { spaces: 2 });
  await fs.move(tempPath, filePath, { overwrite: true });
}

export async function readLoopRuntimeState(projectPath: string): Promise<LoopRuntimeState> {
  return loopRuntimeStateSchema.parse(await fs.readJson(getLoopRuntimePath(projectPath)));
}

export async function writeLoopRuntimeState(projectPath: string, state: LoopRuntimeState): Promise<void> {
  await writeJsonAtomic(getLoopRuntimePath(projectPath), loopRuntimeStateSchema.parse(state));
}

export async function mutateLoopRuntimeState(
  projectPath: string,
  mutate: (state: LoopRuntimeState) => void
): Promise<LoopRuntimeState> {
  // The backend changes the same file: hold the shared lock across read and write.
  return withProcessFileLock(getLoopRuntimePath(projectPath), async () => {
    const state = await readLoopRuntimeState(projectPath);
    mutate(state);
    await writeLoopRuntimeState(projectPath, state);
    return state;
  });
}

export async function appendLoopEvent(
  projectPath: string,
  instanceId: string,
  message: Omit<LoopMessage, 'id' | 'timestamp'>
): Promise<LoopMessage> {
  const entry: LoopMessage = {
    id: uuidv4(),
    timestamp: Date.now(),
    ...message
  };
  const line = `${JSON.stringify(entry)}\n`;
  await fs.ensureDir(getLoopInstanceDir(projectPath, instanceId));
  await fs.appendFile(getLoopEventsPath(projectPath, instanceId), line);
  await mutateLoopRuntimeState(projectPath, (state) => {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (instance) pushLoopMessage(instance, entry);
  });
  return entry;
}

export async function setLoopActivity(
  projectPath: string,
  instanceId: string,
  activity: string | null
): Promise<void> {
  await mutateLoopRuntimeState(projectPath, (state) => {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return;
    instance.currentActivity = activity;
    instance.updatedAt = Date.now();
  });
}

export async function readWorkerState(projectPath: string, instanceId: string): Promise<LoopWorkerState | null> {
  try {
    return loopWorkerStateSchema.parse(await fs.readJson(getLoopWorkerStatePath(projectPath, instanceId)));
  } catch {
    return null;
  }
}

export async function writeWorkerState(projectPath: string, instanceId: string, state: LoopWorkerState): Promise<void> {
  await writeJsonAtomic(getLoopWorkerStatePath(projectPath, instanceId), loopWorkerStateSchema.parse(state));
}

export async function patchWorkerState(
  projectPath: string,
  instanceId: string,
  patch: Partial<LoopWorkerState>
): Promise<LoopWorkerState> {
  const existing = await readWorkerState(projectPath, instanceId);
  const next = loopWorkerStateSchema.parse({
    instanceId,
    projectPath: normalizeBowmanPath(projectPath),
    status: existing?.status ?? 'idle',
    updatedAt: Date.now(),
    ...existing,
    ...patch
  });
  await writeWorkerState(projectPath, instanceId, next);
  return next;
}

export async function enqueueHumanMessage(
  projectPath: string,
  instanceId: string,
  content: string,
  replyToRequestId?: string
): Promise<LoopInboxMessage> {
  const message = loopInboxMessageSchema.parse({
    id: uuidv4(),
    role: 'user',
    content,
    replyToRequestId,
    timestamp: Date.now()
  });
  await fs.ensureDir(getLoopInstanceDir(projectPath, instanceId));
  await fs.appendFile(getLoopInboxPath(projectPath, instanceId), `${JSON.stringify(message)}\n`);
  await appendLoopEvent(projectPath, instanceId, {
    role: 'user',
    kind: 'text',
    content,
    replyToRequestId
  });
  return message;
}

export async function drainInbox(projectPath: string, instanceId: string): Promise<LoopInboxMessage[]> {
  const inboxPath = getLoopInboxPath(projectPath, instanceId);
  if (!(await fs.pathExists(inboxPath))) return [];
  const text = await fs.readFile(inboxPath, 'utf8');
  await fs.writeFile(inboxPath, '');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => loopInboxMessageSchema.parse(JSON.parse(line)));
}
