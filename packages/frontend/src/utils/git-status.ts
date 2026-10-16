import type { Phase } from 'shared'
import type { Idea } from '../stores/data'

export type WorkingTreeChange = { path: string; code: string }

const DAY_MS = 24 * 60 * 60 * 1000
export const MANY_CHANGES = 10
export const STALE_COMMIT_DAYS = 2

// Prompt to commit once work piles up: many changes, or changes left for days.
export function needsCommit(changes: WorkingTreeChange[], lastCommitAt: number | null, now = Date.now()): boolean {
  if (changes.length === 0) return false
  return changes.length > MANY_CHANGES || lastCommitAt === null || now - lastCommitAt >= STALE_COMMIT_DAYS * DAY_MS
}

export function changeKind(code: string): string {
  if (code === '??' || code.includes('A')) return 'new'
  if (code.includes('D')) return 'deleted'
  if (code.includes('R')) return 'renamed'
  return 'modified'
}

const GRAPH_FILE = /(?:^|\/)\.bowman\/(ideas|archived-ideas|phases)\/([0-9a-f-]{36})\.json$/

// Idea and phase files read as what they hold; other files by their path.
export function describeChange(path: string, ideas: Record<string, Idea>, phases: Record<string, Phase>): { label: string; isGraph: boolean } {
  const match = GRAPH_FILE.exec(path)
  if (!match) return { label: path, isGraph: path.includes('.bowman/') }
  const [, folder, id] = match
  const name = folder === 'phases' ? phases[id!]?.name : ideas[id!]?.text
  return { label: `${folder === 'phases' ? 'phase' : 'idea'}: ${name || id!.slice(0, 8)}`, isGraph: true }
}
