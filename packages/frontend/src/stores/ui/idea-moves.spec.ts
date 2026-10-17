import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// idea.move answers without entities: the test sees the optimistic local change.
const mockTrpc = vi.hoisted(() => ({
  idea: { move: { mutate: vi.fn(async () => ({ ideas: [], phases: [] })) } },
  phase: { setCursor: { mutate: vi.fn(async () => ({ success: true })) } }
}))
vi.mock('../../trpc', () => ({ trpc: mockTrpc }))

import { useDataStore } from '../data'
import { useUIStore } from './list-store'

// Shift+J/K on ideas: the selection is by id, so it follows the moved idea.
describe('Shift+J/K on ideas', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockTrpc.idea.move.mutate.mockClear()
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const idea = (id: string, children: string[] = []) =>
      ({ id, text: id, supportingConnections: children.map((ideaId) => ({ ideaId, weight: 1 })), supportedIdeas: [], committedIn: [] }) as any
    for (const entry of [idea('a', ['child-1', 'child-2']), idea('b'), idea('c'), idea('child-1'), idea('child-2')]) {
      dataStore.ideas[entry.id] = entry
    }
    const phase = (id: string, commitments: string[]) => ({ id, name: id, parent: null, childPhaseIds: [], commitments }) as any
    dataStore.phases = { first: phase('first', ['a', 'b']), second: phase('second', ['c']) }
    dataStore.meta = { rootPhaseIds: ['first', 'second'] } as any
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:first'
    uiStore.navigatingIdeas = true
  })

  const current = () => useUIStore().getCurrentIdea()?.id
  const commitments = (phaseId: string) => useDataStore().phases[phaseId]!.commitments

  it('swaps within the phase and keeps the moved idea selected', async () => {
    const uiStore = useUIStore()
    uiStore.selectTopIdea('first', 'b')
    await uiStore.moveIdeaUp()
    expect(commitments('first')).toEqual(['b', 'a'])
    expect(current()).toBe('b')
    expect(mockTrpc.idea.move.mutate).toHaveBeenCalledWith(expect.objectContaining({ ideaId: 'b', from: { phaseId: 'first' }, to: { phaseId: 'first' }, index: 0 }))
  })

  it('at the end of a phase moves into the next phase at the top, and back up to the bottom', async () => {
    const uiStore = useUIStore()
    uiStore.selectTopIdea('first', 'b')
    await uiStore.moveIdeaDown()
    expect(commitments('first')).toEqual(['a'])
    expect(commitments('second')).toEqual(['b', 'c'])
    expect(uiStore.selectedPhaseIdByColumn[0]).toBe('second')
    expect(current()).toBe('b')

    await uiStore.moveIdeaUp()
    expect(commitments('first')).toEqual(['a', 'b'])
    expect(commitments('second')).toEqual(['c'])
    expect(uiStore.selectedPhaseIdByColumn[0]).toBe('first')
    expect(current()).toBe('b')
  })

  it('swaps children inside their parent and stops at the ends', async () => {
    const uiStore = useUIStore()
    const dataStore = useDataStore()
    uiStore.selectTopIdea('first', 'a')
    const state = uiStore.ensureIdeaUIState(uiStore.getPhaseIdeaUIStates('first'), 'a')
    state.expanded = true
    state.selectedChildId = 'child-1'

    await uiStore.moveIdeaDown()
    expect(dataStore.ideas.a!.supportingConnections.map((connection) => connection.ideaId)).toEqual(['child-2', 'child-1'])
    expect(current()).toBe('child-1')

    await uiStore.moveIdeaDown()
    expect(dataStore.ideas.a!.supportingConnections.map((connection) => connection.ideaId)).toEqual(['child-2', 'child-1'])
    expect(mockTrpc.idea.move.mutate).toHaveBeenCalledTimes(1)
  })
})
