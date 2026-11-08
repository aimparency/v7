import type { PrioritizedIdea } from 'agent-tools';
import type { Idea } from 'shared';

/**
 * The idea a cycle works on: the explicit target if it is a candidate, else the
 * highest-ranked candidate below the target (work reaches a container through
 * its leaves), else the top candidate.
 */
export function selectCycleTarget(
  prioritized: PrioritizedIdea[],
  targetIdeaId?: string | null,
  ideaById: Map<string, Idea> = new Map()
): PrioritizedIdea | undefined {
  if (!targetIdeaId) return prioritized[0];
  const direct = prioritized.find((candidate) => candidate.idea.id === targetIdeaId);
  if (direct) return direct;
  const below = descendantIds(targetIdeaId, ideaById);
  return prioritized.find((candidate) => below.has(candidate.idea.id)) ?? prioritized[0];
}

function descendantIds(rootId: string, ideaById: Map<string, Idea>): Set<string> {
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    for (const connection of ideaById.get(stack.pop()!)?.supportingConnections ?? []) {
      if (seen.has(connection.ideaId)) continue;
      seen.add(connection.ideaId);
      stack.push(connection.ideaId);
    }
  }
  return seen;
}

export function throwIfStreamFailed(errors: string[]): void {
  if (errors.length > 0) throw new Error(errors.join('\n'));
}
