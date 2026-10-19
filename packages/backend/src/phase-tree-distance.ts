import type { Phase } from 'shared'

// Steps up and down the phase tree from `fromPhaseId` (null: the root level)
// to each phase. Root phases hang under one virtual root, so two root phases
// are two steps apart. Phases outside the loaded tree are unreachable (Infinity).
export function phaseTreeDistances(fromPhaseId: string | null, phases: Record<string, Phase>) {
  const parentOf = (phaseId: string | null) => (phaseId === null ? undefined : phases[phaseId]?.parent)

  // Steps up from the origin to each of its ancestors, the virtual root last.
  const stepsUp = new Map<string | null, number>()
  for (let phaseId: string | null | undefined = fromPhaseId, steps = 0; phaseId !== undefined && !stepsUp.has(phaseId); steps++) {
    stepsUp.set(phaseId, steps)
    phaseId = parentOf(phaseId)
  }

  return (phaseId: string) => {
    const visited = new Set<string | null>()
    for (let current: string | null | undefined = phaseId, steps = 0; current !== undefined && !visited.has(current); steps++) {
      const up = stepsUp.get(current)
      if (up !== undefined) return up + steps
      visited.add(current)
      current = parentOf(current)
    }
    return Infinity
  }
}
