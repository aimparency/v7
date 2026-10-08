import { defineStore } from 'pinia'
import {
  clearTeleportBuffer as clearTeleportBufferHelper,
  closeIdeaModal as closeIdeaModalHelper,
  closeIdeaSearchModal as closeIdeaSearchModalHelper,
  closePhaseModal as closePhaseModalHelper,
  closeSettingsModal as closeSettingsModalHelper,
  openIdeaCreateModal as openIdeaCreateModalHelper,
  openIdeaSearchModal as openIdeaSearchModalHelper,
  openPhaseCreateModal as openPhaseCreateModalHelper,
  openPhaseEditModal as openPhaseEditModalHelper,
  openSettingsModal as openSettingsModalHelper
} from './modal-helpers'
import type { IdeaSearchModalOptions, IdeaSearchPickPayload } from './idea-search-types'
import type { PhaseSearchAdditionalOption, PhaseSearchModalOptions, PhaseSearchSelection } from './phase-search-types'

type RelativePosition = 'before' | 'after'
type TeleportSource = {
  parentIdeaId?: string
  phaseId?: string
}

// 'keep' is the conservative answer: take the idea out of its list (it stays
// floating), or without a list delete only the ideas themselves.
// 'cascade' deletes them together with their unanchored subtrees.
export type IdeaRemovalChoice = 'keep' | 'cascade'
export type IdeaRemovalRequest = {
  ideaIds: string[]
  // Name of the parent or phase the idea is removed from, if any.
  fromLabel?: string
  // What 'cascade' would delete, roots included.
  cascadeIds: string[]
}

// Not reactive: the pending promise of the open removal dialog.
let resolveIdeaRemovalDialog: ((choice: IdeaRemovalChoice | null) => void) | null = null

export const useUIModalStore = defineStore('ui-modal', {
  state: () => ({
    showPhaseModal: false,
    phaseModalMode: 'create' as 'create' | 'edit',
    phaseModalEditingPhaseId: null as string | null,
    phaseModalEditingParentId: null as string | null,
    newPhaseName: '',
    phaseModalInsertPosition: 'before' as RelativePosition,

    showIdeaModal: false,
    ideaModalInsertPosition: 'before' as RelativePosition,
    ideaModalSource: 'columns' as 'columns' | 'graph',

    showIdeaEditModal: false,
    ideaEditModalIdeaId: null as string | null,
    ideaEditModalIdeaIds: [] as string[],

    // Connection details (contribution % + hypothesis) for a freshly-created connection.
    // parentId = supported idea, childId = supporting idea; the connection already exists.
    showConnectionDetailsModal: false,
    connectionDetailsParentId: null as string | null,
    connectionDetailsChildId: null as string | null,
    // Opened to evaluate the connection's hypothesis (the child was settled).
    connectionDetailsEvaluate: false,

    showIdeaSearch: false,
    ideaSearchMode: 'navigate' as 'navigate' | 'pick',
    ideaSearchCallback: null as ((payload: IdeaSearchPickPayload) => void) | null,
    ideaCreationCallback: null as ((ideaId: string, onConnectionConfirmed?: () => void) => void) | null,
    // Parent the creation callback connects the new idea to; its color is inherited.
    ideaCreationParentId: null as string | null,
    connectionDetailsCallback: null as (() => void) | null,
    ideaSearchInitialIdeaId: null as string | null,
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

    ideaRemoval: null as IdeaRemovalRequest | null,

    // Spin-off apply: target-path chooser dialog opened from the spin-off split button.
    showSpinOffApplyModal: false,

    teleportCutIdeaId: null as string | null,
    teleportSource: null as TeleportSource | null,
    teleportCopyIdeaId: null as string | null,
    teleportCopySource: null as TeleportSource | null,
    movingIdeaId: null as string | null
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

    openIdeaModal(source: 'columns' | 'graph' = 'columns') {
      openIdeaCreateModalHelper(this, source)
    },

    closeIdeaModal() {
      closeIdeaModalHelper(this)
    },

    openIdeaSearch(
      mode: 'navigate' | 'pick' = 'navigate',
      callback?: (payload: IdeaSearchPickPayload) => void,
      initialIdeaId?: string,
      options?: Partial<IdeaSearchModalOptions>
    ) {
      openIdeaSearchModalHelper(this, mode, callback, initialIdeaId, options)
    },

    closeIdeaSearch() {
      closeIdeaSearchModalHelper(this)
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
      this.ideaSearchInitialIdeaId = ideaId
      this.ideaSearchShowParentPaths = true
      this.ideaSearchMode = 'navigate'
      this.ideaSearchCallback = null
      this.showIdeaSearch = true
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

    openIdeaEditModal(ideaId: string, ideaIds: string[] = [ideaId]) {
      this.showIdeaEditModal = true
      this.ideaEditModalIdeaId = ideaId
      this.ideaEditModalIdeaIds = [...new Set(ideaIds)]
    },

    closeIdeaEditModal() {
      this.showIdeaEditModal = false
      this.ideaEditModalIdeaId = null
      this.ideaEditModalIdeaIds = []
    },

    openSpinOffApplyModal() {
      this.showSpinOffApplyModal = true
    },

    closeSpinOffApplyModal() {
      this.showSpinOffApplyModal = false
    },

    openConnectionDetailsModal(parentId: string, childId: string, callback?: () => void, { evaluate = false } = {}) {
      this.connectionDetailsParentId = parentId
      this.connectionDetailsChildId = childId
      this.connectionDetailsEvaluate = evaluate
      this.showConnectionDetailsModal = true
      this.connectionDetailsCallback = callback || null
    },

    // Asks for an evaluation of each connection in turn; closing one (saved or
    // skipped with Escape) opens the next.
    promptConnectionEvaluations(connections: Array<{ parentId: string; childId: string }>) {
      const [next, ...rest] = connections
      if (!next) return
      this.openConnectionDetailsModal(next.parentId, next.childId, () => this.promptConnectionEvaluations(rest), { evaluate: true })
    },

    // Opens the removal dialog; resolves with the choice, or null when cancelled.
    askIdeaRemoval(request: IdeaRemovalRequest): Promise<IdeaRemovalChoice | null> {
      resolveIdeaRemovalDialog?.(null)
      this.ideaRemoval = request
      return new Promise((resolve) => { resolveIdeaRemovalDialog = resolve })
    },

    answerIdeaRemoval(choice: IdeaRemovalChoice | null) {
      const resolve = resolveIdeaRemovalDialog
      resolveIdeaRemovalDialog = null
      this.ideaRemoval = null
      resolve?.(choice)
    },

    closeConnectionDetailsModal() {
      this.showConnectionDetailsModal = false
      this.connectionDetailsParentId = null
      this.connectionDetailsChildId = null
      this.connectionDetailsEvaluate = false
      if (this.connectionDetailsCallback) {
        const cb = this.connectionDetailsCallback
        this.connectionDetailsCallback = null
        cb()
      }
    }
  }
})
