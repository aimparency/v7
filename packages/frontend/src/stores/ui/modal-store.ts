import { defineStore } from 'pinia'
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
import type { AimSearchModalOptions, AimSearchPickPayload } from './aim-search-types'
import type { PhaseSearchAdditionalOption, PhaseSearchModalOptions, PhaseSearchSelection } from './phase-search-types'

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
    aimModalSource: 'columns' as 'columns' | 'graph',

    showAimEditModal: false,
    aimEditModalAimId: null as string | null,

    showAimSearch: false,
    aimSearchMode: 'navigate' as 'navigate' | 'pick',
    aimSearchCallback: null as ((payload: AimSearchPickPayload) => void) | null,
    aimCreationCallback: null as ((aimId: string) => void) | null,
    aimSearchInitialAimId: null as string | null,
    aimSearchShowParentPaths: false,
    aimSearchTitle: 'Search Aims',
    aimSearchPlaceholder: 'Go to aim...',
    aimSearchShowFilters: true,
    aimSearchAdditionalOptions: [],
    showPhaseSearchPrompt: false,
    phaseSearchPromptCallback: null as ((payload: PhaseSearchSelection) => void) | null,
    phaseSearchPromptTitle: 'Search Phases',
    phaseSearchPromptPlaceholder: 'Search phases...',
    phaseSearchPromptAdditionalOptions: [] as PhaseSearchAdditionalOption[],
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

    openAimModal(source: 'columns' | 'graph' = 'columns') {
      openAimCreateModalHelper(this, source)
    },

    closeAimModal() {
      closeAimModalHelper(this)
    },

    openAimSearch(
      mode: 'navigate' | 'pick' = 'navigate',
      callback?: (payload: AimSearchPickPayload) => void,
      initialAimId?: string,
      options?: Partial<AimSearchModalOptions>
    ) {
      openAimSearchModalHelper(this, mode, callback, initialAimId, options)
    },

    closeAimSearch() {
      closeAimSearchModalHelper(this)
      this.aimSearchShowParentPaths = false
    },

    openPhaseSearchPrompt(
      callback?: (payload: PhaseSearchSelection) => void,
      options?: Partial<PhaseSearchModalOptions>
    ) {
      this.showPhaseSearchPrompt = true
      this.phaseSearchPromptCallback = callback || null
      this.phaseSearchPromptTitle = options?.title ?? 'Search Phases'
      this.phaseSearchPromptPlaceholder = options?.placeholder ?? 'Search phases...'
      this.phaseSearchPromptAdditionalOptions = options?.additionalOptions ?? []
    },

    closePhaseSearchPrompt() {
      this.showPhaseSearchPrompt = false
      this.phaseSearchPromptCallback = null
      this.phaseSearchPromptTitle = 'Search Phases'
      this.phaseSearchPromptPlaceholder = 'Search phases...'
      this.phaseSearchPromptAdditionalOptions = []
    },

    openParentPathsModal(aimId: string) {
      // Open search modal in path selection mode showing all paths to parent aims
      this.aimSearchInitialAimId = aimId
      this.aimSearchShowParentPaths = true
      this.aimSearchMode = 'navigate'
      this.aimSearchCallback = null
      this.showAimSearch = true
    },

    clearTeleportBuffer() {
      clearTeleportBufferHelper(this)
    },

    openSettingsModal() {
      openSettingsModalHelper(this)
    },

    closeSettingsModal() {
      closeSettingsModalHelper(this)
    },

    openAimEditModal(aimId: string) {
      this.showAimEditModal = true
      this.aimEditModalAimId = aimId
    },

    closeAimEditModal() {
      this.showAimEditModal = false
      this.aimEditModalAimId = null
    }
  }
})
