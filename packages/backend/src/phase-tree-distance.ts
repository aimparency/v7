import type { Phase } from 'shared'

// Steps up and down the phase tree from `fromPhaseId` to each phase. Root
// phases hang under one virtual root (ordered by `rootPhaseIds`), so two root
// phases are two steps apart. Where the path turns at the common ancestor, the
// gap between the two branches in its child order adds a fraction below one
// step: of equally distant phases, those next to the origin's branch come
// first. Phases outside the tree are unreachable (Infinity).
export function phaseTreeDistances(fromPhaseId: string, phases: Record<string, Phase>, rootPhaseIds: string[] = []) {
  const parentOf = (phaseId: string | null) => (phaseId === null ? undefined : phases[phaseId]?.parent)
  const childrenOf = (phaseId: string | null) => (phaseId === null ? rootPhaseIds : phases[phaseId]?.childPhaseIds ?? [])

  // Each ancestor of the origin (the virtual root last): steps up to it, and
  // its child the origin hangs under.
  const ancestors = new Map<string | null, { stepsUp: number, branch: string | null }>()
  let branch: string | null = null
  for (let phaseId: string | null | undefined = fromPhaseId, steps = 0; phaseId !== undefined && !ancestors.has(phaseId); steps++) {
    ancestors.set(phaseId, { stepsUp: steps, branch })
    branch = phaseId
    phaseId = parentOf(phaseId)
  }

  const sideways = (ancestor: string | null, originBranch: string | null, targetBranch: string | null) => {
    if (originBranch === null || targetBranch === null) return 0
    const children = childrenOf(ancestor)
    const originIndex = children.indexOf(originBranch)
    const targetIndex = children.indexOf(targetBranch)
    if (originIndex < 0 || targetIndex < 0) return 0
    return Math.abs(originIndex - targetIndex) / children.length
  }

  return (phaseId: string) => {
    const visited = new Set<string | null>()
    let targetBranch: string | null = null
    for (let current: string | null | undefined = phaseId, steps = 0; current !== undefined && !visited.has(current); steps++) {
      const ancestor = ancestors.get(current)
      if (ancestor) return ancestor.stepsUp + steps + sideways(current, ancestor.branch, targetBranch)
      visited.add(current)
      targetBranch = current
      current = parentOf(current)
    }
    return Infinity
  }
}
