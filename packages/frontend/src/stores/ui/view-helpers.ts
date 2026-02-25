export type UIViewMode = 'columns' | 'graph' | 'voice'
export type GraphColorMode = 'status' | 'priority'

type ViewState = {
  viewportSize: number
  currentView: UIViewMode
  graphSelectedAimId: string | null
}

type GraphState = {
  graphColorMode: GraphColorMode
  graphPanelWidth: number
  graphShowLabels: boolean
}

type ResettableViewState = {
  selectedColumn: number
  viewportStart: number
  viewportSize: number
  rightmostColumnIndex: number
  floatingAimIndex: number
  navigatingAims: boolean
  graphSelectedAimId: string | null
  selectedLink: { parentId: string; childId: string } | null
}

export function setViewportSize(state: ViewState, size: number): number {
  const clamped = Math.max(1, Math.min(size, 10))
  state.viewportSize = clamped
  localStorage.setItem('aimparency-viewport-size', clamped.toString())
  return clamped
}

export function setView(
  state: ViewState,
  view: UIViewMode,
  getCurrentAimId: () => string | null,
  navigateToAim: (aimId: string) => void
): void {
  if (view === 'graph') {
    state.graphSelectedAimId = getCurrentAimId()
  } else if (view === 'columns' && state.graphSelectedAimId) {
    navigateToAim(state.graphSelectedAimId)
  }

  state.currentView = view
  localStorage.setItem('aimparency-current-view', view)
}

export function setGraphColorMode(state: GraphState, mode: GraphColorMode): void {
  state.graphColorMode = mode
  localStorage.setItem('aimparency-graph-color-mode', mode)
}

export function setGraphPanelWidth(state: GraphState, width: number): number {
  const clamped = Math.max(200, Math.min(width, 600))
  state.graphPanelWidth = clamped
  localStorage.setItem('aimparency-graph-panel-width', clamped.toString())
  return clamped
}

export function toggleGraphShowLabels(state: GraphState): boolean {
  state.graphShowLabels = !state.graphShowLabels
  localStorage.setItem('aimparency-graph-show-labels', String(state.graphShowLabels))
  return state.graphShowLabels
}

export function resetViewState(state: ResettableViewState): void {
  state.selectedColumn = 0
  state.viewportStart = 0
  state.viewportSize = 2
  state.rightmostColumnIndex = 0
  state.floatingAimIndex = -1
  state.navigatingAims = false
  state.graphSelectedAimId = null
  state.selectedLink = null
  localStorage.setItem('aimparency-selected-column', '0')
}
