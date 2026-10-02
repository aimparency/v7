import type { Idea, Phase } from '../stores/data'

export type PrioritizedPhaseAim = {
  idea: Idea
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
  ideas: Record<string, Idea>,
  priorities: Map<string, number>,
  state: string
): PrioritizedPhaseAim[] {
  const phaseIds = collectDescendantPhaseIds(rootPhaseId, phases)
  const membership = new Map<string, { phaseId: string, directlyCommitted: boolean }>()
  const pending: Array<{ ideaId: string, phaseId: string }> = []

  for (const phaseId of phaseIds) {
    for (const ideaId of phases[phaseId]?.commitments ?? []) {
      if (!membership.has(ideaId)) {
        membership.set(ideaId, { phaseId, directlyCommitted: true })
      }
      pending.push({ ideaId, phaseId })
    }
  }

  // Idea payloads also carry commitment membership. Use it as a compatible
  // source while phase data is being loaded incrementally or comes from older
  // cached/test fixtures without populated commitment arrays.
  for (const idea of Object.values(ideas)) {
    const phaseId = idea.committedIn?.find(id => phaseIds.has(id))
    if (!phaseId) continue
    if (!membership.has(idea.id)) {
      membership.set(idea.id, { phaseId, directlyCommitted: true })
    }
    pending.push({ ideaId: idea.id, phaseId })
  }

  // A phase commitment includes the committed idea's contribution subtree. This
  // lets a deadline phase commit one coherent objective while its actionable
  // and human-dependent children remain visible without duplicate commitments.
  const expanded = new Set<string>()
  while (pending.length > 0) {
    const { ideaId, phaseId } = pending.shift()!
    if (expanded.has(ideaId)) continue
    expanded.add(ideaId)

    for (const connection of ideas[ideaId]?.supportingConnections ?? []) {
      const childId = connection.ideaId
      if (!membership.has(childId)) {
        membership.set(childId, { phaseId, directlyCommitted: false })
      }
      pending.push({ ideaId: childId, phaseId })
    }
  }

  return Object.values(ideas)
    .filter(idea => !idea.archived && idea.status.state === state)
    .flatMap(idea => {
      const match = membership.get(idea.id)
      if (!match) return []
      return [{
        idea,
        phaseId: match.phaseId,
        priority: priorities.get(idea.id) ?? idea.calculatedPriority ?? 0,
        directlyCommitted: match.directlyCommitted
      }]
    })
    .sort((left, right) =>
      right.priority - left.priority ||
      left.idea.text.localeCompare(right.idea.text)
    )
}

export function formatAimPriority(priority: number): string {
  if (!Number.isFinite(priority) || priority < 0) return '0×'
  if (priority >= 100) return `${Math.round(priority)}×`
  if (priority >= 10) return `${priority.toFixed(1)}×`
  return `${priority.toFixed(2)}×`
}
