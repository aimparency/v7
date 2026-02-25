import { timestampToLocalDate, timestampToLocalTime } from 'shared'
import type { Aim } from '../data'

type RelativePosition = 'before' | 'after'

export type UIModalState = {
  showPhaseModal: boolean
  phaseModalMode: 'create' | 'edit'
  phaseModalEditingPhaseId: string | null
  phaseModalEditingParentId: string | null
  newPhaseName: string
  newPhaseStartDate: string
  newPhaseStartTime: string
  newPhaseEndDate: string
  newPhaseEndTime: string
  phaseModalInsertPosition: RelativePosition
  showAimModal: boolean
  aimModalMode: 'create' | 'edit'
  aimModalEditingAimId: string | null
  aimModalInsertPosition: RelativePosition
  showAimSearch: boolean
  aimSearchMode: 'navigate' | 'pick'
  aimSearchCallback: ((aim: Aim) => void) | null
  aimSearchInitialAimId: string | null
  showSettingsModal: boolean
  teleportCutAimId: string | null
  teleportSource: { parentAimId?: string; phaseId?: string } | null
  movingAimId: string | null
}

export function openPhaseCreateModal(state: UIModalState): void {
  state.showPhaseModal = true
  state.phaseModalMode = 'create'
  state.phaseModalEditingPhaseId = null
  state.phaseModalEditingParentId = null
  state.newPhaseName = ''
}

export function openPhaseEditModal(
  state: UIModalState,
  phaseId: string,
  phaseName: string,
  phaseFrom: number,
  phaseTo: number,
  parentPhaseId: string | null
): void {
  state.showPhaseModal = true
  state.phaseModalMode = 'edit'
  state.phaseModalEditingPhaseId = phaseId
  state.phaseModalEditingParentId = parentPhaseId
  state.newPhaseName = phaseName
  state.newPhaseStartDate = timestampToLocalDate(phaseFrom)
  state.newPhaseStartTime = timestampToLocalTime(phaseFrom)
  state.newPhaseEndDate = timestampToLocalDate(phaseTo)
  state.newPhaseEndTime = timestampToLocalTime(phaseTo)
}

export function closePhaseModal(state: UIModalState): void {
  state.showPhaseModal = false
  state.phaseModalMode = 'create'
  state.phaseModalEditingPhaseId = null
  state.phaseModalEditingParentId = null
  state.newPhaseName = ''
  state.newPhaseStartDate = ''
  state.newPhaseStartTime = ''
  state.newPhaseEndDate = ''
  state.newPhaseEndTime = ''
}

export function openAimCreateModal(state: UIModalState): void {
  state.showAimModal = true
  state.aimModalMode = 'create'
}

export function closeAimModal(state: UIModalState): void {
  state.showAimModal = false
  state.aimModalMode = 'create'
  state.aimModalEditingAimId = null
}

export function openAimSearchModal(
  state: UIModalState,
  mode: 'navigate' | 'pick',
  callback?: ((aim: Aim) => void) | null,
  initialAimId?: string
): void {
  state.showAimSearch = true
  state.aimSearchMode = mode
  state.aimSearchCallback = callback || null
  state.aimSearchInitialAimId = initialAimId || null
}

export function closeAimSearchModal(state: UIModalState): void {
  state.showAimSearch = false
  state.aimSearchMode = 'navigate'
  state.aimSearchCallback = null
  state.aimSearchInitialAimId = null
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
  state.movingAimId = null
}
