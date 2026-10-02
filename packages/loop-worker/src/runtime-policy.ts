import type { PrioritizedIdea } from 'agent-tools';

export function selectCycleTarget(
  prioritized: PrioritizedIdea[],
  targetIdeaId?: string | null
): PrioritizedIdea | undefined {
  return targetIdeaId
    ? prioritized.find((candidate) => candidate.idea.id === targetIdeaId) ?? prioritized[0]
    : prioritized[0];
}

export function throwIfStreamFailed(errors: string[]): void {
  if (errors.length > 0) throw new Error(errors.join('\n'));
}
