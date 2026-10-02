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
  showAimModal: boolean
  ideaModalInsertPosition: RelativePosition
  ideaModalSource: 'columns' | 'graph'
  showAimSearch: boolean
  ideaSearchMode: 'navigate' | 'pick'
  ideaSearchCallback: ((payload: IdeaSearchPickPayload) => void) | null
  ideaSearchInitialAimId: string | null
  ideaSearchTitle: string
  ideaSearchPlaceholder: string
  ideaSearchShowFilters: boolean
  ideaSearchAdditionalOptions: IdeaSearchAdditionalOption[]
  showSettingsModal: boolean
  teleportCutAimId: string | null
  teleportSource: { parentAimId?: string; phaseId?: string } | null
  teleportCopyAimId: string | null
  teleportCopySource: { parentAimId?: string; phaseId?: string } | null
  movingAimId: string | null
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

export function openAimCreateModal(state: UIModalState, source: 'columns' | 'graph' = 'columns'): void {
  state.showAimModal = true
  state.ideaModalSource = source
}

export function closeAimModal(state: UIModalState): void {
  state.showAimModal = false
  state.ideaModalSource = 'columns'
}

export function openAimSearchModal(
  state: UIModalState,
  mode: 'navigate' | 'pick',
  callback?: ((payload: IdeaSearchPickPayload) => void) | null,
  initialAimId?: string,
  options?: Partial<IdeaSearchModalOptions>
): void {
  const resolvedOptions = {
    ...DEFAULT_IDEA_SEARCH_OPTIONS,
    ...options,
    additionalOptions: options?.additionalOptions ?? DEFAULT_IDEA_SEARCH_OPTIONS.additionalOptions
  }

  state.showAimSearch = true
  state.ideaSearchMode = mode
  state.ideaSearchCallback = callback || null
  state.ideaSearchInitialAimId = initialAimId || null
  state.ideaSearchTitle = resolvedOptions.title
  state.ideaSearchPlaceholder = resolvedOptions.placeholder
  state.ideaSearchShowFilters = resolvedOptions.showFilters
  state.ideaSearchAdditionalOptions = resolvedOptions.additionalOptions
}

export function closeAimSearchModal(state: UIModalState): void {
  state.showAimSearch = false
  state.ideaSearchMode = 'navigate'
  state.ideaSearchCallback = null
  state.ideaSearchInitialAimId = null
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
  state.teleportCutAimId = null
  state.teleportSource = null
  state.teleportCopyAimId = null
  state.teleportCopySource = null
  state.movingAimId = null
}
