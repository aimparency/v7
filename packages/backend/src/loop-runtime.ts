import { z } from 'zod';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { Idea } from 'shared';
import { calculateIdeaValues } from 'shared';
import { spawn, type ChildProcess } from 'child_process';
import { emitChange } from './change-events.js';
import { writeJsonAtomic } from './storage/json.js';
import { normalizeProjectPath } from './project-path.js';
import { ensureProjectStructure, readProjectMeta } from './storage/project.js';
import { listIdeas } from './storage/ideas.js';
import { listPhases } from './storage/phases.js';

// Background loops: their definitions and instances (runtime/loops.json),
// config and secrets, and the loop-worker processes that run them.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '../../../..');
export const LOOP_WORKER_DIR = path.join(REPO_ROOT, 'packages', 'loop-worker');
export const LOOP_WORKER_SCRIPT = path.join(LOOP_WORKER_DIR, 'dist', 'index.js');

export const loopProviderSchema = z.enum(['nvidia', 'openrouter', 'openai-compatible']);
export const loopCapabilitySchema = z.enum(['coding', 'experiments', 'code-intelligence']);
export const loopSecretsSchema = z.object({
  NVIDIA_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  LOOP_API_KEY: z.string().optional()
}).default({});
export const loopConfigSchema = z.object({
  provider: loopProviderSchema.default('nvidia'),
  model: z.string().default('z-ai/glm-5.2'),
  baseUrl: z.string().default('https://integrate.api.nvidia.com/v1'),
  intervalSeconds: z.number().int().min(5).max(3600).default(60)
});
export const loopMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'assistant', 'tool', 'user']),
  kind: z.enum(['event', 'text', 'status', 'error', 'human_action_required', 'external_action_required']),
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
  worktreePath: z.string().nullable().default(null),
  capabilities: z.array(loopCapabilitySchema).default(['coding', 'experiments', 'code-intelligence']),
  createdAt: z.number(),
  updatedAt: z.number()
});
export const loopInstanceSchema = z.object({
  id: z.string(),
  loopId: z.string(),
  name: z.string(),
  status: z.enum(['idle', 'running', 'waiting_for_human', 'waiting_for_external', 'stopped', 'done', 'error']),
  targetPhaseId: z.string().nullable().default(null),
  targetIdeaId: z.string().nullable().default(null),
  stopPolicy: z.enum(['target_halted', 'phase_done', 'never', 'asap']).default('never'),
  currentActivity: z.string().nullable().default(null),
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
  status: z.enum(['idle', 'running', 'waiting_for_human', 'waiting_for_external', 'stopped', 'done', 'error']),
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

export type LoopWorkerProcess = {
  process: ChildProcess;
  pid: number;
  projectPath: string;
  instanceId: string;
};

export const activeLoopWorkers = new Map<string, LoopWorkerProcess>();

export const getSecretsPath = (rawProjectPath: string) =>
  path.join(normalizeProjectPath(rawProjectPath), 'secrets.json');
export const getLoopConfigPath = (rawProjectPath: string) =>
  path.join(normalizeProjectPath(rawProjectPath), 'runtime', 'loop-config.json');
export const getLoopRuntimePath = (rawProjectPath: string) =>
  path.join(normalizeProjectPath(rawProjectPath), 'runtime', 'loops.json');


export const pickDefaultLoopTarget = async (rawProjectPath: string, preferredPhaseId?: string | null) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const [meta, phases, ideas] = await Promise.all([
    readProjectMeta(projectPath).catch(() => null),
    listPhases(projectPath),
    listIdeas(projectPath)
  ]);
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const explicitPhase = preferredPhaseId ? phaseById.get(preferredPhaseId) : undefined;
  const cursorLevel = meta?.phaseActiveLevel ?? 0;
  const cursorPhaseId = meta?.phaseCursors?.[String(cursorLevel)];
  const cursorPhase = cursorPhaseId ? phaseById.get(cursorPhaseId) : undefined;
  const now = Date.now();
  const activePhase = phases.find((phase) =>
    (phase.from ?? 0) > 0 && (phase.to ?? 0) > 0 && phase.from! <= now && now <= phase.to!
  );
  const phase = explicitPhase ?? cursorPhase ?? activePhase ?? phases[0] ?? null;
  if (!phase) return { targetPhaseId: null, targetIdeaId: null };

  const { priorities } = calculateIdeaValues(ideas);
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const targetIdea = [...(phase.commitments ?? [])]
    .map((ideaId) => ideaById.get(ideaId))
    .filter((idea): idea is Idea => idea !== undefined && idea.status.state === 'open')
    .sort((left, right) => (priorities.get(right.id) ?? 0) - (priorities.get(left.id) ?? 0))[0] ?? null;

  return {
    targetPhaseId: phase.id,
    targetIdeaId: targetIdea?.id ?? null
  };
};

const ensureLoopInstanceTarget = async (
  rawProjectPath: string,
  instance: z.infer<typeof loopInstanceSchema>
) => {
  if (instance.targetPhaseId && instance.targetIdeaId) return instance;
  const defaults = await pickDefaultLoopTarget(rawProjectPath, instance.targetPhaseId);
  instance.targetPhaseId = instance.targetPhaseId ?? defaults.targetPhaseId;
  instance.targetIdeaId = instance.targetIdeaId ?? defaults.targetIdeaId;
  instance.updatedAt = Date.now();
  return instance;
};

export const readLoopSecrets = async (rawProjectPath: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const secretsPath = getSecretsPath(projectPath);
  try {
    return loopSecretsSchema.parse(await fs.readJson(secretsPath));
  } catch {
    return loopSecretsSchema.parse({});
  }
};

export const writeLoopSecrets = async (rawProjectPath: string, secrets: z.infer<typeof loopSecretsSchema>) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  await writeJsonAtomic(getSecretsPath(projectPath), loopSecretsSchema.parse(secrets));
};

export const readLoopConfig = async (rawProjectPath: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const configPath = getLoopConfigPath(projectPath);
  try {
    return loopConfigSchema.parse(await fs.readJson(configPath));
  } catch {
    const fallback = loopConfigSchema.parse({});
    await fs.writeJson(configPath, fallback, { spaces: 2 });
    return fallback;
  }
};

export const writeLoopConfig = async (rawProjectPath: string, config: z.infer<typeof loopConfigSchema>) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  await writeJsonAtomic(getLoopConfigPath(projectPath), loopConfigSchema.parse(config));
};

export const makeDefaultLoopRuntimeState = () => {
  const now = Date.now();
  const loopId = uuidv4();
  return loopRuntimeStateSchema.parse({
    version: 1,
    selectedLoopId: loopId,
    selectedInstanceId: null,
    loops: [{
      id: loopId,
      name: 'Default loop',
      systemPrompt: [
        'Continuously advance the highest-value mission through its best actionable ideas.',
        'Verify and record real outcomes, then return to the graph and improve the strategy.',
        'Keep status reports brief.'
      ].join('\n'),
      provider: 'nvidia',
      model: 'z-ai/glm-5.2',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      intervalSeconds: 60,
      associationChance: 0.1,
      capabilities: ['coding', 'experiments', 'code-intelligence'],
      createdAt: now,
      updatedAt: now
    }],
    instances: []
  });
};

export const readLoopRuntimeState = async (rawProjectPath: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const runtimePath = getLoopRuntimePath(projectPath);
  try {
    return loopRuntimeStateSchema.parse(await fs.readJson(runtimePath));
  } catch {
    const fallback = makeDefaultLoopRuntimeState();
    await writeJsonAtomic(runtimePath, fallback);
    return fallback;
  }
};

export const writeLoopRuntimeState = async (rawProjectPath: string, state: z.infer<typeof loopRuntimeStateSchema>) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  await writeJsonAtomic(getLoopRuntimePath(projectPath), loopRuntimeStateSchema.parse(state));
};

export const mutateLoopRuntimeState = async (
  rawProjectPath: string,
  mutate: (state: z.infer<typeof loopRuntimeStateSchema>) => void
) => {
  const state = await readLoopRuntimeState(rawProjectPath);
  mutate(state);
  await writeLoopRuntimeState(rawProjectPath, state);
  emitChange({ type: 'loop', id: 'runtime', projectPath: normalizeProjectPath(rawProjectPath) });
  return state;
};

export const appendLoopMessage = async (
  rawProjectPath: string,
  instanceId: string,
  message: Omit<z.infer<typeof loopMessageSchema>, 'id' | 'timestamp'>
) => {
  await mutateLoopRuntimeState(rawProjectPath, (state) => {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return;
    instance.messages.push({
      id: uuidv4(),
      timestamp: Date.now(),
      ...message
    });
    instance.updatedAt = Date.now();
  });
};

const getLoopApiKey = (provider: z.infer<typeof loopProviderSchema>, secrets: z.infer<typeof loopSecretsSchema>) => {
  if (provider === 'nvidia') return secrets.NVIDIA_API_KEY;
  if (provider === 'openrouter') return secrets.OPENROUTER_API_KEY;
  return secrets.LOOP_API_KEY;
};

export const getLoopInstanceDir = (rawProjectPath: string, instanceId: string) =>
  path.join(normalizeProjectPath(rawProjectPath), 'runtime', 'loop-instances', instanceId);
export const getLoopWorkerStatePath = (rawProjectPath: string, instanceId: string) =>
  path.join(getLoopInstanceDir(rawProjectPath, instanceId), 'state.json');
export const getLoopInboxPath = (rawProjectPath: string, instanceId: string) =>
  path.join(getLoopInstanceDir(rawProjectPath, instanceId), 'inbox.jsonl');

export const readLoopWorkerErrorText = async (rawProjectPath: string, instanceId: string, workerError?: string) => {
  if (workerError?.trim()) return workerError.trim();
  const errLogPath = path.join(getLoopInstanceDir(rawProjectPath, instanceId), 'logs', 'err.log');
  try {
    const text = await fs.readFile(errLogPath, 'utf8');
    return text.trim().split('\n').slice(-40).join('\n').trim();
  } catch {
    return '';
  }
};

export const appendLoopErrorOnce = async (
  instance: z.infer<typeof loopInstanceSchema>,
  content: string
) => {
  if (!content.trim()) return;
  const latestError = [...instance.messages].reverse().find((message) => message.kind === 'error');
  if (latestError?.content === content) return;
  instance.messages.push({
    id: uuidv4(),
    role: 'system',
    kind: 'error',
    content,
    timestamp: Date.now()
  });
  if (instance.messages.length > 500) {
    instance.messages.splice(0, instance.messages.length - 500);
  }
};

export const loopWorkerKey = (rawProjectPath: string, instanceId: string) =>
  `${normalizeProjectPath(rawProjectPath)}:${instanceId}`;

export const readLoopWorkerState = async (rawProjectPath: string, instanceId: string) => {
  try {
    return loopWorkerStateSchema.parse(await fs.readJson(getLoopWorkerStatePath(rawProjectPath, instanceId)));
  } catch {
    return null;
  }
};

export const writeLoopWorkerState = async (
  rawProjectPath: string,
  instanceId: string,
  state: z.infer<typeof loopWorkerStateSchema>
) => {
  await writeJsonAtomic(getLoopWorkerStatePath(rawProjectPath, instanceId), loopWorkerStateSchema.parse(state));
};

export const patchLoopWorkerState = async (
  rawProjectPath: string,
  instanceId: string,
  patch: Partial<z.infer<typeof loopWorkerStateSchema>>
) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const existing = await readLoopWorkerState(projectPath, instanceId);
  const next = loopWorkerStateSchema.parse({
    instanceId,
    projectPath,
    status: existing?.status ?? 'idle',
    updatedAt: Date.now(),
    ...existing,
    ...patch
  });
  await writeLoopWorkerState(projectPath, instanceId, next);
  return next;
};

export const isPidAlive = (pid: number | undefined) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const killLoopWorker = async (rawProjectPath: string, instanceId: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const key = loopWorkerKey(projectPath, instanceId);
  const active = activeLoopWorkers.get(key);
  const workerState = await readLoopWorkerState(projectPath, instanceId);
  const pid = active?.pid ?? workerState?.pid;
  await patchLoopWorkerState(projectPath, instanceId, { stopRequested: true, status: 'stopped' });
  if (pid && isPidAlive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already stopped.
      }
    }
  }
  activeLoopWorkers.delete(key);
};

export const refreshLoopProcessStates = async (rawProjectPath: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const state = await readLoopRuntimeState(projectPath);
  for (const instance of state.instances) {
    const active = activeLoopWorkers.get(loopWorkerKey(projectPath, instance.id));
    if (active?.process.exitCode !== null && active?.process.exitCode !== undefined) {
      activeLoopWorkers.delete(loopWorkerKey(projectPath, instance.id));
    }
  }
    let changed = false;
    for (const instance of state.instances) {
      const workerState = await readLoopWorkerState(projectPath, instance.id);
      if (!workerState) continue;
      const pidAlive = isPidAlive(workerState.pid);
      if ((workerState.status === 'running' || workerState.status === 'waiting_for_human' || workerState.status === 'waiting_for_external') && !pidAlive) {
        instance.status = workerState.stopRequested ? 'stopped' : 'error';
        if (instance.status === 'error') {
          const errorText = await readLoopWorkerErrorText(projectPath, instance.id, workerState.error);
          await appendLoopErrorOnce(instance, errorText || 'Loop worker exited without reporting an error.');
        }
        instance.updatedAt = Date.now();
        changed = true;
      } else if (instance.status !== workerState.status) {
        instance.status = workerState.status;
        if (instance.status === 'error') {
          const errorText = await readLoopWorkerErrorText(projectPath, instance.id, workerState.error);
          await appendLoopErrorOnce(instance, errorText || 'Loop worker entered error state without reporting details.');
        }
        instance.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) await writeLoopRuntimeState(projectPath, state);
    return state;
};

export const spawnLoopWorker = async (rawProjectPath: string, instanceId: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const key = loopWorkerKey(projectPath, instanceId);
  const existing = activeLoopWorkers.get(key);
  if (existing && isPidAlive(existing.pid)) return existing;

  const workerState = await readLoopWorkerState(projectPath, instanceId);
  if (workerState?.pid && isPidAlive(workerState.pid) && (workerState.status === 'running' || workerState.status === 'waiting_for_human' || workerState.status === 'waiting_for_external')) {
    return { pid: workerState.pid, projectPath, instanceId } as LoopWorkerProcess;
  }

  await fs.ensureDir(getLoopInstanceDir(projectPath, instanceId));
  const logDir = path.join(getLoopInstanceDir(projectPath, instanceId), 'logs');
  await fs.ensureDir(logDir);
  const out = fs.openSync(path.join(logDir, 'out.log'), 'a');
  const err = fs.openSync(path.join(logDir, 'err.log'), 'a');
  const child = spawn('node', [
    LOOP_WORKER_SCRIPT,
    '--projectPath',
    projectPath,
    '--instanceId',
    instanceId
  ], {
    cwd: LOOP_WORKER_DIR,
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env }
  });
  child.unref();
  const processEntry: LoopWorkerProcess = { process: child, pid: child.pid!, projectPath, instanceId };
  activeLoopWorkers.set(key, processEntry);
  await patchLoopWorkerState(projectPath, instanceId, {
    status: 'running',
    pid: child.pid!,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    stopRequested: false,
    error: undefined
  });
  child.on('exit', () => {
    const active = activeLoopWorkers.get(key);
    if (active?.process === child) activeLoopWorkers.delete(key);
  });
  return processEntry;
};

export const enqueueLoopHumanMessage = async (rawProjectPath: string, instanceId: string, content: string, replyToRequestId?: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const message = loopInboxMessageSchema.parse({
    id: uuidv4(),
    role: 'user',
    content,
    timestamp: Date.now(),
    replyToRequestId
  });
  await fs.ensureDir(getLoopInstanceDir(projectPath, instanceId));
  await fs.appendFile(getLoopInboxPath(projectPath, instanceId), `${JSON.stringify(message)}\n`);
  await appendLoopMessage(projectPath, instanceId, {
    role: 'user',
    kind: 'text',
    content,
    replyToRequestId
  });
  return message;
};
