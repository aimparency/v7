import { defineStore } from 'pinia'
import type { Aim } from '../data'
import {
  clearTeleportBuffer as clearTeleportBufferHelper,
  closeAimModal as closeAimModalHelper,
  closeAimSearchModal as closeAimSearchModalHelper,
  closePhaseModal as closePhaseModalHelper,
  closeSettingsModal as closeSettingsModalHelper,
  openAimCreateModal as openAimCreateModalHelper,
  openAimSearchModal as openAimSearchModalHelper,
  openPhaseCreateModal as openPhaseCreateModalHelper,
  openPhaseEditModal as openPhaseEditModalHelper,
  openSettingsModal as openSettingsModalHelper
} from './modal-helpers'

type RelativePosition = 'before' | 'after'
type TeleportSource = {
  parentAimId?: string
  phaseId?: string
}

export const useUIModalStore = defineStore('ui-modal', {
  state: () => ({
    showPhaseModal: false,
    phaseModalMode: 'create' as 'create' | 'edit',
    phaseModalEditingPhaseId: null as string | null,
    phaseModalEditingParentId: null as string | null,
    newPhaseName: '',
    newPhaseStartDate: '',
    newPhaseStartTime: '',
    newPhaseEndDate: '',
    newPhaseEndTime: '',
    phaseModalInsertPosition: 'before' as RelativePosition,

    showAimModal: false,
    aimModalMode: 'create' as 'create' | 'edit',
    aimModalEditingAimId: null as string | null,
    aimModalInsertPosition: 'before' as RelativePosition,

    showAimSearch: false,
    aimSearchMode: 'navigate' as 'navigate' | 'pick',
    aimSearchCallback: null as ((aim: Aim) => void) | null,
    aimCreationCallback: null as ((aimId: string) => void) | null,
    aimSearchInitialAimId: null as string | null,
    showSettingsModal: false,

    teleportCutAimId: null as string | null,
    teleportSource: null as TeleportSource | null,
    movingAimId: null as string | null
  }),

  actions: {
    openPhaseModal() {
      openPhaseCreateModalHelper(this)
    },

    openPhaseEditModal(
      phaseId: string,
      phaseName: string,
      phaseFrom: number,
      phaseTo: number,
      parentPhaseId: string | null
    ) {
      openPhaseEditModalHelper(this, phaseId, phaseName, phaseFrom, phaseTo, parentPhaseId)
    },

    closePhaseModal() {
      closePhaseModalHelper(this)
    },

    openAimModal() {
      openAimCreateModalHelper(this)
    },

    closeAimModal() {
      closeAimModalHelper(this)
    },

    openAimSearch(mode: 'navigate' | 'pick' = 'navigate', callback?: (aim: Aim) => void, initialAimId?: string) {
      openAimSearchModalHelper(this, mode, callback, initialAimId)
    },

    closeAimSearch() {
      closeAimSearchModalHelper(this)
    },

    clearTeleportBuffer() {
      clearTeleportBufferHelper(this)
    },

    openSettingsModal() {
      openSettingsModalHelper(this)
    },

    closeSettingsModal() {
      closeSettingsModalHelper(this)
    }
  }
})
