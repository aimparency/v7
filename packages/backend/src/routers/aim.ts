import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs-extra';
import type { Aim, SearchAimResult } from 'shared';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';
import { embeddingTextForAim } from '../embeddings.js';
import { defaultAimColor } from '../aim-color.js';

export const createAimRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  readAim: (projectPath: string, aimId: string) => Promise<Aim>,
  listAims: (projectPath: string, archived?: boolean) => Promise<Aim[]>,
  writeAim: (projectPath: string, aim: Aim) => Promise<void>,
  readPhase: (projectPath: string, phaseId: string) => Promise<any>,
  commitAimToPhase: (projectPath: string, aimId: string, phaseId: string, insertionIndex?: number) => Promise<void>,
  removeAimFromPhase: (projectPath: string, aimId: string, phaseId: string) => Promise<void>,
  connectAimsInternal: (projectPath: string, parentAimId: string, childAimId: string, parentIncomingIndex?: number, childSupportedAimsIndex?: number, relativePosition?: [number, number], weight?: number, explanation?: string) => Promise<void>,
  getRandomRelativePosition: () => [number, number],
  normalizeProjectPath: (p: string) => string,
  addAimToIndex: (projectPath: string, aim: Aim) => void,
  updateAimInIndex: (projectPath: string, aim: Aim) => void,
  removeAimFromIndex: (projectPath: string, aimId: string) => void,
  generateEmbedding: (text: string) => Promise<number[] | null>,
  generateQueryEmbedding: (query: string) => Promise<number[] | null>,
  saveEmbedding: (projectPath: string, aimId: string, vector: number[]) => Promise<void>,
  removeEmbedding: (projectPath: string, aimId: string) => Promise<void>,
  searchVectors: (projectPath: string, queryVector: number[], limit: number) => Promise<Array<{ id: string, score: number }>>,
  searchAims: (projectPath: string, query: string, aims: Aim[]) => Promise<SearchAimResult[]>,
  invalidateSemanticCache: (projectPath: string) => void,
  ensureSearchIndex: (projectPath: string) => Promise<void>,
  ee: any
) => {
  const resolveCreationColor = async (
    projectPath: string,
    explicitColor: string | null | undefined,
    parentId?: string
  ) => {
    if (explicitColor) return explicitColor;
    if (!parentId) return defaultAimColor();
    const parent = await readAim(projectPath, parentId);
    return defaultAimColor(parent.color ?? '#666666', parent.supportingConnections.length);
  };

  return t.router({
    get: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid()
      }))
      .query(async ({ input }: any) => {
        return await readAim(input.projectPath, input.aimId);
      }),

    getMany: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimIds: z.array(z.string().uuid())
      }))
      .query(async ({ input }: any) => {
        const results = await Promise.allSettled(
          input.aimIds.map((aimId: string) => readAim(input.projectPath, aimId))
        );

        return results.flatMap((result, index) => {
          if (result.status === 'fulfilled') return [result.value];

          const aimId = input.aimIds[index];
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          if (!message.includes('ENOENT')) {
            console.warn(`Failed to read aim ${aimId}`, result.reason);
          }
          return [];
        });
      }),

    list: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        phaseId: z.string().uuid().optional(),
        parentAimId: z.string().uuid().optional(),
        floating: z.boolean().optional(),
        uncommitted: z.boolean().optional(),
        archived: z.boolean().optional(),
        ids: z.array(z.string().uuid()).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        sortBy: z.enum(['date', 'status', 'text', 'priority']).optional(),
        sortOrder: z.enum(['asc', 'desc']).optional()
      }))
      .query(async ({ input }: any) => {
        let aims = await listAims(input.projectPath, input.archived);

        if (input.ids) {
          aims = aims.filter((aim: Aim) => input.ids!.includes(aim.id));
        } else {
          if (input.status) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            aims = aims.filter((aim: Aim) => statuses.includes(aim.status.state));
          }

          if (input.phaseId) {
            aims = aims.filter((aim: Aim) => aim.committedIn.includes(input.phaseId!));
          } else if (input.parentAimId) {
            aims = aims.filter((aim: Aim) => aim.supportedAims.includes(input.parentAimId!));
          } else if (input.floating) {
            aims = aims.filter((aim: Aim) => (!aim.committedIn || aim.committedIn.length === 0) && (!aim.supportedAims || aim.supportedAims.length === 0));
          } else if (input.uncommitted) {
            // Not committed to any phase, regardless of parents. Surfaces aims
            // that are connected (have a parent) but invisible to phase-based
            // discovery like get_prioritized_aims — the work backlog to triage
            // into phases. Broader than `floating` (which also requires no parents).
            aims = aims.filter((aim: Aim) => !aim.committedIn || aim.committedIn.length === 0);
          }
        }

        // Sorting
        if (input.sortBy) {
          aims.sort((a: Aim, b: Aim) => {
            let valA: any, valB: any;

            switch(input.sortBy) {
              case 'date':
                valA = a.status.date;
                valB = b.status.date;
                break;
              case 'status':
                valA = a.status.state;
                valB = b.status.state;
                break;
              case 'text':
                valA = a.text.toLowerCase();
                valB = b.text.toLowerCase();
                break;
              case 'priority':
                const costA = (a.cost && a.cost > 0) ? a.cost : 0.1;
                const costB = (b.cost && b.cost > 0) ? b.cost : 0.1;
                valA = (a.intrinsicValue || 0) / costA;
                valB = (b.intrinsicValue || 0) / costB;
                break;
            }

            if (valA < valB) return input.sortOrder === 'desc' ? 1 : -1;
            if (valA > valB) return input.sortOrder === 'desc' ? -1 : 1;
            return 0;
          });
        }

        // Pagination
        if (input.offset !== undefined) {
          aims = aims.slice(input.offset);
        }
        if (input.limit !== undefined) {
          aims = aims.slice(0, input.limit);
        }

        return aims;
      }),

    getRecursive: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .query(async ({ input }: any) => {
        const allAims = await listAims(input.projectPath);
        const aimMap = new Map(allAims.map((a: Aim) => [a.id, a]));
        const result = new Set<Aim>();

        // Get phase root commitments
        const phase = await readPhase(input.projectPath, input.phaseId);
        const queue = [...phase.commitments];

        while (queue.length > 0) {
            const aimId = queue.shift()!;
            if (result.has(aimMap.get(aimId)!)) continue;

            const aim = aimMap.get(aimId);
            if (aim) {
                // Filter by open status (as requested)
                if (aim.status.state === 'open') {
                    result.add(aim);
                }

                // Add children to queue (support both structures during migration)
                const connections = aim.supportingConnections || (aim as any).incoming || [];
                for (const conn of connections) {
                    const childId = typeof conn === 'string' ? conn : conn.aimId;
                    queue.push(childId);
                }
            }
        }

        return Array.from(result);
      }),

    update: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        aim: z.object({
          text: z.string().optional(),
          description: z.string().optional(),
          reflection: z.string().optional(),
          archived: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional()
          }).optional(),
          incoming: z.array(z.string()).optional(),
          supportedAims: z.array(z.string()).optional(),
          committedIn: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
            aimId: z.string().uuid(),
            relativePosition: z.tuple([z.number(), z.number()]).optional(),
            weight: z.number().optional(),
            explanation: z.string().optional()
          })).optional(),
          // Repo-level cross-repo links (aim → whole external repo). No aimId,
          // no reciprocal back-reference, so the parent/child consistency loops
          // below deliberately ignore this field.
          supportingRepos: z.array(z.object({
            repoId: z.string().uuid(),
            relativePosition: z.tuple([z.number(), z.number()]).optional(),
            weight: z.number().optional(),
            explanation: z.string().optional()
          })).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const existingAim = await readAim(input.projectPath, input.aimId);

        // Handle consistency for supportedAims (Parents)
        if (input.aim.supportedAims) {
            const oldParents = new Set<string>(existingAim.supportedAims || []);
            const newParents = new Set<string>(input.aim.supportedAims);

            // Removed Parents
            for (const parentId of oldParents) {
                if (!newParents.has(parentId)) {
                    try {
                        const parent = await readAim(input.projectPath, parentId);
                        if (parent.supportingConnections) {
                            parent.supportingConnections = parent.supportingConnections.filter((c: any) => c.aimId !== input.aimId);
                            await writeAim(input.projectPath, parent);
                        }
                    } catch(e) { console.warn(`Failed to update removed parent ${parentId}`, e); }
                }
            }

            // Added Parents
            for (const parentId of Array.from(newParents)) {
                if (!oldParents.has(parentId)) {
                    try {
                        const parent = await readAim(input.projectPath, parentId);
                        if (!parent.supportingConnections) parent.supportingConnections = [];
                        if (!parent.supportingConnections.some((c: any) => c.aimId === input.aimId)) {
                            parent.supportingConnections.push({
                                aimId: input.aimId,
                                relativePosition: getRandomRelativePosition(),
                                weight: 1
                            });
                            await writeAim(input.projectPath, parent);
                        }
                    } catch(e) { console.warn(`Failed to update added parent ${parentId}`, e); }
                }
            }
        }

        // Handle consistency for supportingConnections (Children)
        if (input.aim.supportingConnections) {
             const oldChildren = new Set<string>((existingAim.supportingConnections || []).map((c: any) => c.aimId));
             const newChildren = new Set<string>(input.aim.supportingConnections.map((c: any) => c.aimId));

             // Removed Children
             for (const childId of oldChildren) {
                 if (!newChildren.has(childId)) {
                     try {
                         const child = await readAim(input.projectPath, childId);
                         if (child.supportedAims) {
                             child.supportedAims = child.supportedAims.filter((id: string) => id !== input.aimId);
                             await writeAim(input.projectPath, child);
                         }
                     } catch(e) { console.warn(`Failed to update removed child ${childId}`, e); }
                 }
             }

             // Added Children
             for (const childId of Array.from(newChildren)) {
                 if (!oldChildren.has(childId)) {
                     try {
                         const child = await readAim(input.projectPath, childId);
                         if (!child.supportedAims) child.supportedAims = [];
                         if (!child.supportedAims.includes(input.aimId)) {
                             child.supportedAims.push(input.aimId);
                             await writeAim(input.projectPath, child);
                         }
                     } catch(e) { console.warn(`Failed to update added child ${childId}`, e); }
                 }
             }
        }

        // Handle status deep merge and date default
        let status = existingAim.status;
        if (input.aim.status) {
          status = {
            ...existingAim.status,
            ...input.aim.status,
            date: input.aim.status.date ?? Date.now()
          };
        }

        let supportingConnections = existingAim.supportingConnections;
        if (input.aim.supportingConnections) {
            supportingConnections = input.aim.supportingConnections.map((c: any) => ({
                aimId: c.aimId,
                relativePosition: c.relativePosition || [0,0],
                weight: c.weight || 1,
                ...(c.explanation !== undefined ? { explanation: c.explanation } : {})
            }));
        }

        let supportingRepos = existingAim.supportingRepos;
        if (input.aim.supportingRepos) {
            supportingRepos = input.aim.supportingRepos.map((c: any) => ({
                repoId: c.repoId,
                relativePosition: c.relativePosition || [0,0],
                weight: c.weight || 1,
                ...(c.explanation !== undefined ? { explanation: c.explanation } : {})
            }));
        }

        const updatedAim = {
          ...existingAim,
          ...input.aim,
          status,
          supportingConnections,
          supportingRepos
        };

        await writeAim(input.projectPath, updatedAim);
        updateAimInIndex(input.projectPath, updatedAim);

        // Update embedding (async)
        if (process.env.NODE_ENV !== 'test' && updatedAim.text) {
          generateEmbedding(embeddingTextForAim(updatedAim)).then(vector => {
             if(vector) {
               saveEmbedding(input.projectPath, input.aimId, vector);
               invalidateSemanticCache(input.projectPath);
             }
          });
        }

        return updatedAim;
      }),

    delete: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid()
      }))
      .mutation(async ({ input }: any) => {
        // First remove the aim from all phases where it's committed
        const aim = await readAim(input.projectPath, input.aimId);
        for (const phaseId of aim.committedIn) {
          await removeAimFromPhase(input.projectPath, input.aimId, phaseId);
        }

        // Clean up parent connections (supportedAims)
        for (const parentId of aim.supportedAims || []) {
            try {
                const parent = await readAim(input.projectPath, parentId);
                if (parent.supportingConnections) {
                    parent.supportingConnections = parent.supportingConnections.filter((c: any) => c.aimId !== input.aimId);
                    await writeAim(input.projectPath, parent);
                }
            } catch (e) {
                console.warn(`Failed to cleanup parent ${parentId} for deleted aim ${input.aimId}: ${e}`);
            }
        }

        // Clean up child connections (supportingConnections)
        for (const conn of aim.supportingConnections || []) {
            try {
                const child = await readAim(input.projectPath, conn.aimId);
                if (child.supportedAims) {
                    child.supportedAims = child.supportedAims.filter((id: string) => id !== input.aimId);
                    await writeAim(input.projectPath, child);
                }
            } catch (e) {
                console.warn(`Failed to cleanup child ${conn.aimId} for deleted aim ${input.aimId}: ${e}`);
            }
        }

        // Then delete the aim file
        const projectPath = normalizeProjectPath(input.projectPath);
        const isArchived = aim.status.state === 'archived';
        const dirName = isArchived ? 'archived-aims' : 'aims';
        const aimPath = path.join(projectPath, dirName, `${input.aimId}.json`);
        await fs.remove(aimPath);

        // Remove from search index
        removeAimFromIndex(input.projectPath, input.aimId);

        if (process.env.NODE_ENV !== 'test') {
          await removeEmbedding(input.projectPath, input.aimId);
          invalidateSemanticCache(input.projectPath);
        }

        ee.emit('change', { type: 'aim', id: input.aimId, projectPath: input.projectPath });

        return { success: true };
      }),

    commitToPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        phaseId: z.string().uuid(),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }: any) => {
        await commitAimToPhase(input.projectPath, input.aimId, input.phaseId, input.insertionIndex);
        return { success: true };
      }),

    removeFromPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }: any) => {
        await removeAimFromPhase(input.projectPath, input.aimId, input.phaseId);
        return { success: true };
      }),

    connectAims: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentAimId: z.string().uuid(),
        childAimId: z.string().uuid(),
        parentIncomingIndex: z.number().optional(),
        childSupportedAimsIndex: z.number().optional(),
        relativePosition: z.tuple([z.number(), z.number()]).optional(),
        weight: z.number().optional(),
        explanation: z.string().optional()
      }))
      .mutation(async ({ input }: any) => {
        await connectAimsInternal(input.projectPath, input.parentAimId, input.childAimId, input.parentIncomingIndex, input.childSupportedAimsIndex, input.relativePosition, input.weight, input.explanation);
      }),

    // Repo-level cross-repo link: attach a {repoId} edge (no aimId) to an aim's
    // supportingRepos — the aim is supported by a WHOLE external repo, a black
    // box. Idempotent on repoId: re-linking updates the existing edge's
    // weight/position/explanation instead of duplicating. The external repo
    // keeps no back-reference (by design — you declare what supports you, never
    // that another repo needs you), so there is no reciprocal write.
    linkRepo: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        repoId: z.string().uuid(),
        relativePosition: z.tuple([z.number(), z.number()]).optional(),
        weight: z.number().optional(),
        explanation: z.string().optional()
      }))
      .mutation(async ({ input }: any) => {
        const aim = await readAim(input.projectPath, input.aimId);
        const existing = aim.supportingRepos ?? [];
        const idx = existing.findIndex((r: any) => r.repoId === input.repoId);
        const edge = {
          repoId: input.repoId,
          relativePosition: input.relativePosition || getRandomRelativePosition(),
          weight: input.weight ?? 1,
          ...(input.explanation !== undefined ? { explanation: input.explanation } : {})
        };
        const supportingRepos = idx >= 0
          ? existing.map((r: any, i: number) => (i === idx ? { ...r, ...edge } : r))
          : [...existing, edge];
        const updatedAim = { ...aim, supportingRepos };
        await writeAim(input.projectPath, updatedAim);
        updateAimInIndex(input.projectPath, updatedAim);
        return updatedAim;
      }),

    unlinkRepo: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        repoId: z.string().uuid()
      }))
      .mutation(async ({ input }: any) => {
        const aim = await readAim(input.projectPath, input.aimId);
        const supportingRepos = (aim.supportingRepos ?? []).filter((r: any) => r.repoId !== input.repoId);
        const updatedAim = { ...aim, supportingRepos };
        await writeAim(input.projectPath, updatedAim);
        updateAimInIndex(input.projectPath, updatedAim);
        return updatedAim;
      }),

    createFloatingAim: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aim: z.object({
          text: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional(),
          supportedAims: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
             aimId: z.string(),
             weight: z.number().optional(),
             relativePosition: z.tuple([z.number(), z.number()]).optional(),
             explanation: z.string().optional()
          })).optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const aimId = uuidv4();
        const status = input.aim.status
          ? {
              state: input.aim.status.state || 'open',
              comment: input.aim.status.comment || '',
              date: input.aim.status.date || Date.now()
            }
          : { state: 'open' as const, comment: '', date: Date.now() };

        // Check if this is the first aim in the project
        const normalizedPath = normalizeProjectPath(input.projectPath);
        const aimsDir = path.join(normalizedPath, 'aims');
        const existingAims = await fs.pathExists(aimsDir)
          ? (await fs.readdir(aimsDir)).filter(f => f.endsWith('.json')).length
          : 0;
        const isFirstAim = existingAims === 0;

        const primaryParentId = input.aim.supportedAims?.[0];
        const aim: Aim = {
          id: aimId,
          text: input.aim.text,
          description: input.aim.description,
          tags: input.aim.tags || [],
          reflections: [],
          supportingConnections: [],
          supportedAims: [],
          committedIn: [],
          status,
          intrinsicValue: input.aim.intrinsicValue ?? (isFirstAim ? 1000 : 0),
          cost: input.aim.cost ?? 1,
          loopWeight: input.aim.loopWeight ?? 1,
          duration: input.aim.duration ?? 1,
          costVariance: input.aim.costVariance ?? 0,
          valueVariance: input.aim.valueVariance ?? 0,
          archived: false,
          color: await resolveCreationColor(input.projectPath, input.aim.color, primaryParentId)
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(embeddingTextForAim(aim)).then(vector => {
             if(vector) {
               saveEmbedding(input.projectPath, aimId, vector);
               invalidateSemanticCache(input.projectPath);
             }
          });
        }

        if (input.aim.supportedAims) {
            for (const parentId of input.aim.supportedAims) {
                await connectAimsInternal(input.projectPath, parentId, aimId);
            }
        }

        if (input.aim.supportingConnections) {
            for (const conn of input.aim.supportingConnections) {
                await connectAimsInternal(input.projectPath, aimId, conn.aimId, undefined, undefined, conn.relativePosition, conn.weight, conn.explanation);
            }
        }

        return aim;
      }),

    createSubAim: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentAimId: z.string().uuid(),
        aim: z.object({
          text: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional(),
          supportedAims: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
             aimId: z.string(),
             weight: z.number().optional(),
             relativePosition: z.tuple([z.number(), z.number()]).optional(),
             explanation: z.string().optional()
          })).optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
        }),
        positionInParent: z.number().optional(),
        weight: z.number().optional(),
        explanation: z.string().optional()
      }))
      .mutation(async ({ input }: any) => {
        const childAimId = uuidv4();
        const status = input.aim.status
          ? {
              state: input.aim.status.state || 'open',
              comment: input.aim.status.comment || '',
              date: input.aim.status.date || Date.now()
            }
          : { state: 'open' as const, comment: '', date: Date.now() };

        const childAim: Aim = {
          id: childAimId,
          text: input.aim.text,
          description: input.aim.description,
          tags: input.aim.tags || [],
          reflections: [],
          supportingConnections: [],
          supportedAims: [],
          committedIn: [],
          status,
          intrinsicValue: input.aim.intrinsicValue ?? 0,
          cost: input.aim.cost ?? 1,
          loopWeight: input.aim.loopWeight ?? 1,
          duration: input.aim.duration ?? 1,
          costVariance: input.aim.costVariance ?? 0,
          valueVariance: input.aim.valueVariance ?? 0,
          archived: false,
          color: await resolveCreationColor(input.projectPath, input.aim.color, input.parentAimId)
        };

        await writeAim(input.projectPath, childAim);
        addAimToIndex(input.projectPath, childAim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(embeddingTextForAim(childAim)).then(vector => {
             if(vector) saveEmbedding(input.projectPath, childAimId, vector);
          });
        }

        await connectAimsInternal(input.projectPath, input.parentAimId, childAimId, input.positionInParent, 0, undefined, input.weight, input.explanation);

        if (input.aim.supportedAims) {
            for (const parentId of input.aim.supportedAims) {
                if (parentId !== input.parentAimId) {
                    await connectAimsInternal(input.projectPath, parentId, childAimId);
                }
            }
        }

        if (input.aim.supportingConnections) {
            for (const conn of input.aim.supportingConnections) {
                await connectAimsInternal(input.projectPath, childAimId, conn.aimId, undefined, undefined, conn.relativePosition, conn.weight, conn.explanation);
            }
        }

        return childAim;
      }),

    createAimInPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        aim: z.object({
          text: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional(),
          supportedAims: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
             aimId: z.string(),
             weight: z.number().optional(),
             relativePosition: z.tuple([z.number(), z.number()]).optional(),
             explanation: z.string().optional()
          })).optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
        }),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }: any) => {
        const aimId = uuidv4();
        const status = input.aim.status
          ? {
              state: input.aim.status.state || 'open',
              comment: input.aim.status.comment || '',
              date: input.aim.status.date || Date.now()
            }
          : { state: 'open' as const, comment: '', date: Date.now() };

        const primaryParentId = input.aim.supportedAims?.[0];
        const aim: Aim = {
          id: aimId,
          text: input.aim.text,
          description: input.aim.description,
          tags: input.aim.tags || [],
          reflections: [],
          supportingConnections: [],
          supportedAims: [],
          committedIn: [input.phaseId], // Will be updated by commitAimToPhase
          status,
          intrinsicValue: input.aim.intrinsicValue ?? 0,
          cost: input.aim.cost ?? 1,
          loopWeight: input.aim.loopWeight ?? 1,
          duration: input.aim.duration ?? 1,
          costVariance: input.aim.costVariance ?? 0,
          valueVariance: input.aim.valueVariance ?? 0,
          archived: false,
          color: await resolveCreationColor(input.projectPath, input.aim.color, primaryParentId)
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(embeddingTextForAim(aim)).then(vector => {
             if(vector) {
               saveEmbedding(input.projectPath, aimId, vector);
               invalidateSemanticCache(input.projectPath);
             }
          });
        }

        await commitAimToPhase(input.projectPath, aimId, input.phaseId, input.insertionIndex);

        if (input.aim.supportedAims) {
            for (const parentId of input.aim.supportedAims) {
                await connectAimsInternal(input.projectPath, parentId, aimId);
            }
        }

        if (input.aim.supportingConnections) {
            for (const conn of input.aim.supportingConnections) {
                await connectAimsInternal(input.projectPath, aimId, conn.aimId, undefined, undefined, conn.relativePosition, conn.weight, conn.explanation);
            }
        }

        return aim;
      }),

    search: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        query: z.string(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        phaseId: z.string().uuid().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        archived: z.boolean().optional()
      }))
      .query(async ({ input }: any) => {
        const projectPath = normalizeProjectPath(input.projectPath);
        await ensureSearchIndex(projectPath);
        const allAims = await listAims(projectPath, input.archived);
        console.log(`[Search] Query: "${input.query}" | Total Aims: ${allAims.length} | Archived: ${input.archived}`);

        let results: SearchAimResult[] = [];

        if (input.query && input.query.trim().length > 0) {
          // 1. Text Search (FlexSearch)
          const textPromise = searchAims(projectPath, input.query, allAims);

          // 2. Semantic Search (Embeddings)
          const vectorPromise = (async () => {
             try {
                 const queryVector = await generateQueryEmbedding(input.query);
                 if (!queryVector) return [];
                 return await searchVectors(projectPath, queryVector, 20);
             } catch (e) {
                 return [];
             }
          })();

          const [textResults, vectorCandidates] = await Promise.all([textPromise, vectorPromise]);

          // Merge results
          const resultMap = new Map<string, SearchAimResult>();

          // Add Semantic Candidates
          for (const cand of vectorCandidates) {
              const aim = allAims.find((a: Aim) => a.id === cand.id);
              if (aim) {
                  resultMap.set(aim.id, { ...aim, score: cand.score });
              }
          }

          // Add/Boost Text Results
          for (const r of textResults) {
              if (resultMap.has(r.id)) {
                  const existing = resultMap.get(r.id)!;
                  r.score = Math.max(r.score || 0, existing.score || 0) * 1.1;
                  if (r.idMatch) existing.idMatch = r.idMatch;
              }
              resultMap.set(r.id, r);
          }

          results = Array.from(resultMap.values());

          // Fallback: Simple substring if hybrid failed entirely
          if (results.length === 0) {
            const lowerQuery = input.query.toLowerCase();
            const fallbackResults = allAims.filter((aim: Aim) =>
                aim.text.toLowerCase().includes(lowerQuery)
            ).map((aim: Aim) => ({ ...aim, score: 0.05 }));
            results = fallbackResults;
          }
        } else {
          // No query provided: start with all aims, scored by their recency
          const now = Date.now();
          results = allAims.map((aim: Aim) => ({ 
            ...aim, 
            score: aim.status?.date ? Math.max(0, 1 - (now - aim.status.date) / (365 * 24 * 60 * 60 * 1000)) : 0
          }));
        }

        if (input.status) {
          const statuses = Array.isArray(input.status) ? input.status : [input.status];
          results = results.filter((aim: SearchAimResult) => statuses.includes(aim.status.state));
        }

        if (input.phaseId) {
          results = results.filter((aim: SearchAimResult) => aim.committedIn.includes(input.phaseId!));
        }

        // Sort by score (descending) before pagination
        results.sort((a, b) => (b.score || 0) - (a.score || 0));

        // Pagination
        if (input.offset !== undefined) {
          results = results.slice(input.offset);
        }
        if (input.limit !== undefined) {
          results = results.slice(0, input.limit);
        }

        return results;
      }),

    searchSemantic: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        query: z.string(),
        limit: z.number().optional(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        phaseId: z.string().uuid().optional()
      }))
      .query(async ({ input }: any) => {
        await ensureSearchIndex(input.projectPath);
        const queryVector = await generateQueryEmbedding(input.query);
        if (!queryVector) return [];

        // Increase limit to account for potential filtering
        const fetchLimit = (input.limit || 10) * 3;
        const vectorResults = await searchVectors(input.projectPath, queryVector, fetchLimit);

        const results = [];
        for (const res of vectorResults) {
            try {
                const aim = await readAim(input.projectPath, res.id);

                let match = true;
                if (input.status) {
                    const statuses = Array.isArray(input.status) ? input.status : [input.status];
                    if (!statuses.includes(aim.status.state)) match = false;
                }
                if (match && input.phaseId) {
                    if (!aim.committedIn.includes(input.phaseId)) match = false;
                }

                if (match) {
                    results.push({ ...aim, score: res.score });
                }
            } catch (e) {
                // Ignore missing aims
            }
        }
        return results.slice(0, input.limit || 10);
      }),

    // Add reflection to aim
    addReflection: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        reflection: z.object({
          context: z.string(),
          outcome: z.string(),
          effectiveness: z.string(),
          lesson: z.string(),
          pattern: z.string().optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const aim = await readAim(input.projectPath, input.aimId);

        const newReflection = {
          date: Date.now(),
          context: input.reflection.context,
          outcome: input.reflection.outcome,
          effectiveness: input.reflection.effectiveness,
          lesson: input.reflection.lesson,
          pattern: input.reflection.pattern
        };

        if (!aim.reflections) {
          aim.reflections = [];
        }
        aim.reflections.push(newReflection);

        await writeAim(input.projectPath, aim);
        updateAimInIndex(input.projectPath, aim);

        return { success: true, reflection: newReflection };
      }),

    // Merge source aim B into target aim A:
    // - Rewires B's parents, children, and phase commitments onto A (deduplicating)
    // - Copies B's reflections to A
    // - Archives B
    // Guards: no self-merge, B must not already be archived. A direct parent-child
    // pair is allowed (the connecting edge is dropped to avoid a self-reference).
    merge: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        targetId: z.string().uuid(),  // A — the aim to keep
        sourceId: z.string().uuid(),  // B — the aim to archive
      }))
      .mutation(async ({ input }: any) => {
        const { projectPath, targetId, sourceId } = input;

        if (targetId === sourceId) {
          throw new Error('Cannot merge an aim into itself');
        }

        const [target, source] = await Promise.all([
          readAim(projectPath, targetId),
          readAim(projectPath, sourceId),
        ]);

        if (source.status.state === 'archived') {
          throw new Error(`Source aim ${sourceId} is already archived`);
        }

        // A direct parent-child relationship is fine to merge — it's exactly the
        // "collapse a redundant nesting" case (a child folded up into its parent,
        // as graph_hygiene's collapse-candidates recommends). The only hazard is
        // the direct target<->source edge: once source's identity is folded into
        // target, that edge becomes target->target. We strip it below before
        // writing target (the rewire loops skip the targetId edge but never remove
        // the surviving side's reference to source). Deep cycles are still left
        // alone; archiving source severs its outgoing edges anyway.

        const rewired: string[] = [];

        // 1. Rewire source's parents onto target
        for (const parentId of source.supportedAims ?? []) {
          if (parentId === targetId) continue; // already a parent of target
          try {
            const parent = await readAim(projectPath, parentId);
            // Replace source with target in parent's supportingConnections (or add if missing)
            const hasSource = (parent.supportingConnections ?? []).some((c: any) => c.aimId === sourceId);
            const hasTarget = (parent.supportingConnections ?? []).some((c: any) => c.aimId === targetId);
            if (hasSource) {
              parent.supportingConnections = (parent.supportingConnections ?? []).map((c: any) =>
                c.aimId === sourceId ? { ...c, aimId: targetId } : c
              );
              if (hasTarget) {
                // Both existed — remove the duplicate entry (keep first occurrence of targetId)
                const seen = new Set<string>();
                parent.supportingConnections = parent.supportingConnections.filter((c: any) => {
                  if (seen.has(c.aimId)) return false;
                  seen.add(c.aimId);
                  return true;
                });
              }
              await writeAim(projectPath, parent);
            }
            // Add parentId to target.supportedAims if not already present
            if (!target.supportedAims.includes(parentId)) {
              target.supportedAims.push(parentId);
            }
            rewired.push(`parent ${parentId}`);
          } catch (e) {
            console.warn(`merge: could not rewire parent ${parentId}: ${e}`);
          }
        }

        // 2. Rewire source's children onto target
        for (const conn of source.supportingConnections ?? []) {
          const childId = conn.aimId;
          if (childId === targetId) continue; // target is already a child of itself? skip
          try {
            const child = await readAim(projectPath, childId);
            // Replace source with target in child's supportedAims (or add if missing)
            if ((child.supportedAims ?? []).includes(sourceId)) {
              child.supportedAims = child.supportedAims.filter((id: string) => id !== sourceId);
              if (!child.supportedAims.includes(targetId)) {
                child.supportedAims.push(targetId);
              }
              await writeAim(projectPath, child);
            }
            // Add child connection to target if not already present
            const alreadyConnected = (target.supportingConnections ?? []).some((c: any) => c.aimId === childId);
            if (!alreadyConnected) {
              if (!target.supportingConnections) target.supportingConnections = [];
              target.supportingConnections.push({
                aimId: childId,
                weight: conn.weight ?? 1,
                relativePosition: getRandomRelativePosition(),
              });
            }
            rewired.push(`child ${childId}`);
          } catch (e) {
            console.warn(`merge: could not rewire child ${childId}: ${e}`);
          }
        }

        // 3. Rewire source's phase commitments onto target
        for (const phaseId of source.committedIn ?? []) {
          try {
            await commitAimToPhase(projectPath, targetId, phaseId);
            await removeAimFromPhase(projectPath, sourceId, phaseId);
            // commitAimToPhase persists committedIn on the target's file directly,
            // but the final writeAim(target) below writes our in-memory copy and
            // would clobber it — so mirror the commit into the in-memory target.
            target.committedIn = target.committedIn ?? [];
            if (!target.committedIn.includes(phaseId)) target.committedIn.push(phaseId);
            rewired.push(`phase ${phaseId}`);
          } catch (e) {
            console.warn(`merge: could not rewire phase ${phaseId}: ${e}`);
          }
        }

        // 4. Copy source's reflections to target
        const copiedReflections = source.reflections ?? [];
        target.reflections = [...(target.reflections ?? []), ...copiedReflections];

        // Drop any direct edge between target and source in either direction: folding
        // source into target would otherwise leave target with a self-reference (an
        // edge to its own merged-away identity / a soon-archived aim).
        target.supportedAims = (target.supportedAims ?? []).filter((id: string) => id !== sourceId);
        target.supportingConnections = (target.supportingConnections ?? []).filter((c: any) => c.aimId !== sourceId);

        // 5. Archive source — clear its connections since they've been rewired
        source.supportedAims = [];
        source.supportingConnections = [];
        source.committedIn = [];
        source.status = { state: 'archived', comment: `Merged into ${targetId}`, date: Date.now() };

        // Write both
        await writeAim(projectPath, target);
        await writeAim(projectPath, source); // writeAim moves to archived-aims/ automatically
        updateAimInIndex(projectPath, target);
        removeAimFromIndex(projectPath, sourceId);

        if (process.env.NODE_ENV !== 'test') {
          await removeEmbedding(projectPath, sourceId);
          invalidateSemanticCache(projectPath);
        }

        ee.emit('change', { type: 'aim', id: targetId, projectPath });
        ee.emit('change', { type: 'aim', id: sourceId, projectPath });

        return {
          success: true,
          rewired,
          reflectionsCopied: copiedReflections.length,
          archivedSource: sourceId,
        };
      })
  });
};
