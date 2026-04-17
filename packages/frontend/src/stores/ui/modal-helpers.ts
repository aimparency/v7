import type { AimSearchAdditionalOption, AimSearchModalOptions, AimSearchPickPayload } from './aim-search-types'

type RelativePosition = 'before' | 'after'

const DEFAULT_AIM_SEARCH_OPTIONS: AimSearchModalOptions = {
  title: 'Search Aims',
  placeholder: 'Go to aim...',
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
  aimModalInsertPosition: RelativePosition
  aimModalSource: 'columns' | 'graph'
  showAimSearch: boolean
  aimSearchMode: 'navigate' | 'pick'
  aimSearchCallback: ((payload: AimSearchPickPayload) => void) | null
  aimSearchInitialAimId: string | null
  aimSearchTitle: string
  aimSearchPlaceholder: string
  aimSearchShowFilters: boolean
  aimSearchAdditionalOptions: AimSearchAdditionalOption[]
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
  state.aimModalSource = source
}

export function closeAimModal(state: UIModalState): void {
  state.showAimModal = false
  state.aimModalSource = 'columns'
}

export function openAimSearchModal(
  state: UIModalState,
  mode: 'navigate' | 'pick',
  callback?: ((payload: AimSearchPickPayload) => void) | null,
  initialAimId?: string,
  options?: Partial<AimSearchModalOptions>
): void {
  const resolvedOptions = {
    ...DEFAULT_AIM_SEARCH_OPTIONS,
    ...options,
    additionalOptions: options?.additionalOptions ?? DEFAULT_AIM_SEARCH_OPTIONS.additionalOptions
  }

  state.showAimSearch = true
  state.aimSearchMode = mode
  state.aimSearchCallback = callback || null
  state.aimSearchInitialAimId = initialAimId || null
  state.aimSearchTitle = resolvedOptions.title
  state.aimSearchPlaceholder = resolvedOptions.placeholder
  state.aimSearchShowFilters = resolvedOptions.showFilters
  state.aimSearchAdditionalOptions = resolvedOptions.additionalOptions
}

export function closeAimSearchModal(state: UIModalState): void {
  state.showAimSearch = false
  state.aimSearchMode = 'navigate'
  state.aimSearchCallback = null
  state.aimSearchInitialAimId = null
  state.aimSearchTitle = DEFAULT_AIM_SEARCH_OPTIONS.title
  state.aimSearchPlaceholder = DEFAULT_AIM_SEARCH_OPTIONS.placeholder
  state.aimSearchShowFilters = DEFAULT_AIM_SEARCH_OPTIONS.showFilters
  state.aimSearchAdditionalOptions = []
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
