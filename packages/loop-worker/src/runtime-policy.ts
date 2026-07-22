import type { PrioritizedAim } from 'agent-tools';

export function selectCycleTarget(
  prioritized: PrioritizedAim[],
  targetAimId?: string | null
): PrioritizedAim | undefined {
  return targetAimId
    ? prioritized.find((candidate) => candidate.aim.id === targetAimId)
    : prioritized[0];
}

export function throwIfStreamFailed(errors: string[]): void {
  if (errors.length > 0) throw new Error(errors.join('\n'));
}
