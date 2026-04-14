export type UIViewMode = 'columns' | 'graph' | 'voice'
export type GraphColorMode = 'status' | 'priority'

type ViewState = {
  windowSize: number
  currentView: UIViewMode
  graphSelectedAimId: string | null
}

type GraphState = {
  graphColorMode: GraphColorMode
  graphPanelWidth: number
  graphShowLabels: boolean
}

type ResettableViewState = {
  activeColumn: number
  windowStart: number
  windowSize: number
  maxColumn: number
  floatingAimIndex: number
  navigatingAims: boolean
  graphSelectedAimId: string | null
  selectedLink: { parentId: string; childId: string } | null
}

export function setWindowSize(state: ViewState, size: number): number {
  const clamped = Math.max(1, Math.min(size, 10))
  state.windowSize = clamped
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
}

export function setGraphColorMode(state: GraphState, mode: GraphColorMode): void {
  state.graphColorMode = mode
}

export function setGraphPanelWidth(state: GraphState, width: number): number {
  const clamped = Math.max(200, Math.min(width, 600))
  state.graphPanelWidth = clamped
  return clamped
}

export function toggleGraphShowLabels(state: GraphState): boolean {
  state.graphShowLabels = !state.graphShowLabels
  return state.graphShowLabels
}

export function resetViewState(state: ResettableViewState): void {
  state.activeColumn = 0
  state.windowStart = 0
  state.windowSize = 2
  state.maxColumn = 0
  state.floatingAimIndex = -1
  state.navigatingAims = false
  state.graphSelectedAimId = null
  state.selectedLink = null
}
