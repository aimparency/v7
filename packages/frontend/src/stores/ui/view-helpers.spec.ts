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

  it('clamps viewport size', () => {
    const state = { windowSize: 3, currentView: 'columns' as UIViewMode, graphSelectedIdeaId: null as string | null }
    expect(setWindowSize(state, 99)).toBe(10)
    expect(state.windowSize).toBe(10)
  })

  it('syncs between list and graph view selection', () => {
    const state = { windowSize: 3, currentView: 'columns' as UIViewMode, graphSelectedIdeaId: null as string | null }
    const navigateToIdea = vi.fn()

    setView(state, 'graph', () => 'a1', navigateToIdea)
    expect(state.graphSelectedIdeaId).toBe('a1')

    state.graphSelectedIdeaId = 'a2'
    setView(state, 'columns', () => null, navigateToIdea)
    expect(navigateToIdea).toHaveBeenCalledWith('a2')
  })

  it('updates graph display options and resets state', () => {
    const graphState = { graphColorMode: 'status' as GraphColorMode, graphPanelWidth: 300, graphShowLabels: true }
    setGraphColorMode(graphState, 'priority')
    expect(graphState.graphColorMode).toBe('priority')

    expect(setGraphPanelWidth(graphState, 999)).toBe(600)
    expect(graphState.graphPanelWidth).toBe(600)

    const labels = toggleGraphShowLabels(graphState)
    expect(labels).toBe(false)
    expect(graphState.graphShowLabels).toBe(false)

    const state = {
      activeColumn: 9,
      windowStart: 4,
      windowSize: 6,
      maxColumn: 8,
      floatingIdeaIndex: 5,
      navigatingIdeas: true,
      graphSelectedIdeaId: 'x',
      selectedLink: { parentId: 'p', childId: 'c' }
    }
    resetViewState(state)
    expect(state.activeColumn).toBe(0)
    expect(state.windowSize).toBe(2)
    expect(state.graphSelectedIdeaId).toBe(null)
  })
})
