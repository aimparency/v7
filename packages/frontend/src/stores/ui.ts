import { defineStore } from 'pinia'
import type { Hint } from 'shared'
import { trpc } from '../trpc'
import { useDataStore, type Aim, type Phase, type AimCreationParams } from './data'
import { AIM_DEFAULTS } from '../constants/aimDefaults'
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
} from './ui/modal-helpers'
import {
  normalizeProjectPath,
  removeProjectFromHistoryEntries,
  setProjectFailureState,
  upsertProjectHistory,
  type ProjectHistoryEntry
} from './ui/project-helpers'
import {
  setViewportSize as setViewportSizeHelper,
} from './ui/view-helpers'
import {
  getSelectionPathFromState,
  setCurrentAimIndexInState,
  type SelectionPath
} from './ui/navigation-helpers'
import {
  handleAimNavigationKeysAction,
  handleColumnNavigationKeysAction,
  handleGlobalKeydownAction,
  handleGraphKeydownAction
} from './ui/keyboard-actions'
import { createAimAction } from './ui/aim-actions'
import {
  moveAimDownAction,
  moveAimInAction,
  moveAimOutAction,
  moveAimUpAction,
  pasteCutAimAction
} from './ui/move-actions'
import { goToLastChildAimAction, navigateDownAction, navigateUpAction } from './ui/navigation-actions'
import {
  calculateAimPathsAction,
  executeNavigationAction,
  navigateToAimAction,
  prepareNavigationAction,
  selectAimAction,
  selectAimByIdAction,
  type AimPath
} from './ui/selection-actions'
export type { AimPath } from './ui/selection-actions'
import { selectPhaseAction, setSelectionAction } from './ui/phase-actions'
import { useGraphUIStore } from './ui/graph-store'

type RelativePosition = 'before' | 'after' 

type TeleportSource = {
  parentAimId?: string
  phaseId?: string
}

// Helper to get project path with query parameter precedence
function getInitialProjectPath(): string {
  // Check URL query parameter first
  const urlParams = new URLSearchParams(window.location.search)
  const pathFromUrl = urlParams.get('path')

  if (pathFromUrl) {
    // Return the path from URL without persisting to localStorage
    return pathFromUrl
  }

  // Fall back to localStorage
  return localStorage.getItem('aimparency-project-path') || ''
}

export const useUIStore = defineStore('ui', {
  state: () => ({
    // Project state
    projectPath: getInitialProjectPath(),
    connectionStatus: 'connecting' as 'connecting' | 'connected' | 'no connection',
    projectHistory: JSON.parse(localStorage.getItem('aimparency-project-history') || '[]') as ProjectHistoryEntry[],

    // Modal states
    showPhaseModal: false,
    phaseModalMode: 'create' as 'create' | 'edit',
    phaseModalEditingPhaseId: null as string | null, // Track which phase is being edited
    phaseModalEditingParentId: null as string | null, // Track parent of phase being edited
    newPhaseName: '',
    newPhaseStartDate: '',
    newPhaseStartTime: '',
    newPhaseEndDate: '',
    newPhaseEndTime: '',
    phaseModalInsertPosition: 'before' as RelativePosition, 

    showAimModal: false,
    aimModalMode: 'create' as 'create' | 'edit',
    aimModalEditingAimId: null as string | null,
    aimModalInsertPosition: 'before' as RelativePosition,

    showAimSearch: false,
    aimSearchMode: 'navigate' as 'navigate' | 'pick',
    aimSearchCallback: null as ((aim: Aim) => void) | null,
    aimCreationCallback: null as ((aimId: string) => void) | null,
    aimSearchInitialAimId: null as string | null,
    showSettingsModal: false,
    showWatchdog: localStorage.getItem('aimparency-show-watchdog') === 'true',

    // Navigation mode system
    navigatingAims: false, 
    
    // Column tracking for navigation
    rightmostColumnIndex: 0, // Track the rightmost (empty) column index
    selectedColumn: parseInt(localStorage.getItem('aimparency-selected-column') || '0'), // Currently selected column (visual selection)

    // Phase selection by column
    selectedPhaseByColumn: JSON.parse(localStorage.getItem('aimparency-selected-phases') || '{}') as Record<number, number>, // columnIndex -> phaseIndex
    selectedPhaseIdByColumn: JSON.parse(localStorage.getItem('aimparency-selected-phase-ids') || '{}') as Record<number, string>, // columnIndex -> phaseId
    phaseCountByColumn: {} as Record<number, number>, // columnIndex -> total phase count
    columnParentPhaseId: JSON.parse(localStorage.getItem('aimparency-column-parents') || '{"0":null}') as Record<number, string | null>, // columnIndex -> parent phase ID whose children this column shows (0 = root phases)

    // Root aims selection (for column -1)
    floatingAimIndex: parseInt(localStorage.getItem('aimparency-floating-index') || '0'),

    // Viewport for column scrolling
    viewportStart: parseInt(localStorage.getItem('aimparency-viewport-start') || '-1'), // Left edge of visible window
    viewportSize: parseInt(localStorage.getItem('aimparency-viewport-size') || '3'), // Number of columns visible at once

    // Phase reload trigger (increment to force reload)
    phaseReloadTrigger: 0,

    // Delete pending states
    pendingDeletePhaseId: null as string | null,
    pendingDeleteAimId: null as string | null,

    // Moving aim state (for loading animation)
    movingAimId: null as string | null,
    teleportCutAimId: null as string | null,
    teleportSource: null as TeleportSource | null,

    // Scroll Request
    columnScrollRequest: null as { col: number, direction: 'bottom' | 'top' } | null,

    // View state
    currentView: (localStorage.getItem('aimparency-current-view') || 'columns') as 'columns' | 'graph' | 'voice',
    watchdogMaximized: false,

    // Remember last selected sub-phase index per parent phase
    lastSelectedSubPhaseIndexByPhase: JSON.parse(localStorage.getItem('aimparency-last-sub-phase-index') || '{}') as Record<string, number>,

    // Keyboard hints
    keyboardHints: [] as Hint[],
  }),
  
  getters: {
    isInProjectSelection: (state) => !state.projectPath,

    // Reactive phase selection getters
    getSelectedPhase: (state) => (columnIndex: number): number => {
      const index = state.selectedPhaseByColumn[columnIndex] ?? 0
      const phaseCount = state.phaseCountByColumn[columnIndex] ?? 0

      if (phaseCount === 0) {
        return 0
      }

      // Default to 0 if index is out of bounds
      if (index >= phaseCount) {
        return 0
      }

      return index
    },

    getSelectedPhaseId: (state) => (columnIndex: number): string | undefined => {
      return state.selectedPhaseIdByColumn[columnIndex]
    },

    getPhaseCount: (state) => (columnIndex: number): number => {
      return state.phaseCountByColumn[columnIndex] ?? 0
    },

    graphSelectedAimId: () => useGraphUIStore().graphSelectedAimId,
    graphColorMode: () => useGraphUIStore().graphColorMode,
    graphPanelWidth: () => useGraphUIStore().graphPanelWidth,
    graphShowLabels: () => useGraphUIStore().graphShowLabels,
  },
  
  actions: {
    requestColumnScroll(col: number, direction: 'bottom' | 'top') {
      this.columnScrollRequest = { col, direction }
      setTimeout(() => { 
        if (this.columnScrollRequest?.col === col && this.columnScrollRequest?.direction === direction) {
          this.columnScrollRequest = null 
        }
      }, 100)
    },

    setProjectPath(path: string) {
      const cleanPath = normalizeProjectPath(path)

      this.projectPath = cleanPath
      if (cleanPath) {
        localStorage.setItem('aimparency-project-path', cleanPath)
      } else {
        localStorage.removeItem('aimparency-project-path')
      }
    },

    addProjectToHistory(path: string) {
      this.projectHistory = upsertProjectHistory(this.projectHistory, path, Date.now())
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    removeProjectFromHistory(path: string) {
      this.projectHistory = removeProjectFromHistoryEntries(this.projectHistory, path)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    markProjectAsFailed(path: string) {
      this.projectHistory = setProjectFailureState(this.projectHistory, path, true)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    clearProjectFailure(path: string) {
      this.projectHistory = setProjectFailureState(this.projectHistory, path, false)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },
    
    setConnectionStatus(status: typeof this.connectionStatus) {
      this.connectionStatus = status
    },

    setViewportSize(size: number) {
      setViewportSizeHelper(this, size)
      this.ensureSelectionVisible()
    },

    setView(view: 'columns' | 'graph' | 'voice') {
      const graphStore = useGraphUIStore()

      if (view === 'graph') {
        const current = this.getCurrentAim()
        graphStore.setGraphSelection(current ? current.id : null)
      } else if (view === 'columns' && graphStore.graphSelectedAimId) {
        this.navigateToAim(graphStore.graphSelectedAimId)
      }

      this.currentView = view
      localStorage.setItem('aimparency-current-view', view)
    },

    ensureSelectionVisible() {
      const col = this.selectedColumn
      const start = this.viewportStart
      const size = this.viewportSize
      const end = start + size - 1

      if (col < start) {
        this.viewportStart = col
      } else if (col > end) {
        this.viewportStart = col - size + 1
      }
    },
    
    // Phase creation/editing actions
    openPhaseModal() {
      openPhaseCreateModalHelper(this)
    },

    openPhaseEditModal(phaseId: string, phaseName: string, phaseFrom: number, phaseTo: number, parentPhaseId: string | null, columnIndex: number = 0) {
      openPhaseEditModalHelper(this, phaseId, phaseName, phaseFrom, phaseTo, parentPhaseId)
    },

    closePhaseModal() {
      closePhaseModalHelper(this)
    },

    // Create phase and update selection
    async createPhase(phaseName: string, from: number, to: number) {
      const dataStore = useDataStore()

      // Determine column and parent from current selection
      const columnIndex = this.selectedColumn
      let parentPhaseId: string | null = null

      if (columnIndex > 0) {
        // Column 1+ -> parent is the selected phase from the previous column
        const parentColumn = columnIndex - 1
        parentPhaseId = this.getSelectedPhaseId(parentColumn) ?? null
      }
      // Column 0 -> parent is null (root phase)

      const phaseData = {
        name: phaseName,
        from,
        to,
        parent: parentPhaseId,
        commitments: []
      }

      await dataStore.createAndSelectPhase(this.projectPath, phaseData, columnIndex)
    },

    closeAimModal() {
      closeAimModalHelper(this)
    },
    
    // Aim creation/editing actions
    openAimModal(phaseId?: string, insertionIndex: number = 0) {
      openAimCreateModalHelper(this)
    },

    openAimSearch(mode: 'navigate' | 'pick' = 'navigate', callback?: (aim: Aim) => void, initialAimId?: string) {
      openAimSearchModalHelper(this, mode, callback, initialAimId)
    },

    closeAimSearch() {
      closeAimSearchModalHelper(this)
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

    // Create aim and update selection
    async createAim(aimTextOrId: string, isExistingAim: boolean = false, description?: string, tags?: string[], intrinsicValue: number = AIM_DEFAULTS.intrinsicValue, loopWeight: number = AIM_DEFAULTS.loopWeight, cost: number = AIM_DEFAULTS.cost, weight: number = 1, supportedAims: string[] = [], supportingConnections: { aimId: string, weight?: number, relativePosition?: [number, number] }[] = []) {
      const dataStore = useDataStore()

      const aimAttributes: AimCreationParams = {
        text: aimTextOrId,
        description,
        tags: tags || [],
        status: { state: 'open' as const, comment: '', date: Date.now() },
        supportingConnections,
        supportedAims,
        intrinsicValue: intrinsicValue ?? 0,
        loopWeight,
        cost
      }
      await createAimAction(this, dataStore, aimTextOrId, isExistingAim, aimAttributes, weight)
    },

    // Keyboard hints actions
    setKeyboardHints(hints: Hint[]) {
      this.keyboardHints = hints
    },

    // Column tracking actions
    setRightmostColumn(columnIndex: number) {
      this.rightmostColumnIndex = columnIndex
    },

    setMinRightmost(columnIndex: number) {
      this.rightmostColumnIndex = Math.max(this.rightmostColumnIndex, columnIndex)
    },

    setFocusedColumn(columnIndex: number) {
      this.selectedColumn = columnIndex
    },

    setSelectedColumn(columnIndex: number) {
      this.selectedColumn = columnIndex
    },

    getCurrentAim(): Aim | undefined {
      const path = this.getSelectionPath()
      return path.aims[path.aims.length - 1]
    }, 

    getSelectionPath(): SelectionPath {
      return getSelectionPathFromState(
        this.navigatingAims,
        this.selectedColumn,
        this.floatingAimIndex,
        (columnIndex) => this.getSelectedPhaseId(columnIndex)
      )
    },

    // Helper to set current aim index (replaces setSelectedAim)
    setCurrentAimIndex(aimIndex: number, dataStore: any) {
      setCurrentAimIndexInState(
        this.selectedColumn,
        (columnIndex) => this.getSelectedPhaseId(columnIndex),
        (index) => { this.floatingAimIndex = index },
        aimIndex,
        dataStore
      )
    },

    async selectPhase(columnIndex: number, phaseIndex: number, isTopLevel = true) {
      await selectPhaseAction(this, columnIndex, phaseIndex, isTopLevel)
    },

    // Set selection without loading (j/k navigation)
    setSelection(columnIndex: number, phaseIndex: number) {
      setSelectionAction(this, columnIndex, phaseIndex)
    },

    // Click-to-select by aim ID (finds top-level index automatically)
    async selectAimById(columnIndex: number, phaseId: string | undefined, aimId: string) {
      await selectAimByIdAction(this, columnIndex, phaseId, aimId)
    },

    // Click-to-select: focus an aim (set column, phase, mode, and aim)
    async selectAim(columnIndex: number, phaseId: string | undefined, aimIndex: number) {
      await selectAimAction(this, columnIndex, phaseId, aimIndex)
    },

    triggerPhaseReload() {
      this.phaseReloadTrigger++
    },

    setPendingDeletePhase(phaseId: string | null) {
      this.pendingDeletePhaseId = phaseId
    },

    setPendingDeleteAim(aimId: string | null) {
      this.pendingDeleteAimId = aimId
    },

    deselectAim() {
      this.navigatingAims = false
    },

    setGraphSelection(aimId: string | null) {
      useGraphUIStore().setGraphSelection(aimId)
    },

    setGraphColorMode(mode: 'status' | 'priority') {
      useGraphUIStore().setGraphColorMode(mode)
    },

    setGraphPanelWidth(width: number) {
      useGraphUIStore().setGraphPanelWidth(width)
    },

    toggleGraphShowLabels() {
      useGraphUIStore().toggleGraphShowLabels()
    },

    async calculateAimPaths(aimId: string): Promise<AimPath[]> {
      return await calculateAimPathsAction(this, aimId)
    },

    async prepareNavigation(aimId: string): Promise<AimPath[]> {
      return await prepareNavigationAction(this, aimId)
    },

    async executeNavigation(path: AimPath) {
      await executeNavigationAction(this, path)
    },

    async navigateToAim(aimId: string) {
      await navigateToAimAction(this, aimId)
    },

    // Global keyboard handler - single source of truth for all navigation
    async handleGraphKeydown(event: KeyboardEvent, dataStore: any) {
      await handleGraphKeydownAction(this, event, dataStore)
    },

    async handleGlobalKeydown(event: KeyboardEvent, dataStore: any) {
      await handleGlobalKeydownAction(this, event, dataStore)
    },

    // Universal navigation down (j) - works on selection path
    async navigateDown(dontDescend: boolean = false) {
      await navigateDownAction(this)
    },

    // Universal navigation up (k) - works on selection path
    async navigateUp() {
      await navigateUpAction(this)
    },

    goToLastChildAim(target: Aim) {
      goToLastChildAimAction(target)
    },

    // Move aim down (J)
    async moveAimDown() {
      await moveAimDownAction(this)
    },

    // Move aim up (K)
    async moveAimUp() {
      await moveAimUpAction(this)
    },

    // Move aim out of sub-aim list (H) - make it sibling of parent
    async moveAimOut() {
      await moveAimOutAction(this)
    },

    // Move aim in (L) - make it a sub-aim of previous sibling
    async moveAimIn() {
      await moveAimInAction(this)
    },

    cutAimForTeleport() {
      const path = this.getSelectionPath()
      const currentAim = path.aims[path.aims.length - 1]
      if (!currentAim) return

      let source: TeleportSource | null = null
      if (path.aims.length > 1) {
        const parentAim = path.aims[path.aims.length - 2]
        if (parentAim) {
          source = { parentAimId: parentAim.id }
        }
      } else if (path.phase) {
        source = { phaseId: path.phase.id }
      }

      this.teleportCutAimId = currentAim.id
      this.teleportSource = source
      this.movingAimId = currentAim.id
    },

    async pasteCutAim(dataStore: any) {
      await pasteCutAimAction(this, dataStore)
    },

    // Keyboard navigation handlers
    async handleColumnNavigationKeys(event: KeyboardEvent, dataStore: any) {
      await handleColumnNavigationKeysAction(this, event, dataStore)
    },

    // Aims edit mode: j/k = navigate aims, J/K = move aims, h/l = expand/collapse, H = move out, d = delete, o/O = create, x/p = cut/paste teleport
    async handleAimNavigationKeys(event: KeyboardEvent, dataStore: any) {
      await handleAimNavigationKeysAction(this, event, dataStore)
    },

    resetViewState() {
      this.selectedColumn = 0
      this.viewportStart = 0
      this.viewportSize = 2
      this.rightmostColumnIndex = 0
      this.floatingAimIndex = -1
      this.navigatingAims = false
      const graphStore = useGraphUIStore()
      graphStore.deselectLink()
      graphStore.clearGraphSelection()
      localStorage.setItem('aimparency-selected-column', '0')
    },
  }
})
