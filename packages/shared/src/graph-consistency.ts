import type { Idea, Phase } from './types.js';

// Referential integrity of a .bowman graph: every link names an existing
// entity, and every link is recorded on both ends. Pure, so the backend's
// consistency check and the standalone validator apply the same rules.

export type GraphConsistencyIssueCode =
  | 'idea_nonexistent_phase'
  | 'idea_missing_phase_commitment'
  | 'phase_nonexistent_idea'
  | 'phase_missing_idea_committed_in'
  | 'idea_nonexistent_child'
  | 'idea_missing_child_supported_idea'
  | 'idea_nonexistent_parent'
  | 'idea_missing_parent_supporting_connection';

export type GraphConsistencyIssue = { code: GraphConsistencyIssueCode; message: string };

type GraphIdea = Pick<Idea, 'id' | 'committedIn' | 'supportedIdeas'> & { supportingConnections?: { ideaId: string }[] };
type GraphPhase = Pick<Phase, 'id' | 'commitments'>;

/**
 * `unreadableIdeaIds`: idea files that exist but fail to load. Links to them
 * are never reported as dangling, so a fixer cannot delete them.
 */
export function checkGraphConsistency(
  ideas: readonly GraphIdea[],
  phases: readonly GraphPhase[],
  unreadableIdeaIds: ReadonlySet<string> = new Set()
): GraphConsistencyIssue[] {
  const ideaMap = new Map(ideas.map((idea) => [idea.id, idea]));
  const phaseMap = new Map(phases.map((phase) => [phase.id, phase]));
  const issues: GraphConsistencyIssue[] = [];
  const report = (code: GraphConsistencyIssueCode, message: string) => issues.push({ code, message });

  for (const idea of ideas) {
    for (const phaseId of idea.committedIn) {
      const phase = phaseMap.get(phaseId);
      if (!phase) report('idea_nonexistent_phase', `Idea ${idea.id} claims to be committed in non-existent phase ${phaseId}`);
      else if (!phase.commitments.includes(idea.id)) report('idea_missing_phase_commitment', `Idea ${idea.id} says committed in Phase ${phaseId}, but Phase does not have it in commitments`);
    }
  }

  for (const phase of phases) {
    for (const ideaId of phase.commitments) {
      if (unreadableIdeaIds.has(ideaId)) continue;
      const idea = ideaMap.get(ideaId);
      if (!idea) report('phase_nonexistent_idea', `Phase ${phase.id} commits to non-existent idea ${ideaId}`);
      else if (!idea.committedIn.includes(phase.id)) report('phase_missing_idea_committed_in', `Phase ${phase.id} commits to Idea ${ideaId}, but Idea does not say committed in Phase`);
    }
  }

  for (const idea of ideas) {
    for (const { ideaId: childId } of idea.supportingConnections ?? []) {
      if (unreadableIdeaIds.has(childId)) continue;
      const child = ideaMap.get(childId);
      if (!child) report('idea_nonexistent_child', `Idea ${idea.id} has non-existent supporting connection (child) ${childId}`);
      else if (!child.supportedIdeas.includes(idea.id)) report('idea_missing_child_supported_idea', `Idea ${idea.id} lists ${childId} as supporting, but ${childId} does not list ${idea.id} as supportedIdeas`);
    }

    for (const parentId of idea.supportedIdeas) {
      if (unreadableIdeaIds.has(parentId)) continue;
      const parent = ideaMap.get(parentId);
      if (!parent) report('idea_nonexistent_parent', `Idea ${idea.id} has non-existent supportedIdeas (parent) ${parentId}`);
      else if (!parent.supportingConnections?.some((connection) => connection.ideaId === idea.id)) report('idea_missing_parent_supporting_connection', `Idea ${idea.id} lists ${parentId} as supportedIdeas, but ${parentId} does not list ${idea.id} in supportingConnections`);
    }
  }

  return issues;
}
