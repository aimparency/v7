import path from 'path';
import { normalizeProjectPath } from '../project-path.js';
import { withFileLock } from './json.js';
import { listIdeas, readIdea, writeIdea } from './ideas.js';
import { listPhases, readPhase, writePhase } from './phases.js';

export async function cleanupCommitments(rawProjectPath: string, specificPhaseId?: string): Promise<number> {
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

function phaseLockKey(projectPath: string, phaseId: string): string {
  return path.join(normalizeProjectPath(projectPath), 'phases', `${phaseId}.json`);
}

function ideaLockKey(projectPath: string, ideaId: string): string {
  return path.join(normalizeProjectPath(projectPath), 'ideas', `${ideaId}.json`);
}

// Adds idea to phase's commitments (or moves it to insertionIndex) and phase to idea's committedIn
export async function commitIdeaToPhase(projectPath: string, ideaId: string, phaseId: string, insertionIndex?: number): Promise<void> {
  await withFileLock(phaseLockKey(projectPath, phaseId), async () => {
    const phase = await readPhase(projectPath, phaseId);
    const currentIndex = phase.commitments.indexOf(ideaId);
    if (currentIndex === -1) {
      if (insertionIndex !== undefined && insertionIndex <= phase.commitments.length) {
        phase.commitments.splice(insertionIndex, 0, ideaId);
      } else {
        phase.commitments.push(ideaId);
      }
    } else if (insertionIndex !== undefined && currentIndex !== insertionIndex) {
      // insertionIndex is relative to the array after removal (frontend sends currentIndex + 1 for move down).
      phase.commitments.splice(currentIndex, 1);
      phase.commitments.splice(Math.min(insertionIndex, phase.commitments.length), 0, ideaId);
    } else {
      return;
    }
    await writePhase(projectPath, phase);
  });

  await withFileLock(ideaLockKey(projectPath, ideaId), async () => {
    const idea = await readIdea(projectPath, ideaId);
    if (!idea.committedIn.includes(phaseId)) {
      idea.committedIn.push(phaseId);
      await writeIdea(projectPath, idea);
    }
  });
}

// Removes idea from phase's commitments and phase from idea's committedIn
export async function removeIdeaFromPhase(projectPath: string, ideaId: string, phaseId: string): Promise<void> {
  await withFileLock(phaseLockKey(projectPath, phaseId), async () => {
    const phase = await readPhase(projectPath, phaseId);
    phase.commitments = phase.commitments.filter(id => id !== ideaId);
    await writePhase(projectPath, phase);
  });

  await withFileLock(ideaLockKey(projectPath, ideaId), async () => {
    const idea = await readIdea(projectPath, ideaId);
    idea.committedIn = (idea.committedIn || []).filter(id => id !== phaseId);
    await writeIdea(projectPath, idea);
  });
}
