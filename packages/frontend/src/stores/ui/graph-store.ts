import { defineStore } from 'pinia'
import {
  setGraphColorMode as setGraphColorModeHelper,
  setGraphPanelWidth as setGraphPanelWidthHelper,
  toggleGraphShowLabels as toggleGraphShowLabelsHelper,
  type GraphColorMode
} from './view-helpers'

export type PersistedGraphViewState = {
  graphSelectedAimId: string | null
  selectedLink: { parentId: string; childId: string } | null
  graphColorMode: GraphColorMode
  graphPanelWidth: number
  graphShowLabels: boolean
}

type GraphUIState = PersistedGraphViewState & {
  pendingDeleteLink: { parentId: string; childId: string } | null
}

export const useGraphUIStore = defineStore('ui-graph', {
  state: (): GraphUIState => ({
    graphSelectedAimId: null,
    selectedLink: null,
    pendingDeleteLink: null,
    graphColorMode: 'status',
    graphPanelWidth: 300,
    graphShowLabels: true
  }),

  actions: {
    getPersistedGraphViewState(): PersistedGraphViewState {
      return {
        graphSelectedAimId: this.graphSelectedAimId,
        selectedLink: this.selectedLink,
        graphColorMode: this.graphColorMode,
        graphPanelWidth: this.graphPanelWidth,
        graphShowLabels: this.graphShowLabels
      }
    },

    applyPersistedGraphViewState(state?: Partial<GraphUIState> | null) {
      if (!state) return
      this.graphSelectedAimId = state.graphSelectedAimId ?? null
      this.selectedLink = state.selectedLink ?? null
      if (state.graphColorMode) {
        this.graphColorMode = state.graphColorMode
      }
      if (typeof state.graphPanelWidth === 'number') {
        this.graphPanelWidth = state.graphPanelWidth
      }
      if (typeof state.graphShowLabels === 'boolean') {
        this.graphShowLabels = state.graphShowLabels
      }
    },

    setGraphSelection(aimId: string | null) {
      this.graphSelectedAimId = aimId
    },

    clearGraphSelection() {
      this.graphSelectedAimId = null
    },

    selectLink(parentId: string, childId: string) {
      this.selectedLink = { parentId, childId }
      this.pendingDeleteLink = null
    },

    deselectLink() {
      this.selectedLink = null
      this.pendingDeleteLink = null
    },

    setPendingDeleteLink(link: { parentId: string; childId: string } | null) {
      this.pendingDeleteLink = link
    },

    setGraphColorMode(mode: GraphColorMode) {
      setGraphColorModeHelper(this, mode)
    },

    setGraphPanelWidth(width: number) {
      setGraphPanelWidthHelper(this, width)
    },

    toggleGraphShowLabels() {
      toggleGraphShowLabelsHelper(this)
    }
  }
})
