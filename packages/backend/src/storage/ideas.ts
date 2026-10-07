import fs from 'fs-extra';
import path from 'path';
import { IdeaSchema, describeSchemaError } from 'shared';
import type { Idea } from 'shared';
import { assertWritableBowman } from 'shared/bowman-migration';
import { normalizeProjectPath } from '../project-path.js';
import { emitChange } from '../change-events.js';
import { removeIdeaFromIndex } from '../search.js';
import { removeEmbedding } from '../embeddings.js';
import { readJsonOrNull, writeJsonAtomic } from './json.js';
import { ensureProjectStructure, migrateProject } from './project.js';

export async function writeIdea(rawProjectPath: string, idea: Idea): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await ensureProjectStructure(projectPath);
  await assertWritableBowman(projectPath);
  
  const isArchived = idea.status.state === 'archived';
  const targetDir = isArchived ? 'archived-ideas' : 'ideas';
  const sourceDir = isArchived ? 'ideas' : 'archived-ideas';
  
  const ideaPath = path.join(projectPath, targetDir, `${idea.id}.json`);
  const oldPath = path.join(projectPath, sourceDir, `${idea.id}.json`);
  
  // Strip calculated values before saving
  const { calculatedValue, calculatedCost, ...ideaToSave } = placeUnplacedConnections(idea);
  // Every writer passes here, so an invalid idea (e.g. cost 0) is refused
  // instead of being stored and later hidden as unreadable.
  const validation = IdeaSchema.safeParse(ideaToSave);
  if (!validation.success) {
    throw new Error(`Idea ${idea.id} was not saved: ${describeSchemaError(validation.error)}`);
  }

  // Raw prior content rides along on the change event (undo history).
  const previous = (await readJsonOrNull(ideaPath)) ?? (await readJsonOrNull(oldPath));
  await writeJsonAtomic(ideaPath, ideaToSave);
  
  // Clean up if it was in the other location
  if (await fs.pathExists(oldPath)) {
    await fs.remove(oldPath);
  }

  emitChange({ type: 'idea', id: idea.id, projectPath, entity: ideaToSave, previous });
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

export async function readIdea(rawProjectPath: string, ideaId: string, afterLayoutMigration = false): Promise<Idea> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  
  // Try active ideas first
  let ideaPath = path.join(projectPath, 'ideas', `${ideaId}.json`);
  if (!(await fs.pathExists(ideaPath))) {
    // Try archived ideas
    ideaPath = path.join(projectPath, 'archived-ideas', `${ideaId}.json`);
    if (!afterLayoutMigration && !(await fs.pathExists(ideaPath))) {
      await migrateProject(projectPath); // may still be in the legacy layout
      return readIdea(projectPath, ideaId, true);
    }
  }
  
  return IdeaSchema.parse(normalizeIdeaRecord(await fs.readJson(ideaPath)).idea);
}

// Explicit, idempotent upgrade of idea files: legacy fields and unplaced
// connections. Returns the ids of rewritten ideas.
export async function migrateIdeaFiles(rawProjectPath: string): Promise<string[]> {
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
      // Unreadable ideas are reported by the consistency check, not fixed here.
      const parsed = IdeaSchema.safeParse(idea);
      if (!parsed.success) continue;
      await writeIdea(projectPath, parsed.data);
      migrated.push(idea.id);
    }
  }
  return migrated;
}

export type UnreadableIdea = {
  id: string;
  file: string;
  error: string;
  // Whatever could still be read from the raw file, so the idea stays visible.
  text?: string;
  supportingIdeaIds: string[];
};

// Reads every idea file of the given directories once: the ideas that load,
// and the files that fail to (e.g. a value an older schema allowed, or edited
// outside the backend), with whatever the raw file still says.
export async function scanIdeaFiles(rawProjectPath: string, dirNames: string[]): Promise<{ ideas: Idea[]; unreadable: UnreadableIdea[] }> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await migrateProject(projectPath);
  const ideas: Idea[] = [];
  const unreadable: UnreadableIdea[] = [];
  for (const dirName of dirNames) {
    const dir = path.join(projectPath, dirName);
    if (!(await fs.pathExists(dir))) continue;
    const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json'));
    await Promise.all(files.map(async (file) => {
      let raw: any = null;
      try {
        raw = await fs.readJson(path.join(dir, file));
        ideas.push(IdeaSchema.parse(normalizeIdeaRecord(raw).idea));
      } catch (error) {
        const connections = Array.isArray(raw?.supportingConnections) ? raw.supportingConnections : [];
        unreadable.push({
          id: path.basename(file, '.json'),
          file: `${dirName}/${file}`,
          error: describeSchemaError(error),
          text: typeof raw?.text === 'string' ? raw.text : undefined,
          supportingIdeaIds: connections
            .map((connection: any) => connection?.ideaId)
            .filter((id: unknown): id is string => typeof id === 'string'),
        });
      }
    }));
  }
  return { ideas, unreadable };
}

export async function listIdeas(projectPath: string, archived: boolean = false): Promise<Idea[]> {
  return (await scanIdeaFiles(projectPath, [archived ? 'archived-ideas' : 'ideas'])).ideas;
}

// Helper to generate random relative position
export function getRandomRelativePosition(): [number, number] {
  const angle = Math.random() * 2 * Math.PI;
  const length = 2.5;
  return [Math.cos(angle) * length, Math.sin(angle) * length];
}

// Helper function to connect ideas (reused by connectIdeas and createSubIdea)
export async function connectIdeasInternal(projectPath: string, parentIdeaId: string, childIdeaId: string, parentIncomingIndex?: number, childSupportedIdeasIndex?: number, relativePosition?: [number, number], weight: number = 1, hypothesis?: string): Promise<void> {
  console.log('connectIdeasInternal:', { parentIdeaId, childIdeaId, parentIncomingIndex, childSupportedIdeasIndex, relativePosition, weight, hypothesis });
  const parent = await readIdea(projectPath, parentIdeaId);
  const child = await readIdea(projectPath, childIdeaId);

  // Update parent's supportingConnections (sub-idea goes into parent's supportingConnections)
  let targetParentIndex = parentIncomingIndex !== undefined ? parentIncomingIndex : parent.supportingConnections.length;
  const currentChildIndex = parent.supportingConnections.findIndex(c => c.ideaId === childIdeaId);
  
  if (currentChildIndex === targetParentIndex) {
    // Already at the correct position, but update weight/hypothesis if changed
    const existing = currentChildIndex !== -1 ? parent.supportingConnections[currentChildIndex] : undefined;
    if (existing) {
      let changed = false;
      if (existing.weight !== weight) { existing.weight = weight; changed = true; }
      if (hypothesis !== undefined && existing.hypothesis !== hypothesis) { existing.hypothesis = hypothesis; changed = true; }
      if (changed) await writeIdea(projectPath, parent);
    }
  } else {
    // Preserve an existing hypothesis (unless a new one is supplied) and evaluation across reorder
    const prevConn = currentChildIndex !== -1 ? parent.supportingConnections[currentChildIndex] : undefined;
    // Remove from current position if present
    if (currentChildIndex !== -1) {
      parent.supportingConnections.splice(currentChildIndex, 1);
      // No decrement needed for reordering logic from frontend
      const maxIndex = parent.supportingConnections.length;
      targetParentIndex = Math.min(targetParentIndex, maxIndex);
    }
    // Insert at target position
    const resolvedHypothesis = hypothesis !== undefined ? hypothesis : prevConn?.hypothesis;
    const newConnection = {
      ideaId: childIdeaId,
      relativePosition: relativePosition || getRandomRelativePosition(),
      weight,
      ...(resolvedHypothesis !== undefined ? { hypothesis: resolvedHypothesis } : {}),
      ...(prevConn?.evaluation !== undefined ? { evaluation: prevConn.evaluation } : {})
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

// Remove an idea file (active or archived) and purge it from index + embeddings.
export async function deleteIdeaCompletely(rawProjectPath: string, ideaId: string): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  await assertWritableBowman(projectPath);
  await fs.remove(path.join(projectPath, 'ideas', `${ideaId}.json`));
  await fs.remove(path.join(projectPath, 'archived-ideas', `${ideaId}.json`));
  removeIdeaFromIndex(projectPath, ideaId);
  await removeEmbedding(projectPath, ideaId);
}
