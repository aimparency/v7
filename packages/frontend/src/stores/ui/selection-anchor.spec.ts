import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../trpc', () => ({ trpc: {} }))

import { useDataStore } from '../data'
import { useUIStore } from './list-store'
import { keepAimSelection } from './selection-anchor'

describe('keepAimSelection', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps the same aim selected when another client inserts an aim above it', () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    dataStore.phases = { p: { id: 'p', name: 'P', parent: null, childPhaseIds: [], commitments: ['x', 'y'], selectedAimIndex: 1 } } as any
    dataStore.aims = Object.fromEntries(['x', 'y', 'new'].map((id) => [id, { id, text: id, supportingConnections: [], supportedAims: [], committedIn: ['p'] }])) as any
    uiStore.selectedEntryKeyByColumn = { 0: 'phase:p' }
    uiStore.activeColumn = 0
    uiStore.navigatingAims = true
    expect(uiStore.getCurrentAim()?.id).toBe('y')

    keepAimSelection(uiStore, () => { dataStore.phases.p!.commitments = ['new', 'x', 'y'] })

    expect(uiStore.getCurrentAim()?.id).toBe('y')
    expect(dataStore.phases.p!.selectedAimIndex).toBe(2)
  })
})
