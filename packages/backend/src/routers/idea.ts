import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import { IdeaProposalSchema, flattenIdeaProposal, type Idea, type IdeaProposal, type SearchIdeaResult } from 'shared';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';
import { embeddingTextForIdea } from '../embeddings.js';
import { defaultIdeaColor } from '../idea-color.js';
import { getIdeaCommitEvidence, getIdeaStatusHistory, getCommitDiff } from '../git-evidence.js';

export const createIdeaRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  readIdea: (projectPath: string, ideaId: string) => Promise<Idea>,
  listIdeas: (projectPath: string, archived?: boolean) => Promise<Idea[]>,
  writeIdea: (projectPath: string, idea: Idea) => Promise<void>,
  readPhase: (projectPath: string, phaseId: string) => Promise<any>,
  commitIdeaToPhase: (projectPath: string, ideaId: string, phaseId: string, insertionIndex?: number) => Promise<void>,
  removeIdeaFromPhase: (projectPath: string, ideaId: string, phaseId: string) => Promise<void>,
  connectIdeasInternal: (projectPath: string, parentIdeaId: string, childIdeaId: string, parentIncomingIndex?: number, childSupportedIdeasIndex?: number, relativePosition?: [number, number], weight?: number, explanation?: string) => Promise<void>,
  getRandomRelativePosition: () => [number, number],
  normalizeProjectPath: (p: string) => string,
  addIdeaToIndex: (projectPath: string, idea: Idea) => void,
  updateIdeaInIndex: (projectPath: string, idea: Idea) => void,
  removeIdeaFromIndex: (projectPath: string, ideaId: string) => void,
  generateEmbedding: (text: string) => Promise<number[] | null>,
  generateQueryEmbedding: (query: string) => Promise<number[] | null>,
  saveEmbedding: (projectPath: string, ideaId: string, vector: number[]) => Promise<void>,
  removeEmbedding: (projectPath: string, ideaId: string) => Promise<void>,
  searchVectors: (projectPath: string, queryVector: number[], limit: number) => Promise<Array<{ id: string, score: number }>>,
  searchIdeas: (projectPath: string, query: string, ideas: Idea[]) => Promise<SearchIdeaResult[]>,
  invalidateSemanticCache: (projectPath: string) => void,
  ensureSearchIndex: (projectPath: string) => Promise<void>,
  generateProposal: (input: {
    projectPath: string;
    transcript: string;
    existingParentIds: string[];
    phaseId?: string;
    parentContext: Array<{ text: string; description?: string }>;
  }) => Promise<IdeaProposal>,
  ee: any
) => {
  const resolveCreationColor = async (
    projectPath: string,
    explicitColor: string | null | undefined,
    parentId?: string
  ) => {
    if (explicitColor) return explicitColor;
    if (!parentId) return defaultIdeaColor();
    const parent = await readIdea(projectPath, parentId);
    return defaultIdeaColor(parent.color ?? '#666666', parent.supportingConnections.length);
  };

  type ApprovalJournal = {
    proposalHash: string;
    revision: string;
    idMap: Record<string, string>;
    completedOperations: number;
    complete: boolean;
  };

  const proposalHash = (proposal: IdeaProposal) =>
    createHash('sha256').update(JSON.stringify(proposal)).digest('hex');

  const approvalJournalPath = (projectPath: string, idempotencyKey: string) => {
    const safeKey = createHash('sha256').update(idempotencyKey).digest('hex');
    return path.join(normalizeProjectPath(projectPath), 'runtime', 'idea-proposal-approvals', `${safeKey}.json`);
  };

  return t.router({
    commitEvidence: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional()
      }))
      .query(async ({ input }: any) => {
        const bowmanPath = normalizeProjectPath(input.projectPath);
        const repositoryPath = path.dirname(bowmanPath);
        return getIdeaCommitEvidence(repositoryPath, input.ideaId, input.limit);
      }),

    // Status changes of the idea as committed to git, oldest first.
    statusHistory: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid()
      }))
      .query(async ({ input }: any) => {
        return getIdeaStatusHistory(normalizeProjectPath(input.projectPath), input.ideaId);
      }),

    // Per-file patches of one commit in the project's repository.
    commitDiff: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        hash: z.string().regex(/^[0-9a-f]{7,40}$/i)
      }))
      .query(async ({ input }: any) => {
        return getCommitDiff(normalizeProjectPath(input.projectPath), input.hash);
      }),

    get: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid()
      }))
      .query(async ({ input }: any) => {
        return await readIdea(input.projectPath, input.ideaId);
      }),

    getMany: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaIds: z.array(z.string().uuid())
      }))
      .query(async ({ input }: any) => {
        const results = await Promise.allSettled(
          input.ideaIds.map((ideaId: string) => readIdea(input.projectPath, ideaId))
        );

        return results.flatMap((result, index) => {
          if (result.status === 'fulfilled') return [result.value];

          const ideaId = input.ideaIds[index];
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          if (!message.includes('ENOENT')) {
            console.warn(`Failed to read idea ${ideaId}`, result.reason);
          }
          return [];
        });
      }),

    list: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        phaseId: z.string().uuid().optional(),
        parentIdeaId: z.string().uuid().optional(),
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
        let ideas = await listIdeas(input.projectPath, input.archived);

        if (input.ids) {
          ideas = ideas.filter((idea: Idea) => input.ids!.includes(idea.id));
        } else {
          if (input.status) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            ideas = ideas.filter((idea: Idea) => statuses.includes(idea.status.state));
          }

          if (input.phaseId) {
            ideas = ideas.filter((idea: Idea) => idea.committedIn.includes(input.phaseId!));
          } else if (input.parentIdeaId) {
            ideas = ideas.filter((idea: Idea) => idea.supportedIdeas.includes(input.parentIdeaId!));
          } else if (input.floating) {
            ideas = ideas.filter((idea: Idea) => (!idea.committedIn || idea.committedIn.length === 0) && (!idea.supportedIdeas || idea.supportedIdeas.length === 0));
          } else if (input.uncommitted) {
            // Not committed to any phase, regardless of parents. Surfaces ideas
            // that are connected (have a parent) but invisible to phase-based
            // discovery like get_prioritized_ideas — the work backlog to triage
            // into phases. Broader than `floating` (which also requires no parents).
            ideas = ideas.filter((idea: Idea) => !idea.committedIn || idea.committedIn.length === 0);
          }
        }

        // Sorting
        if (input.sortBy) {
          ideas.sort((a: Idea, b: Idea) => {
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
          ideas = ideas.slice(input.offset);
        }
        if (input.limit !== undefined) {
          ideas = ideas.slice(0, input.limit);
        }

        return ideas;
      }),

    getRecursive: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .query(async ({ input }: any) => {
        const allIdeas = await listIdeas(input.projectPath);
        const ideaMap = new Map(allIdeas.map((a: Idea) => [a.id, a]));
        const result = new Set<Idea>();

        // Get phase root commitments
        const phase = await readPhase(input.projectPath, input.phaseId);
        const queue = [...phase.commitments];

        while (queue.length > 0) {
            const ideaId = queue.shift()!;
            if (result.has(ideaMap.get(ideaId)!)) continue;

            const idea = ideaMap.get(ideaId);
            if (idea) {
                // Filter by open status (as requested)
                if (idea.status.state === 'open') {
                    result.add(idea);
                }

                // Add children to queue (support both structures during migration)
                const connections = idea.supportingConnections || (idea as any).incoming || [];
                for (const conn of connections) {
                    const childId = typeof conn === 'string' ? conn : conn.ideaId;
                    queue.push(childId);
                }
            }
        }

        return Array.from(result);
      }),

    proposeIdeaSubtree: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        transcript: z.string().trim().min(1).max(10_000),
        existingParentIds: z.array(z.string().uuid()).max(20).default([]),
        phaseId: z.string().uuid().optional()
      }))
      .mutation(async ({ input }: any) => {
        const parents = await Promise.all(input.existingParentIds.map((id: string) => readIdea(input.projectPath, id)));
        if (parents.some(parent => parent.archived || parent.status.state === 'archived')) {
          throw new Error('Cannot generate a proposal under an archived idea');
        }
        if (input.phaseId) await readPhase(input.projectPath, input.phaseId);
        return generateProposal({
          projectPath: normalizeProjectPath(input.projectPath),
          transcript: input.transcript,
          existingParentIds: input.existingParentIds,
          phaseId: input.phaseId,
          parentContext: parents.map(parent => ({
            text: parent.text,
            ...(parent.description ? { description: parent.description } : {})
          }))
        });
      }),

    approveIdeaSubtree: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        proposal: IdeaProposalSchema,
        revision: z.string().trim().min(1).max(200),
        idempotencyKey: z.string().trim().min(8).max(500)
      }))
      .mutation(async ({ input }: any) => {
        const proposal = input.proposal as IdeaProposal;
        if (input.revision !== proposal.revision) {
          throw new Error(`Stale approval revision: expected ${proposal.revision}, received ${input.revision}`);
        }

        // Validate every external reference before the first graph write.
        for (const parentId of proposal.existingParentIds) {
          const parent = await readIdea(input.projectPath, parentId);
          if (parent.archived || parent.status.state === 'archived') {
            throw new Error(`Cannot attach proposal to archived idea ${parentId}`);
          }
        }
        if (proposal.phaseId) await readPhase(input.projectPath, proposal.phaseId);

        const flat = flattenIdeaProposal(proposal.root);
        const hash = proposalHash(proposal);
        const journalPath = approvalJournalPath(input.projectPath, input.idempotencyKey);
        await fs.ensureDir(path.dirname(journalPath));

        let journal: ApprovalJournal;
        if (await fs.pathExists(journalPath)) {
          journal = await fs.readJson(journalPath);
          if (journal.proposalHash !== hash || journal.revision !== proposal.revision) {
            throw new Error('Idempotency key is already bound to a different proposal snapshot');
          }
          if (journal.complete) {
            const replayedRootIdeaId = journal.idMap[proposal.root.proposalId];
            if (!replayedRootIdeaId) throw new Error('Completed approval journal has no root idea ID');
            return {
              complete: true,
              replayed: true,
              rootIdeaId: replayedRootIdeaId,
              idMap: journal.idMap,
              completedOperations: journal.completedOperations
            };
          }
        } else {
          journal = {
            proposalHash: hash,
            revision: proposal.revision,
            idMap: Object.fromEntries(flat.ideas.map(idea => [idea.proposalId, uuidv4()])),
            completedOperations: 0,
            complete: false
          };
          await fs.writeJson(journalPath, journal, { spaces: 2 });
        }

        const connectionByParent = new Map<string, typeof flat.connections>();
        for (const connection of flat.connections) {
          const connections = connectionByParent.get(connection.parentProposalId) ?? [];
          connections.push(connection);
          connectionByParent.set(connection.parentProposalId, connections);
        }
        const parentByChild = new Map(flat.connections.map(connection => [
          connection.childProposalId,
          connection.parentProposalId
        ]));
        const durableId = (proposalId: string) => {
          const id = journal.idMap[proposalId];
          if (!id) throw new Error(`Approval journal is missing an ID for proposal ${proposalId}`);
          return id;
        };
        const operations: Array<() => Promise<void>> = flat.ideas.map(proposed => async () => {
          const internalParent = parentByChild.get(proposed.proposalId);
          const isRoot = proposed.proposalId === proposal.root.proposalId;
          const supportedIdeas = internalParent
            ? [durableId(internalParent)]
            : proposal.existingParentIds;
          const idea: Idea = {
            id: durableId(proposed.proposalId),
            text: proposed.text,
            description: proposed.description,
            tags: proposed.tags ?? [],
            reflections: [],
            supportingConnections: (connectionByParent.get(proposed.proposalId) ?? []).map(connection => ({
              ideaId: durableId(connection.childProposalId),
              relativePosition: getRandomRelativePosition(),
              weight: connection.weight,
              ...(connection.explanation ? { explanation: connection.explanation } : {})
            })),
            supportedIdeas,
            committedIn: isRoot && proposal.phaseId ? [proposal.phaseId] : [],
            status: {
              state: proposed.status ?? 'open',
              comment: proposed.statusComment ?? '',
              date: Date.now()
            },
            intrinsicValue: proposed.intrinsicValue ?? 0,
            valueRationale: proposed.valueRationale,
            cost: proposed.cost ?? 1,
            loopWeight: 1,
            duration: 1,
            costVariance: 0,
            valueVariance: 0,
            archived: false,
            color: defaultIdeaColor()
          };
          await writeIdea(input.projectPath, idea);
          addIdeaToIndex(input.projectPath, idea);
        });

        const rootIdeaId = durableId(proposal.root.proposalId);
        for (const parentId of proposal.existingParentIds) {
          operations.push(() => connectIdeasInternal(input.projectPath, parentId, rootIdeaId));
        }
        if (proposal.phaseId) {
          operations.push(() => commitIdeaToPhase(input.projectPath, rootIdeaId, proposal.phaseId!));
        }

        try {
          for (let index = journal.completedOperations; index < operations.length; index += 1) {
            const operation = operations[index];
            if (!operation) throw new Error(`Approval operation ${index} is missing`);
            await operation();
            journal.completedOperations = index + 1;
            await fs.writeJson(journalPath, journal, { spaces: 2 });
          }
          journal.complete = true;
          await fs.writeJson(journalPath, journal, { spaces: 2 });
          return {
            complete: true,
            replayed: false,
            rootIdeaId,
            idMap: journal.idMap,
            completedOperations: journal.completedOperations
          };
        } catch (error) {
          return {
            complete: false,
            replayed: false,
            rootIdeaId,
            idMap: journal.idMap,
            completedOperations: journal.completedOperations,
            failedOperation: journal.completedOperations,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }),

    update: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        idea: z.object({
          text: z.string().optional(),
          description: z.string().optional(),
          reflection: z.string().optional(),
          archived: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional(),
            reviewedAt: z.number().optional()
          }).optional(),
          incoming: z.array(z.string()).optional(),
          supportedIdeas: z.array(z.string()).optional(),
          committedIn: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
            ideaId: z.string().uuid(),
            relativePosition: z.tuple([z.number(), z.number()]).optional(),
            weight: z.number().optional(),
            explanation: z.string().optional()
          })).optional(),
          // Repo-level cross-repo links (idea → whole external repo). No ideaId,
          // no reciprocal back-reference, so the parent/child consistency loops
          // below deliberately ignore this field.
          supportingRepos: z.array(z.object({
            repoId: z.string().uuid(),
            relativePosition: z.tuple([z.number(), z.number()]).optional(),
            weight: z.number().optional(),
            explanation: z.string().optional()
          })).optional(),
          intrinsicValue: z.number().finite().nonnegative().optional(),
          valueRationale: z.string().optional(),
          cost: z.number().finite().positive('Estimated direct cost must be greater than 0').optional(),
          duration: z.number().finite().nonnegative('Days until return must be 0 or greater').optional(),
          loopWeight: z.number().optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const existingIdea = await readIdea(input.projectPath, input.ideaId);

        // Handle consistency for supportedIdeas (Parents)
        if (input.idea.supportedIdeas) {
            const oldParents = new Set<string>(existingIdea.supportedIdeas || []);
            const newParents = new Set<string>(input.idea.supportedIdeas);

            // Removed Parents
            for (const parentId of oldParents) {
                if (!newParents.has(parentId)) {
                    try {
                        const parent = await readIdea(input.projectPath, parentId);
                        if (parent.supportingConnections) {
                            parent.supportingConnections = parent.supportingConnections.filter((c: any) => c.ideaId !== input.ideaId);
                            await writeIdea(input.projectPath, parent);
                        }
                    } catch(e) { console.warn(`Failed to update removed parent ${parentId}`, e); }
                }
            }

            // Added Parents
            for (const parentId of Array.from(newParents)) {
                if (!oldParents.has(parentId)) {
                    try {
                        const parent = await readIdea(input.projectPath, parentId);
                        if (!parent.supportingConnections) parent.supportingConnections = [];
                        if (!parent.supportingConnections.some((c: any) => c.ideaId === input.ideaId)) {
                            parent.supportingConnections.push({
                                ideaId: input.ideaId,
                                relativePosition: getRandomRelativePosition(),
                                weight: 1
                            });
                            await writeIdea(input.projectPath, parent);
                        }
                    } catch(e) { console.warn(`Failed to update added parent ${parentId}`, e); }
                }
            }
        }

        // Handle consistency for supportingConnections (Children)
        if (input.idea.supportingConnections) {
             const oldChildren = new Set<string>((existingIdea.supportingConnections || []).map((c: any) => c.ideaId));
             const newChildren = new Set<string>(input.idea.supportingConnections.map((c: any) => c.ideaId));

             // Removed Children
             for (const childId of oldChildren) {
                 if (!newChildren.has(childId)) {
                     try {
                         const child = await readIdea(input.projectPath, childId);
                         if (child.supportedIdeas) {
                             child.supportedIdeas = child.supportedIdeas.filter((id: string) => id !== input.ideaId);
                             await writeIdea(input.projectPath, child);
                         }
                     } catch(e) { console.warn(`Failed to update removed child ${childId}`, e); }
                 }
             }

             // Added Children
             for (const childId of Array.from(newChildren)) {
                 if (!oldChildren.has(childId)) {
                     try {
                         const child = await readIdea(input.projectPath, childId);
                         if (!child.supportedIdeas) child.supportedIdeas = [];
                         if (!child.supportedIdeas.includes(input.ideaId)) {
                             child.supportedIdeas.push(input.ideaId);
                             await writeIdea(input.projectPath, child);
                         }
                     } catch(e) { console.warn(`Failed to update added child ${childId}`, e); }
                 }
             }
        }

        // `date` means state-transition time, not "last status-object edit".
        // A comment edit or explicit relevance review must preserve it.
        let status = existingIdea.status;
        if (input.idea.status) {
          const stateChanged = input.idea.status.state !== undefined &&
            input.idea.status.state !== existingIdea.status.state;
          status = {
            ...existingIdea.status,
            ...input.idea.status,
            date: input.idea.status.date ?? (stateChanged ? Date.now() : existingIdea.status.date)
          };
        }

        let supportingConnections = existingIdea.supportingConnections;
        if (input.idea.supportingConnections) {
            supportingConnections = input.idea.supportingConnections.map((c: any) => ({
                ideaId: c.ideaId,
                relativePosition: c.relativePosition || [0,0],
                weight: c.weight || 1,
                ...(c.explanation !== undefined ? { explanation: c.explanation } : {})
            }));
        }

        let supportingRepos = existingIdea.supportingRepos;
        if (input.idea.supportingRepos) {
            supportingRepos = input.idea.supportingRepos.map((c: any) => ({
                repoId: c.repoId,
                relativePosition: c.relativePosition || [0,0],
                weight: c.weight || 1,
                ...(c.explanation !== undefined ? { explanation: c.explanation } : {})
            }));
        }

        const updatedIdea = {
          ...existingIdea,
          ...input.idea,
          status,
          supportingConnections,
          supportingRepos
        };

        await writeIdea(input.projectPath, updatedIdea);
        updateIdeaInIndex(input.projectPath, updatedIdea);

        // Update embedding (async)
        if (process.env.NODE_ENV !== 'test' && updatedIdea.text) {
          generateEmbedding(embeddingTextForIdea(updatedIdea)).then(vector => {
             if(vector) {
               saveEmbedding(input.projectPath, input.ideaId, vector);
               invalidateSemanticCache(input.projectPath);
             }
          });
        }

        return updatedIdea;
      }),

    delete: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid()
      }))
      .mutation(async ({ input }: any) => {
        // First remove the idea from all phases where it's committed
        const idea = await readIdea(input.projectPath, input.ideaId);
        for (const phaseId of idea.committedIn) {
          await removeIdeaFromPhase(input.projectPath, input.ideaId, phaseId);
        }

        // Clean up parent connections (supportedIdeas)
        for (const parentId of idea.supportedIdeas || []) {
            try {
                const parent = await readIdea(input.projectPath, parentId);
                if (parent.supportingConnections) {
                    parent.supportingConnections = parent.supportingConnections.filter((c: any) => c.ideaId !== input.ideaId);
                    await writeIdea(input.projectPath, parent);
                }
            } catch (e) {
                console.warn(`Failed to cleanup parent ${parentId} for deleted idea ${input.ideaId}: ${e}`);
            }
        }

        // Clean up child connections (supportingConnections)
        for (const conn of idea.supportingConnections || []) {
            try {
                const child = await readIdea(input.projectPath, conn.ideaId);
                if (child.supportedIdeas) {
                    child.supportedIdeas = child.supportedIdeas.filter((id: string) => id !== input.ideaId);
                    await writeIdea(input.projectPath, child);
                }
            } catch (e) {
                console.warn(`Failed to cleanup child ${conn.ideaId} for deleted idea ${input.ideaId}: ${e}`);
            }
        }

        // Then delete the idea file
        const projectPath = normalizeProjectPath(input.projectPath);
        const isArchived = idea.status.state === 'archived';
        const dirName = isArchived ? 'archived-ideas' : 'ideas';
        const ideaPath = path.join(projectPath, dirName, `${input.ideaId}.json`);
        const previous = await fs.readJson(ideaPath).catch(() => null);
        await fs.remove(ideaPath);

        // Remove from search index
        removeIdeaFromIndex(input.projectPath, input.ideaId);

        if (process.env.NODE_ENV !== 'test') {
          await removeEmbedding(input.projectPath, input.ideaId);
          invalidateSemanticCache(input.projectPath);
        }

        ee.emit('change', { type: 'idea', id: input.ideaId, projectPath: input.projectPath, deleted: true, previous });

        return { success: true };
      }),

    commitToPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        phaseId: z.string().uuid(),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }: any) => {
        await commitIdeaToPhase(input.projectPath, input.ideaId, input.phaseId, input.insertionIndex);
        return { success: true };
      }),

    removeFromPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }: any) => {
        await removeIdeaFromPhase(input.projectPath, input.ideaId, input.phaseId);
        return { success: true };
      }),

    connectIdeas: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentIdeaId: z.string().uuid(),
        childIdeaId: z.string().uuid(),
        parentIncomingIndex: z.number().optional(),
        childSupportedIdeasIndex: z.number().optional(),
        relativePosition: z.tuple([z.number(), z.number()]).optional(),
        weight: z.number().optional(),
        explanation: z.string().optional()
      }))
      .mutation(async ({ input }: any) => {
        await connectIdeasInternal(input.projectPath, input.parentIdeaId, input.childIdeaId, input.parentIncomingIndex, input.childSupportedIdeasIndex, input.relativePosition, input.weight, input.explanation);
      }),

    // Repo-level cross-repo link: attach a {repoId} edge (no ideaId) to an idea's
    // supportingRepos — the idea is supported by a WHOLE external repo, a black
    // box. Idempotent on repoId: re-linking updates the existing edge's
    // weight/position/explanation instead of duplicating. The external repo
    // keeps no back-reference (by design — you declare what supports you, never
    // that another repo needs you), so there is no reciprocal write.
    linkRepo: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        repoId: z.string().uuid(),
        relativePosition: z.tuple([z.number(), z.number()]).optional(),
        weight: z.number().optional(),
        explanation: z.string().optional()
      }))
      .mutation(async ({ input }: any) => {
        const idea = await readIdea(input.projectPath, input.ideaId);
        const existing = idea.supportingRepos ?? [];
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
        const updatedIdea = { ...idea, supportingRepos };
        await writeIdea(input.projectPath, updatedIdea);
        updateIdeaInIndex(input.projectPath, updatedIdea);
        return updatedIdea;
      }),

    unlinkRepo: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        repoId: z.string().uuid()
      }))
      .mutation(async ({ input }: any) => {
        const idea = await readIdea(input.projectPath, input.ideaId);
        const supportingRepos = (idea.supportingRepos ?? []).filter((r: any) => r.repoId !== input.repoId);
        const updatedIdea = { ...idea, supportingRepos };
        await writeIdea(input.projectPath, updatedIdea);
        updateIdeaInIndex(input.projectPath, updatedIdea);
        return updatedIdea;
      }),

    createFloatingIdea: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        idea: z.object({
          text: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional(),
            reviewedAt: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().finite().nonnegative().optional(),
          valueRationale: z.string().optional(),
          cost: z.number().finite().positive('Estimated direct cost must be greater than 0').optional(),
          duration: z.number().finite().nonnegative('Days until return must be 0 or greater').optional(),
          loopWeight: z.number().optional(),
          supportedIdeas: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
             ideaId: z.string(),
             weight: z.number().optional(),
             relativePosition: z.tuple([z.number(), z.number()]).optional(),
             explanation: z.string().optional()
          })).optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const ideaId = uuidv4();
        const status = input.idea.status
          ? {
              state: input.idea.status.state || 'open',
              comment: input.idea.status.comment || '',
              date: input.idea.status.date || Date.now(),
              ...(input.idea.status.reviewedAt !== undefined ? { reviewedAt: input.idea.status.reviewedAt } : {})
            }
          : { state: 'open' as const, comment: '', date: Date.now() };

        // Check if this is the first idea in the project
        const normalizedPath = normalizeProjectPath(input.projectPath);
        const ideasDir = path.join(normalizedPath, 'ideas');
        const existingIdeas = await fs.pathExists(ideasDir)
          ? (await fs.readdir(ideasDir)).filter(f => f.endsWith('.json')).length
          : 0;
        const isFirstIdea = existingIdeas === 0;

        const primaryParentId = input.idea.supportedIdeas?.[0];
        const idea: Idea = {
          id: ideaId,
          text: input.idea.text,
          description: input.idea.description,
          tags: input.idea.tags || [],
          reflections: [],
          supportingConnections: [],
          supportedIdeas: [],
          committedIn: [],
          status,
          intrinsicValue: input.idea.intrinsicValue ?? (isFirstIdea ? 1000 : 0),
          valueRationale: input.idea.valueRationale,
          cost: input.idea.cost ?? 1,
          loopWeight: input.idea.loopWeight ?? 1,
          duration: input.idea.duration ?? 1,
          costVariance: input.idea.costVariance ?? 0,
          valueVariance: input.idea.valueVariance ?? 0,
          archived: false,
          color: await resolveCreationColor(input.projectPath, input.idea.color, primaryParentId)
        };

        await writeIdea(input.projectPath, idea);
        addIdeaToIndex(input.projectPath, idea);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(embeddingTextForIdea(idea)).then(vector => {
             if(vector) {
               saveEmbedding(input.projectPath, ideaId, vector);
               invalidateSemanticCache(input.projectPath);
             }
          });
        }

        if (input.idea.supportedIdeas) {
            for (const parentId of input.idea.supportedIdeas) {
                await connectIdeasInternal(input.projectPath, parentId, ideaId);
            }
        }

        if (input.idea.supportingConnections) {
            for (const conn of input.idea.supportingConnections) {
                await connectIdeasInternal(input.projectPath, ideaId, conn.ideaId, undefined, undefined, conn.relativePosition, conn.weight, conn.explanation);
            }
        }

        return idea;
      }),

    createSubIdea: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentIdeaId: z.string().uuid(),
        idea: z.object({
          text: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional(),
            reviewedAt: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().finite().nonnegative().optional(),
          valueRationale: z.string().optional(),
          cost: z.number().finite().positive('Estimated direct cost must be greater than 0').optional(),
          duration: z.number().finite().nonnegative('Days until return must be 0 or greater').optional(),
          loopWeight: z.number().optional(),
          supportedIdeas: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
             ideaId: z.string(),
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
        const childIdeaId = uuidv4();
        const status = input.idea.status
          ? {
              state: input.idea.status.state || 'open',
              comment: input.idea.status.comment || '',
              date: input.idea.status.date || Date.now(),
              ...(input.idea.status.reviewedAt !== undefined ? { reviewedAt: input.idea.status.reviewedAt } : {})
            }
          : { state: 'open' as const, comment: '', date: Date.now() };

        const childIdea: Idea = {
          id: childIdeaId,
          text: input.idea.text,
          description: input.idea.description,
          tags: input.idea.tags || [],
          reflections: [],
          supportingConnections: [],
          supportedIdeas: [],
          committedIn: [],
          status,
          intrinsicValue: input.idea.intrinsicValue ?? 0,
          valueRationale: input.idea.valueRationale,
          cost: input.idea.cost ?? 1,
          loopWeight: input.idea.loopWeight ?? 1,
          duration: input.idea.duration ?? 1,
          costVariance: input.idea.costVariance ?? 0,
          valueVariance: input.idea.valueVariance ?? 0,
          archived: false,
          color: await resolveCreationColor(input.projectPath, input.idea.color, input.parentIdeaId)
        };

        await writeIdea(input.projectPath, childIdea);
        addIdeaToIndex(input.projectPath, childIdea);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(embeddingTextForIdea(childIdea)).then(vector => {
             if(vector) saveEmbedding(input.projectPath, childIdeaId, vector);
          });
        }

        await connectIdeasInternal(input.projectPath, input.parentIdeaId, childIdeaId, input.positionInParent, 0, undefined, input.weight, input.explanation);

        if (input.idea.supportedIdeas) {
            for (const parentId of input.idea.supportedIdeas) {
                if (parentId !== input.parentIdeaId) {
                    await connectIdeasInternal(input.projectPath, parentId, childIdeaId);
                }
            }
        }

        if (input.idea.supportingConnections) {
            for (const conn of input.idea.supportingConnections) {
                await connectIdeasInternal(input.projectPath, childIdeaId, conn.ideaId, undefined, undefined, conn.relativePosition, conn.weight, conn.explanation);
            }
        }

        return childIdea;
      }),

    createIdeaInPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        idea: z.object({
          text: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.string().optional(),
            comment: z.string().optional(),
            date: z.number().optional(),
            reviewedAt: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().finite().nonnegative().optional(),
          valueRationale: z.string().optional(),
          cost: z.number().finite().positive('Estimated direct cost must be greater than 0').optional(),
          duration: z.number().finite().nonnegative('Days until return must be 0 or greater').optional(),
          loopWeight: z.number().optional(),
          supportedIdeas: z.array(z.string()).optional(),
          supportingConnections: z.array(z.object({
             ideaId: z.string(),
             weight: z.number().optional(),
             relativePosition: z.tuple([z.number(), z.number()]).optional(),
             explanation: z.string().optional()
          })).optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
        }),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }: any) => {
        const ideaId = uuidv4();
        const status = input.idea.status
          ? {
              state: input.idea.status.state || 'open',
              comment: input.idea.status.comment || '',
              date: input.idea.status.date || Date.now(),
              ...(input.idea.status.reviewedAt !== undefined ? { reviewedAt: input.idea.status.reviewedAt } : {})
            }
          : { state: 'open' as const, comment: '', date: Date.now() };

        const primaryParentId = input.idea.supportedIdeas?.[0];
        const idea: Idea = {
          id: ideaId,
          text: input.idea.text,
          description: input.idea.description,
          tags: input.idea.tags || [],
          reflections: [],
          supportingConnections: [],
          supportedIdeas: [],
          committedIn: [input.phaseId], // Will be updated by commitIdeaToPhase
          status,
          intrinsicValue: input.idea.intrinsicValue ?? 0,
          valueRationale: input.idea.valueRationale,
          cost: input.idea.cost ?? 1,
          loopWeight: input.idea.loopWeight ?? 1,
          duration: input.idea.duration ?? 1,
          costVariance: input.idea.costVariance ?? 0,
          valueVariance: input.idea.valueVariance ?? 0,
          archived: false,
          color: await resolveCreationColor(input.projectPath, input.idea.color, primaryParentId)
        };

        await writeIdea(input.projectPath, idea);
        addIdeaToIndex(input.projectPath, idea);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(embeddingTextForIdea(idea)).then(vector => {
             if(vector) {
               saveEmbedding(input.projectPath, ideaId, vector);
               invalidateSemanticCache(input.projectPath);
             }
          });
        }

        await commitIdeaToPhase(input.projectPath, ideaId, input.phaseId, input.insertionIndex);

        if (input.idea.supportedIdeas) {
            for (const parentId of input.idea.supportedIdeas) {
                await connectIdeasInternal(input.projectPath, parentId, ideaId);
            }
        }

        if (input.idea.supportingConnections) {
            for (const conn of input.idea.supportingConnections) {
                await connectIdeasInternal(input.projectPath, ideaId, conn.ideaId, undefined, undefined, conn.relativePosition, conn.weight, conn.explanation);
            }
        }

        return idea;
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
        const allIdeas = await listIdeas(projectPath, input.archived);
        console.log(`[Search] Query: "${input.query}" | Total Ideas: ${allIdeas.length} | Archived: ${input.archived}`);

        let results: SearchIdeaResult[] = [];

        if (input.query && input.query.trim().length > 0) {
          // 1. Text Search (FlexSearch)
          const textPromise = searchIdeas(projectPath, input.query, allIdeas);

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
          const resultMap = new Map<string, SearchIdeaResult>();

          // Add Semantic Candidates
          for (const cand of vectorCandidates) {
              const idea = allIdeas.find((a: Idea) => a.id === cand.id);
              if (idea) {
                  resultMap.set(idea.id, { ...idea, score: cand.score });
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

          // Literal title matches always outrank fuzzy/semantic ones: the embedder is
          // English-only, so for other languages a verbatim hit is the strongest signal.
          const lowerQuery = input.query.trim().toLowerCase();
          for (const idea of allIdeas) {
              const position = idea.text.toLowerCase().indexOf(lowerQuery);
              if (position === -1) continue;
              const literalScore = position === 0 ? 1.5 : 1.3;
              const existing = resultMap.get(idea.id);
              if (existing) {
                  existing.score = Math.max(existing.score || 0, literalScore);
              } else {
                  resultMap.set(idea.id, { ...idea, score: literalScore });
              }
          }

          results = Array.from(resultMap.values());
        } else {
          // No query provided: start with all ideas, scored by their recency
          const now = Date.now();
          results = allIdeas.map((idea: Idea) => ({ 
            ...idea, 
            score: idea.status?.date ? Math.max(0, 1 - (now - idea.status.date) / (365 * 24 * 60 * 60 * 1000)) : 0
          }));
        }

        if (input.status) {
          const statuses = Array.isArray(input.status) ? input.status : [input.status];
          results = results.filter((idea: SearchIdeaResult) => statuses.includes(idea.status.state));
        }

        if (input.phaseId) {
          results = results.filter((idea: SearchIdeaResult) => idea.committedIn.includes(input.phaseId!));
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
                const idea = await readIdea(input.projectPath, res.id);

                let match = true;
                if (input.status) {
                    const statuses = Array.isArray(input.status) ? input.status : [input.status];
                    if (!statuses.includes(idea.status.state)) match = false;
                }
                if (match && input.phaseId) {
                    if (!idea.committedIn.includes(input.phaseId)) match = false;
                }

                if (match) {
                    results.push({ ...idea, score: res.score });
                }
            } catch (e) {
                // Ignore missing ideas
            }
        }
        return results.slice(0, input.limit || 10);
      }),

    // Add reflection to idea
    addReflection: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        reflection: z.object({
          context: z.string(),
          outcome: z.string(),
          effectiveness: z.string(),
          lesson: z.string(),
          pattern: z.string().optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const idea = await readIdea(input.projectPath, input.ideaId);

        const newReflection = {
          date: Date.now(),
          context: input.reflection.context,
          outcome: input.reflection.outcome,
          effectiveness: input.reflection.effectiveness,
          lesson: input.reflection.lesson,
          pattern: input.reflection.pattern
        };

        if (!idea.reflections) {
          idea.reflections = [];
        }
        idea.reflections.push(newReflection);

        await writeIdea(input.projectPath, idea);
        updateIdeaInIndex(input.projectPath, idea);

        return { success: true, reflection: newReflection };
      }),

    // Merge source idea B into target idea A:
    // - Rewires B's parents, children, and phase commitments onto A (deduplicating)
    // - Copies B's reflections to A
    // - Archives B
    // Guards: no self-merge, B must not already be archived. A direct parent-child
    // pair is allowed (the connecting edge is dropped to avoid a self-reference).
    merge: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        targetId: z.string().uuid(),  // A — the idea to keep
        sourceId: z.string().uuid(),  // B — the idea to archive
      }))
      .mutation(async ({ input }: any) => {
        const { projectPath, targetId, sourceId } = input;

        if (targetId === sourceId) {
          throw new Error('Cannot merge an idea into itself');
        }

        const [target, source] = await Promise.all([
          readIdea(projectPath, targetId),
          readIdea(projectPath, sourceId),
        ]);

        if (source.status.state === 'archived') {
          throw new Error(`Source idea ${sourceId} is already archived`);
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
        for (const parentId of source.supportedIdeas ?? []) {
          if (parentId === targetId) continue; // already a parent of target
          try {
            const parent = await readIdea(projectPath, parentId);
            // Replace source with target in parent's supportingConnections (or add if missing)
            const hasSource = (parent.supportingConnections ?? []).some((c: any) => c.ideaId === sourceId);
            const hasTarget = (parent.supportingConnections ?? []).some((c: any) => c.ideaId === targetId);
            if (hasSource) {
              parent.supportingConnections = (parent.supportingConnections ?? []).map((c: any) =>
                c.ideaId === sourceId ? { ...c, ideaId: targetId } : c
              );
              if (hasTarget) {
                // Both existed — remove the duplicate entry (keep first occurrence of targetId)
                const seen = new Set<string>();
                parent.supportingConnections = parent.supportingConnections.filter((c: any) => {
                  if (seen.has(c.ideaId)) return false;
                  seen.add(c.ideaId);
                  return true;
                });
              }
              await writeIdea(projectPath, parent);
            }
            // Add parentId to target.supportedIdeas if not already present
            if (!target.supportedIdeas.includes(parentId)) {
              target.supportedIdeas.push(parentId);
            }
            rewired.push(`parent ${parentId}`);
          } catch (e) {
            console.warn(`merge: could not rewire parent ${parentId}: ${e}`);
          }
        }

        // 2. Rewire source's children onto target
        for (const conn of source.supportingConnections ?? []) {
          const childId = conn.ideaId;
          if (childId === targetId) continue; // target is already a child of itself? skip
          try {
            const child = await readIdea(projectPath, childId);
            // Replace source with target in child's supportedIdeas (or add if missing)
            if ((child.supportedIdeas ?? []).includes(sourceId)) {
              child.supportedIdeas = child.supportedIdeas.filter((id: string) => id !== sourceId);
              if (!child.supportedIdeas.includes(targetId)) {
                child.supportedIdeas.push(targetId);
              }
              await writeIdea(projectPath, child);
            }
            // Add child connection to target if not already present
            const alreadyConnected = (target.supportingConnections ?? []).some((c: any) => c.ideaId === childId);
            if (!alreadyConnected) {
              if (!target.supportingConnections) target.supportingConnections = [];
              target.supportingConnections.push({
                ideaId: childId,
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
            await commitIdeaToPhase(projectPath, targetId, phaseId);
            await removeIdeaFromPhase(projectPath, sourceId, phaseId);
            // commitIdeaToPhase persists committedIn on the target's file directly,
            // but the final writeIdea(target) below writes our in-memory copy and
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
        if (source.reflection?.trim()) {
          target.reflection = [target.reflection?.trim(), source.reflection.trim()]
            .filter(Boolean)
            .join('\n\n');
        }
        target.tags = [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])];

        // Drop any direct edge between target and source in either direction: folding
        // source into target would otherwise leave target with a self-reference (an
        // edge to its own merged-away identity / a soon-archived idea).
        target.supportedIdeas = (target.supportedIdeas ?? []).filter((id: string) => id !== sourceId);
        target.supportingConnections = (target.supportingConnections ?? []).filter((c: any) => c.ideaId !== sourceId);

        // 5. Archive source — clear its connections since they've been rewired
        source.supportedIdeas = [];
        source.supportingConnections = [];
        source.committedIn = [];
        source.archived = true;
        source.status = { state: 'archived', comment: `Merged into ${targetId}`, date: Date.now() };

        // Write both
        await writeIdea(projectPath, target);
        await writeIdea(projectPath, source); // writeIdea moves to archived-ideas/ automatically
        updateIdeaInIndex(projectPath, target);
        removeIdeaFromIndex(projectPath, sourceId);

        // Merging changes the source's lifecycle and identity in every
        // environment. Skipping this in test-mode also affects real MCP
        // processes launched with NODE_ENV=test and leaves an orphaned vector.
        await removeEmbedding(projectPath, sourceId);
        invalidateSemanticCache(projectPath);

        return {
          success: true,
          rewired,
          reflectionsCopied: copiedReflections.length,
          archivedSource: sourceId,
        };
      })
  });
};
