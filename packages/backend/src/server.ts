import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { EventEmitter } from 'events';
import { z } from 'zod';
import { AimSchema, PhaseSchema, ProjectMetaSchema, AimStatusSchema, SystemStatusSchema, AIMPARENCY_DIR_NAME, INITIAL_STATES } from 'shared';
import type { Aim, Phase, ProjectMeta, SystemStatus, SearchAimResult, LinkedRepo, LinkedRepoLocal } from 'shared';
import { LinkedRepoRegistrySchema, LinkedRepoSchema } from 'shared';
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
import { generateEmbedding, generateQueryEmbedding, warmupEmbedder, saveEmbedding, saveEmbeddings, removeEmbedding, searchVectors, loadVectorStore, hasCurrentEmbedding } from './embeddings.js';
import { getSemanticGraph, invalidateSemanticCache } from './forces.js';
import { chatWithGemini } from './voice-agent.js';
import { calculateAimValues, planSpinOff, computeSpinOff, remapSpinOffCollisions } from 'shared';
import { saveAimValues, getAimValues, getDb } from './db.js';
import { createAimRouter } from './routers/aim.js';
import { generateAimProposal } from './aim-proposal-generator.js';
import { createPhaseRouter } from './routers/phase.js';
import { createSystemRouter } from './routers/system.js';
import { createVoiceRouter } from './routers/voice.js';
import { createGraphRouter } from './routers/graph.js';
import { createMarketRouter } from './routers/market.js';
import { createProjectRouter } from './routers/project.js';
import { createHistoryRouter } from './routers/history.js';
import { normalizeProjectPath } from './project-path.js';
import { runWithOrigin } from './change-origin.js';
import { bowmanExists, completeDirectoryPath, resolveBowmanPath } from './path-completion.js';

// Create context for tRPC
type Context = { clientId?: string };
const createContext = (opts?: { info?: { connectionParams?: Record<string, string | undefined> | null } }): Context => ({
  clientId: opts?.info?.connectionParams?.clientId
});

const t = initTRPC.context<Context>().create();
const ee = new EventEmitter();

// Middleware to add artificial delay for testing
const DEV_DELAY_MS = process.env.DEV_DELAY === 'true' ? 300 : 0;
const delayMiddleware = t.middleware(async ({ ctx, next }) => {
  if (DEV_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, DEV_DELAY_MS));
  }
  return runWithOrigin(ctx.clientId, () => next());
});

// Create procedures with delay middleware
const delayedProcedure = t.procedure.use(delayMiddleware);

const GITIGNORE_CONTENT = 'vectors.json\ncache.db\nsemantic-graph.json\nruntime/\nsecrets.json\n';
const CURRENT_PHASE_DATA_MODEL_VERSION = 2;
const DEFAULT_AUTONOMY_POLICY = {
  version: 1,
  autonomyMode: 'supervised',
  preferredAgentType: null,
  sessionLeaseMinutes: 60,
  autoConnectToExistingSession: true,
  restoreSupervisorStateOnSessionRestart: true,
  requireCommitBeforeCompact: true,
  askForHumanOn: ['destructive-git', 'network', 'api-keys']
};


const searchIndexBuilds = new Map<string, Promise<void>>();

function ensureSearchIndex(projectPath: string): Promise<void> {
  // Normalize path for consistent cache key
  const normalizedPath = normalizeProjectPath(projectPath);
  let build = searchIndexBuilds.get(normalizedPath);
  if (!build) {
    build = (async () => {
      console.log(`[Search] Building index for ${normalizedPath}...`);
      const [aims, phases] = await Promise.all([listAims(normalizedPath), listPhases(normalizedPath)]);
      indexAims(normalizedPath, aims);
      indexPhases(normalizedPath, phases);
    })();
    // A failed build must not stick; the next caller retries.
    build.catch(() => searchIndexBuilds.delete(normalizedPath));
    searchIndexBuilds.set(normalizedPath, build);
  }
  return build;
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
    await writeJsonAtomic(autonomyPolicyPath, DEFAULT_AUTONOMY_POLICY);
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
    if (!currentContent.includes('secrets.json')) {
        currentContent += '\nsecrets.json';
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
  const { calculatedValue, calculatedCost, ...aimToSave } = placeUnplacedConnections(aim);

  // Raw prior content rides along on the change event (undo history).
  const previous = (await readJsonOrNull(aimPath)) ?? (await readJsonOrNull(oldPath));
  await writeJsonAtomic(aimPath, aimToSave);
  
  // Clean up if it was in the other location
  if (await fs.pathExists(oldPath)) {
    await fs.remove(oldPath);
  }

  ee.emit('change', { type: 'aim', id: aim.id, projectPath, entity: aimToSave, previous });
}

// Upgrades legacy fields of a raw aim record in memory. Pure: reads must not
// write, or every aim.get/aim.list would dirty .bowman and race concurrent
// writers. migrateAimFiles persists the result explicitly.
function normalizeAimRecord(raw: any): { aim: any; changed: boolean } {
  const aim = { ...raw };
  let changed = false;

  // 'incoming' became 'supportingConnections'
  if (Array.isArray(aim.incoming)) {
    const existing = aim.supportingConnections ?? [];
    const added = aim.incoming
      .filter((incomingId: string) => !existing.some((c: any) => c.aimId === incomingId))
      .map((incomingId: string) => ({ aimId: incomingId, relativePosition: [0, 0] as [number, number], weight: 1 }));
    aim.supportingConnections = [...added, ...existing];
    // An empty legacy array carries nothing; dropping it is not worth a rewrite
    // (the next regular save omits it anyway).
    changed ||= aim.incoming.length > 0;
    delete aim.incoming;
  }

  // 'outgoing' became 'supportedAims'
  if (Array.isArray(aim.outgoing)) {
    const supportedAims = [...(aim.supportedAims ?? [])];
    for (const parentId of aim.outgoing) {
      if (!supportedAims.includes(parentId)) supportedAims.push(parentId);
    }
    aim.supportedAims = supportedAims;
    changed ||= aim.outgoing.length > 0;
    delete aim.outgoing;
  }

  if (!aim.supportingConnections) aim.supportingConnections = [];
  if (!aim.supportedAims) aim.supportedAims = [];
  if (!aim.committedIn) aim.committedIn = [];

  return { aim, changed };
}

// [0,0] is the schema default for a connection without a position; it would
// stack the child onto its parent in the graph, so writes spread it out.
const hasUnplacedConnection = (aim: { supportingConnections?: Array<{ relativePosition?: [number, number] }> }) =>
  (aim.supportingConnections ?? []).some((c) => c.relativePosition?.[0] === 0 && c.relativePosition?.[1] === 0);

function placeUnplacedConnections<T extends { supportingConnections?: any[] }>(aim: T): T {
  if (!hasUnplacedConnection(aim)) return aim;
  return {
    ...aim,
    supportingConnections: aim.supportingConnections!.map((c: any) =>
      c.relativePosition?.[0] === 0 && c.relativePosition?.[1] === 0
        ? { ...c, relativePosition: getRandomRelativePosition() }
        : c
    )
  };
}

async function readAim(rawProjectPath: string, aimId: string): Promise<Aim> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  
  // Try active aims first
  let aimPath = path.join(projectPath, 'aims', `${aimId}.json`);
  if (!(await fs.pathExists(aimPath))) {
    // Try archived aims
    aimPath = path.join(projectPath, 'archived-aims', `${aimId}.json`);
  }
  
  return AimSchema.parse(normalizeAimRecord(await fs.readJson(aimPath)).aim);
}

// Explicit, idempotent upgrade of aim files: legacy fields and unplaced
// connections. Returns the ids of rewritten aims.
async function migrateAimFiles(rawProjectPath: string): Promise<string[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const migrated: string[] = [];
  for (const dirName of ['aims', 'archived-aims']) {
    const dir = path.join(projectPath, dirName);
    if (!(await fs.pathExists(dir))) continue;
    for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith('.json'))) {
      const raw = await readJsonOrNull(path.join(dir, file));
      if (!raw) continue;
      const { aim, changed } = normalizeAimRecord(raw);
      if (!changed && !hasUnplacedConnection(aim)) continue;
      await writeAim(projectPath, AimSchema.parse(aim));
      migrated.push(aim.id);
    }
  }
  return migrated;
}

async function listAims(rawProjectPath: string, archived: boolean = false): Promise<Aim[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const dirName = archived ? 'archived-aims' : 'aims';
  const aimsDir = path.join(projectPath, dirName);
  
  if (!await fs.pathExists(aimsDir)) return [];
  
  const files = (await fs.readdir(aimsDir)).filter((file) => file.endsWith('.json'));
  const results = await Promise.all(files.map(async (file): Promise<Aim | null> => {
      const aimId = path.basename(file, '.json');
      // For listing, we can just read directly from the dir we are in to avoid double check overhead of readAim
      // BUT readAim upgrades legacy fields in memory. So we should use readAim.
      // readAim checks 'aims' first. 
      // If we are listing archived, readAim will check 'aims' (fail) then 'archived-aims' (success).
      // If we are listing active, readAim will check 'aims' (success).
      // So it works.
      try {
        return await readAim(projectPath, aimId);
      } catch (e) {
        console.error(`Failed to read aim ${aimId}`, e);
        return null;
      }
  }));

  return results.filter((aim): aim is Aim => aim !== null);
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

async function readJsonOrNull(filePath: string): Promise<any | null> {
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
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
  const previous = emitChange ? await readJsonOrNull(phasePath) : null;
  await writeJsonAtomic(phasePath, phase);
  if (emitChange) {
    ee.emit('change', { type: 'phase', id: phase.id, projectPath, entity: phase, previous });
  }
}

async function readProjectMeta(rawProjectPath: string): Promise<ProjectMeta> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const metaPath = path.join(projectPath, 'meta.json');

  let meta: ProjectMeta;
  let needsPersist = false;
  let hadRootPhaseIds = false;
  if (await fs.pathExists(metaPath)) {
    meta = await fs.readJson(metaPath);
    hadRootPhaseIds = Array.isArray(meta.rootPhaseIds);
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
  if (!meta.linkedRepos) meta.linkedRepos = [];

  // Reads trust the stored order; only legacy metas without rootPhaseIds
  // derive it (in memory) from the phases' parent backlinks. Rewriting it here
  // raced multi-file writers such as a phase changing parent: a read between
  // their writes re-derived and persisted a half-moved tree.
  // reconcilePhaseTree (fixConsistency) repairs stored drift explicitly.
  if (!hadRootPhaseIds) {
    meta.rootPhaseIds = await deriveLegacySiblingIds(projectPath, null);
  }

  // Generate a stable repo identity once, then persist so it never changes.
  // This is the source of truth cross-repo edges reference ({repoId, aimId}).
  if (!meta.repoId) {
    meta.repoId = uuidv4();
    needsPersist = true;
  }
  if (needsPersist) {
    await writeProjectMeta(projectPath, meta);
  }

  return meta;
}

async function writeProjectMeta(rawProjectPath: string, meta: ProjectMeta): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const metaPath = path.join(projectPath, 'meta.json');
  const previous = await readJsonOrNull(metaPath);
  await writeJsonAtomic(metaPath, meta);
  ee.emit('change', { type: 'project', id: 'meta', projectPath, entity: meta, previous });
}

function normalizePhase(rawPhase: unknown): Phase {
  const parsed = PhaseSchema.partial().parse(rawPhase);

  if (
    !parsed.id ||
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

function compareLegacyPhaseOrder(a: Phase, b: Phase): number {
  const fields: Array<keyof Pick<Phase, 'order' | 'from' | 'to'>> = ['order', 'from', 'to'];
  for (const field of fields) {
    const aValue = a[field];
    const bValue = b[field];
    if (aValue !== undefined || bValue !== undefined) {
      const difference = (aValue ?? Number.POSITIVE_INFINITY) - (bValue ?? Number.POSITIVE_INFINITY);
      if (difference !== 0) return difference;
    }
  }
  return a.id.localeCompare(b.id);
}

function reconcileSiblingIds(existingIds: string[] | undefined, derivedIds: string[]): string[] {
  const validIds = new Set(derivedIds);
  const reconciledIds: string[] = [];
  const seen = new Set<string>();
  for (const id of existingIds ?? []) {
    if (validIds.has(id) && !seen.has(id)) {
      reconciledIds.push(id);
      seen.add(id);
    }
  }
  for (const id of derivedIds) {
    if (!seen.has(id)) reconciledIds.push(id);
  }
  return reconciledIds;
}

function sameIds(left: string[] | undefined, right: string[]): boolean {
  return !!left && left.length === right.length && left.every((id, index) => id === right[index]);
}

async function deriveLegacySiblingIds(
  rawProjectPath: string,
  parentPhaseId: string | null
): Promise<string[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const phasesDir = path.join(projectPath, 'phases');
  if (!await fs.pathExists(phasesDir)) return [];

  const siblings: Phase[] = [];
  for (const file of await fs.readdir(phasesDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const phase = normalizePhase(await fs.readJson(path.join(phasesDir, file)));
      if (phase.parent === parentPhaseId) siblings.push(phase);
    } catch {
      // Malformed phase files remain isolated from migration, as they are from listing.
    }
  }
  return siblings.sort(compareLegacyPhaseOrder).map((phase) => phase.id);
}

async function readPhaseFile(rawProjectPath: string, phaseId: string): Promise<Phase> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const phasePath = path.join(projectPath, 'phases', `${phaseId}.json`);

  try {
    const data = await fs.readJson(phasePath);
    const phase = normalizePhase(data);
    // Pure read, like readProjectMeta: legacy files derive children in memory.
    if (!Array.isArray(data?.childPhaseIds)) {
      phase.childPhaseIds = await deriveLegacySiblingIds(projectPath, phase.id);
    }
    return phase;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${phasePath}: ${message}`);
  }
}

async function readPhase(rawProjectPath: string, phaseId: string): Promise<Phase> {
  return await readPhaseFile(rawProjectPath, phaseId);
}

// Explicit repair of the phase tree: every stored child list (and the root
// list in meta) is reconciled with the phases' parent backlinks — stale ids
// dropped, missing children appended. Returns a message per rewritten owner.
async function reconcilePhaseTree(rawProjectPath: string): Promise<string[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const fixes: string[] = [];
  const phases = await listPhases(projectPath);
  const childrenByParent = new Map<string | null, Phase[]>();
  for (const phase of phases) {
    const bucket = childrenByParent.get(phase.parent) ?? [];
    bucket.push(phase);
    childrenByParent.set(phase.parent, bucket);
  }
  const derivedIds = (parentId: string | null) =>
    [...(childrenByParent.get(parentId) ?? [])].sort(compareLegacyPhaseOrder).map((phase) => phase.id);

  for (const phase of phases) {
    const reconciled = reconcileSiblingIds(phase.childPhaseIds, derivedIds(phase.id));
    const raw = await readJsonOrNull(path.join(projectPath, 'phases', `${phase.id}.json`));
    if (!Array.isArray(raw?.childPhaseIds) || !sameIds(raw.childPhaseIds, reconciled)) {
      await writePhase(projectPath, { ...phase, childPhaseIds: reconciled });
      fixes.push(`Reconciled child phases of Phase ${phase.id}`);
    }
  }

  const meta = await readProjectMeta(projectPath);
  const rawMeta = await readJsonOrNull(path.join(projectPath, 'meta.json'));
  const reconciledRoots = reconcileSiblingIds(meta.rootPhaseIds, derivedIds(null));
  if (!Array.isArray(rawMeta?.rootPhaseIds) || !sameIds(rawMeta.rootPhaseIds, reconciledRoots)) {
    await writeProjectMeta(projectPath, { ...meta, rootPhaseIds: reconciledRoots });
    fixes.push('Reconciled root phases');
  }
  return fixes;
}

// Enumeration convenience endpoint.
// Interactive UI loading should prefer project meta + phase.get and follow the
// tree structure via rootPhaseIds / childPhaseIds instead of calling listPhases
// on the hot path.
async function listPhases(rawProjectPath: string, parentPhaseId?: string | null): Promise<Phase[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const phasesDir = path.join(projectPath, 'phases');
  if (!await fs.pathExists(phasesDir)) return [];
  
  const files = (await fs.readdir(phasesDir)).filter((file) => file.endsWith('.json'));
  const legacyPhaseIds = new Set<string>();
  const phaseResults = await Promise.all(files.map(async (file): Promise<Phase | null> => {
      const phaseId = path.basename(file, '.json');
      try {
        const rawPhase = await fs.readJson(path.join(phasesDir, file));
        if (!Array.isArray(rawPhase?.childPhaseIds)) legacyPhaseIds.add(phaseId);
        return normalizePhase(rawPhase);
      } catch (error) {
        console.warn(`[Phase] Skipping malformed phase file ${phaseId} in ${projectPath}:`, error);
        return null;
      }
  }));
  const allPhases = phaseResults.filter((phase): phase is Phase => phase !== null);

  const meta = await readProjectMeta(projectPath);
  const phaseMap = new Map(allPhases.map((phase) => [phase.id, phase]));
  const childrenByParent = new Map<string | null, Phase[]>();

  for (const phase of allPhases) {
    const bucket = childrenByParent.get(phase.parent) ?? [];
    bucket.push(phase);
    childrenByParent.set(phase.parent, bucket);
  }

  if (parentPhaseId === undefined) {
    // Same as readPhaseFile: legacy phases only carry the `parent` backlink.
    return allPhases.map((phase) => legacyPhaseIds.has(phase.id)
      ? {
          ...phase,
          childPhaseIds: [...(childrenByParent.get(phase.id) ?? [])].sort(compareLegacyPhaseOrder).map((child) => child.id)
        }
      : phase);
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
  await writeJsonAtomic(systemPath, initialStatus);
  return initialStatus;
}

async function writeSystemStatus(rawProjectPath: string, status: SystemStatus): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const systemPath = path.join(projectPath, 'system.json');
  await writeJsonAtomic(systemPath, status);
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
async function connectAimsInternal(projectPath: string, parentAimId: string, childAimId: string, parentIncomingIndex?: number, childSupportedAimsIndex?: number, relativePosition?: [number, number], weight: number = 1, explanation?: string): Promise<void> {
  console.log('connectAimsInternal:', { parentAimId, childAimId, parentIncomingIndex, childSupportedAimsIndex, relativePosition, weight, explanation });
  const parent = await readAim(projectPath, parentAimId);
  const child = await readAim(projectPath, childAimId);

  // Update parent's supportingConnections (sub-aim goes into parent's supportingConnections)
  let targetParentIndex = parentIncomingIndex !== undefined ? parentIncomingIndex : parent.supportingConnections.length;
  const currentChildIndex = parent.supportingConnections.findIndex(c => c.aimId === childAimId);
  
  if (currentChildIndex === targetParentIndex) {
    // Already at the correct position, but update weight/explanation if changed
    const existing = currentChildIndex !== -1 ? parent.supportingConnections[currentChildIndex] : undefined;
    if (existing) {
      let changed = false;
      if (existing.weight !== weight) { existing.weight = weight; changed = true; }
      if (explanation !== undefined && existing.explanation !== explanation) { existing.explanation = explanation; changed = true; }
      if (changed) await writeAim(projectPath, parent);
    }
  } else {
    // Preserve an existing explanation across reorder if none is supplied
    const prevConn = currentChildIndex !== -1 ? parent.supportingConnections[currentChildIndex] : undefined;
    // Remove from current position if present
    if (currentChildIndex !== -1) {
      parent.supportingConnections.splice(currentChildIndex, 1);
      // No decrement needed for reordering logic from frontend
      const maxIndex = parent.supportingConnections.length;
      targetParentIndex = Math.min(targetParentIndex, maxIndex);
    }
    // Insert at target position
    const resolvedExplanation = explanation !== undefined ? explanation : prevConn?.explanation;
    const newConnection = {
      aimId: childAimId,
      relativePosition: relativePosition || getRandomRelativePosition(),
      weight,
      ...(resolvedExplanation !== undefined ? { explanation: resolvedExplanation } : {})
    };

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
// --- Spin-off helpers ---------------------------------------------------------

// Remove an aim file (active or archived) and purge it from index + embeddings.
async function deleteAimCompletely(rawProjectPath: string, aimId: string): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await fs.remove(path.join(projectPath, 'aims', `${aimId}.json`));
  await fs.remove(path.join(projectPath, 'archived-aims', `${aimId}.json`));
  removeAimFromIndex(projectPath, aimId);
  await removeEmbedding(projectPath, aimId);
}

const spinOffRouter = t.router({
  // Tab-completion for the target path chooser: given a partial path (supporting
  // `~/` and absolute `/`), return matching child directory names and whether the
  // resolved path already holds a .bowman graph (so the UI can warn).
  completePath: delayedProcedure
    .input(z.object({ partial: z.string() }))
    .query(async ({ input }: any) => {
      return {
        matches: await completeDirectoryPath(input.partial),
        bowmanExists: await bowmanExists(input.partial),
      };
    }),

  // Dry-run: classify aims into kept (green) / overlap (orange) / spun-off (red)
  // for the graph preview, plus a warning if the target already has a graph.
  preview: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      rootIds: z.array(z.string().uuid()).min(1),
      targetPath: z.string().optional(),
    }))
    .query(async ({ input }: any) => {
      const aims = await listAims(normalizeProjectPath(input.projectPath));
      const plan = planSpinOff(aims, input.rootIds);
      return {
        ...plan,
        counts: {
          kept: plan.keptIds.length,
          overlap: plan.overlapIds.length,
          spinOff: plan.spinOffIds.length,
        },
        targetHasBowman: input.targetPath ? await bowmanExists(input.targetPath) : false,
      };
    }),

  // Execute: write the branch (roots + supporters) into a fresh .bowman at
  // targetPath, then optionally prune the source — deleting only aims that serve
  // the selection exclusively, keeping shared aims (overlap). Conservative.
  execute: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      rootIds: z.array(z.string().uuid()).min(1),
      targetPath: z.string(),
      removeFromSource: z.boolean().default(true),
      preserveInflow: z.boolean().default(true),
    }))
    .mutation(async ({ input }: any) => {
      const source = normalizeProjectPath(input.projectPath);
      const target = resolveBowmanPath(input.targetPath);
      if (path.resolve(source) === path.resolve(target)) {
        throw new Error('The spin-off target must be a different .bowman graph from the source.');
      }
      const integrateIntoExisting = await bowmanExists(target);

      const aims = await listAims(source);
      const { plan, spinOffAims, sourceAimsToRewrite, sourceAimIdsToDelete } =
        computeSpinOff(aims, input.rootIds, { preserveInflow: input.preserveInflow });

      // For an existing graph, retain all target metadata and remap only ids that
      // collide. Internal branch edges follow the remap; no edge is added to an
      // existing target aim, leaving the imported root(s) free for re-parenting.
      let aimsToWrite = spinOffAims;
      let remappedIds: Record<string, string> = {};
      if (integrateIntoExisting) {
        const targetAims = [
          ...await listAims(target),
          ...await listAims(target, true),
        ];
        const remapped = remapSpinOffCollisions(
          spinOffAims,
          targetAims.map((aim) => aim.id),
          uuidv4,
        );
        aimsToWrite = remapped.aims;
        remappedIds = remapped.idMap;
      }

      // Write the branch. A fresh graph inherits source presentation metadata;
      // an existing graph remains authoritative for its own settings and phases.
      await ensureProjectStructure(target);
      if (!integrateIntoExisting) {
        const sourceMeta = await readProjectMeta(source);
        await writeProjectMeta(target, {
          name: path.basename(path.dirname(target)) || 'spin-off',
          color: sourceMeta.color,
          statuses: sourceMeta.statuses,
          rootPhaseIds: [],
        });
      }
      for (const aim of aimsToWrite) {
        await writeAim(target, aim);
        addAimToIndex(target, aim);
      }
      invalidateSemanticCache(target);

      // Prune the source (optional): rewrite kept aims that lost edges, then
      // delete the exclusive aims, then clean up dangling phase commitments.
      let deletedFromSource = 0;
      if (input.removeFromSource) {
        for (const aim of sourceAimsToRewrite) {
          await writeAim(source, aim);
          updateAimInIndex(source, aim);
        }
        for (const id of sourceAimIdsToDelete) {
          await deleteAimCompletely(source, id);
          deletedFromSource++;
        }
        await cleanupCommitments(source);
        invalidateSemanticCache(source);
      }

      return {
        target,
        copied: aimsToWrite.length,
        deletedFromSource,
        integratedIntoExisting: integrateIntoExisting,
        remappedIds,
        counts: {
          kept: plan.keptIds.length,
          overlap: plan.overlapIds.length,
          spinOff: plan.spinOffIds.length,
        },
      };
    }),
});

// --- Linked-repo registry -----------------------------------------------------
// Identity split: the PORTABLE part (repoId, name, url) lives in meta.linkedRepos
// and travels with the repo via git; the MACHINE-LOCAL part (where the repo is
// checked out, and read/write access) lives here in .bowman/runtime/ (gitignored)
// so committed absolute paths never break for collaborators. Resolving a
// cross-repo edge {repoId, aimId} is two-stage: repoId → local map → load.

const LINKED_REPOS_REGISTRY_FILE = 'linked-repos.json';

function linkedRepoRegistryPath(projectPath: string): string {
  return path.join(normalizeProjectPath(projectPath), 'runtime', LINKED_REPOS_REGISTRY_FILE);
}

async function readLinkedRepoRegistry(projectPath: string): Promise<LinkedRepoLocal[]> {
  const file = linkedRepoRegistryPath(projectPath);
  if (!(await fs.pathExists(file))) return [];
  try {
    return LinkedRepoRegistrySchema.parse(await fs.readJson(file)).repos;
  } catch {
    return [];
  }
}

async function writeLinkedRepoRegistry(projectPath: string, repos: LinkedRepoLocal[]): Promise<void> {
  await ensureProjectStructure(projectPath);
  await writeJsonAtomic(linkedRepoRegistryPath(projectPath), { repos });
}

// Two-stage resolution: repoId → machine-local localPath (or null if this repo
// is linked but not checked out here — the 'repo-not-checked-out' state).
async function resolveLinkedRepoLocalPath(projectPath: string, repoId: string): Promise<string | null> {
  const entry = (await readLinkedRepoRegistry(projectPath)).find((r) => r.repoId === repoId);
  return entry ? entry.localPath : null;
}

// A portable link plus this machine's resolution status (localPath present ⇒
// checked out here). Explicit output schemas keep the router's inferred type
// nameable (portable .d.ts emit) and document the cross-repo API contract.
const LinkedRepoStatusSchema = LinkedRepoSchema.extend({
  localPath: z.string().optional(),
  access: z.enum(['read', 'write']).optional(),
  resolved: z.boolean(),
});

const linkedRepoRouter = t.router({
  // Portable links (from meta) merged with this machine's resolution status.
  list: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .output(z.array(LinkedRepoStatusSchema))
    .query(async ({ input }: any) => {
      const meta = await readProjectMeta(input.projectPath);
      const registry = await readLinkedRepoRegistry(input.projectPath);
      const localById = new Map(registry.map((r) => [r.repoId, r]));
      return (meta.linkedRepos ?? []).map((link) => {
        const local = localById.get(link.repoId);
        return {
          ...link,
          localPath: local?.localPath,
          access: local?.access,
          resolved: !!local, // false ⇒ linked but not checked out here
        };
      });
    }),

  // Register a sibling project as a linked repo: read its stable repoId from its
  // meta (generating one if absent), record the portable part in this repo's
  // meta and the machine-local path in the runtime registry.
  register: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      targetPath: z.string(),
      url: z.string().optional(),
      access: z.enum(['read', 'write']).default('read'),
    }))
    .output(LinkedRepoStatusSchema)
    .mutation(async ({ input }: any) => {
      const target = resolveBowmanPath(input.targetPath);
      if (!(await fs.pathExists(target))) {
        throw new Error(`No .bowman found at target: ${target}`);
      }

      const selfMeta = await readProjectMeta(input.projectPath);
      const targetMeta = await readProjectMeta(target); // generates+persists target repoId if missing
      const repoId = targetMeta.repoId!;

      if (repoId === selfMeta.repoId) {
        throw new Error('Cannot link a repo to itself.');
      }

      // Portable part → meta.linkedRepos (upsert by repoId).
      const portable: LinkedRepo = { repoId, name: targetMeta.name, ...(input.url ? { url: input.url } : {}) };
      const links = (selfMeta.linkedRepos ?? []).filter((l) => l.repoId !== repoId);
      links.push(portable);
      selfMeta.linkedRepos = links;
      await writeProjectMeta(input.projectPath, selfMeta);

      // Machine-local part → runtime registry (upsert by repoId).
      const local: LinkedRepoLocal = { repoId, localPath: target, access: input.access };
      const registry = (await readLinkedRepoRegistry(input.projectPath)).filter((r) => r.repoId !== repoId);
      registry.push(local);
      await writeLinkedRepoRegistry(input.projectPath, registry);

      return { ...portable, localPath: target, access: input.access, resolved: true };
    }),

  // Drop a linked repo from both the portable list and the local registry.
  unregister: delayedProcedure
    .input(z.object({ projectPath: z.string(), repoId: z.string().uuid() }))
    .output(z.object({ repoId: z.string().uuid(), removed: z.boolean() }))
    .mutation(async ({ input }: any) => {
      const meta = await readProjectMeta(input.projectPath);
      meta.linkedRepos = (meta.linkedRepos ?? []).filter((l) => l.repoId !== input.repoId);
      await writeProjectMeta(input.projectPath, meta);

      const registry = (await readLinkedRepoRegistry(input.projectPath)).filter((r) => r.repoId !== input.repoId);
      await writeLinkedRepoRegistry(input.projectPath, registry);

      return { repoId: input.repoId, removed: true };
    }),

  // Resolve a repoId to its local checkout — for the black-box node's name and
  // health only. Aims inside the linked repo are never read (see e81b11c3).
  resolve: delayedProcedure
    .input(z.object({ projectPath: z.string(), repoId: z.string().uuid() }))
    .output(z.object({
      repoId: z.string().uuid(),
      name: z.string().optional(),
      localPath: z.string().optional(),
      resolved: z.boolean(),
    }))
    .query(async ({ input }: any) => {
      const meta = await readProjectMeta(input.projectPath);
      const link = (meta.linkedRepos ?? []).find((l) => l.repoId === input.repoId);
      const localPath = await resolveLinkedRepoLocalPath(input.projectPath, input.repoId);
      return { repoId: input.repoId, name: link?.name, localPath: localPath ?? undefined, resolved: !!localPath };
    }),
});

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
    generateQueryEmbedding,
    saveEmbedding,
    removeEmbedding,
    searchVectors,
    searchAims,
    invalidateSemanticCache,
    ensureSearchIndex,
    generateAimProposal,
    ee
  ),
  phase: createPhaseRouter(
    t,
    delayedProcedure,
    readPhase,
    listPhases,
    writePhase,
    readProjectMeta,
    writeProjectMeta,
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
    readProjectMeta,
    writeAim,
    indexAims,
    indexPhases,
    loadVectorStore,
    hasCurrentEmbedding,
    generateEmbedding,
    saveEmbeddings,
    removeEmbedding,
    migrateCommittedInField,
    cleanupCommitments,
    getDb,
    readAim,
    writePhase,
    ensureSearchIndex,
    migrateAimFiles,
    reconcilePhaseTree,
    ee
  ),
  spinOff: spinOffRouter,
  linkedRepo: linkedRepoRouter,
  history: createHistoryRouter(
    t,
    delayedProcedure,
    normalizeProjectPath,
    writeAim,
    writePhase,
    writeProjectMeta,
    ee
  )
});


export { appRouter };
export type AppRouter = typeof appRouter;

const HTTP_PORT = parseInt(process.env.PORT_BACKEND_HTTP || '3000');
const WS_PORT = parseInt(process.env.PORT_BACKEND_WS || '3001');
// Restrict binding to a single interface (e.g. Tailscale IP) when set; otherwise all interfaces.
const BIND_HOST = process.env.BIND_HOST || undefined;

export function startServer() {
  const server = createHTTPServer({
    router: appRouter,
    createContext,
  });

  const wss = new WebSocketServer({ port: WS_PORT, host: BIND_HOST });

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

  server.listen(HTTP_PORT, BIND_HOST, () => {
    console.log(`HTTP Server running on http://${BIND_HOST || 'localhost'}:${HTTP_PORT}`);
  });

  // Load the embedding model up front so the first search/index doesn't pay the cold-load cost.
  warmupEmbedder().then(() => console.log('Embedding model ready'));

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
