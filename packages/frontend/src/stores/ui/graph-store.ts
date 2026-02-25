import { defineStore } from 'pinia'
import {
  setGraphColorMode as setGraphColorModeHelper,
  setGraphPanelWidth as setGraphPanelWidthHelper,
  toggleGraphShowLabels as toggleGraphShowLabelsHelper,
  type GraphColorMode
} from './view-helpers'

type GraphUIState = {
  graphSelectedAimId: string | null
  selectedLink: { parentId: string; childId: string } | null
  graphColorMode: GraphColorMode
  graphPanelWidth: number
  graphShowLabels: boolean
}

export const useGraphUIStore = defineStore('ui-graph', {
  state: (): GraphUIState => ({
    graphSelectedAimId: null,
    selectedLink: null,
    graphColorMode: (localStorage.getItem('aimparency-graph-color-mode') || 'status') as GraphColorMode,
    graphPanelWidth: parseInt(localStorage.getItem('aimparency-graph-panel-width') || '300'),
    graphShowLabels: localStorage.getItem('aimparency-graph-show-labels') !== 'false'
  }),

  actions: {
    setGraphSelection(aimId: string | null) {
      this.graphSelectedAimId = aimId
    },

    clearGraphSelection() {
      this.graphSelectedAimId = null
    },

    selectLink(parentId: string, childId: string) {
      this.selectedLink = { parentId, childId }
    },

    deselectLink() {
      this.selectedLink = null
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
