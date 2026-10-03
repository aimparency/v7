import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CURRENT_DATA_MODEL_VERSION, INITIAL_STATES } from 'shared';
import type { ProjectMeta, SystemStatus } from 'shared';
import { assertWritableBowman, migrateBowman, NewerDataModelError } from 'shared/bowman-migration';
import { normalizeProjectPath } from '../project-path.js';
import { emitChange } from '../change-events.js';
import { readJsonOrNull, writeJsonAtomic } from './json.js';
import { deriveLegacySiblingIds } from './phase-files.js';

const GITIGNORE_CONTENT = 'vectors.json\ncache.db\nsemantic-graph.json\nruntime/\nsecrets.json\n.migration-lock\n';
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

// Brings an opened project to the current data model (see shared/bowman-migration).
// Cheap once a project is current, so it runs on every structure check.
const runningMigrations = new Map<string, Promise<void>>();
const warnedNewerProjects = new Set<string>();
export async function migrateProject(projectPath: string): Promise<void> {
  const running = runningMigrations.get(projectPath);
  if (running) return running;
  const migration = migrateBowman(projectPath)
    .then((result) => {
      if (result.applied.length > 0) {
        console.log(`[migration] ${projectPath}: data model ${result.from ?? 'new'} → ${result.to ?? 'new'} (${result.applied.join('; ')})`);
      }
      if (result.conflicts.length > 0) {
        console.warn(`[migration] ${projectPath}: kept both versions of ${result.conflicts.join(', ')} (see migration-conflicts/)`);
      }
      if (result.newerThanSupported && !warnedNewerProjects.has(projectPath)) {
        warnedNewerProjects.add(projectPath);
        console.warn(`[migration] ${projectPath}: data model ${result.from} is newer than ${CURRENT_DATA_MODEL_VERSION}; opened read-only`);
      }
    })
    .finally(() => runningMigrations.delete(projectPath));
  runningMigrations.set(projectPath, migration);
  return migration;
}

export async function ensureProjectStructure(rawProjectPath: string) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await migrateProject(projectPath);
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
    if (!currentContent.includes('.migration-lock')) {
        currentContent += '\n.migration-lock';
        needsUpdate = true;
    }
    
    if (needsUpdate) {
        await fs.writeFile(gitignorePath, currentContent);
    }
  }
}

export async function readProjectMeta(rawProjectPath: string): Promise<ProjectMeta> {
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
      dataModelVersion: CURRENT_DATA_MODEL_VERSION,
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
    // A project from a newer Aimparency stays read-only; the repoId is then only in memory.
    await writeProjectMeta(projectPath, meta).catch((error) => {
      if (!(error instanceof NewerDataModelError)) throw error;
    });
  }

  return meta;
}

export async function writeProjectMeta(rawProjectPath: string, meta: ProjectMeta): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  await assertWritableBowman(projectPath);
  const metaPath = path.join(projectPath, 'meta.json');
  const previous = await readJsonOrNull(metaPath);
  await writeJsonAtomic(metaPath, meta);
  emitChange({ type: 'project', id: 'meta', projectPath, entity: meta, previous });
}

export async function readSystemStatus(rawProjectPath: string): Promise<SystemStatus> {
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

export async function writeSystemStatus(rawProjectPath: string, status: SystemStatus): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  const systemPath = path.join(projectPath, 'system.json');
  await writeJsonAtomic(systemPath, status);
  emitChange({ type: 'system', id: 'status', projectPath });
}
