import { z } from 'zod';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { observable } from '@trpc/server/observable';
import type { Aim, Phase, ProjectMeta } from 'shared';
import { INITIAL_STATES } from 'shared';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';

const agentTypeSchema = z.enum(['claude', 'gemini', 'codex']);
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
  restoreAnimatorStateOnSessionRestart: z.boolean().default(true),
  requireCommitBeforeCompact: z.boolean().default(true),
  askForHumanOn: z.array(z.string()).default(['destructive-git', 'network', 'api-keys'])
});

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
          return meta;
        }

        // Initialize with defaults if missing
        const parentDir = path.dirname(projectPath);
        const name = path.basename(parentDir) || 'Project';

        meta = {
            name,
            color: '#007acc',
            statuses: INITIAL_STATES
        };

        try {
            await ensureProjectStructure(projectPath);
            await fs.writeJson(metaPath, meta, { spaces: 2 });
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
          statuses: z.array(z.any()).optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const projectPath = normalizeProjectPath(input.projectPath);
        await ensureProjectStructure(projectPath);
        const metaPath = path.join(projectPath, 'meta.json');
        await fs.writeJson(metaPath, input.meta, { spaces: 2 });
        return input.meta;
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
        const errors: string[] = [];

        const aimMap = new Map(aims.map((a: Aim) => [a.id, a]));
        const phaseMap = new Map(phases.map((p: Phase) => [p.id, p]));

        // Check 1: Aim <-> Phase consistency
        for (const aim of aims) {
          for (const phaseId of aim.committedIn) {
            if (!phaseMap.has(phaseId)) {
              errors.push(`Aim ${aim.id} claims to be committed in non-existent phase ${phaseId}`);
            } else {
              const phase = phaseMap.get(phaseId)!;
              if (!phase.commitments.includes(aim.id)) {
                errors.push(`Aim ${aim.id} says committed in Phase ${phaseId}, but Phase does not have it in commitments`);
              }
            }
          }
        }

        for (const phase of phases) {
          for (const aimId of phase.commitments) {
            if (!aimMap.has(aimId)) {
              errors.push(`Phase ${phase.id} commits to non-existent aim ${aimId}`);
            } else {
              const aim = aimMap.get(aimId)!;
              if (!aim.committedIn.includes(phase.id)) {
                errors.push(`Phase ${phase.id} commits to Aim ${aimId}, but Aim does not say committed in Phase`);
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
                errors.push(`Aim ${aim.id} has non-existent supporting connection (child) ${childId}`);
                } else {
                const child = aimMap.get(childId)!;
                if (!child.supportedAims.includes(aim.id)) {
                    errors.push(`Aim ${aim.id} lists ${childId} as supporting, but ${childId} does not list ${aim.id} as supportedAims`);
                }
                }
            }
          }

          // supportedAims (Parents)
          for (const parentId of aim.supportedAims) {
            if (!aimMap.has(parentId)) {
              errors.push(`Aim ${aim.id} has non-existent supportedAims (parent) ${parentId}`);
            } else {
              const parent = aimMap.get(parentId)!;
              const parentHasConnection = parent.supportingConnections?.some((c: any) => c.aimId === aim.id);
              if (!parentHasConnection) {
                errors.push(`Aim ${aim.id} lists ${parentId} as supportedAims, but ${parentId} does not list ${aim.id} in supportingConnections`);
              }
            }
          }
        }

        // Check 4: Embeddings consistency
        const vectorStore = await loadVectorStore(input.projectPath);
        for (const aimId of Object.keys(vectorStore)) {
            if (!aimMap.has(aimId)) {
                errors.push(`Orphaned embedding found for Aim ${aimId}`);
            }
        }

        return { valid: errors.length === 0, errors };
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
      })
  });
};
