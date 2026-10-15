import path from 'path';
import { z } from 'zod';
import { toBowmanPath } from './project-path.js';

// On-disk format of background loops, shared by the backend (which manages
// loops) and the loop-worker (which runs one instance):
// .bowman/runtime/loops.json and .bowman/runtime/loop-instances/<id>/.

export const loopProviderSchema = z.enum(['nvidia', 'openrouter', 'openai-compatible']);
export const loopCapabilitySchema = z.enum(['coding', 'experiments', 'code-intelligence']);

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

export const loopInstanceStatusSchema = z.enum(['idle', 'running', 'waiting_for_human', 'waiting_for_external', 'stopped', 'done', 'error']);
export const loopStopPolicySchema = z.enum(['target_halted', 'phase_done', 'never', 'asap']);

export const loopInstanceSchema = z.object({
  id: z.string(),
  loopId: z.string(),
  name: z.string(),
  status: loopInstanceStatusSchema.default('idle'),
  targetPhaseId: z.string().nullable().default(null),
  targetIdeaId: z.string().nullable().default(null),
  stopPolicy: loopStopPolicySchema.default('never'),
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

// The full log lives in events.jsonl; loops.json keeps only the recent tail.
const MAX_INSTANCE_MESSAGES = 500;

export function pushLoopMessage(instance: LoopInstance, message: LoopMessage): void {
  instance.messages.push(message);
  if (instance.messages.length > MAX_INSTANCE_MESSAGES) {
    instance.messages.splice(0, instance.messages.length - MAX_INSTANCE_MESSAGES);
  }
  instance.updatedAt = message.timestamp;
}

const runtimeDir = (projectPath: string) => path.join(toBowmanPath(path.resolve(projectPath)), 'runtime');

export const getLoopRuntimePath = (projectPath: string) => path.join(runtimeDir(projectPath), 'loops.json');
export const getLoopInstanceDir = (projectPath: string, instanceId: string) =>
  path.join(runtimeDir(projectPath), 'loop-instances', instanceId);
export const getLoopWorkerStatePath = (projectPath: string, instanceId: string) =>
  path.join(getLoopInstanceDir(projectPath, instanceId), 'state.json');
export const getLoopEventsPath = (projectPath: string, instanceId: string) =>
  path.join(getLoopInstanceDir(projectPath, instanceId), 'events.jsonl');
export const getLoopInboxPath = (projectPath: string, instanceId: string) =>
  path.join(getLoopInstanceDir(projectPath, instanceId), 'inbox.jsonl');
