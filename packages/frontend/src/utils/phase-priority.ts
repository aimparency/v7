import type { Aim, Phase } from '../stores/data'

export type PrioritizedPhaseAim = {
  aim: Aim
  phaseId: string
  priority: number
  directlyCommitted: boolean
}

export function collectDescendantPhaseIds(
  rootPhaseId: string,
  phases: Record<string, Phase>
): Set<string> {
  const ids = new Set<string>()
  const pending = [rootPhaseId]

  while (pending.length > 0) {
    const phaseId = pending.pop()!
    if (ids.has(phaseId)) continue
    ids.add(phaseId)

    for (const childId of phases[phaseId]?.childPhaseIds ?? []) {
      pending.push(childId)
    }
  }

  return ids
}

export function rankAimsForPhaseTree(
  rootPhaseId: string,
  phases: Record<string, Phase>,
  aims: Record<string, Aim>,
  priorities: Map<string, number>,
  state: string
): PrioritizedPhaseAim[] {
  const phaseIds = collectDescendantPhaseIds(rootPhaseId, phases)
  const membership = new Map<string, { phaseId: string, directlyCommitted: boolean }>()
  const pending: Array<{ aimId: string, phaseId: string }> = []

  for (const phaseId of phaseIds) {
    for (const aimId of phases[phaseId]?.commitments ?? []) {
      if (!membership.has(aimId)) {
        membership.set(aimId, { phaseId, directlyCommitted: true })
      }
      pending.push({ aimId, phaseId })
    }
  }

  // Aim payloads also carry commitment membership. Use it as a compatible
  // source while phase data is being loaded incrementally or comes from older
  // cached/test fixtures without populated commitment arrays.
  for (const aim of Object.values(aims)) {
    const phaseId = aim.committedIn?.find(id => phaseIds.has(id))
    if (!phaseId) continue
    if (!membership.has(aim.id)) {
      membership.set(aim.id, { phaseId, directlyCommitted: true })
    }
    pending.push({ aimId: aim.id, phaseId })
  }

  // A phase commitment includes the committed aim's contribution subtree. This
  // lets a deadline phase commit one coherent objective while its actionable
  // and human-dependent children remain visible without duplicate commitments.
  const expanded = new Set<string>()
  while (pending.length > 0) {
    const { aimId, phaseId } = pending.shift()!
    if (expanded.has(aimId)) continue
    expanded.add(aimId)

    for (const connection of aims[aimId]?.supportingConnections ?? []) {
      const childId = connection.aimId
      if (!membership.has(childId)) {
        membership.set(childId, { phaseId, directlyCommitted: false })
      }
      pending.push({ aimId: childId, phaseId })
    }
  }

  return Object.values(aims)
    .filter(aim => !aim.archived && aim.status.state === state)
    .flatMap(aim => {
      const match = membership.get(aim.id)
      if (!match) return []
      return [{
        aim,
        phaseId: match.phaseId,
        priority: priorities.get(aim.id) ?? aim.calculatedPriority ?? 0,
        directlyCommitted: match.directlyCommitted
      }]
    })
    .sort((left, right) =>
      right.priority - left.priority ||
      left.aim.text.localeCompare(right.aim.text)
    )
}

export function formatAimPriority(priority: number): string {
  if (!Number.isFinite(priority) || priority < 0) return '0×'
  if (priority >= 100) return `${Math.round(priority)}×`
  if (priority >= 10) return `${priority.toFixed(1)}×`
  return `${priority.toFixed(2)}×`
}
