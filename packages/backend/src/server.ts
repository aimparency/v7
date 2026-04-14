import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { EventEmitter } from 'events';
import { z } from 'zod';
import { AimSchema, PhaseSchema, ProjectMetaSchema, AimStatusSchema, SystemStatusSchema, AIMPARENCY_DIR_NAME, INITIAL_STATES } from 'shared';
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
import { generateEmbedding, saveEmbedding, removeEmbedding, searchVectors, loadVectorStore, hasCurrentEmbedding } from './embeddings.js';
import { getSemanticGraph, invalidateSemanticCache } from './forces.js';
import { chatWithGemini } from './voice-agent.js';
import { calculateAimValues } from 'shared';
import { saveAimValues, getAimValues, getDb } from './db.js';
import { createAimRouter } from './routers/aim.js';
import { createPhaseRouter } from './routers/phase.js';
import { createSystemRouter } from './routers/system.js';
import { createVoiceRouter } from './routers/voice.js';
import { createGraphRouter } from './routers/graph.js';
import { createMarketRouter } from './routers/market.js';
import { createProjectRouter } from './routers/project.js';

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

const GITIGNORE_CONTENT = 'vectors.json\ncache.db\nsemantic-graph.json\nruntime/\n';
const CURRENT_PHASE_DATA_MODEL_VERSION = 2;
const DEFAULT_AUTONOMY_POLICY = {
  version: 1,
  autonomyMode: 'supervised',
  preferredAgentType: null,
  sessionLeaseMinutes: 60,
  autoConnectToExistingSession: true,
  restoreAnimatorStateOnSessionRestart: true,
  requireCommitBeforeCompact: true,
  askForHumanOn: ['destructive-git', 'network', 'api-keys']
};

function normalizeProjectPath(p: string): string {
  if (!p) return p;
  return p.endsWith(AIMPARENCY_DIR_NAME) ? p : path.join(p, AIMPARENCY_DIR_NAME);
}

const indexedProjects = new Set<string>();

async function ensureSearchIndex(projectPath: string) {
    // Normalize path for consistent cache key
    const normalizedPath = normalizeProjectPath(projectPath);
    if (indexedProjects.has(normalizedPath)) return;
    
    console.log(`[Search] Building index for ${normalizedPath}...`);
    // Pass raw projectPath to list functions (they normalize internally) but use normalized for map key
    const aims = await listAims(normalizedPath);
    const phases = await listPhases(normalizedPath);
    
    indexAims(normalizedPath, aims);
    indexPhases(normalizedPath, phases);
    
    indexedProjects.add(normalizedPath);
}

// Recalculation Queue
const recalculateTimers = new Map<string, NodeJS.Timeout>();

function triggerRecalculation(projectPath: string) {
  if (recalculateTimers.has(projectPath)) {
    clearTimeout(recalculateTimers.get(projectPath)!);
  }
  recalculateTimers.set(projectPath, setTimeout(async () => {
    try {
        const aims = await listAims(projectPath);
        const result = calculateAimValues(aims);
        
        const map = new Map();
        for (const [id, value] of result.values.entries()) {
            map.set(id, {
                value,
                cost: result.costs.get(id) || 0,
                doneCost: result.doneCosts.get(id) || 0,
                priority: result.priorities.get(id) || 0
            });
        }
        saveAimValues(projectPath, map);
        // console.log(`[ValueCalc] Updated values for ${projectPath}`);
    } catch (e) {
        console.error(`[ValueCalc] Failed to recalculate for ${projectPath}`, e);
    }
  }, 1000));
}

ee.on('change', ({ type, projectPath }) => {
    if (process.env.NODE_ENV === 'test') return;
    if (type === 'aim' || type === 'phase') {
        triggerRecalculation(projectPath);
    }
});

// Utility functions for file operations
async function ensureProjectStructure(rawProjectPath: string) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await fs.ensureDir(path.join(projectPath, 'aims'));
  await fs.ensureDir(path.join(projectPath, 'archived-aims'));
  await fs.ensureDir(path.join(projectPath, 'phases'));
  await fs.ensureDir(path.join(projectPath, 'runtime'));
  await fs.ensureDir(path.join(projectPath, 'runtime', 'audit'));
  const autonomyPolicyPath = path.join(projectPath, 'runtime', 'autonomy-policy.json');
  if (!(await fs.pathExists(autonomyPolicyPath))) {
    await fs.writeJson(autonomyPolicyPath, DEFAULT_AUTONOMY_POLICY, { spaces: 2 });
  }
  
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (!(await fs.pathExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, GITIGNORE_CONTENT);
  } else {
    let currentContent = await fs.readFile(gitignorePath, 'utf8');
    let needsUpdate = false;
    
    if (!currentContent.includes('vectors.json')) {
      currentContent += '\nvectors.json';
      needsUpdate = true;
    }
    if (!currentContent.includes('cache.db')) {
        currentContent += '\ncache.db';
        needsUpdate = true;
    }
    if (!currentContent.includes('semantic-graph.json')) {
        currentContent += '\nsemantic-graph.json';
        needsUpdate = true;
    }
    if (!currentContent.includes('runtime/')) {
        currentContent += '\nruntime/';
        needsUpdate = true;
    }
    
    if (needsUpdate) {
        await fs.writeFile(gitignorePath, currentContent);
    }
  }
}

async function writeAim(rawProjectPath: string, aim: Aim): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  
  const isArchived = aim.status.state === 'archived';
  const targetDir = isArchived ? 'archived-aims' : 'aims';
  const sourceDir = isArchived ? 'aims' : 'archived-aims';
  
  const aimPath = path.join(projectPath, targetDir, `${aim.id}.json`);
  const oldPath = path.join(projectPath, sourceDir, `${aim.id}.json`);
  
  // Strip calculated values before saving
  const { calculatedValue, calculatedCost, ...aimToSave } = aim;

  await fs.writeJson(aimPath, aimToSave, { spaces: 2 });
  
  // Clean up if it was in the other location
  if (await fs.pathExists(oldPath)) {
    await fs.remove(oldPath);
  }

  ee.emit('change', { type: 'aim', id: aim.id, projectPath });
}

async function readAim(rawProjectPath: string, aimId: string): Promise<Aim> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  
  // Try active aims first
  let aimPath = path.join(projectPath, 'aims', `${aimId}.json`);
  if (!(await fs.pathExists(aimPath))) {
    // Try archived aims
    aimPath = path.join(projectPath, 'archived-aims', `${aimId}.json`);
  }
  
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
  
  return AimSchema.parse(aim);
}

async function listAims(rawProjectPath: string, archived: boolean = false): Promise<Aim[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const dirName = archived ? 'archived-aims' : 'aims';
  const aimsDir = path.join(projectPath, dirName);
  
  if (!await fs.pathExists(aimsDir)) return [];
  
  const files = await fs.readdir(aimsDir);
  const aims: Aim[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const aimId = path.basename(file, '.json');
      // For listing, we can just read directly from the dir we are in to avoid double check overhead of readAim
      // BUT readAim has migration logic. So we should use readAim.
      // readAim checks 'aims' first. 
      // If we are listing archived, readAim will check 'aims' (fail) then 'archived-aims' (success).
      // If we are listing active, readAim will check 'aims' (success).
      // So it works.
      try {
        const aim = await readAim(projectPath, aimId);
        aims.push(aim);
      } catch (e) {
        console.error(`Failed to read aim ${aimId}`, e);
      }
    }
  }
  
  return aims;
}

function populateAimValues(projectPath: string, aims: Aim[]) {
    try {
        const values = getAimValues(projectPath);
        for (const aim of aims) {
            const data = values.get(aim.id);
            if (data) {
                aim.calculatedValue = data.value;
                aim.calculatedCost = data.cost;
                aim.calculatedDoneCost = data.doneCost;
                aim.calculatedPriority = data.priority;
            }
        }
    } catch (e) {
        // Ignore DB errors (missing DB, locked, etc)
    }
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

async function writePhase(rawProjectPath: string, phase: Phase, emitChange = true): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const phasePath = path.join(projectPath, 'phases', `${phase.id}.json`);
  await writeJsonAtomic(phasePath, phase);
  if (emitChange) {
    ee.emit('change', { type: 'phase', id: phase.id, projectPath });
  }
}

async function readProjectMeta(rawProjectPath: string): Promise<ProjectMeta> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const metaPath = path.join(projectPath, 'meta.json');

  let meta: ProjectMeta;
  if (await fs.pathExists(metaPath)) {
    meta = await fs.readJson(metaPath);
  } else {
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
  }

  if (!meta.statuses) meta.statuses = INITIAL_STATES;
  if (meta.dataModelVersion === undefined) meta.dataModelVersion = 1;
  if (!meta.phaseCursors) meta.phaseCursors = {};
  if (meta.phaseActiveLevel === undefined) meta.phaseActiveLevel = 0;
  if (!meta.rootPhaseIds) meta.rootPhaseIds = [];

  return meta;
}

async function writeProjectMeta(rawProjectPath: string, meta: ProjectMeta): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const metaPath = path.join(projectPath, 'meta.json');
  await writeJsonAtomic(metaPath, meta);
}

function normalizePhase(rawPhase: unknown): Phase {
  const parsed = PhaseSchema.partial().parse(rawPhase);

  if (
    !parsed.id ||
    typeof parsed.from !== 'number' ||
    typeof parsed.to !== 'number' ||
    parsed.parent === undefined ||
    !parsed.commitments ||
    !parsed.name
  ) {
    throw new Error('Invalid phase data');
  }

  return {
    id: parsed.id,
    from: parsed.from,
    to: parsed.to,
    order: parsed.order,
    parent: parsed.parent,
    childPhaseIds: parsed.childPhaseIds ?? [],
    commitments: parsed.commitments,
    name: parsed.name
  };
}

async function readPhaseFile(rawProjectPath: string, phaseId: string): Promise<Phase> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const phasePath = path.join(projectPath, 'phases', `${phaseId}.json`);

  try {
    const data = await fs.readJson(phasePath);
    return normalizePhase(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${phasePath}: ${message}`);
  }
}

async function readPhase(rawProjectPath: string, phaseId: string): Promise<Phase> {
  return await readPhaseFile(rawProjectPath, phaseId);
}

async function listPhases(rawProjectPath: string, parentPhaseId?: string | null): Promise<Phase[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const phasesDir = path.join(projectPath, 'phases');
  if (!await fs.pathExists(phasesDir)) return [];
  
  const files = await fs.readdir(phasesDir);
  const allPhases: Phase[] = [];
  const rawPhases = new Map<string, any>();
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const phaseId = path.basename(file, '.json');
      try {
        const rawPhase = await fs.readJson(path.join(phasesDir, file));
        const normalized = normalizePhase(rawPhase);
        rawPhases.set(normalized.id, rawPhase);
        allPhases.push(normalized);
      } catch (error) {
        console.warn(`[Phase] Skipping malformed phase file ${phaseId} in ${projectPath}:`, error);
      }
    }
  }

  const meta = await readProjectMeta(projectPath);
  const phaseMap = new Map(allPhases.map((phase) => [phase.id, phase]));
  const childrenByParent = new Map<string | null, Phase[]>();

  for (const phase of allPhases) {
    const bucket = childrenByParent.get(phase.parent) ?? [];
    bucket.push(phase);
    childrenByParent.set(phase.parent, bucket);
  }

  if (parentPhaseId === undefined) {
    return allPhases;
  }

  const siblingPhases = childrenByParent.get(parentPhaseId ?? null) ?? [];
  const orderedIdsFromTree =
    parentPhaseId === null
      ? (meta.rootPhaseIds ?? []).filter((id) => {
          const phase = phaseMap.get(id);
          return phase && phase.parent === null;
        })
      : (phaseMap.get(parentPhaseId)?.childPhaseIds ?? []).filter((id) => {
          const child = phaseMap.get(id);
          return child && child.parent === parentPhaseId;
        });

  const orderedSet = new Set(orderedIdsFromTree);
  const missingSiblingIds = siblingPhases
    .map((phase) => phase.id)
    .filter((id) => !orderedSet.has(id));

  const orderedIds = [...orderedIdsFromTree, ...missingSiblingIds];

  return orderedIds
    .map((id) => phaseMap.get(id))
    .filter((phase): phase is Phase => !!phase && phase.parent === parentPhaseId);
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
  
  if (!phase.commitments.includes(aimId)) {
    if (insertionIndex !== undefined && insertionIndex <= phase.commitments.length) {
      phase.commitments.splice(insertionIndex, 0, aimId);
    } else {
      phase.commitments.push(aimId);
    }
    await writePhase(projectPath, phase);
  } else {
    // Reorder if index provided
    if (insertionIndex !== undefined) {
       const currentIndex = phase.commitments.indexOf(aimId);
       if (currentIndex !== -1 && currentIndex !== insertionIndex) {
           phase.commitments.splice(currentIndex, 1);
           // Insert at target index (relative to the array after removal)
           // If insertionIndex was calculated based on the original array,
           // and we are moving DOWN (insertion > current), we might need to adjust?
           // Frontend sends `currentIndex + 1` for move down.
           // [A, B]. Move A(0) to 1.
           // Remove A -> [B]. Insert at 1 -> [B, A]. Correct.
           // [A, B]. Move B(1) to 0.
           // Remove B -> [A]. Insert at 0 -> [B, A]. Correct.
           
           // Ensure index is within bounds of the *new* array (length - 1 + 1 = length)
           const maxIndex = phase.commitments.length;
           const targetIndex = Math.min(insertionIndex, maxIndex);
           
           phase.commitments.splice(targetIndex, 0, aimId);
           await writePhase(projectPath, phase);
       }
    }
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
async function connectAimsInternal(projectPath: string, parentAimId: string, childAimId: string, parentIncomingIndex?: number, childSupportedAimsIndex?: number, relativePosition?: [number, number], weight: number = 1): Promise<void> {
  console.log('connectAimsInternal:', { parentAimId, childAimId, parentIncomingIndex, childSupportedAimsIndex, relativePosition, weight });
  const parent = await readAim(projectPath, parentAimId);
  const child = await readAim(projectPath, childAimId);

  // Update parent's supportingConnections (sub-aim goes into parent's supportingConnections)
  let targetParentIndex = parentIncomingIndex !== undefined ? parentIncomingIndex : parent.supportingConnections.length;
  const currentChildIndex = parent.supportingConnections.findIndex(c => c.aimId === childAimId);
  
  if (currentChildIndex === targetParentIndex) {
    // Already at the correct position, but update weight if changed
    if (currentChildIndex !== -1 && parent.supportingConnections[currentChildIndex]) {
      if (parent.supportingConnections[currentChildIndex].weight !== weight) {
        parent.supportingConnections[currentChildIndex].weight = weight;
        await writeAim(projectPath, parent);
      }
    }
  } else {
    // Remove from current position if present
    if (currentChildIndex !== -1) {
      parent.supportingConnections.splice(currentChildIndex, 1);
      // No decrement needed for reordering logic from frontend
      const maxIndex = parent.supportingConnections.length;
      targetParentIndex = Math.min(targetParentIndex, maxIndex);
    }
    // Insert at target position
    const newConnection = { aimId: childAimId, relativePosition: relativePosition || getRandomRelativePosition(), weight };
    
    parent.supportingConnections.splice(targetParentIndex, 0, newConnection);
    await writeAim(projectPath, parent);
  }

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

// Helper to calculate smart sub-phase dates
// Create the actual tRPC router
const appRouter = t.router({
  aim: createAimRouter(
    t,
    delayedProcedure,
    readAim,
    listAims,
    writeAim,
    readPhase,
    commitAimToPhase,
    removeAimFromPhase,
    connectAimsInternal,
    getRandomRelativePosition,
    normalizeProjectPath,
    addAimToIndex,
    updateAimInIndex,
    removeAimFromIndex,
    generateEmbedding,
    saveEmbedding,
    removeEmbedding,
    searchVectors,
    searchAims,
    invalidateSemanticCache,
    ensureSearchIndex,
    ee
  ),
  phase: createPhaseRouter(
    t,
    delayedProcedure,
    readPhase,
    listPhases,
    writePhase,
    normalizeProjectPath,
    cleanupCommitments,
    addPhaseToIndex,
    updatePhaseInIndex,
    removePhaseFromIndex,
    searchPhases,
    ensureSearchIndex,
    ee
  ),
  system: createSystemRouter(
    t,
    delayedProcedure,
    readSystemStatus,
    writeSystemStatus
  ),
  voice: createVoiceRouter(
    t,
    delayedProcedure,
    chatWithGemini
  ),
  graph: createGraphRouter(
    t,
    delayedProcedure,
    getSemanticGraph
  ),
  market: createMarketRouter(
    t,
    delayedProcedure
  ),
  project: createProjectRouter(
    t,
    delayedProcedure,
    normalizeProjectPath,
    ensureProjectStructure,
    listAims,
    listPhases,
    writeAim,
    indexAims,
    indexPhases,
    loadVectorStore,
    hasCurrentEmbedding,
    generateEmbedding,
    saveEmbedding,
    removeEmbedding,
    migrateCommittedInField,
    cleanupCommitments,
    getDb,
    readAim,
    writePhase,
    ee
  )
});


export { appRouter };
export type AppRouter = typeof appRouter;

const HTTP_PORT = parseInt(process.env.PORT_BACKEND_HTTP || '3000');
const WS_PORT = parseInt(process.env.PORT_BACKEND_WS || '3001');

export function startServer() {
  const server = createHTTPServer({
    router: appRouter,
    createContext,
  });

  const wss = new WebSocketServer({ port: WS_PORT });

  applyWSSHandler({
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

  console.log(`WebSocket Server running on ws://localhost:${WS_PORT}`);

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close();
    wss.close();
  });
  
  return { server, wss };
}

const isMainModule =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== 'test' && isMainModule) {
  startServer();
}
