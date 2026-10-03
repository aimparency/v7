import fs from 'fs-extra';
import path from 'path';
import type { Phase } from 'shared';
import { assertWritableBowman } from 'shared/bowman-migration';
import { normalizeProjectPath } from '../project-path.js';
import { emitChange } from '../change-events.js';
import { readJsonOrNull, writeJsonAtomic } from './json.js';
import { compareLegacyPhaseOrder, deriveLegacySiblingIds, normalizePhase } from './phase-files.js';
import { ensureProjectStructure, readProjectMeta, writeProjectMeta } from './project.js';

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

export async function readPhase(rawProjectPath: string, phaseId: string): Promise<Phase> {
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

export async function writePhase(rawProjectPath: string, phase: Phase): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  await assertWritableBowman(projectPath);
  const phasePath = path.join(projectPath, 'phases', `${phase.id}.json`);
  const previous = await readJsonOrNull(phasePath);
  await writeJsonAtomic(phasePath, phase);
  emitChange({ type: 'phase', id: phase.id, projectPath, entity: phase, previous });
}

// Explicit repair of the phase tree: every stored child list (and the root
// list in meta) is reconciled with the phases' parent backlinks — stale ids
// dropped, missing children appended. Returns a message per rewritten owner.
export async function reconcilePhaseTree(rawProjectPath: string): Promise<string[]> {
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
export async function listPhases(rawProjectPath: string, parentPhaseId?: string | null): Promise<Phase[]> {
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
    // Same as readPhase: legacy phases only carry the `parent` backlink.
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
