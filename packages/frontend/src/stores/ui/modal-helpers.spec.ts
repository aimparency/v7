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
  newPhaseStartDate: '',
  newPhaseStartTime: '',
  newPhaseEndDate: '',
  newPhaseEndTime: '',
  phaseModalInsertPosition: 'before',
  showAimModal: false,
  aimModalMode: 'create',
  aimModalEditingAimId: null,
  aimModalInsertPosition: 'before',
  aimModalSource: 'columns',
  showAimSearch: false,
  aimSearchMode: 'navigate',
  aimSearchCallback: null,
  aimSearchInitialAimId: null,
  aimSearchTitle: 'Search Aims',
  aimSearchPlaceholder: 'Go to aim...',
  aimSearchShowFilters: true,
  aimSearchAdditionalOptions: [],
  showSettingsModal: false,
  teleportCutAimId: 'x',
  teleportSource: { parentAimId: 'p' },
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

  it('toggles aim modal and search state', () => {
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
    expect(state.aimSearchMode).toBe('pick')
    expect(state.aimSearchInitialAimId).toBe('a1')
    expect(state.aimSearchTitle).toBe('Pick Parent')
    expect(state.aimSearchPlaceholder).toBe('Search parents...')
    expect(state.aimSearchShowFilters).toBe(false)
    expect(state.aimSearchAdditionalOptions).toEqual([{ id: 'skip', label: 'Skip' }])
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
    expect(state.movingAimId).toBe(null)
  })
})
