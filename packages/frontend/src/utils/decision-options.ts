import type { Idea } from '../stores/data'

// The choices for one idea that waits on the human, numbered in the inbox so
// one key decides and the next idea comes up. Options an agent prepared are
// ai-proposition children: choosing one makes it open work and turns down the
// other proposals.

export type DecisionOption =
  | { kind: 'choose', label: string, childId: string }
  | { kind: 'accept', label: string }
  | { kind: 'done', label: string }
  | { kind: 'reply', label: string, placeholder: string }
  | { kind: 'drop', label: string }

export type StatusChange = { ideaId: string, status: Idea['status'] }

const proposals = (idea: Idea, ideas: Record<string, Idea>) =>
  idea.supportingConnections
    .map(connection => ideas[connection.ideaId])
    .filter((child): child is Idea => !!child && !child.archived && child.status.state === 'ai-proposition')

export function decisionOptions(idea: Idea, ideas: Record<string, Idea>): DecisionOption[] {
  const chosen: DecisionOption[] = proposals(idea, ideas).map(child => ({ kind: 'choose', label: child.text || '(untitled)', childId: child.id }))
  const state = idea.status.state
  if (state === 'ai-proposition') return [
    ...chosen,
    { kind: 'accept', label: 'Take it up' },
    { kind: 'reply', label: 'Answer…', placeholder: 'Your answer, or what to do instead' },
    { kind: 'drop', label: 'Drop' }
  ]
  if (state === 'review') return [
    ...chosen,
    { kind: 'accept', label: 'Accept' },
    { kind: 'reply', label: 'Send back…', placeholder: 'What still needs to change?' },
    { kind: 'drop', label: 'Drop' }
  ]
  return [
    ...chosen,
    ...(state === 'human-dependent' ? [{ kind: 'done', label: 'Done, I did it' } as const] : []),
    { kind: 'reply', label: 'Answer…', placeholder: 'Your answer, or what to do instead' },
    { kind: 'drop', label: 'Drop' }
  ]
}

// The status changes one decision makes. Every decision but accept and drop
// hands the idea back to the agents as open work, with what the human said in
// front of the old comment, so the question and its answer stay together.
export function decide(idea: Idea, option: DecisionOption, ideas: Record<string, Idea>, text = ''): StatusChange[] {
  const old = idea.status.comment
  const handBack = (said: string): StatusChange =>
    ({ ideaId: idea.id, status: { ...idea.status, state: 'open', comment: old ? `${said}\n\n${old}` : said } })
  switch (option.kind) {
    case 'accept':
      // A reviewed idea keeps its evidence; a proposal taken up becomes open work.
      return idea.status.state === 'ai-proposition'
        ? [handBack('Taken up by the human.')]
        : [{ ideaId: idea.id, status: { ...idea.status, state: 'implemented' } }]
    case 'drop':
      return [{ ideaId: idea.id, status: { ...idea.status, state: 'cancelled', comment: old ? `Dropped by the human.\n\n${old}` : 'Dropped by the human.' } }]
    case 'done':
      return [handBack('The human did it; verify and continue.')]
    case 'reply':
      return [handBack(idea.status.state === 'review' ? text.trim() : `Answer: ${text.trim()}`)]
    case 'choose':
      return [
        handBack(`Chosen: ${option.label}`),
        ...proposals(idea, ideas).map(child => ({
          ideaId: child.id,
          status: child.id === option.childId
            ? { ...child.status, state: 'open', comment: 'Chosen by the human.' }
            : { ...child.status, state: 'cancelled', comment: `Not chosen; the human picked "${option.label}".` }
        }))
      ]
  }
}
