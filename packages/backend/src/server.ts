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
import { IdeaSchema, PhaseSchema, ProjectMetaSchema, IdeaStatusSchema, SystemStatusSchema, AIMPARENCY_DIR_NAME, INITIAL_STATES } from 'shared';
import type { Idea, Phase, ProjectMeta, SystemStatus, SearchIdeaResult, LinkedRepo, LinkedRepoLocal } from 'shared';
import { LinkedRepoRegistrySchema, LinkedRepoSchema } from 'shared';
import { migrateBowmanLayout, needsBowmanMigration } from 'shared/bowman-migration';
import {
  indexIdeas,
  indexPhases,
  searchIdeas,
  searchPhases,
  addIdeaToIndex,
  updateIdeaInIndex,
  removeIdeaFromIndex,
  addPhaseToIndex,
  updatePhaseInIndex,
  removePhaseFromIndex
} from './search.js';
import { generateEmbedding, generateQueryEmbedding, warmupEmbedder, saveEmbedding, saveEmbeddings, removeEmbedding, searchVectors, loadVectorStore, hasCurrentEmbedding } from './embeddings.js';
import { getSemanticGraph, invalidateSemanticCache } from './forces.js';
import { chatWithGemini } from './voice-agent.js';
import { calculateIdeaValues, planSpinOff, computeSpinOff, remapSpinOffCollisions } from 'shared';
import { saveIdeaValues, getIdeaValues, getDb } from './db.js';
import { createIdeaRouter } from './routers/idea.js';
import { generateIdeaProposal } from './idea-proposal-generator.js';
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
      const [ideas, phases] = await Promise.all([listIdeas(normalizedPath), listPhases(normalizedPath)]);
      indexIdeas(normalizedPath, ideas);
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
        const ideas = await listIdeas(projectPath);
        const result = calculateIdeaValues(ideas);
        
        const map = new Map();
        for (const [id, value] of result.values.entries()) {
            map.set(id, {
                value,
                cost: result.costs.get(id) || 0,
                doneCost: result.doneCosts.get(id) || 0,
                priority: result.priorities.get(id) || 0
            });
        }
        saveIdeaValues(projectPath, map);
        // console.log(`[ValueCalc] Updated values for ${projectPath}`);
    } catch (e) {
        console.error(`[ValueCalc] Failed to recalculate for ${projectPath}`, e);
    }
  }, 1000));
}

ee.on('change', ({ type, projectPath }) => {
    if (process.env.NODE_ENV === 'test') return;
    if (type === 'idea' || type === 'phase') {
        triggerRecalculation(projectPath);
    }
});

// Projects created before the aim→idea rename keep aims/ until first touched here.
const runningLayoutMigrations = new Map<string, Promise<void>>();
async function migrateLegacyLayout(projectPath: string): Promise<void> {
  const running = runningLayoutMigrations.get(projectPath);
  if (running) return running;
  if (!(await needsBowmanMigration(projectPath))) return;
  const migration = migrateBowmanLayout(projectPath)
    .then((report) => {
      console.log(`[migration] ${projectPath}: moved ${report.migratedIdeas} aims to ideas, rewrote ${report.rewrittenFiles} files`);
      if (report.conflicts.length > 0) {
        console.warn(`[migration] ${projectPath}: kept both versions of ${report.conflicts.join(', ')} (see migration-conflicts/)`);
      }
    })
    .finally(() => runningLayoutMigrations.delete(projectPath));
  runningLayoutMigrations.set(projectPath, migration);
  return migration;
}

// Utility functions for file operations
async function ensureProjectStructure(rawProjectPath: string) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await migrateLegacyLayout(projectPath);
  await fs.ensureDir(path.join(projectPath, 'ideas'));
  await fs.ensureDir(path.join(projectPath, 'archived-ideas'));
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

async function writeIdea(rawProjectPath: string, idea: Idea): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  
  const isArchived = idea.status.state === 'archived';
  const targetDir = isArchived ? 'archived-ideas' : 'ideas';
  const sourceDir = isArchived ? 'ideas' : 'archived-ideas';
  
  const ideaPath = path.join(projectPath, targetDir, `${idea.id}.json`);
  const oldPath = path.join(projectPath, sourceDir, `${idea.id}.json`);
  
  // Strip calculated values before saving
  const { calculatedValue, calculatedCost, ...ideaToSave } = placeUnplacedConnections(idea);

  // Raw prior content rides along on the change event (undo history).
  const previous = (await readJsonOrNull(ideaPath)) ?? (await readJsonOrNull(oldPath));
  await writeJsonAtomic(ideaPath, ideaToSave);
  
  // Clean up if it was in the other location
  if (await fs.pathExists(oldPath)) {
    await fs.remove(oldPath);
  }

  ee.emit('change', { type: 'idea', id: idea.id, projectPath, entity: ideaToSave, previous });
}

// Upgrades legacy fields of a raw idea record in memory. Pure: reads must not
// write, or every idea.get/idea.list would dirty .bowman and race concurrent
// writers. migrateIdeaFiles persists the result explicitly.
function normalizeIdeaRecord(raw: any): { idea: any; changed: boolean } {
  const idea = { ...raw };
  let changed = false;

  // 'incoming' became 'supportingConnections'
  if (Array.isArray(idea.incoming)) {
    const existing = idea.supportingConnections ?? [];
    const added = idea.incoming
      .filter((incomingId: string) => !existing.some((c: any) => c.ideaId === incomingId))
      .map((incomingId: string) => ({ ideaId: incomingId, relativePosition: [0, 0] as [number, number], weight: 1 }));
    idea.supportingConnections = [...added, ...existing];
    // An empty legacy array carries nothing; dropping it is not worth a rewrite
    // (the next regular save omits it anyway).
    changed ||= idea.incoming.length > 0;
    delete idea.incoming;
  }

  // 'outgoing' became 'supportedIdeas'
  if (Array.isArray(idea.outgoing)) {
    const supportedIdeas = [...(idea.supportedIdeas ?? [])];
    for (const parentId of idea.outgoing) {
      if (!supportedIdeas.includes(parentId)) supportedIdeas.push(parentId);
    }
    idea.supportedIdeas = supportedIdeas;
    changed ||= idea.outgoing.length > 0;
    delete idea.outgoing;
  }

  if (!idea.supportingConnections) idea.supportingConnections = [];
  if (!idea.supportedIdeas) idea.supportedIdeas = [];
  if (!idea.committedIn) idea.committedIn = [];

  return { idea, changed };
}

// [0,0] is the schema default for a connection without a position; it would
// stack the child onto its parent in the graph, so writes spread it out.
const hasUnplacedConnection = (idea: { supportingConnections?: Array<{ relativePosition?: [number, number] }> }) =>
  (idea.supportingConnections ?? []).some((c) => c.relativePosition?.[0] === 0 && c.relativePosition?.[1] === 0);

function placeUnplacedConnections<T extends { supportingConnections?: any[] }>(idea: T): T {
  if (!hasUnplacedConnection(idea)) return idea;
  return {
    ...idea,
    supportingConnections: idea.supportingConnections!.map((c: any) =>
      c.relativePosition?.[0] === 0 && c.relativePosition?.[1] === 0
        ? { ...c, relativePosition: getRandomRelativePosition() }
        : c
    )
  };
}

async function readIdea(rawProjectPath: string, ideaId: string, afterLayoutMigration = false): Promise<Idea> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  
  // Try active ideas first
  let ideaPath = path.join(projectPath, 'ideas', `${ideaId}.json`);
  if (!(await fs.pathExists(ideaPath))) {
    // Try archived ideas
    ideaPath = path.join(projectPath, 'archived-ideas', `${ideaId}.json`);
    if (!afterLayoutMigration && !(await fs.pathExists(ideaPath)) && (await needsBowmanMigration(projectPath))) {
      await migrateLegacyLayout(projectPath);
      return readIdea(projectPath, ideaId, true);
    }
  }
  
  return IdeaSchema.parse(normalizeIdeaRecord(await fs.readJson(ideaPath)).idea);
}

// Explicit, idempotent upgrade of idea files: legacy fields and unplaced
// connections. Returns the ids of rewritten ideas.
async function migrateIdeaFiles(rawProjectPath: string): Promise<string[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const migrated: string[] = [];
  for (const dirName of ['ideas', 'archived-ideas']) {
    const dir = path.join(projectPath, dirName);
    if (!(await fs.pathExists(dir))) continue;
    for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith('.json'))) {
      const raw = await readJsonOrNull(path.join(dir, file));
      if (!raw) continue;
      const { idea, changed } = normalizeIdeaRecord(raw);
      if (!changed && !hasUnplacedConnection(idea)) continue;
      await writeIdea(projectPath, IdeaSchema.parse(idea));
      migrated.push(idea.id);
    }
  }
  return migrated;
}

async function listIdeas(rawProjectPath: string, archived: boolean = false): Promise<Idea[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const dirName = archived ? 'archived-ideas' : 'ideas';
  const ideasDir = path.join(projectPath, dirName);
  await migrateLegacyLayout(projectPath);
  
  if (!await fs.pathExists(ideasDir)) return [];
  
  const files = (await fs.readdir(ideasDir)).filter((file) => file.endsWith('.json'));
  const results = await Promise.all(files.map(async (file): Promise<Idea | null> => {
      const ideaId = path.basename(file, '.json');
      // For listing, we can just read directly from the dir we are in to avoid double check overhead of readIdea
      // BUT readIdea upgrades legacy fields in memory. So we should use readIdea.
      // readIdea checks 'ideas' first. 
      // If we are listing archived, readIdea will check 'ideas' (fail) then 'archived-ideas' (success).
      // If we are listing active, readIdea will check 'ideas' (success).
      // So it works.
      try {
        return await readIdea(projectPath, ideaId);
      } catch (e) {
        console.error(`Failed to read idea ${ideaId}`, e);
        return null;
      }
  }));

  return results.filter((idea): idea is Idea => idea !== null);
}

function populateIdeaValues(projectPath: string, ideas: Idea[]) {
    try {
        const values = getIdeaValues(projectPath);
        for (const idea of ideas) {
            const data = values.get(idea.id);
            if (data) {
                idea.calculatedValue = data.value;
                idea.calculatedCost = data.cost;
                idea.calculatedDoneCost = data.doneCost;
                idea.calculatedPriority = data.priority;
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
  // This is the source of truth cross-repo edges reference ({repoId, ideaId}).
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
  const ideas = await listIdeas(projectPath);
  let changedCount = 0;
  let validPhaseIds: Set<string> | null = null;

  if (!specificPhaseId) {
    const phases = await listPhases(projectPath);
    validPhaseIds = new Set(phases.map(p => p.id));
  }

  for (const idea of ideas) {
    let changed = false;
    if (specificPhaseId) {
      if (idea.committedIn && idea.committedIn.includes(specificPhaseId)) {
        idea.committedIn = idea.committedIn.filter(id => id !== specificPhaseId);
        changed = true;
      }
    } else if (validPhaseIds) {
       if (idea.committedIn) {
         const originalLength = idea.committedIn.length;
         idea.committedIn = idea.committedIn.filter(id => validPhaseIds!.has(id));
         if (idea.committedIn.length !== originalLength) {
           changed = true;
         }
       }
    }

    if (changed) {
      await writeIdea(projectPath, idea);
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

// Helper function to add idea to phase's commitments and idea's committedIn
async function commitIdeaToPhase(projectPath: string, ideaId: string, phaseId: string, insertionIndex?: number): Promise<void> {
  // Update the phase
  const phase = await readPhase(projectPath, phaseId);
  console.log(`commitIdeaToPhase: ideaId=${ideaId}, phaseId=${phaseId}, insertionIndex=${insertionIndex}`);
  
  if (!phase.commitments.includes(ideaId)) {
    if (insertionIndex !== undefined && insertionIndex <= phase.commitments.length) {
      phase.commitments.splice(insertionIndex, 0, ideaId);
    } else {
      phase.commitments.push(ideaId);
    }
    await writePhase(projectPath, phase);
  } else {
    // Reorder if index provided
    if (insertionIndex !== undefined) {
       const currentIndex = phase.commitments.indexOf(ideaId);
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
           
           phase.commitments.splice(targetIndex, 0, ideaId);
           await writePhase(projectPath, phase);
       }
    }
  }
  
  // Update the idea
  const idea = await readIdea(projectPath, ideaId);
  if (!idea.committedIn.includes(phaseId)) {
    idea.committedIn.push(phaseId);
    await writeIdea(projectPath, idea);
  }
}

// Helper function to remove idea from phase's commitments and idea's committedIn
async function removeIdeaFromPhase(projectPath: string, ideaId: string, phaseId: string): Promise<void> {
  // Update the phase
  const phase = await readPhase(projectPath, phaseId);
  phase.commitments = phase.commitments.filter(id => id !== ideaId);
  await writePhase(projectPath, phase);

  // Update the idea
  const idea = await readIdea(projectPath, ideaId);
  idea.committedIn = (idea.committedIn || []).filter(id => id !== phaseId);
  await writeIdea(projectPath, idea);
}

// Helper to generate random relative position
function getRandomRelativePosition(): [number, number] {
  const angle = Math.random() * 2 * Math.PI;
  const length = 2.5;
  return [Math.cos(angle) * length, Math.sin(angle) * length];
}

// Helper function to connect ideas (reused by connectIdeas and createSubIdea)
async function connectIdeasInternal(projectPath: string, parentIdeaId: string, childIdeaId: string, parentIncomingIndex?: number, childSupportedIdeasIndex?: number, relativePosition?: [number, number], weight: number = 1, explanation?: string): Promise<void> {
  console.log('connectIdeasInternal:', { parentIdeaId, childIdeaId, parentIncomingIndex, childSupportedIdeasIndex, relativePosition, weight, explanation });
  const parent = await readIdea(projectPath, parentIdeaId);
  const child = await readIdea(projectPath, childIdeaId);

  // Update parent's supportingConnections (sub-idea goes into parent's supportingConnections)
  let targetParentIndex = parentIncomingIndex !== undefined ? parentIncomingIndex : parent.supportingConnections.length;
  const currentChildIndex = parent.supportingConnections.findIndex(c => c.ideaId === childIdeaId);
  
  if (currentChildIndex === targetParentIndex) {
    // Already at the correct position, but update weight/explanation if changed
    const existing = currentChildIndex !== -1 ? parent.supportingConnections[currentChildIndex] : undefined;
    if (existing) {
      let changed = false;
      if (existing.weight !== weight) { existing.weight = weight; changed = true; }
      if (explanation !== undefined && existing.explanation !== explanation) { existing.explanation = explanation; changed = true; }
      if (changed) await writeIdea(projectPath, parent);
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
      ideaId: childIdeaId,
      relativePosition: relativePosition || getRandomRelativePosition(),
      weight,
      ...(resolvedExplanation !== undefined ? { explanation: resolvedExplanation } : {})
    };

    parent.supportingConnections.splice(targetParentIndex, 0, newConnection);
    await writeIdea(projectPath, parent);
  }

  // Update child's supportedIdeas (parent goes into child's supportedIdeas)
  let targetChildIndex = childSupportedIdeasIndex !== undefined ? childSupportedIdeasIndex : child.supportedIdeas.length;
  const currentParentIndex = child.supportedIdeas.indexOf(parentIdeaId);
  if (currentParentIndex === targetChildIndex) {
    // Already at the correct position
  } else {
    // Remove from current position if present
    if (currentParentIndex !== -1) {
      child.supportedIdeas.splice(currentParentIndex, 1);
    }
    // Insert at target position
    if (targetChildIndex <= child.supportedIdeas.length) {
      child.supportedIdeas.splice(targetChildIndex, 0, parentIdeaId);
    } else {
      child.supportedIdeas.push(parentIdeaId);
    }
  }
  console.log(parent, child)
  await writeIdea(projectPath, child);
}

// Migration function to populate committedIn field for existing ideas
async function migrateCommittedInField(projectPath: string): Promise<void> {
  const allIdeas = await listIdeas(projectPath);
  const allPhases = await listPhases(projectPath);
  
  // Create a map of ideaId -> phaseIds that commit this idea
  const ideaCommitments: Record<string, string[]> = {};
  
  // Initialize all ideas with empty arrays
  for (const idea of allIdeas) {
    ideaCommitments[idea.id] = [];
  }
  
  // Populate from phase commitments
  for (const phase of allPhases) {
    for (const ideaId of phase.commitments) {
      if (ideaCommitments[ideaId]) {
        ideaCommitments[ideaId].push(phase.id);
      }
    }
  }
  
  // Update all ideas that don't have committedIn field or have incorrect data
  for (const idea of allIdeas) {
    const expectedCommittedIn = ideaCommitments[idea.id] || [];
    if (!idea.committedIn || JSON.stringify(idea.committedIn.sort()) !== JSON.stringify(expectedCommittedIn.sort())) {
      idea.committedIn = expectedCommittedIn;
      await writeIdea(projectPath, idea);
    }
  }
}

// Helper to calculate smart sub-phase dates
// Create the actual tRPC router
// --- Spin-off helpers ---------------------------------------------------------

// Remove an idea file (active or archived) and purge it from index + embeddings.
async function deleteIdeaCompletely(rawProjectPath: string, ideaId: string): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await fs.remove(path.join(projectPath, 'ideas', `${ideaId}.json`));
  await fs.remove(path.join(projectPath, 'archived-ideas', `${ideaId}.json`));
  removeIdeaFromIndex(projectPath, ideaId);
  await removeEmbedding(projectPath, ideaId);
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

  // Dry-run: classify ideas into kept (green) / overlap (orange) / spun-off (red)
  // for the graph preview, plus a warning if the target already has a graph.
  preview: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      rootIds: z.array(z.string().uuid()).min(1),
      targetPath: z.string().optional(),
    }))
    .query(async ({ input }: any) => {
      const ideas = await listIdeas(normalizeProjectPath(input.projectPath));
      const plan = planSpinOff(ideas, input.rootIds);
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
  // targetPath, then optionally prune the source — deleting only ideas that serve
  // the selection exclusively, keeping shared ideas (overlap). Conservative.
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

      const ideas = await listIdeas(source);
      const { plan, spinOffIdeas, sourceIdeasToRewrite, sourceIdeaIdsToDelete } =
        computeSpinOff(ideas, input.rootIds, { preserveInflow: input.preserveInflow });

      // For an existing graph, retain all target metadata and remap only ids that
      // collide. Internal branch edges follow the remap; no edge is added to an
      // existing target idea, leaving the imported root(s) free for re-parenting.
      let ideasToWrite = spinOffIdeas;
      let remappedIds: Record<string, string> = {};
      if (integrateIntoExisting) {
        const targetIdeas = [
          ...await listIdeas(target),
          ...await listIdeas(target, true),
        ];
        const remapped = remapSpinOffCollisions(
          spinOffIdeas,
          targetIdeas.map((idea) => idea.id),
          uuidv4,
        );
        ideasToWrite = remapped.ideas;
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
      for (const idea of ideasToWrite) {
        await writeIdea(target, idea);
        addIdeaToIndex(target, idea);
      }
      invalidateSemanticCache(target);

      // Prune the source (optional): rewrite kept ideas that lost edges, then
      // delete the exclusive ideas, then clean up dangling phase commitments.
      let deletedFromSource = 0;
      if (input.removeFromSource) {
        for (const idea of sourceIdeasToRewrite) {
          await writeIdea(source, idea);
          updateIdeaInIndex(source, idea);
        }
        for (const id of sourceIdeaIdsToDelete) {
          await deleteIdeaCompletely(source, id);
          deletedFromSource++;
        }
        await cleanupCommitments(source);
        invalidateSemanticCache(source);
      }

      return {
        target,
        copied: ideasToWrite.length,
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
// cross-repo edge {repoId, ideaId} is two-stage: repoId → local map → load.

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
  // health only. Ideas inside the linked repo are never read (see e81b11c3).
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
  idea: createIdeaRouter(
    t,
    delayedProcedure,
    readIdea,
    listIdeas,
    writeIdea,
    readPhase,
    commitIdeaToPhase,
    removeIdeaFromPhase,
    connectIdeasInternal,
    getRandomRelativePosition,
    normalizeProjectPath,
    addIdeaToIndex,
    updateIdeaInIndex,
    removeIdeaFromIndex,
    generateEmbedding,
    generateQueryEmbedding,
    saveEmbedding,
    removeEmbedding,
    searchVectors,
    searchIdeas,
    invalidateSemanticCache,
    ensureSearchIndex,
    generateIdeaProposal,
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
    listIdeas,
    listPhases,
    readProjectMeta,
    writeIdea,
    indexIdeas,
    indexPhases,
    loadVectorStore,
    hasCurrentEmbedding,
    generateEmbedding,
    saveEmbeddings,
    removeEmbedding,
    migrateCommittedInField,
    cleanupCommitments,
    getDb,
    readIdea,
    writePhase,
    ensureSearchIndex,
    migrateIdeaFiles,
    reconcilePhaseTree,
    ee
  ),
  spinOff: spinOffRouter,
  linkedRepo: linkedRepoRouter,
  history: createHistoryRouter(
    t,
    delayedProcedure,
    normalizeProjectPath,
    writeIdea,
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
