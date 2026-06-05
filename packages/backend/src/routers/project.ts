import { z } from 'zod';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import type { Dirent } from 'fs';
import { fileURLToPath } from 'url';
import { observable } from '@trpc/server/observable';
import type { Aim, Phase, ProjectMeta } from 'shared';
import { INITIAL_STATES, cosineSimilarity } from 'shared';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';

const agentTypeSchema = z.enum(['claude', 'gemini', 'codex', 'agy']);
const watchdogRuntimeAgentStateSchema = z.object({
  enabled: z.boolean().default(false),
  emergencyStopped: z.boolean().default(false),
  stopReason: z.string().nullable().default(null),
  updatedAt: z.number().default(0)
});
const watchdogRuntimeStateSchema = z.object({
  updatedAt: z.number().default(0),
  preferredAgentType: agentTypeSchema.nullable().optional(),
  agents: z.record(z.string(), watchdogRuntimeAgentStateSchema).default({})
});
const autonomyPolicySchema = z.object({
  version: z.number().default(1),
  autonomyMode: z.enum(['manual', 'supervised', 'autonomous']).default('supervised'),
  preferredAgentType: agentTypeSchema.nullable().default(null),
  sessionLeaseMinutes: z.number().int().positive().default(60),
  autoConnectToExistingSession: z.boolean().default(true),
  restoreSupervisorStateOnSessionRestart: z.boolean().default(true),
  requireCommitBeforeCompact: z.boolean().default(true),
  askForHumanOn: z.array(z.string()).default(['destructive-git', 'network', 'api-keys'])
});

const projectDiscoveryInputSchema = z.object({
  roots: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(0).max(6).optional()
});

const DISCOVERY_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo'
]);

const CURRENT_PHASE_DATA_MODEL_VERSION = 2;

type ConsistencyIssueCode =
  | 'aim_nonexistent_phase'
  | 'aim_missing_phase_commitment'
  | 'phase_nonexistent_aim'
  | 'phase_missing_aim_committed_in'
  | 'aim_nonexistent_child'
  | 'aim_missing_child_supported_aim'
  | 'aim_nonexistent_parent'
  | 'aim_missing_parent_supporting_connection'
  | 'orphaned_embedding'
  | 'legacy';

type ConsistencyIssue = {
  code: ConsistencyIssueCode;
  message: string;
  suggestedAction: string;
};

const CONSISTENCY_ACTIONS: Record<ConsistencyIssueCode, string> = {
  aim_nonexistent_phase: 'Remove invalid phase link',
  aim_missing_phase_commitment: 'Add to phase commitments',
  phase_nonexistent_aim: 'Remove invalid aim commitment',
  phase_missing_aim_committed_in: 'Add to aim committedIn',
  aim_nonexistent_child: 'Remove invalid child link',
  aim_missing_child_supported_aim: 'Sync bidirectional link',
  aim_nonexistent_parent: 'Remove invalid parent link',
  aim_missing_parent_supporting_connection: 'Sync bidirectional link',
  orphaned_embedding: 'Delete orphaned embedding',
  legacy: 'Auto-fix'
};

function createConsistencyIssue(code: ConsistencyIssueCode, message: string): ConsistencyIssue {
  return {
    code,
    message,
    suggestedAction: CONSISTENCY_ACTIONS[code]
  };
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await fs.writeJson(tempPath, data, { spaces: 2 });
  await fs.move(tempPath, filePath, { overwrite: true });
}

export const createProjectRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  normalizeProjectPath: (p: string) => string,
  ensureProjectStructure: (projectPath: string) => Promise<void>,
  listAims: (projectPath: string, archived?: boolean) => Promise<Aim[]>,
  listPhases: (projectPath: string, parentPhaseId?: string | null) => Promise<Phase[]>,
  writeAim: (projectPath: string, aim: Aim) => Promise<void>,
  indexAims: (projectPath: string, aims: Aim[]) => void,
  indexPhases: (projectPath: string, phases: Phase[]) => void,
  loadVectorStore: (projectPath: string) => Promise<Record<string, any>>,
  hasCurrentEmbedding: (value: unknown) => boolean,
  generateEmbedding: (text: string) => Promise<number[] | null>,
  saveEmbedding: (projectPath: string, aimId: string, vector: number[]) => Promise<void>,
  removeEmbedding: (projectPath: string, aimId: string) => Promise<void>,
  migrateCommittedInField: (projectPath: string) => Promise<void>,
  cleanupCommitments: (projectPath: string, specificPhaseId?: string) => Promise<number>,
  getDb: (projectPath: string) => any,
  readAim: (projectPath: string, aimId: string) => Promise<Aim>,
  writePhase: (projectPath: string, phase: Phase) => Promise<void>,
  ee: any
) => {
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

  const getDefaultDiscoveryRoots = () => {
    const cwd = path.resolve(process.cwd());
    const parent = path.dirname(cwd);
    return Array.from(new Set([cwd, parent, os.homedir()].filter(Boolean)));
  };

  const discoverProjectsFromRoot = async (
    root: string,
    maxDepth: number,
    seenProjectRoots: Set<string>,
    results: Array<{ path: string, bowmanPath: string, sourceRoot: string }>
  ) => {
    const visit = async (dirPath: string, depth: number): Promise<void> => {
      if (depth > maxDepth || results.length >= 50) return;

      let entries: Dirent[];
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      const hasBowmanDir = entries.some((entry) => entry.isDirectory() && entry.name === '.bowman');
      if (hasBowmanDir && !seenProjectRoots.has(dirPath)) {
        seenProjectRoots.add(dirPath);
        results.push({
          path: dirPath,
          bowmanPath: path.join(dirPath, '.bowman'),
          sourceRoot: root
        });
      }

      if (depth === maxDepth) return;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '.bowman' || DISCOVERY_IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && depth > 0) continue;

        await visit(path.join(dirPath, entry.name), depth + 1);
        if (results.length >= 50) return;
      }
    };

    await visit(root, 0);
  };

  return t.router({
    onUpdate: t.procedure.subscription(() => {
      return observable<{ type: string, id: string, projectPath: string }>((emit) => {
        const onChange = (data: any) => emit.next(data);
        ee.on('change', onChange);
        return () => ee.off('change', onChange);
      });
    }),

    getMeta: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }: any) => {
        const projectPath = normalizeProjectPath(input.projectPath);
        const metaPath = path.join(projectPath, 'meta.json');

        let meta: ProjectMeta;

        if (await fs.pathExists(metaPath)) {
          meta = await fs.readJson(metaPath);
          // Merge defaults if missing properties (like statuses)
          if (!meta.statuses) {
              meta.statuses = INITIAL_STATES;
          }
          if (meta.dataModelVersion === undefined) {
              meta.dataModelVersion = 1;
          }
          if (!meta.phaseCursors) {
              meta.phaseCursors = {};
          }
          if (meta.phaseActiveLevel === undefined) {
              meta.phaseActiveLevel = 0;
          }
          if (!meta.rootPhaseIds) {
              meta.rootPhaseIds = [];
          }
          return meta;
        }

        // Initialize with defaults if missing
        const parentDir = path.dirname(projectPath);
        const name = path.basename(parentDir) || 'Project';

        meta = {
            name,
            color: '#007acc',
            statuses: INITIAL_STATES,
            dataModelVersion: CURRENT_PHASE_DATA_MODEL_VERSION,
            phaseCursors: {},
            phaseActiveLevel: 0,
            rootPhaseIds: []
        };

        try {
            await ensureProjectStructure(projectPath);
            await writeJsonAtomic(metaPath, meta);
        } catch (e) {
            console.error("Failed to initialize meta.json", e);
        }

        return meta;
      }),

    getWatchdogRuntimeState: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }: any) => {
        return readWatchdogRuntimeState(input.projectPath);
      }),

    updateWatchdogRuntimeState: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        preferredAgentType: agentTypeSchema.nullable().optional(),
        agentState: z.object({
          agentType: agentTypeSchema,
          enabled: z.boolean().optional(),
          emergencyStopped: z.boolean().optional(),
          stopReason: z.string().nullable().optional()
        }).optional()
      }))
      .mutation(async ({ input }: any) => {
        const agentType = input.agentState?.agentType as z.infer<typeof agentTypeSchema> | undefined;
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
          nextState.agents[agentType] = {
            enabled: input.agentState.enabled ?? currentAgentState.enabled,
            emergencyStopped: input.agentState.emergencyStopped ?? currentAgentState.emergencyStopped,
            stopReason: input.agentState.stopReason !== undefined
              ? input.agentState.stopReason
              : currentAgentState.stopReason,
            updatedAt: Date.now()
          };
        }

        const parsed = watchdogRuntimeStateSchema.parse(nextState);
        await writeWatchdogRuntimeState(input.projectPath, parsed);
        return parsed;
      }),

    getAutonomyPolicy: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }: any) => {
        return readAutonomyPolicy(input.projectPath);
      }),

    updateAutonomyPolicy: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        policy: autonomyPolicySchema.partial()
      }))
      .mutation(async ({ input }: any) => {
        const existing = await readAutonomyPolicy(input.projectPath);
        const merged = autonomyPolicySchema.parse({
          ...existing,
          ...input.policy
        });
        await writeAutonomyPolicy(input.projectPath, merged);
        return merged;
      }),

    discoverLocalProjects: delayedProcedure
      .input(projectDiscoveryInputSchema.optional())
      .query(async ({ input }: any) => {
        const roots: string[] = Array.from(
          new Set((input?.roots?.length ? input.roots : getDefaultDiscoveryRoots()).map((root: string) => path.resolve(root)))
        );
        const maxDepth = input?.maxDepth ?? 2;
        const seenProjectRoots = new Set<string>();
        const projects: Array<{ path: string, bowmanPath: string, sourceRoot: string }> = [];

        for (const root of roots) {
          await discoverProjectsFromRoot(root, maxDepth, seenProjectRoots, projects);
        }

        projects.sort((left, right) => left.path.localeCompare(right.path));

        return {
          rootsScanned: roots,
          projects
        };
      }),

    buildSearchIndex: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }: any) => {
        const aims = await listAims(input.projectPath);
        const phases = await listPhases(input.projectPath);

        indexAims(input.projectPath, aims);
        indexPhases(input.projectPath, phases);

        // Background embedding generation
        if (process.env.NODE_ENV !== 'test') {
          (async () => {
              const vectorStore = await loadVectorStore(input.projectPath);
              const aimsToEmbed = aims.filter((aim: Aim) => !hasCurrentEmbedding(vectorStore[aim.id]));

              if (aimsToEmbed.length > 0) {
                  console.log(`Starting embedding generation for ${aimsToEmbed.length} aims (skipped ${aims.length - aimsToEmbed.length} existing)...`);
                  for (const aim of aimsToEmbed) {
                      const vector = await generateEmbedding(aim.text);
                      if (vector) {
                          await saveEmbedding(input.projectPath, aim.id, vector);
                      }
                  }
                  console.log('Embedding generation complete.');
              } else {
                  console.log(`Embeddings up to date (checked ${aims.length} aims).`);
              }
          })().catch(console.error);
        }

        return {
          success: true,
          indexed: {
            aims: aims.length,
            phases: phases.length
          }
        };
      }),

    updateMeta: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        meta: z.object({
          name: z.string(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          statuses: z.array(z.any()).optional(),
          dataModelVersion: z.number().int().positive().optional(),
          phaseCursors: z.record(z.string(), z.string()).optional(),
          phaseActiveLevel: z.number().int().min(0).optional(),
          rootPhaseIds: z.array(z.string()).optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const projectPath = normalizeProjectPath(input.projectPath);
        await ensureProjectStructure(projectPath);
        const metaPath = path.join(projectPath, 'meta.json');
        const nextMeta = {
          ...input.meta,
          dataModelVersion: input.meta.dataModelVersion ?? CURRENT_PHASE_DATA_MODEL_VERSION
        };
        await writeJsonAtomic(metaPath, nextMeta);
        return nextMeta;
      }),

    injectAgentInstructions: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }: any) => {
        const projectPath = normalizeProjectPath(input.projectPath);
        const rootDir = path.dirname(projectPath); // Project root (above .bowman)

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const instructionsPath = path.join(__dirname, '../agent-instruction.md');

        if (!(await fs.pathExists(instructionsPath))) {
            throw new Error(`Agent instructions file not found at ${instructionsPath}`);
        }

        const agentInstructions = await fs.readFile(instructionsPath, 'utf-8');

        const geminiConfig = path.join(rootDir, '.gemini/GEMINI.md');
        const claudeConfig = path.join(rootDir, 'CLAUDE.md');
        const cursorConfig = path.join(rootDir, '.cursorrules');

        const results: string[] = [];

        async function inject(filePath: string, name: string) {
            try {
                if (await fs.pathExists(filePath)) {
                    let content = await fs.readFile(filePath, 'utf-8');
                    const markerStart = '--- Context from: Aimparency ---';
                    const markerEnd = '--- End of Context from: Aimparency ---';
                    const block = `\n${markerStart}\n${agentInstructions}\n${markerEnd}\n`;

                    const regex = new RegExp(`${markerStart.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[\\s\\S]*?${markerEnd.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`, 'g');

                    if (regex.test(content)) {
                        content = content.replace(regex, block.trim());
                        results.push(`Updated ${name}`);
                    } else {
                        content += block;
                        results.push(`Appended to ${name}`);
                    }
                    await fs.writeFile(filePath, content, 'utf-8');
                }
            } catch (e: any) {
                results.push(`Failed to update ${name}: ${e.message}`);
            }
        }

        await inject(geminiConfig, 'GEMINI.md');
        await inject(claudeConfig, 'CLAUDE.md');
        await inject(cursorConfig, '.cursorrules');

        return { results };
      }),

    migrateCommittedIn: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }: any) => {
        await migrateCommittedInField(input.projectPath);
        return { success: true };
      }),

    migrateTags: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }: any) => {
        const aims = await listAims(input.projectPath);
        for (const aim of aims) {
          if (!aim.tags) {
            aim.tags = [];
            await writeAim(input.projectPath, aim);
          }
        }
        return { success: true };
      }),

    migrateIncoming: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }: any) => {
        const aims = await listAims(input.projectPath);
        let count = 0;
        for (const aim of aims) {
          const anyAim = aim as any;
          if (anyAim.incoming && Array.isArray(anyAim.incoming)) {
             if (!aim.supportingConnections) aim.supportingConnections = [];
             for (const id of anyAim.incoming) {
                if (!aim.supportingConnections.some((c: any) => c.aimId === id)) {
                    aim.supportingConnections.push({ aimId: id, relativePosition: [0, 0], weight: 1 });
                }
             }
             delete anyAim.incoming;
             await writeAim(input.projectPath, aim);
             count++;
          }
        }
        return { success: true, migrated: count };
      }),

    repair: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }: any) => {
        const count = await cleanupCommitments(input.projectPath);
        return { fixedAims: count };
      }),

    checkConsistency: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }: any) => {
        const aims = await listAims(input.projectPath);
        const phases = await listPhases(input.projectPath);
        const issues: ConsistencyIssue[] = [];

        const aimMap = new Map(aims.map((a: Aim) => [a.id, a]));
        const phaseMap = new Map(phases.map((p: Phase) => [p.id, p]));

        // Check 1: Aim <-> Phase consistency
        for (const aim of aims) {
          for (const phaseId of aim.committedIn) {
            if (!phaseMap.has(phaseId)) {
              issues.push(createConsistencyIssue(
                'aim_nonexistent_phase',
                `Aim ${aim.id} claims to be committed in non-existent phase ${phaseId}`
              ));
            } else {
              const phase = phaseMap.get(phaseId)!;
              if (!phase.commitments.includes(aim.id)) {
                issues.push(createConsistencyIssue(
                  'aim_missing_phase_commitment',
                  `Aim ${aim.id} says committed in Phase ${phaseId}, but Phase does not have it in commitments`
                ));
              }
            }
          }
        }

        for (const phase of phases) {
          for (const aimId of phase.commitments) {
            if (!aimMap.has(aimId)) {
              issues.push(createConsistencyIssue(
                'phase_nonexistent_aim',
                `Phase ${phase.id} commits to non-existent aim ${aimId}`
              ));
            } else {
              const aim = aimMap.get(aimId)!;
              if (!aim.committedIn.includes(phase.id)) {
                issues.push(createConsistencyIssue(
                  'phase_missing_aim_committed_in',
                  `Phase ${phase.id} commits to Aim ${aimId}, but Aim does not say committed in Phase`
                ));
              }
            }
          }
        }

        // Check 2: Aim <-> Aim consistency (supportingConnections/supportedAims)
        for (const aim of aims) {
          // supportingConnections (Children)
          if (aim.supportingConnections) {
            for (const conn of aim.supportingConnections) {
                const childId = conn.aimId;
                if (!aimMap.has(childId)) {
                issues.push(createConsistencyIssue(
                  'aim_nonexistent_child',
                  `Aim ${aim.id} has non-existent supporting connection (child) ${childId}`
                ));
                } else {
                const child = aimMap.get(childId)!;
                if (!child.supportedAims.includes(aim.id)) {
                    issues.push(createConsistencyIssue(
                      'aim_missing_child_supported_aim',
                      `Aim ${aim.id} lists ${childId} as supporting, but ${childId} does not list ${aim.id} as supportedAims`
                    ));
                }
                }
            }
          }

          // supportedAims (Parents)
          for (const parentId of aim.supportedAims) {
            if (!aimMap.has(parentId)) {
              issues.push(createConsistencyIssue(
                'aim_nonexistent_parent',
                `Aim ${aim.id} has non-existent supportedAims (parent) ${parentId}`
              ));
            } else {
              const parent = aimMap.get(parentId)!;
              const parentHasConnection = parent.supportingConnections?.some((c: any) => c.aimId === aim.id);
              if (!parentHasConnection) {
                issues.push(createConsistencyIssue(
                  'aim_missing_parent_supporting_connection',
                  `Aim ${aim.id} lists ${parentId} as supportedAims, but ${parentId} does not list ${aim.id} in supportingConnections`
                ));
              }
            }
          }
        }

        // Check 4: Embeddings consistency
        const vectorStore = await loadVectorStore(input.projectPath);
        for (const aimId of Object.keys(vectorStore)) {
            if (!aimMap.has(aimId)) {
                issues.push(createConsistencyIssue(
                  'orphaned_embedding',
                  `Orphaned embedding found for Aim ${aimId}`
                ));
            }
        }

        return { valid: issues.length === 0, errors: issues.map((issue) => issue.message), issues };
      }),

    fixConsistency: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }: any) => {
        const aims = await listAims(input.projectPath);
        const phases = await listPhases(input.projectPath);
        const fixes: string[] = [];

        const aimMap = new Map(aims.map((a: Aim) => [a.id, a]));
        const phaseMap = new Map(phases.map((p: Phase) => [p.id, p]));

        // Fix 1: Aim <-> Phase consistency
        for (const aim of aims) {
          const originalCommittedIn = [...aim.committedIn];
          aim.committedIn = aim.committedIn.filter((phaseId: string) => {
            const phase = phaseMap.get(phaseId);
            if (!phase) {
              fixes.push(`Removed non-existent phase ${phaseId} from Aim ${aim.id}`);
              return false;
            }
            if (!phase.commitments.includes(aim.id)) {
              fixes.push(`Removed phase ${phaseId} from Aim ${aim.id} (not in phase commitments)`);
              return false;
            }
            return true;
          });

          if (aim.committedIn.length !== originalCommittedIn.length) {
            await writeAim(input.projectPath, aim);
          }
        }

        for (const phase of phases) {
          const validCommitments = [];
          for (const aimId of phase.commitments) {
            const aim = aimMap.get(aimId);
            if (!aim) {
              fixes.push(`Removed non-existent aim ${aimId} from Phase ${phase.id}`);
              continue;
            }
            validCommitments.push(aimId);

            if (!aim.committedIn.includes(phase.id)) {
              aim.committedIn.push(phase.id);
              await writeAim(input.projectPath, aim);
              fixes.push(`Added phase ${phase.id} to Aim ${aim.id}`);
            }
          }

          if (validCommitments.length !== phase.commitments.length) {
            phase.commitments = validCommitments;
            await writePhase(input.projectPath, phase);
          }
        }

        // Fix 2: Aim <-> Aim consistency
        for (const aim of aims) {
          // supportingConnections (Children)
          if (aim.supportingConnections) {
            const validConnections = [];
            for (const conn of aim.supportingConnections) {
                const childId = conn.aimId;
                const child = aimMap.get(childId);
                if (!child) {
                fixes.push(`Removed non-existent child ${childId} from Aim ${aim.id}`);
                continue;
                }
                validConnections.push(conn);

                if (!child.supportedAims.includes(aim.id)) {
                child.supportedAims.push(aim.id);
                await writeAim(input.projectPath, child);
                fixes.push(`Added supportedAims parent ${aim.id} to Child ${child.id}`);
                }
            }
            if (validConnections.length !== aim.supportingConnections.length) {
                aim.supportingConnections = validConnections;
                await writeAim(input.projectPath, aim);
            }
          }

          // supportedAims (Parents)
          const validSupportedAims = [];
          for (const parentId of aim.supportedAims) {
            const parent = aimMap.get(parentId);
            if (!parent) {
              fixes.push(`Removed non-existent parent ${parentId} from Aim ${aim.id}`);
              continue;
            }
            validSupportedAims.push(parentId);

            if (!parent.supportingConnections) parent.supportingConnections = [];
            if (!parent.supportingConnections.some((c: any) => c.aimId === aim.id)) {
              parent.supportingConnections.push({ aimId: aim.id, relativePosition: [0,0], weight: 1 });
              await writeAim(input.projectPath, parent);
              fixes.push(`Added supporting connection ${aim.id} to Parent ${parent.id}`);
            }
          }
          if (validSupportedAims.length !== aim.supportedAims.length) {
            aim.supportedAims = validSupportedAims;
            await writeAim(input.projectPath, aim);
          }
        }

        // Fix 3: Phase parent consistency
        for (const phase of phases) {
          if (phase.parent) {
            if (!phaseMap.has(phase.parent)) {
              fixes.push(`Removed non-existent parent phase ${phase.parent} from Phase ${phase.id}`);
              phase.parent = null;
              await writePhase(input.projectPath, phase);
            }
          }
        }

        // Fix 4: Embeddings consistency
        const vectorStore = await loadVectorStore(input.projectPath);
        for (const aimId of Object.keys(vectorStore)) {
            if (!aimMap.has(aimId)) {
                await removeEmbedding(input.projectPath, aimId);
                fixes.push(`Removed orphaned embedding for Aim ${aimId}`);
            }
        }

        // Fix 5: Cache consistency (aim_values)
        try {
            const db = getDb(input.projectPath);
            const validIds = Array.from(aimMap.keys());
            if (validIds.length > 0) {
                const placeholders = validIds.map(() => '?').join(',');
                const info = db.prepare(`DELETE FROM aim_values WHERE id NOT IN (${placeholders})`).run(...validIds);
                if (info.changes > 0) {
                    fixes.push(`Removed ${info.changes} orphaned entries from aim_values cache`);
                }
            } else {
                // No aims, clear cache
                const info = db.prepare('DELETE FROM aim_values').run();
                if (info.changes > 0) {
                    fixes.push(`Cleared ${info.changes} entries from aim_values cache (no valid aims)`);
                }
            }
        } catch (e) {
            console.error('Failed to clean aim_values cache:', e);
            fixes.push('Failed to clean aim_values cache (see logs)');
        }

        return { success: true, fixes };
      }),

    // Read-only duplicate report: loads all vectors in one pass, computes
    // all-pairs cosine similarity, returns pairs above `threshold` ranked by score.
    // Use merge_aims to act on the results.
    findDuplicates: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        threshold: z.number().min(0).max(1).optional(), // default 0.90
        limit: z.number().int().positive().optional(),   // default 50
      }))
      .query(async ({ input }: any) => {
        const threshold = input.threshold ?? 0.90;
        const limit = input.limit ?? 50;

        const [aims, vectorStore] = await Promise.all([
          listAims(input.projectPath),
          loadVectorStore(input.projectPath),
        ]);

        const aimMap = new Map<string, Aim>(aims.map((a: Aim) => [a.id, a]));

        // Build indexed list of (aimId, vector) for active aims only
        const indexed: Array<{ id: string; vector: number[] }> = [];
        for (const [id, vector] of Object.entries(vectorStore)) {
          if (Array.isArray(vector) && vector.length > 0 && aimMap.has(id)) {
            indexed.push({ id, vector: vector as number[] });
          }
        }

        const pairs: Array<{
          scoreRaw: number;
          score: string;
          aId: string;
          aText: string;
          bId: string;
          bText: string;
        }> = [];

        // All-pairs O(n²/2): ~100k comparisons for 450 aims, negligible
        for (let i = 0; i < indexed.length; i++) {
          const a = indexed[i]!;
          for (let j = i + 1; j < indexed.length; j++) {
            const b = indexed[j]!;
            if (a.vector.length !== b.vector.length) continue;
            const score = cosineSimilarity(a.vector, b.vector);
            if (score >= threshold) {
              const aimA = aimMap.get(a.id)!;
              const aimB = aimMap.get(b.id)!;
              pairs.push({
                scoreRaw: score,
                score: score.toFixed(4),
                aId: a.id,
                aText: aimA.text,
                bId: b.id,
                bText: aimB.text,
              });
            }
          }
        }

        pairs.sort((a, b) => b.scoreRaw - a.scoreRaw);
        const topPairs = pairs.slice(0, limit).map(({ scoreRaw: _, ...rest }) => rest);

        return {
          threshold,
          totalIndexed: indexed.length,
          totalAims: aims.length,
          unindexed: aims.length - indexed.length,
          pairsFound: pairs.length,
          pairs: topPairs,
          note: indexed.length === 0
            ? 'No embeddings found. Run build_search_index first.'
            : pairs.length === 0
              ? `No pairs above threshold ${threshold}. Try lowering it.`
              : undefined,
        };
      }),

    // Read-only reparent suggestions: for each leaf child of a vague catch-all parent,
    // suggest the closest structural sub-parent (by embedding cosine) to move it under.
    // Candidate sub-parents default to the catch-all's children that are themselves
    // parents; pass candidateParentIds to override. Apply via merge/move tooling — this
    // is an approve-a-list report, it changes nothing.
    suggestReparents: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentAimId: z.string(),                              // the catch-all parent
        candidateParentIds: z.array(z.string()).optional(),   // override structural sub-parents
        limit: z.number().int().positive().optional(),        // default 200
      }))
      .query(async ({ input }: any) => {
        const limit = input.limit ?? 200;
        const [aims, vectorStore] = await Promise.all([
          listAims(input.projectPath),
          loadVectorStore(input.projectPath),
        ]);
        const aimMap = new Map<string, Aim>(aims.map((a: Aim) => [a.id, a]));
        const catchAll = aimMap.get(input.parentAimId);
        if (!catchAll) {
          return { error: `Catch-all parent ${input.parentAimId} not found.` };
        }

        const vecOf = (id: string): number[] | undefined => {
          const v = vectorStore[id];
          return Array.isArray(v) && v.length > 0 ? (v as number[]) : undefined;
        };

        // Direct children of the catch-all = aims that support it.
        const childIds: string[] = (catchAll.supportingConnections ?? [])
          .map((c: any) => c.aimId)
          .filter((id: string) => aimMap.has(id));

        const isParent = (id: string) => (aimMap.get(id)?.supportingConnections?.length ?? 0) > 0;

        // Candidate sub-parents: explicit, else the catch-all's children that are parents.
        const candidateIds: string[] = (input.candidateParentIds ?? childIds.filter(isParent))
          .filter((id: string) => aimMap.has(id));

        // A candidate's "meaning" is best represented by what it already contains: the
        // centroid of its children's embeddings. Fall back to its own title embedding
        // when it has no embedded children.
        const candidates = candidateIds.map((id: string) => {
          const childVecs = (aimMap.get(id)?.supportingConnections ?? [])
            .map((c: any) => vecOf(c.aimId))
            .filter((v: any): v is number[] => !!v);
          let vector: number[] | undefined;
          if (childVecs.length > 0) {
            const dim = childVecs[0].length;
            vector = new Array(dim).fill(0);
            for (const v of childVecs) for (let i = 0; i < dim; i++) vector[i] += v[i] / childVecs.length;
          } else {
            vector = vecOf(id);
          }
          return { id, text: aimMap.get(id)!.text, vector };
        }).filter((c: any) => c.vector) as Array<{ id: string; text: string; vector: number[] }>;

        const candidateSet = new Set(candidateIds);
        const leafIds = childIds.filter((id: string) => !candidateSet.has(id));

        const suggestions: any[] = [];
        let unembeddedLeaves = 0;
        for (const leafId of leafIds) {
          const lv = vecOf(leafId);
          if (!lv) { unembeddedLeaves++; continue; }
          let best: { id: string; text: string; score: number } | undefined;
          let runnerUp: { id: string; text: string; score: number } | undefined;
          for (const cand of candidates) {
            if (cand.id === leafId || cand.vector.length !== lv.length) continue;
            const score = cosineSimilarity(lv, cand.vector);
            if (!best || score > best.score) { runnerUp = best; best = { id: cand.id, text: cand.text, score }; }
            else if (!runnerUp || score > runnerUp.score) { runnerUp = { id: cand.id, text: cand.text, score }; }
          }
          if (best) {
            suggestions.push({
              scoreRaw: best.score,
              leafId,
              leafText: aimMap.get(leafId)!.text,
              suggestedParentId: best.id,
              suggestedParentText: best.text,
              score: best.score.toFixed(4),
              margin: runnerUp ? (best.score - runnerUp.score).toFixed(4) : undefined,
              runnerUpId: runnerUp?.id,
              runnerUpText: runnerUp?.text,
            });
          }
        }

        suggestions.sort((a, b) => b.scoreRaw - a.scoreRaw);
        const top = suggestions.slice(0, limit).map(({ scoreRaw: _, ...rest }) => rest);

        return {
          catchAllParent: { id: catchAll.id, text: catchAll.text },
          candidateParents: candidates.map((c) => ({ id: c.id, text: c.text })),
          totalChildren: childIds.length,
          leafCount: leafIds.length,
          unembeddedLeaves,
          suggestionsCount: suggestions.length,
          suggestions: top,
          note: candidates.length === 0
            ? 'No candidate structural sub-parents found. Pass candidateParentIds, or ensure the catch-all has sub-parent children with embeddings (run build_search_index).'
            : suggestions.length === 0
              ? 'No leaf children to reparent (or none embedded). Run build_search_index first.'
              : undefined,
        };
      }),

    // Read-only graph-hygiene dashboard: surfaces where the aim graph needs maintenance —
    // floating aims, mega-parents (catch-all smell), stale cancelled/failed/human-dependent
    // aims, collapse candidates (parents whose active children are all done), and
    // duplicate clusters. Changes nothing; pairs with merge_aims / suggest_reparents / archiving.
    graphHygiene: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        megaParentThreshold: z.number().int().positive().optional(), // default 25
        duplicateThreshold: z.number().min(0).max(1).optional(),     // default 0.93
        limit: z.number().int().positive().optional(),               // per-section cap, default 30
      }))
      .query(async ({ input }: any) => {
        const megaParentThreshold = input.megaParentThreshold ?? 25;
        const duplicateThreshold = input.duplicateThreshold ?? 0.93;
        const limit = input.limit ?? 30;

        const [aims, vectorStore] = await Promise.all([
          listAims(input.projectPath),
          loadVectorStore(input.projectPath),
        ]);
        const aimMap = new Map<string, Aim>(aims.map((a: Aim) => [a.id, a]));
        const active = aims.filter((a: Aim) => !a.archived);

        const childIdsOf = (a: Aim): string[] =>
          (a.supportingConnections ?? []).map((c: any) => c.aimId).filter((id: string) => aimMap.has(id));

        // 1. Floating: no parents and not committed to any phase.
        const floating = active
          .filter((a: Aim) => (a.supportedAims?.length ?? 0) === 0 && (a.committedIn?.length ?? 0) === 0)
          .map((a: Aim) => ({ id: a.id, text: a.text, status: a.status.state }));

        // 2. Mega-parents: too many direct children (catch-all smell).
        const megaParents = active
          .map((a: Aim) => ({ a, n: childIdsOf(a).length }))
          .filter((x) => x.n >= megaParentThreshold)
          .sort((x, y) => y.n - x.n)
          .map((x) => ({ id: x.a.id, text: x.a.text, directChildren: x.n }));

        // 3. Stale-status: cancelled/failed/human-dependent but not archived (clutter).
        const staleStates = new Set(['cancelled', 'failed', 'human-dependent']);
        const staleStatus = active
          .filter((a: Aim) => staleStates.has(a.status.state))
          .map((a: Aim) => ({ id: a.id, text: a.text, status: a.status.state }));

        // 4. Collapse candidates: parents whose active children are ALL done.
        const collapseCandidates = active
          .map((a: Aim) => {
            const kids = childIdsOf(a).map((id) => aimMap.get(id)!).filter((k) => !k.archived);
            const done = kids.filter((k) => k.status.state === 'done').length;
            return { a, total: kids.length, done };
          })
          .filter((x) => x.total > 0 && x.done === x.total)
          .map((x) => ({ id: x.a.id, text: x.a.text, doneChildren: x.done, totalChildren: x.total }));

        // 5. Duplicate clusters: all-pairs cosine above threshold, grouped via union-find.
        const indexedIds = active
          .map((a: Aim) => a.id)
          .filter((id: string) => Array.isArray(vectorStore[id]) && (vectorStore[id] as number[]).length > 0);
        const uf = new Map<string, string>(indexedIds.map((id: string) => [id, id]));
        const find = (x: string): string => {
          let r = x;
          while (uf.get(r) !== r) r = uf.get(r)!;
          while (uf.get(x) !== r) { const nx = uf.get(x)!; uf.set(x, r); x = nx; }
          return r;
        };
        for (let i = 0; i < indexedIds.length; i++) {
          const vi = vectorStore[indexedIds[i]!] as number[];
          for (let j = i + 1; j < indexedIds.length; j++) {
            const vj = vectorStore[indexedIds[j]!] as number[];
            if (vi.length !== vj.length) continue;
            if (cosineSimilarity(vi, vj) >= duplicateThreshold) {
              const ri = find(indexedIds[i]!), rj = find(indexedIds[j]!);
              if (ri !== rj) uf.set(ri, rj);
            }
          }
        }
        const clusterMap = new Map<string, string[]>();
        for (const id of indexedIds) {
          const r = find(id);
          (clusterMap.get(r) ?? clusterMap.set(r, []).get(r)!).push(id);
        }
        const duplicateClusters = [...clusterMap.values()]
          .filter((c) => c.length > 1)
          .sort((a, b) => b.length - a.length)
          .map((c) => c.map((id) => ({ id, text: aimMap.get(id)!.text })));

        const section = <T>(items: T[]) => ({ count: items.length, items: items.slice(0, limit) });

        return {
          totalAims: aims.length,
          activeAims: active.length,
          thresholds: { megaParentThreshold, duplicateThreshold },
          floating: section(floating),
          megaParents: section(megaParents),
          staleStatus: section(staleStatus),
          collapseCandidates: section(collapseCandidates),
          duplicateClusters: section(duplicateClusters),
        };
      })
  });
};
