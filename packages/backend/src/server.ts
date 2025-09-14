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

// Create context for tRPC
const createContext = () => ({});

const t = initTRPC.context<typeof createContext>().create();

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
async function commitAimToPhase(projectPath: string, aimId: string, phaseId: string): Promise<void> {
  // Update the phase
  const phase = await readPhase(projectPath, phaseId);
  if (!phase.commitments.includes(aimId)) {
    phase.commitments.push(aimId);
    await writePhase(projectPath, phase);
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
    create: t.procedure
      .input(z.object({
        projectPath: z.string(),
        aim: AimSchema.omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        const aimId = uuidv4();
        const aim: Aim = {
          id: aimId,
          text: input.aim.text,
          incoming: input.aim.incoming || [],
          outgoing: input.aim.outgoing || [],
          committedIn: input.aim.committedIn || [],
          status: input.aim.status || {
            state: 'open',
            comment: '',
            date: Date.now()
          }
        };
        
        await writeAim(input.projectPath, aim);
        return { id: aimId };
      }),

    get: t.procedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        return await readAim(input.projectPath, input.aimId);
      }),

    list: t.procedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }) => {
        return await listAims(input.projectPath);
      }),

    update: t.procedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        aim: AimSchema.partial().omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        const existingAim = await readAim(input.projectPath, input.aimId);
        const updatedAim = { ...existingAim, ...input.aim };
        await writeAim(input.projectPath, updatedAim);
        return updatedAim;
      }),

    delete: t.procedure
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
        return { success: true };
      }),

    commitToPhase: t.procedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        await commitAimToPhase(input.projectPath, input.aimId, input.phaseId);
        return { success: true };
      }),

    removeFromPhase: t.procedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        await removeAimFromPhase(input.projectPath, input.aimId, input.phaseId);
        return { success: true };
      })
  }),

  phase: t.router({
    create: t.procedure
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
        return { id: phaseId };
      }),

    get: t.procedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        return await readPhase(input.projectPath, input.phaseId);
      }),

    list: t.procedure
      .input(z.object({
        projectPath: z.string(),
        parentPhaseId: z.string().uuid().nullable().optional()
      }))
      .query(async ({ input }) => {
        return await listPhases(input.projectPath, input.parentPhaseId);
      }),

    update: t.procedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        phase: PhaseSchema.partial().omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        const existingPhase = await readPhase(input.projectPath, input.phaseId);
        const updatedPhase = { ...existingPhase, ...input.phase };
        await writePhase(input.projectPath, updatedPhase);
        return updatedPhase;
      }),

    delete: t.procedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        const phasePath = path.join(input.projectPath, 'phases', `${input.phaseId}.json`);
        await fs.remove(phasePath);
        return { success: true };
      })
  }),

  project: t.router({
    getMeta: t.procedure
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

    updateMeta: t.procedure
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

    migrateCommittedIn: t.procedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }) => {
        await migrateCommittedInField(input.projectPath);
        return { success: true };
      })
  })
});

export type AppRouter = typeof appRouter;

// Create HTTP server
const server = createHTTPServer({
  router: appRouter,
  createContext,
});

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

// Start servers
const HTTP_PORT = 3000;
server.listen(HTTP_PORT, () => {
  console.log(`HTTP Server running on http://localhost:${HTTP_PORT}`);
});

console.log(`WebSocket Server running on ws://localhost:3001`);

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close();
  wss.close();
});