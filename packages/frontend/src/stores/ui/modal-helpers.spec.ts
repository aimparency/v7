import { describe, expect, it } from 'vitest'
import {
  clearTeleportBuffer,
  closeIdeaModal,
  closeIdeaSearchModal,
  closePhaseModal,
  closeSettingsModal,
  openIdeaCreateModal,
  openIdeaSearchModal,
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
  showIdeaModal: false,
  ideaModalInsertPosition: 'before',
  ideaModalSource: 'columns',
  showIdeaSearch: false,
  ideaSearchMode: 'navigate',
  ideaSearchCallback: null,
  ideaSearchInitialIdeaId: null,
  ideaSearchTitle: 'Search Ideas',
  ideaSearchPlaceholder: 'Go to idea...',
  ideaSearchShowFilters: true,
  ideaSearchAdditionalOptions: [],
  showSettingsModal: false,
  teleportCutIdeaId: 'x',
  teleportSource: { parentIdeaId: 'p' },
  teleportCopyIdeaId: 'c',
  teleportCopySource: { phaseId: 'ph' },
  movingIdeaId: 'm'
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
    openIdeaCreateModal(state)
    expect(state.showIdeaModal).toBe(true)
    openIdeaSearchModal(state, 'pick', callback, 'a1', {
      title: 'Pick Parent',
      placeholder: 'Search parents...',
      showFilters: false,
      additionalOptions: [{ id: 'skip', label: 'Skip' }]
    })
    expect(state.showIdeaSearch).toBe(true)
    expect(state.ideaSearchMode).toBe('pick')
    expect(state.ideaSearchInitialIdeaId).toBe('a1')
    expect(state.ideaSearchTitle).toBe('Pick Parent')
    expect(state.ideaSearchPlaceholder).toBe('Search parents...')
    expect(state.ideaSearchShowFilters).toBe(false)
    expect(state.ideaSearchAdditionalOptions).toEqual([{ id: 'skip', label: 'Skip' }])
    closeIdeaSearchModal(state)
    closeIdeaModal(state)
    expect(state.showIdeaSearch).toBe(false)
    expect(state.showIdeaModal).toBe(false)
  })

  it('toggles settings and clears teleport buffer', () => {
    const state = createState()
    openSettingsModal(state)
    expect(state.showSettingsModal).toBe(true)
    closeSettingsModal(state)
    expect(state.showSettingsModal).toBe(false)
    clearTeleportBuffer(state)
    expect(state.teleportCutIdeaId).toBe(null)
    expect(state.teleportSource).toBe(null)
    expect(state.teleportCopyIdeaId).toBe(null)
    expect(state.teleportCopySource).toBe(null)
    expect(state.movingIdeaId).toBe(null)
  })
})
