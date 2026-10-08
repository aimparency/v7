import type { Idea } from 'shared';
import { readIdea, writeIdea, deleteIdeaCompletely } from './ideas.js';
import { readPhase, writePhase } from './phases.js';
import { removeIdeaFromPhase } from './commitments.js';

// Where an idea sits in a view: under a parent idea or committed in a phase.
export type IdeaContext = { parentId: string } | { phaseId: string };

const readIdeaOrNull = (projectPath: string, ideaId: string) =>
  readIdea(projectPath, ideaId).catch(() => null);

// Removes the parent → child edge on both sides; the ideas themselves stay.
export async function disconnectIdeas(projectPath: string, parentId: string, childId: string): Promise<void> {
  const parent = await readIdea(projectPath, parentId);
  const child = await readIdea(projectPath, childId);
  const connections = parent.supportingConnections.filter((connection) => connection.ideaId !== childId);
  if (connections.length !== parent.supportingConnections.length) {
    await writeIdea(projectPath, { ...parent, supportingConnections: connections });
  }
  const parents = child.supportedIdeas.filter((id) => id !== parentId);
  if (parents.length !== child.supportedIdeas.length) {
    await writeIdea(projectPath, { ...child, supportedIdeas: parents });
  }
}

// The roots plus, with cascade, every descendant that nothing outside the
// deletion anchors. A phase commitment anchors; so does a parent that survives.
// Descendants start as candidates (visited set, so cycles terminate) and are
// dropped while anchored; dropping one anchors its own children, hence the loop.
async function collectDeletion(projectPath: string, rootIds: string[], cascade: boolean): Promise<Map<string, Idea>> {
  const ideas = new Map<string, Idea>();
  for (const id of rootIds) {
    const idea = await readIdeaOrNull(projectPath, id);
    if (idea) ideas.set(id, idea);
  }
  if (!cascade) return ideas;

  const roots = new Set(ideas.keys());
  const candidates = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const idea = ideas.get(queue.pop()!)!;
    for (const { ideaId } of idea.supportingConnections) {
      if (roots.has(ideaId) || candidates.has(ideaId)) continue;
      const child = await readIdeaOrNull(projectPath, ideaId);
      if (!child) continue;
      ideas.set(ideaId, child);
      candidates.add(ideaId);
      queue.push(ideaId);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of candidates) {
      const idea = ideas.get(id)!;
      const keptByOutside = idea.committedIn.length > 0 ||
        idea.supportedIdeas.some((parentId) => !roots.has(parentId) && !candidates.has(parentId));
      if (keptByOutside) {
        candidates.delete(id);
        changed = true;
      }
    }
  }

  return new Map([...ideas].filter(([id]) => roots.has(id) || candidates.has(id)));
}

// Deletes the ideas (with cascade: plus their orphaned descendants). Surviving
// parents, children and phases are cleaned first, so no file ever points at a
// deleted idea. Returns the ids that were (with dryRun: would be) deleted.
export async function deleteIdeas(projectPath: string, rootIds: string[], options: { cascade: boolean; dryRun?: boolean }): Promise<string[]> {
  const doomed = await collectDeletion(projectPath, rootIds, options.cascade);
  if (options.dryRun) return [...doomed.keys()];

  const survivors = new Map<string, Idea>();
  const survivor = async (id: string) => {
    if (!survivors.has(id)) {
      const idea = await readIdeaOrNull(projectPath, id);
      if (!idea) return null;
      survivors.set(id, idea);
    }
    return survivors.get(id)!;
  };
  const phaseIds = new Set<string>();

  for (const idea of doomed.values()) {
    for (const phaseId of idea.committedIn) phaseIds.add(phaseId);
    for (const parentId of idea.supportedIdeas) {
      if (doomed.has(parentId)) continue;
      const parent = await survivor(parentId);
      if (parent) parent.supportingConnections = parent.supportingConnections.filter((connection) => connection.ideaId !== idea.id);
    }
    for (const { ideaId: childId } of idea.supportingConnections) {
      if (doomed.has(childId)) continue;
      const child = await survivor(childId);
      if (child) child.supportedIdeas = child.supportedIdeas.filter((id) => id !== idea.id);
    }
  }

  for (const idea of survivors.values()) await writeIdea(projectPath, idea);
  for (const phaseId of phaseIds) {
    try {
      const phase = await readPhase(projectPath, phaseId);
      await writePhase(projectPath, { ...phase, commitments: phase.commitments.filter((id) => !doomed.has(id)) });
    } catch (error) {
      console.warn(`Failed to clean phase ${phaseId} while deleting ideas: ${error}`);
    }
  }
  for (const id of doomed.keys()) await deleteIdeaCompletely(projectPath, id);

  return [...doomed.keys()];
}

// Takes the idea out of one parent or phase; the idea itself stays, floating
// if nothing else anchors it.
export async function detachIdea(projectPath: string, ideaId: string, context: IdeaContext): Promise<void> {
  if ('parentId' in context) {
    await disconnectIdeas(projectPath, context.parentId, ideaId);
  } else {
    await removeIdeaFromPhase(projectPath, ideaId, context.phaseId);
  }
}
