import type { Phase } from 'shared'
import type { Idea } from '../stores/data'

// States that wait on the human: finished work to accept, blocked work only a
// human can unblock, and questions only a human can answer.
export const AWAITING_HUMAN_STATES = ['review', 'human-dependent', 'unclear'] as const
export const DEFAULT_AWAITING_HUMAN_STATES = ['review', 'human-dependent'] as const

export type InboxEntry = { idea: Idea; priority: number }

// Highest calculated priority first: the decision whose outcome matters most.
export function rankIdeasAwaitingHuman(
  ideas: Record<string, Idea>,
  priorities: Map<string, number>,
  states: readonly string[] = DEFAULT_AWAITING_HUMAN_STATES
): InboxEntry[] {
  return Object.values(ideas)
    .filter(idea => !idea.archived && states.includes(idea.status.state))
    .map(idea => ({ idea, priority: priorities.get(idea.id) ?? 0 }))
    .sort((left, right) => right.priority - left.priority || left.idea.text.localeCompare(right.idea.text))
}

// Position of each idea's first appearance when reading the plan front to back:
// phases depth-first in their stored order (a phase before its subphases), in
// each phase its commitments in order, each followed by its sub-ideas.
export function firstAppearanceOrder(
  phases: Record<string, Phase>,
  rootPhaseIds: readonly string[],
  ideas: Record<string, Idea>
): Map<string, number> {
  const order = new Map<string, number>()
  const visitIdea = (ideaId: string) => {
    if (order.has(ideaId)) return
    order.set(ideaId, order.size)
    for (const connection of ideas[ideaId]?.supportingConnections ?? []) visitIdea(connection.ideaId)
  }
  const visitPhase = (phaseId: string, seen: Set<string>) => {
    const phase = phases[phaseId]
    if (!phase || seen.has(phaseId)) return
    seen.add(phaseId)
    phase.commitments.forEach(visitIdea)
    for (const childId of phase.childPhaseIds ?? []) visitPhase(childId, seen)
  }
  const seen = new Set<string>()
  for (const phaseId of rootPhaseIds) visitPhase(phaseId, seen)
  return order
}

// Earliest first appearance first; ideas in no phase keep their priority order at the end.
export function sortChronologically(entries: InboxEntry[], order: Map<string, number>): InboxEntry[] {
  const position = (entry: InboxEntry) => order.get(entry.idea.id) ?? Infinity
  return [...entries].sort((left, right) => position(left) - position(right) || right.priority - left.priority)
}
