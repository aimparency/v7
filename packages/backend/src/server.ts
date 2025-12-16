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
import type { Aim, Phase, ProjectMeta, SystemStatus, SearchAimResult } from 'shared';
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
import { generateEmbedding, saveEmbedding, removeEmbedding, searchVectors, loadVectorStore } from './embeddings.js';
import { WatchdogManager } from './watchdog-manager.js';

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

function normalizeProjectPath(p: string): string {
  if (!p) return p;
  return p.endsWith('.bowman') ? p : path.join(p, '.bowman');
}

// Utility functions for file operations
async function ensureProjectStructure(rawProjectPath: string) {
  const projectPath = normalizeProjectPath(rawProjectPath);
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

async function writeAim(rawProjectPath: string, aim: Aim): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const aimPath = path.join(projectPath, 'aims', `${aim.id}.json`);
  await fs.writeJson(aimPath, aim, { spaces: 2 });
  ee.emit('change', { type: 'aim', id: aim.id, projectPath });
}

async function readAim(rawProjectPath: string, aimId: string): Promise<Aim> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const aimPath = path.join(projectPath, 'aims', `${aimId}.json`);
  const aim = await fs.readJson(aimPath);
  
  // Lazy Migration: Integrate 'incoming' into 'supportingConnections'
  if (aim.incoming && Array.isArray(aim.incoming)) {
    if (!aim.supportingConnections) {
      aim.supportingConnections = [];
    }
    
    const newConnections = [];
    for (const incomingId of aim.incoming) {
      if (!aim.supportingConnections.some((c: any) => c.aimId === incomingId)) {
        newConnections.push({
          aimId: incomingId,
          relativePosition: [0, 0] as [number, number],
          weight: 1
        });
      }
    }

    if (newConnections.length > 0 || aim.incoming.length > 0) {
       aim.supportingConnections = [...newConnections, ...aim.supportingConnections];
       delete aim.incoming;
       await writeAim(projectPath, aim);
    }
  }

  // Lazy Migration: Rename 'outgoing' to 'supportedAims'
  if (aim.outgoing && Array.isArray(aim.outgoing)) {
    if (!aim.supportedAims) {
        aim.supportedAims = [];
    }
    // Merge outgoing into supportedAims
    for (const parentId of aim.outgoing) {
        if (!aim.supportedAims.includes(parentId)) {
            aim.supportedAims.push(parentId);
        }
    }
    delete aim.outgoing;
    await writeAim(projectPath, aim);
  }

  // Ensure default array values and fix [0,0] positions
  if (!aim.supportingConnections) {
    aim.supportingConnections = [];
  } else {
    // Check for [0,0] relative positions and fix them
    let changed = false;
    for (const conn of aim.supportingConnections) {
        if (conn.relativePosition && conn.relativePosition[0] === 0 && conn.relativePosition[1] === 0) {
            conn.relativePosition = getRandomRelativePosition();
            changed = true;
        }
    }
    if (changed) {
        await writeAim(projectPath, aim);
    }
  }
  if (!aim.supportedAims) aim.supportedAims = [];
  if (!aim.committedIn) aim.committedIn = [];
  
  return aim;
}

async function listAims(rawProjectPath: string): Promise<Aim[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const aimsDir = path.join(projectPath, 'aims');
  if (!await fs.pathExists(aimsDir)) return [];
  
  const files = await fs.readdir(aimsDir);
  const aims: Aim[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const aimId = path.basename(file, '.json');
      const aim = await readAim(projectPath, aimId);
      aims.push(aim);
    }
  }
  
  return aims;
}

async function writePhase(rawProjectPath: string, phase: Phase): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const phasePath = path.join(projectPath, 'phases', `${phase.id}.json`);
  await fs.writeJson(phasePath, phase, { spaces: 2 });
  ee.emit('change', { type: 'phase', id: phase.id, projectPath });
}

async function readPhase(rawProjectPath: string, phaseId: string): Promise<Phase> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const phasePath = path.join(projectPath, 'phases', `${phaseId}.json`);
  return await fs.readJson(phasePath);
}

async function listPhases(rawProjectPath: string, parentPhaseId?: string | null): Promise<Phase[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
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

async function cleanupCommitments(rawProjectPath: string, specificPhaseId?: string): Promise<number> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const aims = await listAims(projectPath);
  let changedCount = 0;
  let validPhaseIds: Set<string> | null = null;

  if (!specificPhaseId) {
    const phases = await listPhases(projectPath);
    validPhaseIds = new Set(phases.map(p => p.id));
  }

  for (const aim of aims) {
    let changed = false;
    if (specificPhaseId) {
      if (aim.committedIn && aim.committedIn.includes(specificPhaseId)) {
        aim.committedIn = aim.committedIn.filter(id => id !== specificPhaseId);
        changed = true;
      }
    } else if (validPhaseIds) {
       if (aim.committedIn) {
         const originalLength = aim.committedIn.length;
         aim.committedIn = aim.committedIn.filter(id => validPhaseIds!.has(id));
         if (aim.committedIn.length !== originalLength) {
           changed = true;
         }
       }
    }

    if (changed) {
      await writeAim(projectPath, aim);
      changedCount++;
    }
  }
  return changedCount;
}

async function readSystemStatus(rawProjectPath: string): Promise<SystemStatus> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const systemPath = path.join(projectPath, 'system.json');
  if (await fs.pathExists(systemPath)) {
    return await fs.readJson(systemPath);
  }
  // Default initial status
  const initialStatus: SystemStatus = { computeCredits: 10.0, funds: 0.0 };
  await ensureProjectStructure(projectPath);
  await fs.writeJson(systemPath, initialStatus, { spaces: 2 });
  return initialStatus;
}

async function writeSystemStatus(rawProjectPath: string, status: SystemStatus): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const systemPath = path.join(projectPath, 'system.json');
  await fs.writeJson(systemPath, status, { spaces: 2 });
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

// Helper to generate random relative position
function getRandomRelativePosition(): [number, number] {
  const angle = Math.random() * 2 * Math.PI;
  const length = 2.5;
  return [Math.cos(angle) * length, Math.sin(angle) * length];
}

// Helper function to connect aims (reused by connectAims and createSubAim)
async function connectAimsInternal(projectPath: string, parentAimId: string, childAimId: string, parentIncomingIndex?: number, childSupportedAimsIndex?: number, relativePosition?: [number, number]): Promise<void> {
  console.log('connectAimsInternal:', { parentAimId, childAimId, parentIncomingIndex, childSupportedAimsIndex, relativePosition });
  const parent = await readAim(projectPath, parentAimId);
  const child = await readAim(projectPath, childAimId);

  // Update parent's supportingConnections (sub-aim goes into parent's supportingConnections)
  let targetParentIndex = parentIncomingIndex !== undefined ? parentIncomingIndex : parent.supportingConnections.length;
  const currentChildIndex = parent.supportingConnections.findIndex(c => c.aimId === childAimId);
  
  if (currentChildIndex === targetParentIndex) {
    // Already at the correct position
  } else {
    // Remove from current position if present
    if (currentChildIndex !== -1) {
      parent.supportingConnections.splice(currentChildIndex, 1);
      // Adjust target index if removal affected it
      if (currentChildIndex < targetParentIndex) {
        targetParentIndex--;
      }
    }
    // Insert at target position
    const newConnection = { aimId: childAimId, relativePosition: relativePosition || getRandomRelativePosition(), weight: 1 };
    
    if (targetParentIndex <= parent.supportingConnections.length) {
      parent.supportingConnections.splice(targetParentIndex, 0, newConnection);
    } else {
      parent.supportingConnections.push(newConnection);
    }
  }
  await writeAim(projectPath, parent);

  // Update child's supportedAims (parent goes into child's supportedAims)
  let targetChildIndex = childSupportedAimsIndex !== undefined ? childSupportedAimsIndex : child.supportedAims.length;
  const currentParentIndex = child.supportedAims.indexOf(parentAimId);
  if (currentParentIndex === targetChildIndex) {
    // Already at the correct position
  } else {
    // Remove from current position if present
    if (currentParentIndex !== -1) {
      child.supportedAims.splice(currentParentIndex, 1);
    }
    // Insert at target position
    if (targetChildIndex <= child.supportedAims.length) {
      child.supportedAims.splice(targetChildIndex, 0, parentAimId);
    } else {
      child.supportedAims.push(parentAimId);
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
        parentAimId: z.string().uuid().optional(),
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
          if (input.status) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            aims = aims.filter(aim => statuses.includes(aim.status.state));
          }

          if (input.phaseId) {
            aims = aims.filter(aim => aim.committedIn.includes(input.phaseId!));
          } else if (input.parentAimId) {
            aims = aims.filter(aim => aim.supportedAims.includes(input.parentAimId!));
          } else if (input.floating) {
            aims = aims.filter(aim => (!aim.committedIn || aim.committedIn.length === 0) && (!aim.supportedAims || aim.supportedAims.length === 0));
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

    getRecursive: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        const allAims = await listAims(input.projectPath);
        const aimMap = new Map(allAims.map(a => [a.id, a]));
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
            state: z.enum(['open', 'done', 'cancelled', 'partially', 'failed']).optional(),
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

        // Handle supportingConnections merge if needed? 
        // For now, if provided, we replace (simpler for updates).
        // But need to ensure relativePosition/weight defaults if partial?
        // Zod schema above handles basic types.
        // Assuming input is full connection object or we map it. 
        
        let supportingConnections = existingAim.supportingConnections;
        if (input.aim.supportingConnections) {
            supportingConnections = input.aim.supportingConnections.map(c => ({
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
             if(vector) saveEmbedding(input.projectPath, input.aimId, vector);
          });
        }

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
        
        if (process.env.NODE_ENV !== 'test') {
          await removeEmbedding(input.projectPath, input.aimId);
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
        childSupportedAimsIndex: z.number().optional(),
        relativePosition: z.tuple([z.number(), z.number()]).optional()
      }))
      .mutation(async ({ input }) => {
        await connectAimsInternal(input.projectPath, input.parentAimId, input.childAimId, input.parentIncomingIndex, input.childSupportedAimsIndex, input.relativePosition);
        return { success: true };
      }),

    createFloatingAim: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aim: z.object({
          text: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.object({
            state: z.enum(['open', 'done', 'cancelled', 'partially', 'failed']).optional(),
            comment: z.string().optional(),
            date: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional()
        })
      }))
      .mutation(async ({ input }) => {
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
          supportingConnections: [],
          supportedAims: [],
          committedIn: [],
          status,
          intrinsicValue: input.aim.intrinsicValue ?? 0,
          cost: input.aim.cost ?? 1,
          loopWeight: input.aim.loopWeight ?? 0
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(aim.text).then(vector => {
             if(vector) saveEmbedding(input.projectPath, aimId, vector);
          });
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
            state: z.enum(['open', 'done', 'cancelled', 'partially', 'failed']).optional(),
            comment: z.string().optional(),
            date: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional()
        }),
        positionInParent: z.number().optional()
      }))
      .mutation(async ({ input }) => {
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
          supportingConnections: [],
          supportedAims: [],
          committedIn: [],
          status,
          intrinsicValue: input.aim.intrinsicValue ?? 0,
          cost: input.aim.cost ?? 1,
          loopWeight: input.aim.loopWeight ?? 0
        };

        await writeAim(input.projectPath, childAim);
        addAimToIndex(input.projectPath, childAim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(childAim.text).then(vector => {
             if(vector) saveEmbedding(input.projectPath, childAimId, vector);
          });
        }

        await connectAimsInternal(input.projectPath, input.parentAimId, childAimId, input.positionInParent, 0);

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
            state: z.enum(['open', 'done', 'cancelled', 'partially', 'failed']).optional(),
            comment: z.string().optional(),
            date: z.number().optional()
          }).optional(),
          intrinsicValue: z.number().optional(),
          cost: z.number().optional(),
          loopWeight: z.number().optional()
        }),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }) => {
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
          supportingConnections: [],
          supportedAims: [],
          committedIn: [input.phaseId], // Will be updated by commitAimToPhase
          status,
          intrinsicValue: input.aim.intrinsicValue ?? 0,
          cost: input.aim.cost ?? 1,
          loopWeight: input.aim.loopWeight ?? 0
        };

        await writeAim(input.projectPath, aim);
        addAimToIndex(input.projectPath, aim);

        if (process.env.NODE_ENV !== 'test') {
          generateEmbedding(aim.text).then(vector => {
             if(vector) saveEmbedding(input.projectPath, aimId, vector);
          });
        }

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
        
        let results: SearchAimResult[] = [];

        if (input.query && input.query.trim().length > 0) {
          // Primary: FlexSearch (returns SearchAimResult[])
          results = await searchAims(input.projectPath, input.query, allAims);
          
          // Fallback/Augment: Simple text matching if FlexSearch misses obvious ones
          const lowerQuery = input.query.toLowerCase();
          const fallbackResults = allAims.filter(aim => 
            aim.text.toLowerCase().includes(lowerQuery) && 
            !results.some(r => r.id === aim.id)
          ).map(aim => ({ ...aim, score: 0.05 })); // Assign low score to fallback matches
          
          results = [...results, ...fallbackResults];
        } else {
          // No query provided: start with all aims
          results = allAims;
        }

        console.log(`[Search] Search results (after fallback/init): ${results.length}`);

        if (input.status) {
          const statuses = Array.isArray(input.status) ? input.status : [input.status];
          results = results.filter(aim => statuses.includes(aim.status.state));
        }

        if (input.phaseId) {
          results = results.filter(aim => aim.committedIn.includes(input.phaseId!));
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
        phase: z.object({
          name: z.string(),
          from: z.number(),
          to: z.number(),
          parent: z.string().nullable().optional(),
          commitments: z.array(z.string()).optional()
        })
      }))
      .mutation(async ({ input }) => {
        const phaseId = uuidv4();
        const phase: Phase = {
          id: phaseId,
          name: input.phase.name,
          from: input.phase.from,
          to: input.phase.to,
          parent: input.phase.parent ?? null,
          commitments: input.phase.commitments || []
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
        parentPhaseId: z.string().uuid().nullable().optional(),
        activeAt: z.number().optional()
      }))
      .query(async ({ input }) => {
        let phases = await listPhases(input.projectPath, input.parentPhaseId);
        if (input.activeAt !== undefined) {
          phases = phases.filter(p => p.from <= input.activeAt! && p.to >= input.activeAt!);
        }
        return phases;
      }),

    update: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        phase: z.object({
          name: z.string().optional(),
          from: z.number().optional(),
          to: z.number().optional(),
          parent: z.string().nullable().optional(),
          commitments: z.array(z.string()).optional()
        })
      }))
      .mutation(async ({ input }) => {
        const existingPhase = await readPhase(input.projectPath, input.phaseId);
        
        // Manual merge to satisfy type checker
        const updatedPhase: Phase = {
            ...existingPhase,
            ...(input.phase.name !== undefined ? { name: input.phase.name } : {}),
            ...(input.phase.from !== undefined ? { from: input.phase.from } : {}),
            ...(input.phase.to !== undefined ? { to: input.phase.to } : {}),
            ...(input.phase.parent !== undefined ? { parent: input.phase.parent } : {}),
            ...(input.phase.commitments !== undefined ? { commitments: input.phase.commitments } : {})
        };

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
        
        await cleanupCommitments(input.projectPath, input.phaseId);

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
        status: z.object({
          computeCredits: z.number().optional(),
          funds: z.number().optional()
        })
      }))
      .mutation(async ({ input }) => {
        const current = await readSystemStatus(input.projectPath);
        const updated = { 
            ...current, 
            ...(input.status.computeCredits !== undefined ? { computeCredits: input.status.computeCredits } : {}),
            ...(input.status.funds !== undefined ? { funds: input.status.funds } : {})
        };
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

  watchdog: t.router({
    start: delayedProcedure
      .input(z.object({ projectPath: z.string() }))
      .mutation(async ({ input }) => {
         const p = normalizeProjectPath(input.projectPath);
         const result = await WatchdogManager.start(p);
         return result;
      }),
    stop: delayedProcedure
      .input(z.object({ projectPath: z.string() }))
      .mutation(async ({ input }) => {
         const p = normalizeProjectPath(input.projectPath);
         const success = WatchdogManager.stop(p);
         return { success };
      }),
    getStatus: delayedProcedure
      .input(z.object({ projectPath: z.string() }))
      .query(async ({ input }) => {
         const p = normalizeProjectPath(input.projectPath);
         return WatchdogManager.getStatus(p);
      }),
    keepalive: delayedProcedure
      .input(z.object({ projectPath: z.string() }))
      .mutation(async ({ input }) => {
         const p = normalizeProjectPath(input.projectPath);
         const success = WatchdogManager.keepalive(p);
         return { success };
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
        if (process.env.NODE_ENV !== 'test') {
          (async () => {
              const vectorStore = await loadVectorStore(input.projectPath);
              const aimsToEmbed = aims.filter(aim => !vectorStore[aim.id]);

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
        meta: ProjectMetaSchema
      }))
      .mutation(async ({ input }) => {
        await ensureProjectStructure(input.projectPath);
        const metaPath = path.join(input.projectPath, 'meta.json');
        await fs.writeJson(metaPath, input.meta, { spaces: 2 });
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

    migrateIncoming: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }) => {
        const aims = await listAims(input.projectPath);
        let count = 0;
        for (const aim of aims) {
          const anyAim = aim as any;
          if (anyAim.incoming && Array.isArray(anyAim.incoming)) {
             if (!aim.supportingConnections) aim.supportingConnections = [];
             for (const id of anyAim.incoming) {
                if (!aim.supportingConnections.some(c => c.aimId === id)) {
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
      .mutation(async ({ input }) => {
        const count = await cleanupCommitments(input.projectPath);
        return { fixedAims: count };
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
              const parentHasConnection = parent.supportingConnections?.some(c => c.aimId === aim.id);
              if (!parentHasConnection) {
                errors.push(`Aim ${aim.id} lists ${parentId} as supportedAims, but ${parentId} does not list ${aim.id} in supportingConnections`);
              }
            }
          }
        }

        // Check 3: Cycle Detection - Disabled as cycles are allowed (Value Loops)
        /*
        const visited = new Set<string>();
        const recStack = new Set<string>();

        // Limit recursion depth to avoid stack overflow on massive graphs (though unlikely with visited set)
        const detectCycle = (aimId: string, path: string[]) => {
            if (recStack.has(aimId)) {
                // Cycle found
                // Only report if it's a new cycle?
                // The path shows the cycle.
                // We format the error to show the relevant part of the path
                const cycleStartIndex = path.indexOf(aimId);
                const cyclePath = path.slice(cycleStartIndex);
                errors.push(`Cycle detected: ${cyclePath.map(id => aimMap.get(id)?.text || id).join(' -> ')} -> ${aimMap.get(aimId)?.text || aimId}`);
                return;
            }
            if (visited.has(aimId)) return;

            visited.add(aimId);
            recStack.add(aimId);
            path.push(aimId);

            const aim = aimMap.get(aimId);
            if (aim && aim.supportingConnections) {
                for (const conn of aim.supportingConnections) {
                    // Only recurse if child exists (broken links handled by Check 2)
                    if (aimMap.has(conn.aimId)) {
                        detectCycle(conn.aimId, path);
                    }
                }
            }

            path.pop();
            recStack.delete(aimId);
        };

        for (const aim of aims) {
            if (!visited.has(aim.id)) {
                detectCycle(aim.id, []);
            }
        }
        */

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

        // Fix 1: Aim <-> Phase consistency
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
            if (!parent.supportingConnections.some(c => c.aimId === aim.id)) {
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
