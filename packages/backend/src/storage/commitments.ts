import { normalizeProjectPath } from '../project-path.js';
import { listIdeas, updateIdea, writeIdea } from './ideas.js';
import { listPhases, updatePhase } from './phases.js';

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

// Adds idea to phase's commitments (or moves it to insertionIndex) and phase to idea's committedIn
export async function commitIdeaToPhase(projectPath: string, ideaId: string, phaseId: string, insertionIndex?: number): Promise<void> {
  await updatePhase(projectPath, phaseId, (phase) => {
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
      return null;
    }
    return phase;
  });

  await updateIdea(projectPath, ideaId, (idea) => {
    if (idea.committedIn.includes(phaseId)) return null;
    idea.committedIn.push(phaseId);
    return idea;
  });
}

// Removes idea from phase's commitments and phase from idea's committedIn
export async function removeIdeaFromPhase(projectPath: string, ideaId: string, phaseId: string): Promise<void> {
  await updatePhase(projectPath, phaseId, (phase) => ({ ...phase, commitments: phase.commitments.filter(id => id !== ideaId) }));
  await updateIdea(projectPath, ideaId, (idea) => ({ ...idea, committedIn: (idea.committedIn || []).filter(id => id !== phaseId) }));
}
