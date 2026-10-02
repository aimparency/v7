import { defineStore } from 'pinia'
import {
  setGraphColorMode as setGraphColorModeHelper,
  setGraphPanelWidth as setGraphPanelWidthHelper,
  toggleGraphShowLabels as toggleGraphShowLabelsHelper,
  type GraphColorMode
} from './view-helpers'

export type PersistedGraphViewState = {
  graphSelectedIdeaId: string | null
  selectedLink: { parentId: string; childId: string } | null
  graphColorMode: GraphColorMode
  graphPanelWidth: number
  graphShowLabels: boolean
}

export type PhaseFilter = {
  phaseId: string
  phaseName: string
  visibleIds: string[]   // fully shown ideas
  loadableIds: string[]  // ring-only ideas (parents of visible)
}

export function findConnectionBetween(
  firstId: string,
  secondId: string,
  ideasById: Record<string, { supportingConnections?: { ideaId: string }[] }>,
): { parentId: string; childId: string } | null {
  if ((ideasById[firstId]?.supportingConnections ?? []).some(connection => connection.ideaId === secondId)) {
    return { parentId: firstId, childId: secondId }
  }
  if ((ideasById[secondId]?.supportingConnections ?? []).some(connection => connection.ideaId === firstId)) {
    return { parentId: secondId, childId: firstId }
  }
  return null
}

type GraphUIState = PersistedGraphViewState & {
  pendingDeleteIdeaId: string | null
  pendingDeleteLink: { parentId: string; childId: string } | null
  phaseFilter: PhaseFilter | null
  // Ephemeral spin-off preview: when non-empty, the graph colors nodes by their
  // spin-off bucket (kept/overlap/spun-off) for these selected root(s).
  spinOffPreviewRootIds: string[]
  spinOffPreviewPrevMode: GraphColorMode | null
}

export const useGraphUIStore = defineStore('ui-graph', {
  state: (): GraphUIState => ({
    graphSelectedIdeaId: null,
    selectedLink: null,
    pendingDeleteIdeaId: null,
    pendingDeleteLink: null,
    graphColorMode: 'status',
    graphPanelWidth: 300,
    graphShowLabels: true,
    phaseFilter: null,
    spinOffPreviewRootIds: [],
    spinOffPreviewPrevMode: null
  }),

  actions: {
    getPersistedGraphViewState(): PersistedGraphViewState {
      return {
        graphSelectedIdeaId: this.graphSelectedIdeaId,
        selectedLink: this.selectedLink,
        graphColorMode: this.graphColorMode,
        graphPanelWidth: this.graphPanelWidth,
        graphShowLabels: this.graphShowLabels
      }
    },

    applyPersistedGraphViewState(state?: Partial<GraphUIState> | null) {
      if (!state) return
      this.graphSelectedIdeaId = state.graphSelectedIdeaId ?? null
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

    setGraphSelection(ideaId: string | null) {
      this.graphSelectedIdeaId = ideaId
      this.pendingDeleteIdeaId = null
    },

    clearGraphSelection() {
      this.graphSelectedIdeaId = null
      this.pendingDeleteIdeaId = null
    },

    setPendingDeleteIdea(ideaId: string | null) {
      this.pendingDeleteIdeaId = ideaId
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

    setPhaseFilter(phaseId: string, phaseName: string, commitments: string[], ideasById: Record<string, { supportedIdeas?: string[] }>) {
      const visibleIds = commitments.filter(id => !!ideasById[id])
      const visibleSet = new Set(visibleIds)
      const loadableSet = new Set<string>()
      for (const id of visibleIds) {
        for (const parentId of (ideasById[id]?.supportedIdeas ?? [])) {
          if (!visibleSet.has(parentId) && !!ideasById[parentId]) {
            loadableSet.add(parentId)
          }
        }
      }
      this.phaseFilter = { phaseId, phaseName, visibleIds, loadableIds: [...loadableSet] }
    },

    expandLoadableIdea(ideaId: string, ideasById: Record<string, { supportedIdeas?: string[]; supportingConnections?: { ideaId: string }[] }>) {
      if (!this.phaseFilter) return
      const idea = ideasById[ideaId]
      if (!idea) return

      const visibleSet = new Set(this.phaseFilter.visibleIds)
      const loadableSet = new Set(this.phaseFilter.loadableIds)

      // Promote clicked node to visible
      visibleSet.add(ideaId)
      loadableSet.delete(ideaId)

      // Its children become visible
      for (const conn of (idea.supportingConnections ?? [])) {
        if (ideasById[conn.ideaId]) visibleSet.add(conn.ideaId)
      }
      // Its parents become loadable (if not already visible)
      for (const parentId of (idea.supportedIdeas ?? [])) {
        if (!visibleSet.has(parentId) && !!ideasById[parentId]) loadableSet.add(parentId)
      }

      this.phaseFilter = { ...this.phaseFilter, visibleIds: [...visibleSet], loadableIds: [...loadableSet] }
    },

    clearPhaseFilter() {
      this.phaseFilter = null
    },

    // Enter spin-off preview for the given root idea(s): the graph recolors nodes
    // green (kept) / orange (overlap) / red (spun off) so the cut can be eyeballed
    // before committing. Remembers the prior color mode to restore on clear.
    previewSpinOff(rootIds: string[]) {
      if (this.graphColorMode !== 'spin-off') {
        this.spinOffPreviewPrevMode = this.graphColorMode
      }
      this.spinOffPreviewRootIds = [...rootIds]
      this.graphColorMode = 'spin-off'
    },

    clearSpinOffPreview() {
      this.spinOffPreviewRootIds = []
      this.graphColorMode = this.spinOffPreviewPrevMode ?? 'status'
      this.spinOffPreviewPrevMode = null
    },

    // Add/remove an idea as a spin-off root (click-to-toggle during preview).
    toggleSpinOffRoot(ideaId: string) {
      this.spinOffPreviewRootIds = this.spinOffPreviewRootIds.includes(ideaId)
        ? this.spinOffPreviewRootIds.filter((id) => id !== ideaId)
        : [...this.spinOffPreviewRootIds, ideaId]
    }
  }
})
