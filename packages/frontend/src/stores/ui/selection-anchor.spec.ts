import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../trpc', () => ({ trpc: {} }))

import { useDataStore } from '../data'
import { useUIStore } from './list-store'
import { keepIdeaSelection } from './selection-anchor'

describe('idea selection by id', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const seed = (commitments: string[], selected: string) => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const ids = ['a', 'b', 'c', 'new', 'child-1', 'child-2', 'child-3']
    dataStore.phases = { p: { id: 'p', name: 'P', parent: null, childPhaseIds: [], commitments } } as any
    dataStore.ideas = Object.fromEntries(ids.map((id) => [id, { id, text: id, supportingConnections: [], supportedIdeas: [], committedIn: ['p'] }])) as any
    uiStore.selectedEntryKeyByColumn = { 0: 'phase:p' }
    uiStore.activeColumn = 0
    uiStore.navigatingIdeas = true
    uiStore.selectTopIdea('p', selected)
    return { dataStore, uiStore }
  }

  it('stays on the same idea when an idea is inserted above it, in any phase', () => {
    const { dataStore, uiStore } = seed(['a', 'b'], 'b')
    dataStore.replacePhase('p', { ...dataStore.phases.p!, commitments: ['new', 'a', 'b'] })
    expect(uiStore.getCurrentIdea()?.id).toBe('b')

    uiStore.navigatingIdeas = false
    dataStore.replacePhase('p', { ...dataStore.phases.p!, commitments: ['b', 'new', 'a'] })
    expect(uiStore.getSelectedTopIdeaId('p')).toBe('b')
  })

  it('selects the successor, or the new last idea, when a change removes the selected one', () => {
    const { dataStore, uiStore } = seed(['a', 'b', 'c'], 'b')
    keepIdeaSelection(uiStore, () => { dataStore.phases.p!.commitments = ['a', 'c'] })
    expect(uiStore.getCurrentIdea()?.id).toBe('c')

    keepIdeaSelection(uiStore, () => { dataStore.phases.p!.commitments = ['a'] })
    expect(uiStore.getCurrentIdea()?.id).toBe('a')
  })

  it('selects the next sibling when a change removes the selected child', () => {
    const { dataStore, uiStore } = seed(['a'], 'a')
    dataStore.ideas.a!.supportingConnections = ['child-1', 'child-2', 'child-3'].map((ideaId) => ({ ideaId, weight: 1 })) as any
    const state = uiStore.ensureIdeaUIState(uiStore.getPhaseIdeaUIStates('p'), 'a')
    state.expanded = true
    state.selectedChildId = 'child-2'
    expect(uiStore.getCurrentIdea()?.id).toBe('child-2')

    keepIdeaSelection(uiStore, () => {
      dataStore.ideas.a!.supportingConnections = dataStore.ideas.a!.supportingConnections.filter((connection) => connection.ideaId !== 'child-2')
    })
    expect(uiStore.getCurrentIdea()?.id).toBe('child-3')
  })
})
