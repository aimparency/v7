import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { EventEmitter } from 'events';
import { z } from 'zod';
import { AimSchema, PhaseSchema, ProjectMetaSchema, AimStatusSchema, SystemStatusSchema } from 'shared';
import type { Aim, Phase, ProjectMeta, SystemStatus } from 'shared';
import {
  indexAims,
  indexPhases,
  searchAims,
  searchPhases,
  addAimToIndex,
  updateAimInIndex,
  removeAimFromIndex,
  addPhaseToIndex,
  updatePhaseInIndex,
  removePhaseFromIndex
} from './search.js';
import { generateEmbedding, saveEmbedding, removeEmbedding, searchVectors } from './embeddings.js';

// Create context for tRPC
const createContext = () => ({});

const t = initTRPC.context<typeof createContext>().create();
const ee = new EventEmitter();

// Middleware to add artificial delay for testing
const DEV_DELAY_MS = process.env.DEV_DELAY === 'true' ? 300 : 0;
const delayMiddleware = t.middleware(async ({ next }) => {
  if (DEV_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, DEV_DELAY_MS));
  }
  return next();
});

// Create procedures with delay middleware
const delayedProcedure = t.procedure.use(delayMiddleware);

const GITIGNORE_CONTENT = 'vectors.json\n';

// Utility functions for file operations
async function ensureProjectStructure(projectPath: string) {
  await fs.ensureDir(path.join(projectPath, 'aims'));
  await fs.ensureDir(path.join(projectPath, 'phases'));
  
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (!(await fs.pathExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, GITIGNORE_CONTENT);
  } else {
    let currentContent = await fs.readFile(gitignorePath, 'utf8');
    if (!currentContent.includes('vectors.json')) {
      currentContent += '\n' + GITIGNORE_CONTENT;
      await fs.writeFile(gitignorePath, currentContent);
    }
  }
}

async function writeAim(projectPath: string, aim: Aim): Promise<void> {
  await ensureProjectStructure(projectPath);
  const aimPath = path.join(projectPath, 'aims', `${aim.id}.json`);
  await fs.writeJson(aimPath, aim);
  ee.emit('change', { type: 'aim', id: aim.id, projectPath });
}

async function readAim(projectPath: string, aimId: string): Promise<Aim> {
  const aimPath = path.join(projectPath, 'aims', `${aimId}.json`);
  return await fs.readJson(aimPath);
}

async function listAims(projectPath: string): Promise<Aim[]> {
  const aimsDir = path.join(projectPath, 'aims');
  if (!await fs.pathExists(aimsDir)) return [];
  
  const files = await fs.readdir(aimsDir);
  const aims: Aim[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const aim = await fs.readJson(path.join(aimsDir, file));
      aims.push(aim);
    }
  }
  
  return aims;
}

async function writePhase(projectPath: string, phase: Phase): Promise<void> {
  await ensureProjectStructure(projectPath);
  const phasePath = path.join(projectPath, 'phases', `${phase.id}.json`);
  await fs.writeJson(phasePath, phase);
  ee.emit('change', { type: 'phase', id: phase.id, projectPath });
}

async function readPhase(projectPath: string, phaseId: string): Promise<Phase> {
  const phasePath = path.join(projectPath, 'phases', `${phaseId}.json`);
  return await fs.readJson(phasePath);
}

async function listPhases(projectPath: string, parentPhaseId?: string | null): Promise<Phase[]> {
  const phasesDir = path.join(projectPath, 'phases');
  if (!await fs.pathExists(phasesDir)) return [];
  
  const files = await fs.readdir(phasesDir);
  const phases: Phase[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const phase = await fs.readJson(path.join(phasesDir, file));
      if (parentPhaseId === undefined || phase.parent === parentPhaseId) {
        phases.push(phase);
      }
    }
  }
  
  return phases;
}

async function readSystemStatus(projectPath: string): Promise<SystemStatus> {
  const systemPath = path.join(projectPath, 'system.json');
  if (await fs.pathExists(systemPath)) {
    return await fs.readJson(systemPath);
  }
  // Default initial status
  const initialStatus: SystemStatus = { computeCredits: 10.0, funds: 0.0 };
  await ensureProjectStructure(projectPath);
  await fs.writeJson(systemPath, initialStatus);
  return initialStatus;
}

async function writeSystemStatus(projectPath: string, status: SystemStatus): Promise<void> {
  await ensureProjectStructure(projectPath);
  const systemPath = path.join(projectPath, 'system.json');
  await fs.writeJson(systemPath, status);
  ee.emit('change', { type: 'system', id: 'status', projectPath });
}

// Helper function to add aim to phase's commitments and aim's committedIn
async function commitAimToPhase(projectPath: string, aimId: string, phaseId: string, insertionIndex?: number): Promise<void> {
  // Update the phase
  const phase = await readPhase(projectPath, phaseId);
  console.log(`commitAimToPhase: aimId=${aimId}, phaseId=${phaseId}, insertionIndex=${insertionIndex}`);
  console.log(`Before: phase.commitments =`, phase.commitments);
  
  if (!phase.commitments.includes(aimId)) {
    if (insertionIndex !== undefined && insertionIndex <= phase.commitments.length) {
      // Insert at specific position
      console.log(`Inserting at index ${insertionIndex}`);
      phase.commitments.splice(insertionIndex, 0, aimId);
    } else {
      // Append to end
      console.log(`Appending to end (insertionIndex was ${insertionIndex})`);
      phase.commitments.push(aimId);
    }
    console.log(`After: phase.commitments =`, phase.commitments);
    await writePhase(projectPath, phase);
  } else {
    console.log(`Aim ${aimId} already in phase commitments`);
  }
  
  // Update the aim
  const aim = await readAim(projectPath, aimId);
  if (!aim.committedIn.includes(phaseId)) {
    aim.committedIn.push(phaseId);
    await writeAim(projectPath, aim);
  }
}

// Helper function to remove aim from phase's commitments and aim's committedIn
async function removeAimFromPhase(projectPath: string, aimId: string, phaseId: string): Promise<void> {
  // Update the phase
  const phase = await readPhase(projectPath, phaseId);
  phase.commitments = phase.commitments.filter(id => id !== aimId);
  await writePhase(projectPath, phase);

  // Update the aim
  const aim = await readAim(projectPath, aimId);
  aim.committedIn = (aim.committedIn || []).filter(id => id !== phaseId);
  await writeAim(projectPath, aim);
}

// Helper function to connect aims (reused by connectAims and createSubAim)
async function connectAimsInternal(projectPath: string, parentAimId: string, childAimId: string, parentIncomingIndex?: number, childOutgoingIndex?: number): Promise<void> {
  console.log('connectAimsInternal:', { parentAimId, childAimId, parentIncomingIndex, childOutgoingIndex });
  const parent = await readAim(projectPath, parentAimId);
  const child = await readAim(projectPath, childAimId);

  // Update parent's incoming (sub-aim goes into parent's incoming)
  let targetParentIndex = parentIncomingIndex !== undefined ? parentIncomingIndex : parent.incoming.length;
  const currentChildIndex = parent.incoming.indexOf(childAimId);
  if (currentChildIndex === targetParentIndex) {
    // Already at the correct position
  } else {
    // Remove from current position if present
    if (currentChildIndex !== -1) {
      parent.incoming.splice(currentChildIndex, 1);
    }
    // Insert at target position
    if (targetParentIndex <= parent.incoming.length) {
      parent.incoming.splice(targetParentIndex, 0, childAimId);
    } else {
      parent.incoming.push(childAimId);
    }
  }
  await writeAim(projectPath, parent);

  // Update child's outgoing (parent goes into child's outgoing)
  let targetChildIndex = childOutgoingIndex !== undefined ? childOutgoingIndex : child.outgoing.length;
  const currentParentIndex = child.outgoing.indexOf(parentAimId);
  if (currentParentIndex === targetChildIndex) {
    // Already at the correct position
  } else {
    // Remove from current position if present
    if (currentParentIndex !== -1) {
      child.outgoing.splice(currentParentIndex, 1);
    }
    // Insert at target position
    if (targetChildIndex <= child.outgoing.length) {
      child.outgoing.splice(targetChildIndex, 0, parentAimId);
    } else {
      child.outgoing.push(parentAimId);
    }
  }
  console.log(parent, child)
  await writeAim(projectPath, child);
}

// Migration function to populate committedIn field for existing aims
async function migrateCommittedInField(projectPath: string): Promise<void> {
  const allAims = await listAims(projectPath);
  const allPhases = await listPhases(projectPath);
  
  // Create a map of aimId -> phaseIds that commit this aim
  const aimCommitments: Record<string, string[]> = {};
  
  // Initialize all aims with empty arrays
  for (const aim of allAims) {
    aimCommitments[aim.id] = [];
  }
  
  // Populate from phase commitments
  for (const phase of allPhases) {
    for (const aimId of phase.commitments) {
      if (aimCommitments[aimId]) {
        aimCommitments[aimId].push(phase.id);
      }
    }
  }
  
  // Update all aims that don't have committedIn field or have incorrect data
  for (const aim of allAims) {
    const expectedCommittedIn = aimCommitments[aim.id] || [];
    if (!aim.committedIn || JSON.stringify(aim.committedIn.sort()) !== JSON.stringify(expectedCommittedIn.sort())) {
      aim.committedIn = expectedCommittedIn;
      await writeAim(projectPath, aim);
    }
  }
}

// Create the actual tRPC router
const appRouter = t.router({
  aim: t.router({
    get: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        return await readAim(input.projectPath, input.aimId);
      }),

    list: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        phaseId: z.string().uuid().optional(),
        floating: z.boolean().optional(),
        ids: z.array(z.string().uuid()).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        sortBy: z.enum(['date', 'status', 'text']).optional(),
        sortOrder: z.enum(['asc', 'desc']).optional()
      }))
      .query(async ({ input }) => {
        let aims = await listAims(input.projectPath);
        
        if (input.ids) {
          aims = aims.filter(aim => input.ids!.includes(aim.id));
        } else {
          // Only apply other filters if ids is not provided (or combine? usually ids is specific)
          // Let's allow combining or overriding. If IDs are asked, we usually just want those.
          // But keeping existing logic flow:
          
          if (input.status) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            aims = aims.filter(aim => statuses.includes(aim.status.state));
          }

          if (input.phaseId) {
            aims = aims.filter(aim => aim.committedIn.includes(input.phaseId!));
          } else if (input.floating) {
            aims = aims.filter(aim => (!aim.committedIn || aim.committedIn.length === 0) && (!aim.outgoing || aim.outgoing.length === 0));
          }
        }

        // Sorting
        if (input.sortBy) {
          aims.sort((a, b) => {
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

    update: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        aim: AimSchema.partial().omit({ id: true }).extend({
          status: AimStatusSchema.partial().optional()
        })
      }))
      .mutation(async ({ input }) => {
        const existingAim = await readAim(input.projectPath, input.aimId);
        
        // Handle status deep merge and date default
        let status = existingAim.status;
        if (input.aim.status) {
          status = {
            ...existingAim.status,
            ...input.aim.status,
            date: input.aim.status.date ?? Date.now()
          };
        }

        const updatedAim = { 
          ...existingAim, 
          ...input.aim,
          status
        };
        
        await writeAim(input.projectPath, updatedAim);
        updateAimInIndex(input.projectPath, updatedAim);

        // Update embedding (async)
        generateEmbedding(updatedAim.text).then(vector => {
           if(vector) saveEmbedding(input.projectPath, input.aimId, vector);
        });

        return updatedAim;
      }),

    delete: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        // First remove the aim from all phases where it's committed
        const aim = await readAim(input.projectPath, input.aimId);
        for (const phaseId of aim.committedIn) {
          await removeAimFromPhase(input.projectPath, input.aimId, phaseId);
        }

        // Then delete the aim file
        const aimPath = path.join(input.projectPath, 'aims', `${input.aimId}.json`);
        await fs.remove(aimPath);

        // Remove from search index
        removeAimFromIndex(input.projectPath, input.aimId);
        await removeEmbedding(input.projectPath, input.aimId);
        
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
      .mutation(async ({ input }) => {
        await commitAimToPhase(input.projectPath, input.aimId, input.phaseId, input.insertionIndex);
        return { success: true };
      }),

    removeFromPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        await removeAimFromPhase(input.projectPath, input.aimId, input.phaseId);
        return { success: true };
      }),

    connectAims: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentAimId: z.string().uuid(),
        childAimId: z.string().uuid(),
        parentIncomingIndex: z.number().optional(),
        childOutgoingIndex: z.number().optional()
      }))
      .mutation(async ({ input }) => {
        await connectAimsInternal(input.projectPath, input.parentAimId, input.childAimId, input.parentIncomingIndex, input.childOutgoingIndex);
        return { success: true };
      }),

    createFloatingAim: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aim: AimSchema.omit({ id: true, incoming: true, outgoing: true, committedIn: true })
      }))
      .mutation(async ({ input }) => {
        const aimId = uuidv4();
        const aim: Aim = {
          id: aimId,
          text: input.aim.text,
          description: input.aim.description,
          tags: input.aim.tags || [],
          incoming: [],
          outgoing: [],
          committedIn: [],
          status: input.aim.status || {
            state: 'open',
            comment: '',
            date: Date.now()
          }
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        generateEmbedding(aim.text).then(vector => {
           if(vector) saveEmbedding(input.projectPath, aimId, vector);
        });

        return aim;
      }),

    createSubAim: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentAimId: z.string().uuid(),
        aim: AimSchema.omit({ id: true, incoming: true, outgoing: true, committedIn: true }),
        positionInParent: z.number().optional()
      }))
      .mutation(async ({ input }) => {
        const childAimId = uuidv4();
        const childAim: Aim = {
          id: childAimId,
          text: input.aim.text,
          description: input.aim.description,
          tags: input.aim.tags || [],
          incoming: [],
          outgoing: [],
          committedIn: [],
          status: input.aim.status || {
            state: 'open',
            comment: '',
            date: Date.now()
          }
        };

        await writeAim(input.projectPath, childAim);
        addAimToIndex(input.projectPath, childAim);

        generateEmbedding(childAim.text).then(vector => {
           if(vector) saveEmbedding(input.projectPath, childAimId, vector);
        });

        await connectAimsInternal(input.projectPath, input.parentAimId, childAimId, input.positionInParent, 0);

        return childAim;
      }),

    createAimInPhase: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        aim: AimSchema.omit({ id: true, incoming: true, outgoing: true, committedIn: true }),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }) => {
        const aimId = uuidv4();
        const aim: Aim = {
          id: aimId,
          text: input.aim.text,
          description: input.aim.description,
          tags: input.aim.tags || [],
          incoming: [],
          outgoing: [],
          committedIn: [input.phaseId], // Will be updated by commitAimToPhase
          status: input.aim.status || {
            state: 'open',
            comment: '',
            date: Date.now()
          }
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        generateEmbedding(aim.text).then(vector => {
           if(vector) saveEmbedding(input.projectPath, aimId, vector);
        });

        await commitAimToPhase(input.projectPath, aimId, input.phaseId, input.insertionIndex);

        return aim;
      }),

    search: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        query: z.string(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        phaseId: z.string().uuid().optional(),
        limit: z.number().optional(),
        offset: z.number().optional()
      }))
      .query(async ({ input }) => {
        const allAims = await listAims(input.projectPath);
        console.log(`[Search] Query: "${input.query}" | Total Aims: ${allAims.length}`);
        
        let results = await searchAims(input.projectPath, input.query, allAims);
        console.log(`[Search] Search results (before filter): ${results.length}`);

        if (input.status) {
          const statuses = Array.isArray(input.status) ? input.status : [input.status];
          results = results.filter(aim => statuses.includes(aim.status.state));
        }

        if (input.phaseId) {
          results = results.filter(aim => aim.committedIn.includes(input.phaseId!));
        }

        // Pagination
        if (input.offset !== undefined) {
          results = results.slice(input.offset);
        }
        if (input.limit !== undefined) {
          results = results.slice(0, input.limit);
        }
        
        console.log(`[Search] Final results: ${results.length}`);
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
      .query(async ({ input }) => {
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
      })
  }),

  phase: t.router({
    create: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phase: PhaseSchema.omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        const phaseId = uuidv4();
        const phase: Phase = {
          id: phaseId,
          ...input.phase
        };

        await writePhase(input.projectPath, phase);
        addPhaseToIndex(input.projectPath, phase);
        return { id: phaseId };
      }),

    get: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        return await readPhase(input.projectPath, input.phaseId);
      }),

    list: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentPhaseId: z.string().uuid().nullable().optional()
      }))
      .query(async ({ input }) => {
        return await listPhases(input.projectPath, input.parentPhaseId);
      }),

    update: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        phase: PhaseSchema.partial().omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        const existingPhase = await readPhase(input.projectPath, input.phaseId);
        const updatedPhase = { ...existingPhase, ...input.phase };
        await writePhase(input.projectPath, updatedPhase);
        updatePhaseInIndex(input.projectPath, updatedPhase);
        return updatedPhase;
      }),

    delete: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        const phasePath = path.join(input.projectPath, 'phases', `${input.phaseId}.json`);
        await fs.remove(phasePath);
        removePhaseFromIndex(input.projectPath, input.phaseId);
        ee.emit('change', { type: 'phase', id: input.phaseId, projectPath: input.projectPath });
        return { success: true };
      }),

    search: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        query: z.string(),
        parentPhaseId: z.string().uuid().nullable().optional()
      }))
      .query(async ({ input }) => {
        const phases = await listPhases(input.projectPath, input.parentPhaseId);
        return await searchPhases(input.projectPath, input.query, phases);
      })
  }),

  system: t.router({
    getStatus: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }) => {
        return await readSystemStatus(input.projectPath);
      }),

    updateStatus: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        status: SystemStatusSchema.partial()
      }))
      .mutation(async ({ input }) => {
        const current = await readSystemStatus(input.projectPath);
        const updated = { ...current, ...input.status };
        await writeSystemStatus(input.projectPath, updated);
        return updated;
      }),

    performWork: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        workType: z.enum(['mining', 'freelance']).optional()
      }))
      .mutation(async ({ input }) => {
        const current = await readSystemStatus(input.projectPath);
        
        // Simulate work logic
        const earnedCredits = Math.floor(Math.random() * 5) + 5; // 5-10 credits
        const earnedFunds = Math.floor(Math.random() * 10) + 1; // 1-10 funds
        
        const updated = {
          computeCredits: current.computeCredits + earnedCredits,
          funds: current.funds + earnedFunds
        };
        
        await writeSystemStatus(input.projectPath, updated);
        
        return {
          ...updated,
          earned: {
            credits: earnedCredits,
            funds: earnedFunds
          }
        };
      })
  }),

  project: t.router({
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
      .query(async ({ input }) => {
        const metaPath = path.join(input.projectPath, 'meta.json');
        if (await fs.pathExists(metaPath)) {
          return await fs.readJson(metaPath);
        }
        return null;
      }),

    buildSearchIndex: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }) => {
        const aims = await listAims(input.projectPath);
        const phases = await listPhases(input.projectPath);

        indexAims(input.projectPath, aims);
        indexPhases(input.projectPath, phases);

        // Background embedding generation
        (async () => {
            console.log(`Starting embedding generation for ${aims.length} aims...`);
            for (const aim of aims) {
                const vector = await generateEmbedding(aim.text);
                if (vector) {
                    await saveEmbedding(input.projectPath, aim.id, vector);
                }
            }
            console.log('Embedding generation complete.');
        })().catch(console.error);

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
        meta: ProjectMetaSchema
      }))
      .mutation(async ({ input }) => {
        await ensureProjectStructure(input.projectPath);
        const metaPath = path.join(input.projectPath, 'meta.json');
        await fs.writeJson(metaPath, input.meta);
        return input.meta;
      }),

    migrateCommittedIn: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }) => {
        await migrateCommittedInField(input.projectPath);
        return { success: true };
      }),

    migrateTags: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }) => {
        const aims = await listAims(input.projectPath);
        for (const aim of aims) {
          if (!aim.tags) {
            aim.tags = [];
            await writeAim(input.projectPath, aim);
          }
        }
        return { success: true };
      }),

    checkConsistency: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }) => {
        const aims = await listAims(input.projectPath);
        const phases = await listPhases(input.projectPath);
        const errors: string[] = [];

        const aimMap = new Map(aims.map(a => [a.id, a]));
        const phaseMap = new Map(phases.map(p => [p.id, p]));

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

        // Check 2: Aim <-> Aim consistency (incoming/outgoing)
        for (const aim of aims) {
          for (const parentId of aim.incoming) {
            if (!aimMap.has(parentId)) {
              errors.push(`Aim ${aim.id} has non-existent incoming (parent) ${parentId}`);
            } else {
              const parent = aimMap.get(parentId)!;
              if (!parent.outgoing.includes(aim.id)) {
                errors.push(`Aim ${aim.id} lists ${parentId} as incoming, but ${parentId} does not list ${aim.id} as outgoing`);
              }
            }
          }

          for (const childId of aim.outgoing) {
            if (!aimMap.has(childId)) {
              errors.push(`Aim ${aim.id} has non-existent outgoing (child) ${childId}`);
            } else {
              const child = aimMap.get(childId)!;
              if (!child.incoming.includes(aim.id)) {
                errors.push(`Aim ${aim.id} lists ${childId} as outgoing, but ${childId} does not list ${aim.id} as incoming`);
              }
            }
          }
        }

        return { valid: errors.length === 0, errors };
      }),

    fixConsistency: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }) => {
        const aims = await listAims(input.projectPath);
        const phases = await listPhases(input.projectPath);
        const fixes: string[] = [];

        const aimMap = new Map(aims.map(a => [a.id, a]));
        const phaseMap = new Map(phases.map(p => [p.id, p]));

        // Fix 1: Aim <-> Phase consistency (Phase is truth)
        // Remove invalid phases from Aim
        for (const aim of aims) {
          const originalCommittedIn = [...aim.committedIn];
          aim.committedIn = aim.committedIn.filter(phaseId => {
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

        // Add missing phases to Aim (from Phase commitments)
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

        // Fix 2: Aim <-> Aim consistency (Reciprocity)
        for (const aim of aims) {
          // Incoming (Parents)
          const validIncoming = [];
          for (const parentId of aim.incoming) {
            const parent = aimMap.get(parentId);
            if (!parent) {
              fixes.push(`Removed non-existent parent ${parentId} from Aim ${aim.id}`);
              continue;
            }
            validIncoming.push(parentId);
            
            if (!parent.outgoing.includes(aim.id)) {
              parent.outgoing.push(aim.id);
              await writeAim(input.projectPath, parent);
              fixes.push(`Added outgoing child ${aim.id} to Parent ${parent.id}`);
            }
          }
          if (validIncoming.length !== aim.incoming.length) {
            aim.incoming = validIncoming;
            await writeAim(input.projectPath, aim);
          }

          // Outgoing (Children)
          const validOutgoing = [];
          for (const childId of aim.outgoing) {
            const child = aimMap.get(childId);
            if (!child) {
              fixes.push(`Removed non-existent child ${childId} from Aim ${aim.id}`);
              continue;
            }
            validOutgoing.push(childId);
            
            if (!child.incoming.includes(aim.id)) {
              child.incoming.push(aim.id);
              await writeAim(input.projectPath, child);
              fixes.push(`Added incoming parent ${aim.id} to Child ${child.id}`);
            }
          }
          if (validOutgoing.length !== aim.outgoing.length) {
            aim.outgoing = validOutgoing;
            await writeAim(input.projectPath, aim);
          }
        }

        return { success: true, fixes };
      })
  })
});

export { appRouter };
export type AppRouter = typeof appRouter;

// Create HTTP server
const server = createHTTPServer({
  router: appRouter,
  createContext,
});

// Start servers (only if not in test environment)
const HTTP_PORT = 3000;
if (process.env.NODE_ENV !== 'test') {
  // Create WebSocket server
  const wss = new WebSocketServer({ port: 3001 });

  const handler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext,
  });

  wss.on('connection', (ws) => {
    console.log(`WebSocket connection established (${wss.clients.size})`);
    ws.once('close', () => {
      console.log(`WebSocket connection closed (${wss.clients.size})`);
    });
  });

  server.listen(HTTP_PORT, () => {
    console.log(`HTTP Server running on http://localhost:${HTTP_PORT}`);
  });

  console.log(`WebSocket Server running on ws://localhost:3001`);

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close();
    wss.close();
  });
}