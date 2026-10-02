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
import type { IdeaSearchModalOptions, IdeaSearchPickPayload } from './idea-search-types'
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
    phaseModalInsertPosition: 'before' as RelativePosition,

    showAimModal: false,
    ideaModalInsertPosition: 'before' as RelativePosition,
    ideaModalSource: 'columns' as 'columns' | 'graph',

    showAimEditModal: false,
    ideaEditModalAimId: null as string | null,
    ideaEditModalAimIds: [] as string[],

    // Connection details (contribution % + explanation) for a freshly-created connection.
    // parentId = supported idea, childId = supporting idea; the connection already exists.
    showConnectionDetailsModal: false,
    connectionDetailsParentId: null as string | null,
    connectionDetailsChildId: null as string | null,

    showAimSearch: false,
    ideaSearchMode: 'navigate' as 'navigate' | 'pick',
    ideaSearchCallback: null as ((payload: IdeaSearchPickPayload) => void) | null,
    ideaCreationCallback: null as ((ideaId: string, onConnectionConfirmed?: () => void) => void) | null,
    connectionDetailsCallback: null as (() => void) | null,
    ideaSearchInitialAimId: null as string | null,
    ideaSearchShowParentPaths: false,
    ideaSearchTitle: 'Search Ideas',
    ideaSearchPlaceholder: 'Go to idea...',
    ideaSearchShowFilters: true,
    ideaSearchAdditionalOptions: [],
    showPhaseSearchPrompt: false,
    phaseSearchPromptCallback: null as ((payload: PhaseSearchSelection) => void) | null,
    phaseSearchPromptTitle: 'Search Phases',
    phaseSearchPromptPlaceholder: 'Search phases...',
    phaseSearchPromptAdditionalOptions: [] as PhaseSearchAdditionalOption[],
    showSettingsModal: false,

    // Spin-off apply: target-path chooser dialog opened from the spin-off split button.
    showSpinOffApplyModal: false,

    teleportCutAimId: null as string | null,
    teleportSource: null as TeleportSource | null,
    teleportCopyAimId: null as string | null,
    teleportCopySource: null as TeleportSource | null,
    movingAimId: null as string | null
  }),

  actions: {
    openPhaseModal(insertPosition: RelativePosition = 'before') {
      openPhaseCreateModalHelper(this, insertPosition)
    },

    openPhaseEditModal(
      phaseId: string,
      phaseName: string,
      parentPhaseId: string | null
    ) {
      openPhaseEditModalHelper(this, phaseId, phaseName, parentPhaseId)
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
      callback?: (payload: IdeaSearchPickPayload) => void,
      initialAimId?: string,
      options?: Partial<IdeaSearchModalOptions>
    ) {
      openAimSearchModalHelper(this, mode, callback, initialAimId, options)
    },

    closeAimSearch() {
      closeAimSearchModalHelper(this)
      this.ideaSearchShowParentPaths = false
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

    openParentPathsModal(ideaId: string) {
      // Open search modal in path selection mode showing all paths to parent ideas
      this.ideaSearchInitialAimId = ideaId
      this.ideaSearchShowParentPaths = true
      this.ideaSearchMode = 'navigate'
      this.ideaSearchCallback = null
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

    openAimEditModal(ideaId: string, ideaIds: string[] = [ideaId]) {
      this.showAimEditModal = true
      this.ideaEditModalAimId = ideaId
      this.ideaEditModalAimIds = [...new Set(ideaIds)]
    },

    closeAimEditModal() {
      this.showAimEditModal = false
      this.ideaEditModalAimId = null
      this.ideaEditModalAimIds = []
    },

    openSpinOffApplyModal() {
      this.showSpinOffApplyModal = true
    },

    closeSpinOffApplyModal() {
      this.showSpinOffApplyModal = false
    },

    openConnectionDetailsModal(parentId: string, childId: string, callback?: () => void) {
      this.connectionDetailsParentId = parentId
      this.connectionDetailsChildId = childId
      this.showConnectionDetailsModal = true
      this.connectionDetailsCallback = callback || null
    },

    closeConnectionDetailsModal() {
      this.showConnectionDetailsModal = false
      this.connectionDetailsParentId = null
      this.connectionDetailsChildId = null
      if (this.connectionDetailsCallback) {
        const cb = this.connectionDetailsCallback
        this.connectionDetailsCallback = null
        cb()
      }
    }
  }
})
