import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

export const loopProviderSchema = z.enum(['nvidia', 'openrouter', 'openai-compatible']);

export const loopMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'assistant', 'tool', 'user']),
  kind: z.enum(['event', 'text', 'status', 'error', 'human_action_required']),
  content: z.string(),
  timestamp: z.number(),
  requestId: z.string().optional(),
  replyToRequestId: z.string().optional()
});

export const loopDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemPrompt: z.string(),
  provider: loopProviderSchema.default('nvidia'),
  model: z.string().default('z-ai/glm-5.2'),
  baseUrl: z.string().default('https://integrate.api.nvidia.com/v1'),
  intervalSeconds: z.number().int().min(5).max(3600).default(60),
  associationChance: z.number().min(0).max(1).default(0.1),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const loopInstanceStatusSchema = z.enum(['idle', 'running', 'waiting_for_human', 'stopped', 'done', 'error']);
export const loopStopPolicySchema = z.enum(['target_halted', 'phase_done', 'never', 'asap']);

export const loopInstanceSchema = z.object({
  id: z.string(),
  loopId: z.string(),
  name: z.string(),
  status: loopInstanceStatusSchema.default('idle'),
  targetPhaseId: z.string().nullable().default(null),
  targetAimId: z.string().nullable().default(null),
  stopPolicy: loopStopPolicySchema.default('target_halted'),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(loopMessageSchema).default([])
});

export const loopRuntimeStateSchema = z.object({
  version: z.number().default(1),
  selectedLoopId: z.string().nullable().default(null),
  selectedInstanceId: z.string().nullable().default(null),
  loops: z.array(loopDefinitionSchema).default([]),
  instances: z.array(loopInstanceSchema).default([])
});

export const loopWorkerStateSchema = z.object({
  instanceId: z.string(),
  projectPath: z.string(),
  status: loopInstanceStatusSchema,
  pid: z.number().optional(),
  startedAt: z.number().optional(),
  updatedAt: z.number(),
  heartbeatAt: z.number().optional(),
  waitingRequestId: z.string().optional(),
  waitingPrompt: z.string().optional(),
  stopRequested: z.boolean().default(false),
  error: z.string().optional()
});

export const loopInboxMessageSchema = z.object({
  id: z.string(),
  role: z.literal('user').default('user'),
  content: z.string(),
  timestamp: z.number(),
  replyToRequestId: z.string().optional()
});

export type LoopRuntimeState = z.infer<typeof loopRuntimeStateSchema>;
export type LoopDefinition = z.infer<typeof loopDefinitionSchema>;
export type LoopInstance = z.infer<typeof loopInstanceSchema>;
export type LoopMessage = z.infer<typeof loopMessageSchema>;
export type LoopWorkerState = z.infer<typeof loopWorkerStateSchema>;
export type LoopInboxMessage = z.infer<typeof loopInboxMessageSchema>;

export function normalizeBowmanPath(rawProjectPath: string): string {
  const clean = path.resolve(rawProjectPath).replace(/[\\/]$/, '');
  return path.basename(clean) === '.bowman' ? clean : path.join(clean, '.bowman');
}

export function getLoopRuntimePath(projectPath: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'runtime', 'loops.json');
}

export function getLoopInstanceDir(projectPath: string, instanceId: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'runtime', 'loop-instances', instanceId);
}

export function getLoopWorkerStatePath(projectPath: string, instanceId: string): string {
  return path.join(getLoopInstanceDir(projectPath, instanceId), 'state.json');
}

export function getLoopEventsPath(projectPath: string, instanceId: string): string {
  return path.join(getLoopInstanceDir(projectPath, instanceId), 'events.jsonl');
}

export function getLoopInboxPath(projectPath: string, instanceId: string): string {
  return path.join(getLoopInstanceDir(projectPath, instanceId), 'inbox.jsonl');
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
  const state = await readLoopRuntimeState(projectPath);
  mutate(state);
  await writeLoopRuntimeState(projectPath, state);
  return state;
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
    if (!instance) return;
    instance.messages.push(entry);
    if (instance.messages.length > 500) {
      instance.messages.splice(0, instance.messages.length - 500);
    }
    instance.updatedAt = entry.timestamp;
  });
  return entry;
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
