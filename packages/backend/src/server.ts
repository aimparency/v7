import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { AimSchema, PhaseSchema, ProjectMetaSchema } from 'shared';
import type { Aim, Phase, ProjectMeta } from 'shared';
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
} from './search';

// Create context for tRPC
const createContext = () => ({});

const t = initTRPC.context<typeof createContext>().create();

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

// Utility functions for file operations
async function ensureProjectStructure(projectPath: string) {
  await fs.ensureDir(path.join(projectPath, 'aims'));
  await fs.ensureDir(path.join(projectPath, 'phases'));
}

async function writeAim(projectPath: string, aim: Aim): Promise<void> {
  await ensureProjectStructure(projectPath);
  const aimPath = path.join(projectPath, 'aims', `${aim.id}.json`);
  await fs.writeJson(aimPath, aim);
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
        projectPath: z.string()
      }))
      .query(async ({ input }) => {
        return await listAims(input.projectPath);
      }),

    update: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        aim: AimSchema.partial().omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        const existingAim = await readAim(input.projectPath, input.aimId);
        const updatedAim = { ...existingAim, ...input.aim };
        await writeAim(input.projectPath, updatedAim);
        updateAimInIndex(input.projectPath, updatedAim);
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
        await commitAimToPhase(input.projectPath, aimId, input.phaseId, input.insertionIndex);

        return aim;
      }),

    search: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        query: z.string()
      }))
      .query(async ({ input }) => {
        const aims = await listAims(input.projectPath);
        return await searchAims(input.projectPath, input.query, aims);
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

  project: t.router({
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