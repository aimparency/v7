import type { Idea } from '../stores/data'

// States that wait on the human: finished work to accept, or blocked work only
// a human can unblock.
export const AWAITING_HUMAN_STATES = ['review', 'human-dependent'] as const

export type InboxEntry = { idea: Idea; priority: number }

// Highest calculated priority first: the decision whose outcome matters most.
export function rankIdeasAwaitingHuman(
  ideas: Record<string, Idea>,
  priorities: Map<string, number>,
  states: readonly string[] = AWAITING_HUMAN_STATES
): InboxEntry[] {
  return Object.values(ideas)
    .filter(idea => !idea.archived && states.includes(idea.status.state))
    .map(idea => ({ idea, priority: priorities.get(idea.id) ?? 0 }))
    .sort((left, right) => right.priority - left.priority || left.idea.text.localeCompare(right.idea.text))
}
