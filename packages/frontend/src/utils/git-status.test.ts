import { describe, expect, it } from 'vitest'
import type { Phase } from 'shared'
import type { Idea } from '../stores/data'
import { changeKind, describeChange, needsCommit } from './git-status'

const DAY = 24 * 60 * 60 * 1000
const changes = (count: number) => Array.from({ length: count }, (_, index) => ({ path: `f${index}`, code: ' M' }))

describe('git status', () => {
  it('asks for a commit after more than ten changes or changes left for two days', () => {
    const now = 10 * DAY
    expect(needsCommit([], now - 9 * DAY, now)).toBe(false)
    expect(needsCommit(changes(10), now - DAY, now)).toBe(false)
    expect(needsCommit(changes(11), now - DAY, now)).toBe(true)
    expect(needsCommit(changes(1), now - 2 * DAY, now)).toBe(true)
    expect(needsCommit(changes(1), null, now)).toBe(true)
  })

  it('names idea and phase files by their content', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    const ideas = { [id]: { id, text: 'Commit from the UI' } } as unknown as Record<string, Idea>
    const phases = { [id]: { id, name: 'October' } } as unknown as Record<string, Phase>
    expect(describeChange(`.bowman/ideas/${id}.json`, ideas, {})).toEqual({ label: 'idea: Commit from the UI', isGraph: true })
    expect(describeChange(`sub/.bowman/phases/${id}.json`, {}, phases)).toEqual({ label: 'phase: October', isGraph: true })
    expect(describeChange(`.bowman/ideas/${id}.json`, {}, {})).toEqual({ label: 'idea: 11111111', isGraph: true })
    expect(describeChange('src/App.vue', ideas, phases)).toEqual({ label: 'src/App.vue', isGraph: false })
    expect([changeKind('??'), changeKind(' D'), changeKind('R '), changeKind(' M')]).toEqual(['new', 'deleted', 'renamed', 'modified'])
  })
})
