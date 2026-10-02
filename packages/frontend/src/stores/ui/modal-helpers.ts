import type { IdeaSearchAdditionalOption, IdeaSearchModalOptions, IdeaSearchPickPayload } from './idea-search-types'

type RelativePosition = 'before' | 'after'

const DEFAULT_IDEA_SEARCH_OPTIONS: IdeaSearchModalOptions = {
  title: 'Search Ideas',
  placeholder: 'Go to idea...',
  showFilters: true,
  additionalOptions: []
}

export type UIModalState = {
  showPhaseModal: boolean
  phaseModalMode: 'create' | 'edit'
  phaseModalEditingPhaseId: string | null
  phaseModalEditingParentId: string | null
  newPhaseName: string
  phaseModalInsertPosition: RelativePosition
  showIdeaModal: boolean
  ideaModalInsertPosition: RelativePosition
  ideaModalSource: 'columns' | 'graph'
  showIdeaSearch: boolean
  ideaSearchMode: 'navigate' | 'pick'
  ideaSearchCallback: ((payload: IdeaSearchPickPayload) => void) | null
  ideaSearchInitialIdeaId: string | null
  ideaSearchTitle: string
  ideaSearchPlaceholder: string
  ideaSearchShowFilters: boolean
  ideaSearchAdditionalOptions: IdeaSearchAdditionalOption[]
  showSettingsModal: boolean
  teleportCutIdeaId: string | null
  teleportSource: { parentIdeaId?: string; phaseId?: string } | null
  teleportCopyIdeaId: string | null
  teleportCopySource: { parentIdeaId?: string; phaseId?: string } | null
  movingIdeaId: string | null
}

export function openPhaseCreateModal(state: UIModalState, insertPosition: RelativePosition = 'before'): void {
  state.showPhaseModal = true
  state.phaseModalMode = 'create'
  state.phaseModalEditingPhaseId = null
  state.phaseModalEditingParentId = null
  state.phaseModalInsertPosition = insertPosition
  state.newPhaseName = ''
}

export function openPhaseEditModal(
  state: UIModalState,
  phaseId: string,
  phaseName: string,
  parentPhaseId: string | null
): void {
  state.showPhaseModal = true
  state.phaseModalMode = 'edit'
  state.phaseModalEditingPhaseId = phaseId
  state.phaseModalEditingParentId = parentPhaseId
  state.phaseModalInsertPosition = 'before'
  state.newPhaseName = phaseName
}

export function closePhaseModal(state: UIModalState): void {
  state.showPhaseModal = false
  state.phaseModalMode = 'create'
  state.phaseModalEditingPhaseId = null
  state.phaseModalEditingParentId = null
  state.newPhaseName = ''
  state.phaseModalInsertPosition = 'before'
}

export function openIdeaCreateModal(state: UIModalState, source: 'columns' | 'graph' = 'columns'): void {
  state.showIdeaModal = true
  state.ideaModalSource = source
}

export function closeIdeaModal(state: UIModalState): void {
  state.showIdeaModal = false
  state.ideaModalSource = 'columns'
}

export function openIdeaSearchModal(
  state: UIModalState,
  mode: 'navigate' | 'pick',
  callback?: ((payload: IdeaSearchPickPayload) => void) | null,
  initialIdeaId?: string,
  options?: Partial<IdeaSearchModalOptions>
): void {
  const resolvedOptions = {
    ...DEFAULT_IDEA_SEARCH_OPTIONS,
    ...options,
    additionalOptions: options?.additionalOptions ?? DEFAULT_IDEA_SEARCH_OPTIONS.additionalOptions
  }

  state.showIdeaSearch = true
  state.ideaSearchMode = mode
  state.ideaSearchCallback = callback || null
  state.ideaSearchInitialIdeaId = initialIdeaId || null
  state.ideaSearchTitle = resolvedOptions.title
  state.ideaSearchPlaceholder = resolvedOptions.placeholder
  state.ideaSearchShowFilters = resolvedOptions.showFilters
  state.ideaSearchAdditionalOptions = resolvedOptions.additionalOptions
}

export function closeIdeaSearchModal(state: UIModalState): void {
  state.showIdeaSearch = false
  state.ideaSearchMode = 'navigate'
  state.ideaSearchCallback = null
  state.ideaSearchInitialIdeaId = null
  state.ideaSearchTitle = DEFAULT_IDEA_SEARCH_OPTIONS.title
  state.ideaSearchPlaceholder = DEFAULT_IDEA_SEARCH_OPTIONS.placeholder
  state.ideaSearchShowFilters = DEFAULT_IDEA_SEARCH_OPTIONS.showFilters
  state.ideaSearchAdditionalOptions = []
}

export function openSettingsModal(state: UIModalState): void {
  state.showSettingsModal = true
}

export function closeSettingsModal(state: UIModalState): void {
  state.showSettingsModal = false
}

export function clearTeleportBuffer(state: UIModalState): void {
  state.teleportCutIdeaId = null
  state.teleportSource = null
  state.teleportCopyIdeaId = null
  state.teleportCopySource = null
  state.movingIdeaId = null
}
