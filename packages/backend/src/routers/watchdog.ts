import { z } from 'zod';
import fs from 'fs-extra';
import path from 'path';
import {
  mergeWatchdogAgentControlState,
  watchdogAgentTypeSchema,
  watchdogRuntimeAgentStateSchema,
  watchdogRuntimeStateSchema,
} from '../watchdog-runtime-state.js';
import { normalizeProjectPath } from '../project-path.js';
import { ensureProjectStructure } from '../storage/project.js';
import { t, delayedProcedure } from '../trpc.js';

const autonomyPolicySchema = z.object({
  version: z.number().default(1),
  autonomyMode: z.enum(['manual', 'supervised', 'autonomous']).default('supervised'),
  preferredAgentType: watchdogAgentTypeSchema.nullable().default(null),
  sessionLeaseMinutes: z.number().int().positive().default(60),
  autoConnectToExistingSession: z.boolean().default(true),
  restoreSupervisorStateOnSessionRestart: z.boolean().default(true),
  requireCommitBeforeCompact: z.boolean().default(true),
  askForHumanOn: z.array(z.string()).default(['destructive-git', 'network', 'api-keys'])
});

const getWatchdogRuntimeStatePath = (rawProjectPath: string) =>
  path.join(normalizeProjectPath(rawProjectPath), 'runtime', 'watchdog-state.json');
const getAutonomyPolicyPath = (rawProjectPath: string) =>
  path.join(normalizeProjectPath(rawProjectPath), 'runtime', 'autonomy-policy.json');

const readWatchdogRuntimeState = async (rawProjectPath: string) => {
  const statePath = getWatchdogRuntimeStatePath(rawProjectPath);
  if (!(await fs.pathExists(statePath))) {
    return watchdogRuntimeStateSchema.parse({
      updatedAt: 0,
      preferredAgentType: null,
      agents: {}
    });
  }

  try {
    const data = await fs.readJson(statePath);
    return watchdogRuntimeStateSchema.parse(data);
  } catch (error) {
    console.warn(`[ProjectRouter] Failed to read watchdog runtime state for ${rawProjectPath}:`, error);
    return watchdogRuntimeStateSchema.parse({
      updatedAt: 0,
      preferredAgentType: null,
      agents: {}
    });
  }
};

const writeWatchdogRuntimeState = async (rawProjectPath: string, state: z.infer<typeof watchdogRuntimeStateSchema>) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const statePath = getWatchdogRuntimeStatePath(projectPath);
  await fs.writeJson(statePath, state, { spaces: 2 });
};

const readAutonomyPolicy = async (rawProjectPath: string) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const policyPath = getAutonomyPolicyPath(projectPath);
  try {
    const data = await fs.readJson(policyPath);
    return autonomyPolicySchema.parse(data);
  } catch (error) {
    console.warn(`[ProjectRouter] Failed to read autonomy policy for ${rawProjectPath}:`, error);
    const fallback = autonomyPolicySchema.parse({});
    await fs.writeJson(policyPath, fallback, { spaces: 2 });
    return fallback;
  }
};

const writeAutonomyPolicy = async (rawProjectPath: string, policy: z.infer<typeof autonomyPolicySchema>) => {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const policyPath = getAutonomyPolicyPath(projectPath);
  await fs.writeJson(policyPath, policy, { spaces: 2 });
};

export const watchdogRouter = t.router({
  getRuntimeState: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      return readWatchdogRuntimeState(input.projectPath);
    }),

  updateRuntimeState: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      preferredAgentType: watchdogAgentTypeSchema.nullable().optional(),
      agentState: z.object({
        agentType: watchdogAgentTypeSchema,
        enabled: z.boolean().optional(),
        emergencyStopped: z.boolean().optional(),
        stopReason: z.string().nullable().optional()
      }).optional()
    }))
    .mutation(async ({ input }) => {
      const agentType = input.agentState?.agentType as z.infer<typeof watchdogAgentTypeSchema> | undefined;
      const existing = await readWatchdogRuntimeState(input.projectPath);
      const nextState = {
        ...existing,
        updatedAt: Date.now(),
        preferredAgentType: input.preferredAgentType !== undefined
          ? input.preferredAgentType
          : existing.preferredAgentType ?? null,
        agents: { ...existing.agents }
      };

      if (input.agentState && agentType) {
        const currentAgentState = existing.agents[agentType] ?? {
          enabled: false,
          emergencyStopped: false,
          stopReason: null,
          updatedAt: 0
        };
        nextState.agents[agentType] = mergeWatchdogAgentControlState(
          watchdogRuntimeAgentStateSchema.parse(currentAgentState),
          input.agentState,
          Date.now(),
        );
      }

      const parsed = watchdogRuntimeStateSchema.parse(nextState);
      await writeWatchdogRuntimeState(input.projectPath, parsed);
      return parsed;
    }),

  getAutonomyPolicy: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      return readAutonomyPolicy(input.projectPath);
    }),

  updateAutonomyPolicy: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      policy: autonomyPolicySchema.partial()
    }))
    .mutation(async ({ input }) => {
      const existing = await readAutonomyPolicy(input.projectPath);
      const merged = autonomyPolicySchema.parse({
        ...existing,
        ...input.policy
      });
      await writeAutonomyPolicy(input.projectPath, merged);
      return merged;
    })
});
