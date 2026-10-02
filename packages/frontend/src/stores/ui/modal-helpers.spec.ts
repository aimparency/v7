import { describe, expect, it } from 'vitest'
import {
  clearTeleportBuffer,
  closeAimModal,
  closeAimSearchModal,
  closePhaseModal,
  closeSettingsModal,
  openAimCreateModal,
  openAimSearchModal,
  openPhaseCreateModal,
  openSettingsModal,
  type UIModalState
} from './modal-helpers'

const createState = (): UIModalState => ({
  showPhaseModal: false,
  phaseModalMode: 'create',
  phaseModalEditingPhaseId: null,
  phaseModalEditingParentId: null,
  newPhaseName: '',
  phaseModalInsertPosition: 'before',
  showAimModal: false,
  ideaModalInsertPosition: 'before',
  ideaModalSource: 'columns',
  showAimSearch: false,
  ideaSearchMode: 'navigate',
  ideaSearchCallback: null,
  ideaSearchInitialAimId: null,
  ideaSearchTitle: 'Search Ideas',
  ideaSearchPlaceholder: 'Go to idea...',
  ideaSearchShowFilters: true,
  ideaSearchAdditionalOptions: [],
  showSettingsModal: false,
  teleportCutAimId: 'x',
  teleportSource: { parentAimId: 'p' },
  teleportCopyAimId: 'c',
  teleportCopySource: { phaseId: 'ph' },
  movingAimId: 'm'
})

describe('modal helpers', () => {
  it('toggles phase modal create state', () => {
    const state = createState()
    openPhaseCreateModal(state)
    expect(state.showPhaseModal).toBe(true)
    expect(state.phaseModalMode).toBe('create')
    closePhaseModal(state)
    expect(state.showPhaseModal).toBe(false)
    expect(state.newPhaseName).toBe('')
  })

  it('toggles idea modal and search state', () => {
    const state = createState()
    const callback = () => undefined
    openAimCreateModal(state)
    expect(state.showAimModal).toBe(true)
    openAimSearchModal(state, 'pick', callback, 'a1', {
      title: 'Pick Parent',
      placeholder: 'Search parents...',
      showFilters: false,
      additionalOptions: [{ id: 'skip', label: 'Skip' }]
    })
    expect(state.showAimSearch).toBe(true)
    expect(state.ideaSearchMode).toBe('pick')
    expect(state.ideaSearchInitialAimId).toBe('a1')
    expect(state.ideaSearchTitle).toBe('Pick Parent')
    expect(state.ideaSearchPlaceholder).toBe('Search parents...')
    expect(state.ideaSearchShowFilters).toBe(false)
    expect(state.ideaSearchAdditionalOptions).toEqual([{ id: 'skip', label: 'Skip' }])
    closeAimSearchModal(state)
    closeAimModal(state)
    expect(state.showAimSearch).toBe(false)
    expect(state.showAimModal).toBe(false)
  })

  it('toggles settings and clears teleport buffer', () => {
    const state = createState()
    openSettingsModal(state)
    expect(state.showSettingsModal).toBe(true)
    closeSettingsModal(state)
    expect(state.showSettingsModal).toBe(false)
    clearTeleportBuffer(state)
    expect(state.teleportCutAimId).toBe(null)
    expect(state.teleportSource).toBe(null)
    expect(state.teleportCopyAimId).toBe(null)
    expect(state.teleportCopySource).toBe(null)
    expect(state.movingAimId).toBe(null)
  })
})
