import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetViewState,
  setGraphColorMode,
  setGraphPanelWidth,
  setWindowSize,
  setView,
  toggleGraphShowLabels,
  type GraphColorMode,
  type UIViewMode
} from './view-helpers'

describe('view helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('clamps and persists viewport size', () => {
    const state = { windowSize: 3, currentView: 'columns' as UIViewMode, graphSelectedAimId: null as string | null }
    expect(setWindowSize(state, 99)).toBe(10)
    expect(state.windowSize).toBe(10)
    expect(localStorage.getItem('aimparency-window-size')).toBe('10')
  })

  it('syncs between list and graph view selection', () => {
    const state = { windowSize: 3, currentView: 'columns' as UIViewMode, graphSelectedAimId: null as string | null }
    const navigateToAim = vi.fn()

    setView(state, 'graph', () => 'a1', navigateToAim)
    expect(state.graphSelectedAimId).toBe('a1')

    state.graphSelectedAimId = 'a2'
    setView(state, 'columns', () => null, navigateToAim)
    expect(navigateToAim).toHaveBeenCalledWith('a2')
  })

  it('persists graph display options and reset state', () => {
    const graphState = { graphColorMode: 'status' as GraphColorMode, graphPanelWidth: 300, graphShowLabels: true }
    setGraphColorMode(graphState, 'priority')
    expect(localStorage.getItem('aimparency-graph-color-mode')).toBe('priority')

    expect(setGraphPanelWidth(graphState, 999)).toBe(600)
    expect(localStorage.getItem('aimparency-graph-panel-width')).toBe('600')

    const labels = toggleGraphShowLabels(graphState)
    expect(labels).toBe(false)
    expect(localStorage.getItem('aimparency-graph-show-labels')).toBe('false')

    const state = {
      activeColumn: 9,
      windowStart: 4,
      windowSize: 6,
      maxColumn: 8,
      floatingAimIndex: 5,
      navigatingAims: true,
      graphSelectedAimId: 'x',
      selectedLink: { parentId: 'p', childId: 'c' }
    }
    resetViewState(state)
    expect(state.activeColumn).toBe(0)
    expect(state.windowSize).toBe(2)
    expect(state.graphSelectedAimId).toBe(null)
    expect(localStorage.getItem('aimparency-active-column')).toBe('0')
  })
})
