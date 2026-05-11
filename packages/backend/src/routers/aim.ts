import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs-extra';
import type { Aim, SearchAimResult } from 'shared';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';

export const createAimRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  readAim: (projectPath: string, aimId: string) => Promise<Aim>,
  listAims: (projectPath: string, archived?: boolean) => Promise<Aim[]>,
  writeAim: (projectPath: string, aim: Aim) => Promise<void>,
  readPhase: (projectPath: string, phaseId: string) => Promise<any>,
  commitAimToPhase: (projectPath: string, aimId: string, phaseId: string, insertionIndex?: number) => Promise<void>,
  removeAimFromPhase: (projectPath: string, aimId: string, phaseId: string) => Promise<void>,
  connectAimsInternal: (projectPath: string, parentAimId: string, childAimId: string, parentIncomingIndex?: number, childSupportedAimsIndex?: number, relativePosition?: [number, number], weight?: number) => Promise<void>,
  getRandomRelativePosition: () => [number, number],
  normalizeProjectPath: (p: string) => string,
  addAimToIndex: (projectPath: string, aim: Aim) => void,
  updateAimInIndex: (projectPath: string, aim: Aim) => void,
  removeAimFromIndex: (projectPath: string, aimId: string) => void,
  generateEmbedding: (text: string) => Promise<number[] | null>,
  saveEmbedding: (projectPath: string, aimId: string, vector: number[]) => Promise<void>,
  removeEmbedding: (projectPath: string, aimId: string) => Promise<void>,
  searchVectors: (projectPath: string, queryVector: number[], limit: number) => Promise<Array<{ id: string, score: number }>>,
  searchAims: (projectPath: string, query: string, aims: Aim[]) => Promise<SearchAimResult[]>,
  invalidateSemanticCache: (projectPath: string) => void,
  ensureSearchIndex: (projectPath: string) => Promise<void>,
  ee: any
) => {
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
        return await Promise.all(input.aimIds.map((aimId: string) => readAim(input.projectPath, aimId)));
      }),

    list: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        phaseId: z.string().uuid().optional(),
        parentAimId: z.string().uuid().optional(),
        floating: z.boolean().optional(),
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
            weight: z.number().optional()
          })).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional()
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
                weight: c.weight || 1
            }));
        }

        const updatedAim = {
          ...existingAim,
          ...input.aim,
          status,
          supportingConnections
        };

        await writeAim(input.projectPath, updatedAim);
        updateAimInIndex(input.projectPath, updatedAim);

        // Update embedding (async)
        if (process.env.NODE_ENV !== 'test' && updatedAim.text) {
          generateEmbedding(updatedAim.text).then(vector => {
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
        weight: z.number().optional()
      }))
      .mutation(async ({ input }: any) => {
        await connectAimsInternal(input.projectPath, input.parentAimId, input.childAimId, input.parentIncomingIndex, input.childSupportedAimsIndex, input.relativePosition, input.weight);
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
             relativePosition: z.tuple([z.number(), z.number()]).optional()
          })).optional()
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
          archived: false
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(aim.text).then(vector => {
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
                await connectAimsInternal(input.projectPath, aimId, conn.aimId, undefined, undefined, conn.relativePosition, conn.weight);
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
             relativePosition: z.tuple([z.number(), z.number()]).optional()
          })).optional()
        }),
        positionInParent: z.number().optional(),
        weight: z.number().optional()
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
          archived: false
        };

        await writeAim(input.projectPath, childAim);
        addAimToIndex(input.projectPath, childAim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(childAim.text).then(vector => {
             if(vector) saveEmbedding(input.projectPath, childAimId, vector);
          });
        }

        await connectAimsInternal(input.projectPath, input.parentAimId, childAimId, input.positionInParent, 0, undefined, input.weight);

        if (input.aim.supportedAims) {
            for (const parentId of input.aim.supportedAims) {
                if (parentId !== input.parentAimId) {
                    await connectAimsInternal(input.projectPath, parentId, childAimId);
                }
            }
        }

        if (input.aim.supportingConnections) {
            for (const conn of input.aim.supportingConnections) {
                await connectAimsInternal(input.projectPath, childAimId, conn.aimId, undefined, undefined, conn.relativePosition, conn.weight);
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
             relativePosition: z.tuple([z.number(), z.number()]).optional()
          })).optional()
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
          archived: false
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(aim.text).then(vector => {
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
                await connectAimsInternal(input.projectPath, aimId, conn.aimId, undefined, undefined, conn.relativePosition, conn.weight);
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
                 const queryVector = await generateEmbedding(input.query);
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
          // No query provided: start with all aims
          results = allAims;
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
        const queryVector = await generateEmbedding(input.query);
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
      })
  });
};
