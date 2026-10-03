import { normalizeProjectPath } from '../project-path.js';
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

// Helper function to add idea to phase's commitments and idea's committedIn
export async function commitIdeaToPhase(projectPath: string, ideaId: string, phaseId: string, insertionIndex?: number): Promise<void> {
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
export async function removeIdeaFromPhase(projectPath: string, ideaId: string, phaseId: string): Promise<void> {
  // Update the phase
  const phase = await readPhase(projectPath, phaseId);
  phase.commitments = phase.commitments.filter(id => id !== ideaId);
  await writePhase(projectPath, phase);

  // Update the idea
  const idea = await readIdea(projectPath, ideaId);
  idea.committedIn = (idea.committedIn || []).filter(id => id !== phaseId);
  await writeIdea(projectPath, idea);
}

// Migration function to populate committedIn field for existing ideas
export async function migrateCommittedInField(projectPath: string): Promise<void> {
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
