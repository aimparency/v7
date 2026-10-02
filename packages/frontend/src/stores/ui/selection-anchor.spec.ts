import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../trpc', () => ({ trpc: {} }))

import { useDataStore } from '../data'
import { useUIStore } from './list-store'
import { keepIdeaSelection } from './selection-anchor'

describe('keepIdeaSelection', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps the same idea selected when another client inserts an idea above it', () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    dataStore.phases = { p: { id: 'p', name: 'P', parent: null, childPhaseIds: [], commitments: ['x', 'y'], selectedIdeaIndex: 1 } } as any
    dataStore.ideas = Object.fromEntries(['x', 'y', 'new'].map((id) => [id, { id, text: id, supportingConnections: [], supportedIdeas: [], committedIn: ['p'] }])) as any
    uiStore.selectedEntryKeyByColumn = { 0: 'phase:p' }
    uiStore.activeColumn = 0
    uiStore.navigatingIdeas = true
    expect(uiStore.getCurrentIdea()?.id).toBe('y')

    keepIdeaSelection(uiStore, () => { dataStore.phases.p!.commitments = ['new', 'x', 'y'] })

    expect(uiStore.getCurrentIdea()?.id).toBe('y')
    expect(dataStore.phases.p!.selectedIdeaIndex).toBe(2)
  })
})
