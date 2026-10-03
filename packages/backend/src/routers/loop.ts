import { z } from 'zod';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { normalizeProjectPath } from '../project-path.js';
import { t, delayedProcedure } from '../trpc.js';
import {
  loopProviderSchema,
  loopCapabilitySchema,
  loopConfigSchema,
  pickDefaultLoopTarget,
  readLoopSecrets,
  writeLoopSecrets,
  readLoopConfig,
  writeLoopConfig,
  readLoopRuntimeState,
  mutateLoopRuntimeState,
  getLoopInstanceDir,
  killLoopWorker,
  refreshLoopProcessStates,
  spawnLoopWorker,
  enqueueLoopHumanMessage,
} from '../loop-runtime.js';

export const loopRouter = t.router({
  getConfig: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      const [config, secrets] = await Promise.all([
        readLoopConfig(input.projectPath),
        readLoopSecrets(input.projectPath)
      ]);

      return {
        ...config,
        secretsPresent: {
          NVIDIA_API_KEY: Boolean(secrets.NVIDIA_API_KEY),
          OPENROUTER_API_KEY: Boolean(secrets.OPENROUTER_API_KEY),
          LOOP_API_KEY: Boolean(secrets.LOOP_API_KEY)
        }
      };
    }),

  updateConfig: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      config: loopConfigSchema.partial()
    }))
    .mutation(async ({ input }) => {
      const existing = await readLoopConfig(input.projectPath);
      const parsed = loopConfigSchema.parse({
        ...existing,
        ...input.config
      });
      await writeLoopConfig(input.projectPath, parsed);
      return parsed;
    }),

  updateSecrets: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      secrets: z.object({
        NVIDIA_API_KEY: z.string().optional(),
        OPENROUTER_API_KEY: z.string().optional(),
        LOOP_API_KEY: z.string().optional()
      })
    }))
    .mutation(async ({ input }) => {
      const existing = await readLoopSecrets(input.projectPath);
      const next = { ...existing };
      for (const key of ['NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'LOOP_API_KEY'] as const) {
        if (input.secrets[key] !== undefined) {
          const value = String(input.secrets[key]).trim();
          if (value) next[key] = value;
          else delete next[key];
        }
      }
      await writeLoopSecrets(input.projectPath, next);
      return {
        NVIDIA_API_KEY: Boolean(next.NVIDIA_API_KEY),
        OPENROUTER_API_KEY: Boolean(next.OPENROUTER_API_KEY),
        LOOP_API_KEY: Boolean(next.LOOP_API_KEY)
      };
    }),

  getState: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      return refreshLoopProcessStates(input.projectPath);
    }),

  create: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      name: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      const now = Date.now();
      const loopId = uuidv4();
      return mutateLoopRuntimeState(input.projectPath, (state) => {
        state.loops.push({
          id: loopId,
          name: input.name?.trim() || 'New loop',
          systemPrompt: 'Continuously advance the highest-value mission. Verify real outcomes, record them, and reprioritize.',
          provider: 'nvidia',
          model: 'z-ai/glm-5.2',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          intervalSeconds: 60,
          associationChance: 0.1,
          worktreePath: null,
          capabilities: ['coding', 'experiments', 'code-intelligence'],
          createdAt: now,
          updatedAt: now
        });
        state.selectedLoopId = loopId;
        state.selectedInstanceId = null;
      });
    }),

  update: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      loopId: z.string(),
      name: z.string().optional(),
      systemPrompt: z.string().optional(),
      provider: loopProviderSchema.optional(),
      model: z.string().optional(),
      baseUrl: z.string().optional(),
      intervalSeconds: z.number().int().min(5).max(3600).optional(),
      associationChance: z.number().min(0).max(1).optional(),
      worktreePath: z.string().nullable().optional(),
      capabilities: z.array(loopCapabilitySchema).optional()
    }))
    .mutation(async ({ input }) => {
      const resolvedWorktreePath = input.worktreePath?.trim()
        ? path.resolve(input.worktreePath.trim())
        : null;
      if (resolvedWorktreePath) {
        const stat = await fs.stat(resolvedWorktreePath).catch(() => null);
        if (!stat?.isDirectory()) {
          throw new Error(`Worktree path is not a directory: ${resolvedWorktreePath}`);
        }
        const gitMarker = await fs.stat(path.join(resolvedWorktreePath, '.git')).catch(() => null);
        if (!gitMarker) {
          throw new Error(`Worktree path is not a Git working tree: ${resolvedWorktreePath}`);
        }
      }
      return mutateLoopRuntimeState(input.projectPath, (state) => {
        const loop = state.loops.find((candidate) => candidate.id === input.loopId);
        if (!loop) return;
        if (input.name !== undefined) loop.name = input.name;
        if (input.systemPrompt !== undefined) loop.systemPrompt = input.systemPrompt;
        if (input.provider !== undefined) loop.provider = input.provider;
        if (input.model !== undefined) loop.model = input.model;
        if (input.baseUrl !== undefined) loop.baseUrl = input.baseUrl;
        if (input.intervalSeconds !== undefined) loop.intervalSeconds = input.intervalSeconds;
        if (input.associationChance !== undefined) loop.associationChance = input.associationChance;
        if (input.worktreePath !== undefined) {
          loop.worktreePath = resolvedWorktreePath;
        }
        if (input.capabilities !== undefined) loop.capabilities = input.capabilities;
        loop.updatedAt = Date.now();
      });
    }),

  duplicate: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      loopId: z.string()
    }))
    .mutation(async ({ input }) => {
      const now = Date.now();
      const loopId = uuidv4();
      return mutateLoopRuntimeState(input.projectPath, (state) => {
        const source = state.loops.find((candidate) => candidate.id === input.loopId);
        if (!source) return;
        state.loops.push({
          ...source,
          id: loopId,
          name: `${source.name} (duplicated)`,
          createdAt: now,
          updatedAt: now
        });
        state.selectedLoopId = loopId;
        state.selectedInstanceId = null;
      });
    }),

  delete: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      loopId: z.string()
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      const runtime = await readLoopRuntimeState(projectPath);
      for (const instance of runtime.instances.filter((candidate) => candidate.loopId === input.loopId)) {
        await killLoopWorker(projectPath, instance.id);
      }
      return mutateLoopRuntimeState(projectPath, (state) => {
        state.loops = state.loops.filter((loop) => loop.id !== input.loopId);
        state.instances = state.instances.filter((instance) => instance.loopId !== input.loopId);
        if (state.selectedLoopId === input.loopId) {
          state.selectedLoopId = state.loops[0]?.id ?? null;
          state.selectedInstanceId = null;
        }
      });
    }),

  createInstance: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      loopId: z.string(),
      name: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      const now = Date.now();
      const instanceId = uuidv4();
      const target = await pickDefaultLoopTarget(input.projectPath);
      return mutateLoopRuntimeState(input.projectPath, (state) => {
        state.instances.push({
          id: instanceId,
          loopId: input.loopId,
          name: input.name?.trim() || `Instance ${state.instances.filter((i) => i.loopId === input.loopId).length + 1}`,
          status: 'idle',
          targetPhaseId: target.targetPhaseId,
          targetIdeaId: null,
          stopPolicy: 'never',
          currentActivity: null,
          createdAt: now,
          updatedAt: now,
          messages: []
        });
        state.selectedLoopId = input.loopId;
        state.selectedInstanceId = instanceId;
      });
    }),

  updateInstance: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      instanceId: z.string(),
      name: z.string().optional(),
      targetPhaseId: z.string().nullable().optional(),
      targetIdeaId: z.string().nullable().optional(),
      stopPolicy: z.enum(['target_halted', 'phase_done', 'never', 'asap']).optional()
    }))
    .mutation(async ({ input }) => {
      const defaultTarget = input.targetPhaseId && input.targetIdeaId === undefined
        ? await pickDefaultLoopTarget(input.projectPath, input.targetPhaseId)
        : null;
      return mutateLoopRuntimeState(input.projectPath, (state) => {
        const instance = state.instances.find((candidate) => candidate.id === input.instanceId);
        if (!instance) return;
        if (input.name !== undefined) instance.name = input.name.trim() || instance.name;
        if (input.targetPhaseId !== undefined) {
          instance.targetPhaseId = input.targetPhaseId;
          if (input.targetIdeaId === undefined) instance.targetIdeaId = defaultTarget?.targetIdeaId ?? null;
        }
        if (input.targetIdeaId !== undefined) instance.targetIdeaId = input.targetIdeaId;
        if (input.stopPolicy !== undefined) instance.stopPolicy = input.stopPolicy;
        instance.updatedAt = Date.now();
      });
    }),

  deleteInstance: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      instanceId: z.string()
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      await killLoopWorker(projectPath, input.instanceId);
      return mutateLoopRuntimeState(projectPath, (state) => {
        state.instances = state.instances.filter((instance) => instance.id !== input.instanceId);
        if (state.selectedInstanceId === input.instanceId) {
          state.selectedInstanceId = null;
        }
      });
    }),

  startInstance: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      instanceId: z.string()
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      await mutateLoopRuntimeState(projectPath, (state) => {
        const instance = state.instances.find((candidate) => candidate.id === input.instanceId);
        if (!instance) return;
        instance.status = 'running';
        instance.currentActivity = 'starting';
        instance.updatedAt = Date.now();
      });
      await spawnLoopWorker(projectPath, input.instanceId);
      return refreshLoopProcessStates(projectPath);
    }),

  stopInstance: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      instanceId: z.string()
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      await killLoopWorker(projectPath, input.instanceId);
      return mutateLoopRuntimeState(projectPath, (state) => {
        const instance = state.instances.find((candidate) => candidate.id === input.instanceId);
        if (!instance) return;
        instance.status = 'stopped';
        instance.currentActivity = 'stopped';
        instance.updatedAt = Date.now();
      });
    }),

  restartInstance: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      instanceId: z.string()
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      await killLoopWorker(projectPath, input.instanceId);
      await fs.remove(getLoopInstanceDir(projectPath, input.instanceId));
      await mutateLoopRuntimeState(projectPath, (state) => {
        const instance = state.instances.find((candidate) => candidate.id === input.instanceId);
        if (!instance) return;
        instance.status = 'running';
        instance.currentActivity = 'restarting';
        instance.messages = [];
        instance.updatedAt = Date.now();
      });
      await spawnLoopWorker(projectPath, input.instanceId);
      return refreshLoopProcessStates(projectPath);
    }),

  sendHumanMessage: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      instanceId: z.string(),
      content: z.string().min(1),
      replyToRequestId: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      await enqueueLoopHumanMessage(input.projectPath, input.instanceId, input.content, input.replyToRequestId);
      return refreshLoopProcessStates(input.projectPath);
    })
});
