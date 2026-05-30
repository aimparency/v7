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

export type PhaseFilter = {
  phaseId: string
  phaseName: string
  visibleIds: string[]   // fully shown aims
  loadableIds: string[]  // ring-only aims (parents of visible)
}

type GraphUIState = PersistedGraphViewState & {
  pendingDeleteLink: { parentId: string; childId: string } | null
  phaseFilter: PhaseFilter | null
}

export const useGraphUIStore = defineStore('ui-graph', {
  state: (): GraphUIState => ({
    graphSelectedAimId: null,
    selectedLink: null,
    pendingDeleteLink: null,
    graphColorMode: 'status',
    graphPanelWidth: 300,
    graphShowLabels: true,
    phaseFilter: null
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
    },

    setPhaseFilter(phaseId: string, phaseName: string, commitments: string[], aimsById: Record<string, { supportedAims?: string[] }>) {
      const visibleIds = commitments.filter(id => !!aimsById[id])
      const visibleSet = new Set(visibleIds)
      const loadableSet = new Set<string>()
      for (const id of visibleIds) {
        for (const parentId of (aimsById[id]?.supportedAims ?? [])) {
          if (!visibleSet.has(parentId) && !!aimsById[parentId]) {
            loadableSet.add(parentId)
          }
        }
      }
      this.phaseFilter = { phaseId, phaseName, visibleIds, loadableIds: [...loadableSet] }
    },

    expandLoadableAim(aimId: string, aimsById: Record<string, { supportedAims?: string[]; supportingConnections?: { aimId: string }[] }>) {
      if (!this.phaseFilter) return
      const aim = aimsById[aimId]
      if (!aim) return

      const visibleSet = new Set(this.phaseFilter.visibleIds)
      const loadableSet = new Set(this.phaseFilter.loadableIds)

      // Promote clicked node to visible
      visibleSet.add(aimId)
      loadableSet.delete(aimId)

      // Its children become visible
      for (const conn of (aim.supportingConnections ?? [])) {
        if (aimsById[conn.aimId]) visibleSet.add(conn.aimId)
      }
      // Its parents become loadable (if not already visible)
      for (const parentId of (aim.supportedAims ?? [])) {
        if (!visibleSet.has(parentId) && !!aimsById[parentId]) loadableSet.add(parentId)
      }

      this.phaseFilter = { ...this.phaseFilter, visibleIds: [...visibleSet], loadableIds: [...loadableSet] }
    },

    clearPhaseFilter() {
      this.phaseFilter = null
    }
  }
})
