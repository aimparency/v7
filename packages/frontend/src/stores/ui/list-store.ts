import { defineStore } from 'pinia'
import { useDataStore, type Idea, type Phase, type IdeaCreationParams, type PhaseLevelPhaseEntry, type PhaseLevelPlaceholderEntry } from '../data'
import { IDEA_DEFAULTS } from '../../constants/ideaDefaults'
import type { IdeaStatusState } from 'shared'
import {
  setWindowSize as setWindowSizeHelper,
} from './view-helpers'
import {
  getSelectionPathFromState,
  setCurrentAimIndexInState,
  findPathToAim as findPathToAimHelper,
  getVisibleAimRows,
  type IdeaRow,
  type SelectionPath
} from './navigation-helpers'
import { captureSelectionAnchor, applySelectionAnchor, type SelectionAnchor } from './selection-anchor'
import { createAimUIState, ensureAimUIState, insertsAsFirstChild, type IdeaUIState, type IdeaUIStateTree } from './idea-ui-state'
import {
  handleAimNavigationKeysAction,
  handleColumnNavigationKeysAction,
  handleGlobalKeydownAction,
  handleGraphKeydownAction
} from './keyboard-actions'
import {
  moveAimDownAction,
  moveAimInAction,
  moveAimOutAction,
  moveAimUpAction,
  pasteCutAimAction,
  pasteCopiedAimAction
} from './move-actions'
import { useGraphUIStore } from './graph-store'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'
import { trpc } from '../../trpc'
import { hasQueryFlag, perfLog } from '../../utils/perf-log'
import type { PersistedGraphViewState } from './graph-store'

type TeleportSource = {
  parentAimId?: string
  phaseId?: string
}

export type IdeaPath = {
  phaseId?: string
  ideas: Idea[]
}

function logNav(event: string, details: Record<string, unknown> = {}) {
  if (!hasQueryFlag('phaseNavDebug')) return
  console.log(`[PhaseNav] ${event}`, details)
}

type PhaseMoveDirection = 'forward' | 'backward' | 'preserve'

const PHASE_KEY_PREFIX = 'phase:'

type PersistedListViewState = {
  activeColumn: number
  windowStart: number
  windowSize: number
  selectedEntryKeyByColumn?: Record<number, string>
  // Legacy snapshots stored the selection as index + phase id.
  selectedPhaseIdByColumn?: Record<number, string>
  floatingAimIndex: number
  lastSelectedSubPhaseIndexByPhase: Record<string, number>
  navigatingAims: boolean
  selectedAimIndexByPhaseId: Record<string, number>
  selectedIncomingIndexByAimId?: Record<string, number>
  expandedAimIds?: string[]
  floatingAimUIStates?: IdeaUIStateTree
  phaseAimUIStatesByPhaseId?: Record<string, IdeaUIStateTree>
  // Authoritative selection by identity; the index fields above only seed
  // remembered per-phase positions (and older saved states).
  selection?: SelectionAnchor
}

// Structural edits (J/K/H/L on ideas or phases, paste) run one after another.
// Each computes its target from the current, index-based selection and applies
// an optimistic change; a key pressed while the previous edit's server round
// trip is in flight would otherwise start from optimistic state that the
// arriving push then overwrites, leaving the index on a different idea — so
// fast repeated J/K moved other ideas.
let structuralEditQueue: Promise<unknown> = Promise.resolve()

// The list the idea cursor moves in; see getAimListScope.
type IdeaListScope = {
  ideas: Idea[]
  tree: IdeaUIStateTree
  setTopIndex: (index: number) => void
}

type PersistedUIState = {
  currentView?: 'columns' | 'graph' | 'voice'
  listViewState?: PersistedListViewState
  graphViewState?: PersistedGraphViewState
}

export const useListStore = defineStore('ui', {
  state: () => ({
    // Navigation mode system
    navigatingAims: false, 
    
    // Column tracking for navigation
    maxColumn: 0,
    activeColumn: 0,

    // Phase selection by column (transient browsing focus — does NOT define the current phase).
    // Holds the selected entry's key (`phase:<id>` or `placeholder:<parentId>`); the
    // selected index and phase id are derived from it so they can never disagree.
    selectedEntryKeyByColumn: {} as Record<number, string>,

    // The explicit "current" phase path (root → marked phase → first child each level down).
    // Set only via `c` (markPhaseAsCurrent); persisted to meta.phaseCursors and read by the
    // autonomous loop as the active phase. Independent of browsing focus above.
    currentPhaseIdByLevel: {} as Record<string, string>, // level -> phaseId

    // Root ideas selection (for column -1)
    floatingAimIndex: 0,

    // Viewport for column scrolling
    windowStart: 0,
    windowSize: 3,

    // Delete pending states
    pendingDeletePhaseId: null as string | null,

    // Multi-selection (separate from primary navigation/focus selection).
    // Used for bulk actions like "merge ideas" (current week UI feature).
    // Ctrl/Cmd+click or shift+click to populate. Primary click still drives nav selection.
    multiSelectMode: false,
    multiSelectedAimIds: [] as string[],
    multiAnchorId: null as string | null,
    pendingBulkDelete: false,

    // Scroll Request
    columnScrollIntent: null as { col: number, direction: 'bottom' | 'top' } | null,

    // Remember last selected sub-phase index per parent phase
    lastSelectedSubPhaseIndexByPhase: {} as Record<string, number>,
    scrollTopByColumn: {} as Record<number, number>,

    uiStatePersistTimeout: null as ReturnType<typeof setTimeout> | null,
    isRestoringUIState: false,
    restoreGeneration: 0,
    floatingAimUIStates: {} as IdeaUIStateTree,
    phaseAimUIStatesByPhaseId: {} as Record<string, IdeaUIStateTree>,
  }),
  
  getters: {
    isInProjectSelection: () => useProjectStore().isInProjectSelection,

    // Index of the selected entry among the column's selectable entries (0 if unset or gone).
    getSelectedPhase(): (columnIndex: number) => number {
      return (columnIndex) => Math.max(0, this.findSelectedPhaseIndex(columnIndex))
    },

    // Like getSelectedPhase, but -1 while the selected phase is in transit: a
    // multi-write move (e.g. a phase changing parent) briefly drops it from every
    // parent's child list. Falling back to 0 there would treat that transient as
    // a jump to the first entry (scrolling, or J/K acting on it). A key that is
    // gone for good (phase deleted, or listed in another column) still falls back.
    findSelectedPhaseIndex: (state) => (columnIndex: number): number => {
      const key = state.selectedEntryKeyByColumn[columnIndex]
      if (!key) return 0
      const dataStore = useDataStore()
      const index = dataStore.getSelectableColumnEntries(columnIndex).findIndex((entry) => entry.key === key)
      if (index >= 0 || !key.startsWith(PHASE_KEY_PREFIX)) return Math.max(0, index)
      const phaseId = key.slice(PHASE_KEY_PREFIX.length)
      const inTransit = !!dataStore.phases[phaseId] &&
        !(dataStore.meta?.rootPhaseIds ?? []).includes(phaseId) &&
        !Object.values(dataStore.phases).some((phase) => phase.childPhaseIds?.includes(phaseId))
      return inTransit ? -1 : 0
    },

    selectedPhaseIdByColumn: (state): Record<number, string> => {
      const ids: Record<number, string> = {}
      for (const [columnIndex, key] of Object.entries(state.selectedEntryKeyByColumn)) {
        if (key.startsWith(PHASE_KEY_PREFIX)) ids[Number(columnIndex)] = key.slice(PHASE_KEY_PREFIX.length)
      }
      return ids
    },

    getSelectedPhaseId(): (columnIndex: number) => string | undefined {
      return (columnIndex) => this.selectedPhaseIdByColumn[columnIndex]
    },

    // Set of phase ids on the current path, for highlighting.
    currentPhaseIdSet: (state): Set<string> => new Set(Object.values(state.currentPhaseIdByLevel)),

    getPhaseCount: (state) => (columnIndex: number): number => {
      const dataStore = useDataStore()
      return dataStore.getSelectableColumnEntries(columnIndex).length
    },
    graphSelectedAimId: () => useGraphUIStore().graphSelectedAimId,
    currentView: () => useProjectStore().currentView,

    // Multi-select helpers (for bulk actions like merge)
    multiSelectedSet: (state): Set<string> => new Set(state.multiSelectedAimIds),
    isMultiSelected: (state) => (ideaId: string): boolean => state.multiSelectedAimIds.includes(ideaId),
    multiSelectCount: (state): number => state.multiSelectedAimIds.length,
  },
  
  actions: {
    beginUIStateRestore() {
      this.isRestoringUIState = true
      this.restoreGeneration++
    },

    endUIStateRestore() {
      this.isRestoringUIState = false
      this.restoreGeneration++
    },

    interruptUIStateRestore() {
      if (this.isRestoringUIState) {
        this.endUIStateRestore()
      }
    },

    getPersistedUIStateKey(projectPath: string) {
      return `aimparency-ui-state:${projectPath}`
    },

    setColumnScrollTop(columnIndex: number, top: number) {
      this.scrollTopByColumn[columnIndex] = top
    },

    getListViewStateSnapshot(): PersistedListViewState {
      const dataStore = useDataStore()
      const selectedAimIndexByPhaseId: Record<string, number> = {}

      for (const phase of Object.values(dataStore.phases)) {
        if (phase?.selectedAimIndex !== undefined) {
          selectedAimIndexByPhaseId[phase.id] = phase.selectedAimIndex
        }
      }

      return {
        activeColumn: this.activeColumn,
        windowStart: this.windowStart,
        windowSize: this.windowSize,
        selectedEntryKeyByColumn: { ...this.selectedEntryKeyByColumn },
        floatingAimIndex: this.floatingAimIndex,
        lastSelectedSubPhaseIndexByPhase: { ...this.lastSelectedSubPhaseIndexByPhase },
        navigatingAims: this.navigatingAims,
        selectedAimIndexByPhaseId,
        floatingAimUIStates: this.floatingAimUIStates,
        phaseAimUIStatesByPhaseId: this.phaseAimUIStatesByPhaseId,
        selection: captureSelectionAnchor(this)
      }
    },

    async persistProjectUIState() {
      const projectStore = useProjectStore()
      if (!projectStore.projectPath) return

      const graphStore = useGraphUIStore()
      const state: PersistedUIState = {
        currentView: projectStore.currentView,
        listViewState: this.getListViewStateSnapshot(),
        graphViewState: graphStore.getPersistedGraphViewState()
      }

      localStorage.setItem(this.getPersistedUIStateKey(projectStore.projectPath), JSON.stringify(state))
    },

    scheduleProjectUIStatePersist() {
      if (this.isRestoringUIState) return
      if (this.uiStatePersistTimeout) {
        clearTimeout(this.uiStatePersistTimeout)
      }

      this.uiStatePersistTimeout = setTimeout(() => {
        this.uiStatePersistTimeout = null
        void this.persistProjectUIState()
      }, 150)
    },

    async flushProjectUIStatePersist() {
      if (this.uiStatePersistTimeout) {
        clearTimeout(this.uiStatePersistTimeout)
        this.uiStatePersistTimeout = null
      }

      if (!this.isRestoringUIState) {
        await this.persistProjectUIState()
      }
    },

    // Mark a phase as the current/active phase: build the path root → phaseId (recursive up
    // via parents) and phaseId → leaf (recursive down picking the first child each level).
    // Persists to meta.phaseCursors (what the autonomous loop reads as the active phase).
    async markPhaseAsCurrent(phaseId: string) {
      const dataStore = useDataStore()
      const projectStore = useProjectStore()
      if (!phaseId) return

      // Recursive up: collect ancestors to the root.
      const upChain: string[] = []
      const seen = new Set<string>()
      let cur: string | null | undefined = phaseId
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        upChain.push(cur)
        cur = dataStore.phases[cur]?.parent ?? null
      }
      upChain.reverse() // root … phaseId
      const markedLevel = upChain.length - 1

      // Recursive down: follow the first child phase at each level until a leaf.
      const downChain: string[] = []
      let node = phaseId
      while (node && !seen.has(`down:${node}`)) {
        seen.add(`down:${node}`)
        const firstChild = dataStore.phases[node]?.childPhaseIds?.[0]
        if (!firstChild || seen.has(firstChild)) break
        seen.add(firstChild)
        downChain.push(firstChild)
        node = firstChild
      }

      const cursors: Record<string, string> = {}
      ;[...upChain, ...downChain].forEach((id, level) => { cursors[String(level)] = id })
      this.currentPhaseIdByLevel = cursors

      if (projectStore.projectPath) {
        void trpc.phase.setCursor.mutate({
          projectPath: projectStore.projectPath,
          cursors,
          activeLevel: Math.max(0, markedLevel)
        }).catch(() => {})
      }
    },

    async restoreCursorFromMeta(): Promise<boolean> {
      const dataStore = useDataStore()
      const meta = dataStore.meta
      if (!meta?.phaseCursors || Object.keys(meta.phaseCursors).length === 0) return false

      this.beginUIStateRestore()
      const restoreGeneration = this.restoreGeneration
      try {
        const deepestLevel = await this.restoreSelectionPath(
          meta.phaseCursors as Record<string, string>,
          () => this.isRestoringUIState && this.restoreGeneration === restoreGeneration
        )
        if (deepestLevel === undefined) return true

        // Startup follows the complete authoritative cursor chain. Focus the
        // deepest populated phase level rather than restoring a stale browser
        // column or exposing a trailing empty child column.
        this.activeColumn = deepestLevel
        this.maxColumn = deepestLevel
        this.ensureSelectionVisible()
        return true
      } finally {
        if (this.restoreGeneration === restoreGeneration && this.isRestoringUIState) {
          this.endUIStateRestore()
        }
      }
    },

    // Rebuilds the column selection top-down from phase ids per level. Levels whose
    // id is missing or no longer under the selected parent fall back to the
    // remembered/first owned child. Stops after `maxLevel` or the first column
    // without a selectable phase. Returns the deepest selected level, or undefined when
    // `shouldContinue` aborted the restore.
    async restoreSelectionPath(
      phaseIdByLevel: Record<string | number, string>,
      shouldContinue: () => boolean = () => true,
      maxLevel: number = Math.max(0, ...Object.keys(phaseIdByLevel).map(Number).filter((level) => !isNaN(level)))
    ): Promise<number | undefined> {
      let deepestLevel = 0

      for (let level = 0; level <= maxLevel; level++) {
        this.ensureColumnSelection(level)
        if (!shouldContinue()) return undefined

        const phaseId = phaseIdByLevel[level]
        const index = phaseId ? this.findSelectableIndexForPhase(level, phaseId) : -1
        const entry = index >= 0
          ? this.applyPhaseSelection(level, index)
          : this.selectOwnedChild(level, 'preserve')
        if (!entry) break

        deepestLevel = level
        if (entry.type !== 'phase') break
      }

      return deepestLevel
    },

    async restoreProjectUIState() {
      const restoreStartedAt = performance.now()
      perfLog('ui.restoreProjectUIState:start', { projectPath: useProjectStore().projectPath })
      const projectStore = useProjectStore()
      const dataStore = useDataStore()
      const graphStore = useGraphUIStore()

      if (!projectStore.projectPath) return false

      // The current phase lives in meta (set only via `c`), independent of browsing focus.
      this.currentPhaseIdByLevel = { ...((dataStore.meta?.phaseCursors as Record<string, string>) ?? {}) }

      const raw = localStorage.getItem(this.getPersistedUIStateKey(projectStore.projectPath))
      if (!raw) {
        return await this.restoreCursorFromMeta()
      }

      let parsed: PersistedUIState | null = null
      try {
        parsed = JSON.parse(raw) as PersistedUIState
      } catch {
        return await this.restoreCursorFromMeta()
      }

      // This browser's own saved selection wins: reopen exactly where it left
      // off. The shared phase cursors only seed a browser without saved state.
      if (!parsed.listViewState) {
        if (parsed.currentView) projectStore.setCurrentView(parsed.currentView)
        graphStore.applyPersistedGraphViewState(parsed.graphViewState)
        return await this.restoreCursorFromMeta()
      }

      this.beginUIStateRestore()
      const restoreGeneration = this.restoreGeneration
      try {
        if (parsed.currentView) {
          projectStore.setCurrentView(parsed.currentView)
        }

        const listViewState = parsed.listViewState
        if (listViewState) {
          this.windowSize = listViewState.windowSize
          this.windowStart = listViewState.windowStart
          this.activeColumn = listViewState.activeColumn
          this.floatingAimIndex = listViewState.floatingAimIndex
          this.lastSelectedSubPhaseIndexByPhase = { ...listViewState.lastSelectedSubPhaseIndexByPhase }
          this.navigatingAims = listViewState.navigatingAims
          this.scrollTopByColumn = {}

          const shouldContinue = () => this.isRestoringUIState && this.restoreGeneration === restoreGeneration
          const restoreVisibleMax = Math.max(this.activeColumn, this.getVisibleMaxColumn())
          const phaseIdByLevel: Record<number, string> = {}
          const savedKeys = listViewState.selectedEntryKeyByColumn
            ?? Object.fromEntries(Object.entries(listViewState.selectedPhaseIdByColumn ?? {}).map(([level, id]) => [level, `${PHASE_KEY_PREFIX}${id}`]))
          for (const [level, key] of Object.entries(savedKeys)) {
            if (Number(level) <= restoreVisibleMax && key.startsWith(PHASE_KEY_PREFIX)) {
              phaseIdByLevel[Number(level)] = key.slice(PHASE_KEY_PREFIX.length)
            }
          }

          this.maxColumn = this.windowStart < 0 ? -1 : 0
          if (restoreVisibleMax >= 0) {
            const deepestLevel = await this.restoreSelectionPath(phaseIdByLevel, shouldContinue, restoreVisibleMax)
            if (deepestLevel === undefined) return true
            this.maxColumn = Math.max(this.maxColumn, deepestLevel)
          }
          if (this.activeColumn > this.maxColumn) {
            this.activeColumn = this.maxColumn
          }

          for (const [phaseId, selectedAimIndex] of Object.entries(listViewState.selectedAimIndexByPhaseId)) {
            const phase = dataStore.phases[phaseId]
            if (phase) {
              phase.selectedAimIndex = selectedAimIndex
            }
          }

          if (listViewState.floatingAimUIStates) {
            this.floatingAimUIStates = listViewState.floatingAimUIStates
          }
          if (listViewState.phaseAimUIStatesByPhaseId) {
            this.phaseAimUIStatesByPhaseId = listViewState.phaseAimUIStatesByPhaseId
          }

          if (listViewState.expandedAimIds || listViewState.selectedIncomingIndexByAimId) {
            const expandedAimIds = new Set(listViewState.expandedAimIds ?? [])
            for (const idea of Object.values(dataStore.ideas)) {
              if (!idea) continue
              if (!expandedAimIds.has(idea.id) && listViewState.selectedIncomingIndexByAimId?.[idea.id] === undefined) continue
              const state = ensureAimUIState(this.floatingAimUIStates, idea.id)
              state.expanded = expandedAimIds.has(idea.id)
              const selectedIncomingIndex = listViewState.selectedIncomingIndexByAimId?.[idea.id]
              if (selectedIncomingIndex !== undefined) {
                state.selectedIncomingIndex = selectedIncomingIndex
              }
            }
          }

          if (this.navigatingAims && this.activeColumn >= 0) {
            const activePhaseId = this.selectedPhaseIdByColumn[this.activeColumn]
            if (activePhaseId) {
              const phase = dataStore.phases[activePhaseId]
              if (phase && listViewState.selectedAimIndexByPhaseId[activePhaseId] !== undefined) {
                phase.selectedAimIndex = Math.min(
                  listViewState.selectedAimIndexByPhaseId[activePhaseId]!,
                  Math.max(0, phase.commitments.length - 1)
                )
              }
            }
          }

          if (listViewState.selection) {
            await applySelectionAnchor(this, listViewState.selection)
          }

          this.ensureSelectionVisible()
        }

        graphStore.applyPersistedGraphViewState(parsed.graphViewState)
        perfLog('ui.restoreProjectUIState:done', {
          projectPath: projectStore.projectPath,
          durationMs: Math.round((performance.now() - restoreStartedAt) * 10) / 10,
          activeColumn: this.activeColumn,
          windowStart: this.windowStart,
          windowSize: this.windowSize,
          maxColumn: this.maxColumn
        })
        return true
      } finally {
        if (this.restoreGeneration === restoreGeneration && this.isRestoringUIState) {
          this.endUIStateRestore()
        }
      }
    },

    requestColumnScroll(col: number, direction: 'bottom' | 'top') {
      this.columnScrollIntent = { col, direction }
      setTimeout(() => { 
        if (this.columnScrollIntent?.col === col && this.columnScrollIntent?.direction === direction) {
          this.columnScrollIntent = null 
        }
      }, 100)
    },

    setWindowSize(size: number) {
      setWindowSizeHelper(this, size)
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

      useProjectStore().setCurrentView(view)
    },

    ensureSelectionVisible() {
      const col = this.activeColumn
      const start = this.windowStart
      const size = this.windowSize
      const end = start + size - 1

      if (col < start) {
        this.windowStart = col
      } else if (col > end) {
        this.windowStart = col - size + 1
      }
    },
    
    clearTeleportBuffer() {
      useUIModalStore().clearTeleportBuffer()
    },

    // Create idea and update selection
    async createAim(
      ideaTextOrId: string,
      isExistingAim: boolean = false,
      description?: string,
      tags?: string[],
      intrinsicValue: number = IDEA_DEFAULTS.intrinsicValue,
      loopWeight: number = IDEA_DEFAULTS.loopWeight,
      cost: number = IDEA_DEFAULTS.cost,
      weight: number = 1,
      supportedAims: string[] = [],
      supportingConnections: { ideaId: string, weight?: number, relativePosition?: [number, number] }[] = [],
      color?: string | null,
      statusState: IdeaStatusState = 'open',
      statusComment: string = '',
      duration: number = IDEA_DEFAULTS.duration,
      valueRationale: string = IDEA_DEFAULTS.valueRationale
    ) {
      const dataStore = useDataStore()
      const modalStore = useUIModalStore()
      const projectStore = useProjectStore()

      const ideaAttributes: IdeaCreationParams = {
        text: ideaTextOrId,
        description,
        tags: tags || [],
        reflections: [],
        status: { state: statusState, comment: statusComment, date: Date.now() },
        supportingConnections,
        supportedAims,
        intrinsicValue: intrinsicValue ?? 0,
        valueRationale: valueRationale.trim() || undefined,
        loopWeight,
        cost,
        duration,
        costVariance: 0,
        valueVariance: 0,
        archived: false,
        color: color || undefined
      }

      const path = this.getSelectionPath()
      let newAimId: string | undefined
      // Parent idea when creating/linking inside a sub-idea list (implicit connection).
      // Used to offer the contribution % + explanation modal afterwards.
      let implicitParentId: string | undefined
      let createdAsPhaseCommitmentWithoutImplicitSupportedAim = false

      if (modalStore.ideaModalSource === 'graph') {
        if (isExistingAim) {
          newAimId = ideaTextOrId
        } else {
          const result = await dataStore.createFloatingAim(projectStore.projectPath, ideaAttributes)
          newAimId = result.id
        }
      } else if (path.ideas.length === 0) {
        if (path.phase) {
          if (isExistingAim) {
            await trpc.idea.commitToPhase.mutate({
              projectPath: projectStore.projectPath,
              ideaId: ideaTextOrId,
              phaseId: path.phase.id,
              insertionIndex: 0
            })
            newAimId = ideaTextOrId
          } else {
            const result = await dataStore.createCommittedAim(projectStore.projectPath, path.phase.id, ideaAttributes, 0)
            newAimId = result.id
            createdAsPhaseCommitmentWithoutImplicitSupportedAim = true
          }
        } else if (isExistingAim) {
          if (modalStore.ideaCreationCallback) {
            newAimId = ideaTextOrId
          } else {
            modalStore.showAimModal = false
            return
          }
        } else {
          const result = await dataStore.createFloatingAim(projectStore.projectPath, ideaAttributes)
          newAimId = result.id
        }
      } else {
        const currentAim = path.ideas[path.ideas.length - 1]
        const currentAimState = path.ideaStates[path.ideaStates.length - 1]
        if (!currentAim) {
          modalStore.showAimModal = false
          return
        }

        if (insertsAsFirstChild(currentAim, currentAimState, modalStore.ideaModalInsertPosition)) {
          if (isExistingAim) {
            await trpc.idea.connectAims.mutate({
              projectPath: projectStore.projectPath,
              parentAimId: currentAim.id,
              childAimId: ideaTextOrId,
              parentIncomingIndex: 0,
              weight
            })
            newAimId = ideaTextOrId

            const updatedParent = await trpc.idea.get.query({
              projectPath: projectStore.projectPath,
              ideaId: currentAim.id
            })
            dataStore.replaceAim(currentAim.id, updatedParent)
          } else {
            const result = await dataStore.createSubAim(projectStore.projectPath, currentAim.id, ideaAttributes, 0, weight)
            newAimId = result.id
          }

          implicitParentId = currentAim.id
          if (currentAimState) {
            currentAimState.selectedIncomingIndex = 0
          }
        } else if (path.ideas.length > 1) {
          const parentAim = path.ideas[path.ideas.length - 2]
          const parentAimState = path.ideaStates[path.ideaStates.length - 2]
          if (parentAim) {
            let insertionIndex = parentAimState?.selectedIncomingIndex ?? 0
            if (modalStore.ideaModalInsertPosition === 'after') {
              insertionIndex++
            }

            if (isExistingAim) {
              await trpc.idea.connectAims.mutate({
                projectPath: projectStore.projectPath,
                parentAimId: parentAim.id,
                childAimId: ideaTextOrId,
                parentIncomingIndex: insertionIndex,
                weight
              })
              newAimId = ideaTextOrId

              const updatedParent = await trpc.idea.get.query({
                projectPath: projectStore.projectPath,
                ideaId: parentAim.id
              })
              dataStore.replaceAim(parentAim.id, updatedParent)
            } else {
              const result = await dataStore.createSubAim(projectStore.projectPath, parentAim.id, ideaAttributes, insertionIndex, weight)
              newAimId = result.id
            }

            implicitParentId = parentAim.id
            if (parentAimState) {
              parentAimState.selectedIncomingIndex = insertionIndex
            }
          }
        } else if (path.phase) {
          let insertionIndex = 0
          const phase = dataStore.phases[path.phase.id]
          if (phase && phase.selectedAimIndex !== undefined) {
            insertionIndex = phase.selectedAimIndex + (modalStore.ideaModalInsertPosition === 'after' ? 1 : 0)
          }

          if (isExistingAim) {
            await trpc.idea.commitToPhase.mutate({
              projectPath: projectStore.projectPath,
              ideaId: ideaTextOrId,
              phaseId: path.phase.id,
              insertionIndex
            })
            newAimId = ideaTextOrId

            const updatedPhase = await trpc.phase.get.query({
              projectPath: projectStore.projectPath,
              phaseId: path.phase.id
            })
            dataStore.replacePhase(path.phase.id, updatedPhase)
          } else {
            const result = await dataStore.createCommittedAim(projectStore.projectPath, path.phase.id, ideaAttributes, insertionIndex)
            newAimId = result.id
            createdAsPhaseCommitmentWithoutImplicitSupportedAim = true
          }

          const freshPhase = dataStore.phases[path.phase.id]
          if (freshPhase) {
            freshPhase.selectedAimIndex = insertionIndex
          }
        } else if (isExistingAim) {
          if (modalStore.ideaCreationCallback) {
            newAimId = ideaTextOrId
          } else {
            modalStore.showAimModal = false
            return
          }
        } else {
          const result = await dataStore.createFloatingAim(projectStore.projectPath, ideaAttributes)
          newAimId = result.id
        }
      }

      let connectionCallbackPromptsPhase = false
      if (newAimId) {
        const shouldPromptForPhaseCommitment =
          !isExistingAim &&
          modalStore.ideaModalSource === 'graph' &&
          projectStore.currentView === 'graph'

        if (modalStore.ideaCreationCallback) {
          if (shouldPromptForPhaseCommitment) {
            connectionCallbackPromptsPhase = true
            const promptPhase = () => {
              modalStore.openPhaseSearchPrompt(async (payload) => {
                if (payload.type !== 'phase') return
                await dataStore.commitAimToPhase(projectStore.projectPath, newAimId!, payload.data.id)
              }, {
                title: 'Commit to Phase',
                placeholder: 'Optional: search for a phase...',
                additionalOptions: [{
                  id: 'skip-phase',
                  label: 'Skip (leave uncommitted)',
                  description: 'Keep this new graph idea uncommitted to any phase.',
                  showWhenQueryEmptyOnly: true,
                  actsAsEscape: true
                }]
              })
            }
            modalStore.ideaCreationCallback(newAimId, promptPhase)
          } else {
            modalStore.ideaCreationCallback(newAimId)
          }
          modalStore.ideaCreationCallback = null
        }

        if (path.phase) {
          const ideas = dataStore.getAimsForPhase(path.phase.id)
          const newAimIndex = ideas.findIndex((idea: any) => idea.id === newAimId)
          if (newAimIndex !== -1) {
            const phase = dataStore.phases[path.phase.id]
            if (phase) {
              phase.selectedAimIndex = newAimIndex
            }
          }
        } else {
          const newAimIndex = dataStore.floatingAims.findIndex((idea: any) => idea.id === newAimId)
          if (newAimIndex !== -1) {
            this.floatingAimIndex = newAimIndex
          }
        }
      }

      const shouldPromptForSupportedAim =
        !isExistingAim &&
        !!newAimId &&
        supportedAims.length === 0 &&
        createdAsPhaseCommitmentWithoutImplicitSupportedAim &&
        modalStore.ideaModalSource === 'columns' &&
        projectStore.currentView === 'columns'

      const shouldPromptForPhaseCommitment =
        !isExistingAim &&
        !!newAimId &&
        modalStore.ideaModalSource === 'graph' &&
        projectStore.currentView === 'graph' &&
        !connectionCallbackPromptsPhase

      modalStore.closeAimModal()

      // Sub-idea list creation/linking: offer contribution % + explanation for the
      // implicit parent->child connection. Reload the parent so its supportingConnections
      // include the freshly-created connection before the modal patches it.
      if (implicitParentId && newAimId && !shouldPromptForSupportedAim && !shouldPromptForPhaseCommitment) {
        await dataStore.loadAims(projectStore.projectPath, [implicitParentId, newAimId])
        modalStore.openConnectionDetailsModal(implicitParentId, newAimId)
      }

      if (shouldPromptForSupportedAim && newAimId) {
        modalStore.openAimSearch('pick', async (payload) => {
          if (payload.type !== 'idea') return

          await trpc.idea.connectAims.mutate({
            projectPath: projectStore.projectPath,
            parentAimId: payload.data.id,
            childAimId: newAimId
          })

          await dataStore.loadAims(projectStore.projectPath, [payload.data.id, newAimId])
        }, undefined, {
          title: 'Connect to Supported Idea',
          placeholder: 'Optional: search for a parent idea...',
          additionalOptions: [{
            id: 'skip-parent',
            label: 'Skip (no supported idea)',
            description: 'Leave this new idea without a supported idea connection.',
            showWhenQueryEmptyOnly: true,
            actsAsEscape: true
          }]
        })
      } else if (shouldPromptForPhaseCommitment && newAimId) {
        modalStore.openPhaseSearchPrompt(async (payload) => {
          if (payload.type !== 'phase') return
          await dataStore.commitAimToPhase(projectStore.projectPath, newAimId, payload.data.id)
        }, {
          title: 'Commit to Phase',
          placeholder: 'Optional: search for a phase...',
          additionalOptions: [{
            id: 'skip-phase',
            label: 'Skip (leave uncommitted)',
            description: 'Keep this new graph idea uncommitted to any phase.',
            showWhenQueryEmptyOnly: true,
            actsAsEscape: true
          }]
        })
      }
    },

    // Column tracking actions
    setMaxColumn(columnIndex: number) {
      this.maxColumn = columnIndex
    },

    ensureMaxColumn(columnIndex: number) {
      this.maxColumn = Math.max(this.maxColumn, columnIndex)
    },

    setActiveColumn(columnIndex: number) {
      logNav('setActiveColumn', {
        from: this.activeColumn,
        to: columnIndex,
        navigatingAims: this.navigatingAims
      })
      this.activeColumn = columnIndex
    },

    getCurrentAim(): Idea | undefined {
      const path = this.getSelectionPath()
      return path.ideas[path.ideas.length - 1]
    }, 

    getCurrentAimUIState(): IdeaUIState | undefined {
      const path = this.getSelectionPath()
      return path.ideaStates[path.ideaStates.length - 1]
    },

    getFloatingAimUIStates(): IdeaUIStateTree {
      return this.floatingAimUIStates
    },

    getPhaseAimUIStates(phaseId: string): IdeaUIStateTree {
      this.phaseAimUIStatesByPhaseId[phaseId] ??= {}
      return this.phaseAimUIStatesByPhaseId[phaseId]
    },

    ensureAimUIState(tree: IdeaUIStateTree, ideaId: string): IdeaUIState {
      return ensureAimUIState(tree, ideaId)
    },

    getSelectionPath(): SelectionPath {
      return getSelectionPathFromState(
        this.navigatingAims,
        this.activeColumn,
        this.floatingAimIndex,
        (columnIndex) => this.getSelectedPhaseId(columnIndex),
        () => this.getFloatingAimUIStates(),
        (phaseId) => this.getPhaseAimUIStates(phaseId)
      )
    },

    // Helper to set current idea index (replaces setSelectedAim)
    setCurrentAimIndex(ideaIndex: number, dataStore: any) {
      setCurrentAimIndexInState(
        this.activeColumn,
        (columnIndex) => this.getSelectedPhaseId(columnIndex),
        (index) => { this.floatingAimIndex = index },
        ideaIndex,
        dataStore
      )
    },

    // A column below the root needs a selection among the children of the
    // phase selected to its left.
    ensureColumnSelection(columnIndex: number) {
      if (columnIndex > 0 && this.selectedEntryKeyByColumn[columnIndex] === undefined) {
        this.selectOwnedChild(columnIndex)
      }
    },

    getVisibleMaxColumn() {
      return this.windowStart + this.windowSize - 1
    },

    getSelectableEntries(columnIndex: number): Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry> {
      const dataStore = useDataStore()
      return dataStore.getSelectableColumnEntries(columnIndex)
    },

    getSelectedPhaseEntry(columnIndex: number): PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry | undefined {
      const entries = this.getSelectableEntries(columnIndex)
      return entries[this.findSelectedPhaseIndex(columnIndex)]
    },

    getParentPhasesForColumn(columnIndex: number) {
      const dataStore = useDataStore()
      if (columnIndex <= 0) {
        return []
      }
      return dataStore.getActualPhasesForColumn(columnIndex - 1)
    },

    // Ensures the column's selection belongs to the parent selected one column to
    // the left, choosing via chooseOwnedEntry when it doesn't. Column 0 keeps any
    // valid selection and otherwise selects the first root.
    selectOwnedChild(columnIndex: number, direction: PhaseMoveDirection = 'preserve') {
      const entries = this.getSelectableEntries(columnIndex)
      if (entries.length === 0) return undefined

      if (columnIndex === 0) {
        const selectedKey = this.selectedEntryKeyByColumn[0]
        const selectedIndex = selectedKey ? entries.findIndex((entry) => entry.key === selectedKey) : -1
        return this.applyPhaseSelection(0, Math.max(0, selectedIndex))
      }

      const parentPhaseId = this.selectedPhaseIdByColumn[columnIndex - 1]
      if (!parentPhaseId) return undefined

      const targetEntry = this.chooseOwnedEntry(
        this.getOwnedEntries(columnIndex, parentPhaseId),
        this.getSelectedPhaseEntry(columnIndex),
        parentPhaseId,
        direction
      )
      if (!targetEntry) return undefined
      return this.applyPhaseSelection(columnIndex, entries.indexOf(targetEntry))
    },

    getOwnedEntries(columnIndex: number, parentPhaseId: string) {
      return this.getSelectableEntries(columnIndex).filter((entry) => entry.parentPhaseId === parentPhaseId)
    },

    findSelectableIndexForPhase(columnIndex: number, phaseId: string): number {
      return this.getSelectableEntries(columnIndex).findIndex((entry) => entry.type === 'phase' && entry.phase.id === phaseId)
    },

    applyPhaseSelection(columnIndex: number, phaseIndex: number) {
      const entries = this.getSelectableEntries(columnIndex)
      if (entries.length === 0) {
        delete this.selectedEntryKeyByColumn[columnIndex]
        return undefined
      }

      const clampedIndex = Math.max(0, Math.min(phaseIndex, entries.length - 1))
      const entry = entries[clampedIndex]
      if (!entry) {
        return undefined
      }

      this.selectedEntryKeyByColumn[columnIndex] = entry.key

      if (columnIndex > 0 && entry.parentPhaseId) {
        this.lastSelectedSubPhaseIndexByPhase[entry.parentPhaseId] = entry.childIndex
      }

      logNav('applyPhaseSelection', {
        columnIndex,
        clampedIndex,
        selectedEntryType: entry.type,
        phaseId: entry.type === 'phase' ? entry.phase.id : null,
        parentPhaseId: entry.parentPhaseId ?? null
      })

      // Browsing focus no longer defines the current phase — only `c` (markPhaseAsCurrent) does.
      return entry
    },

    // Walks right from `fromColumn`, keeping each column's selection among the
    // children of the selection to its left. Stops at `maxLevel` or at the first
    // column without an owned child; returns the deepest selected level.
    async resolveSelectionPath(fromColumn: number, direction: PhaseMoveDirection, maxLevel: number) {
      let deepestLevel = Math.max(0, fromColumn - 1)
      for (let level = Math.max(0, fromColumn); level <= maxLevel; level++) {
        this.ensureColumnSelection(level)
        const entry = this.selectOwnedChild(level, direction)
        if (!entry) break
        deepestLevel = level
        logNav('resolveSelectionPath', { fromColumn, level, key: entry.key, direction })
        if (entry.type !== 'phase') break
      }
      return deepestLevel
    },

    repairSelectionLeft(fromLevel: number) {
      const minVisibleLevel = Math.max(0, this.windowStart)
      let currentParentId = this.getSelectedPhaseEntry(fromLevel)?.parentPhaseId ?? null
      for (let level = fromLevel - 1; level >= minVisibleLevel && currentParentId; level--) {
        const parentIndex = this.findSelectableIndexForPhase(level, currentParentId)
        if (parentIndex < 0) {
          break
        }

        const parentEntry = this.applyPhaseSelection(level, parentIndex)
        logNav('repairSelectionLeft', {
          sourceLevel: fromLevel,
          updatedLevel: level,
          parentPhaseId: currentParentId,
          parentIndex
        })
        if (!parentEntry || parentEntry.type !== 'phase') {
          break
        }
        currentParentId = parentEntry.parentPhaseId
      }
    },

    chooseOwnedEntry(
      entries: Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry>,
      currentEntry: PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry | undefined,
      parentPhaseId: string,
      direction: PhaseMoveDirection
    ) {
      if (entries.length === 0) {
        return undefined
      }

      // A selection that still belongs to this parent stays put; the per-parent
      // memory only applies when returning to the parent from elsewhere.
      const currentMatch = currentEntry && entries.find((entry) => entry.key === currentEntry.key)
      if (currentMatch) {
        return currentMatch
      }

      const rememberedChildIndex = this.lastSelectedSubPhaseIndexByPhase[parentPhaseId]
      if (rememberedChildIndex !== undefined) {
        const rememberedEntry = entries.find((entry) => entry.childIndex === rememberedChildIndex)
        if (rememberedEntry) {
          return rememberedEntry
        }
      }

      if (currentEntry && currentEntry.parentPhaseId === parentPhaseId) {
        if (currentEntry.childIndex >= 0 && currentEntry.childIndex < entries.length) {
          return entries[currentEntry.childIndex]
        }
      }

      return direction === 'backward' ? entries[entries.length - 1] : entries[0]
    },

    async reconcilePhaseSelection(fromLevel: number, direction: PhaseMoveDirection = 'preserve') {
      this.repairSelectionLeft(fromLevel)
      const deepestLevel = await this.resolveSelectionPath(fromLevel + 1, direction, this.getVisibleMaxColumn())
      this.maxColumn = Math.max(fromLevel, deepestLevel)
      logNav('reconcilePhaseSelection', {
        fromLevel,
        direction,
        activeColumn: this.activeColumn,
        selectedEntryKeyByColumn: { ...this.selectedEntryKeyByColumn },
        maxColumn: this.maxColumn
      })
    },

    async selectPhase(
      columnIndex: number,
      phaseIndex: number,
      direction: PhaseMoveDirection = 'preserve'
    ) {
      logNav('selectPhase:start', {
        columnIndex,
        requestedPhaseIndex: phaseIndex,
        direction,
        activeColumn: this.activeColumn,
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn }
      })

      this.setActiveColumn(columnIndex)
      this.ensureColumnSelection(columnIndex)
      const selectedEntry = this.applyPhaseSelection(columnIndex, phaseIndex)
      if (!selectedEntry) {
        this.setMaxColumn(columnIndex)
        return
      }

      await this.reconcilePhaseSelection(columnIndex, direction)
      logNav('selectPhase:done', {
        columnIndex,
        activeColumn: this.activeColumn,
        selectedEntryKeyByColumn: { ...this.selectedEntryKeyByColumn },
        maxColumn: this.maxColumn
      })
    },

    async moveActivePhase(delta: number) {
      const columnIndex = this.activeColumn
      if (columnIndex < 0) {
        return false
      }

      const direction: PhaseMoveDirection = delta < 0 ? 'backward' : 'forward'
      const selectedIndex = this.findSelectedPhaseIndex(columnIndex)
      // The selected entry is mid-move; swallow the key rather than navigating
      // from a stand-in position.
      if (selectedIndex < 0) return true
      const nextIndex = selectedIndex + delta
      if (nextIndex < 0 || nextIndex >= this.getSelectableEntries(columnIndex).length) {
        return false
      }

      await this.selectPhase(columnIndex, nextIndex, direction)
      return true
    },

    async continueAimBoundaryPhaseMove(delta: -1 | 1) {
      const dataStore = useDataStore()
      const projectStore = useProjectStore()
      const col = this.activeColumn
      const selectLastAim = delta < 0

      while (await this.moveActivePhase(delta)) {
        const selectedEntry = this.getSelectedPhaseEntry(col)
        if (!selectedEntry) {
          return false
        }

        if (selectedEntry.type !== 'phase') {
          continue
        }

        const newPhase = dataStore.phases[selectedEntry.phase.id]
        if (!newPhase) {
          return false
        }

        if (newPhase.commitments.length > 0) {
          // Enter at the first row going down, the last visible row going up.
          const scope = this.getAimListScope(newPhase.id)
          const rows = scope ? getVisibleAimRows(scope.ideas, scope.tree, dataStore) : []
          const row = selectLastAim ? rows[rows.length - 1] : rows[0]
          if (scope && row) this.selectAimRow(scope, row)
        }

        return true
      }

      return false
    },

    // Set selection without loading (j/k navigation)
    setSelection(columnIndex: number, phaseIndex: number) {
      this.applyPhaseSelection(columnIndex, phaseIndex)
    },

    // Click-to-select by idea ID (finds top-level index automatically)
    async selectAimById(columnIndex: number, phaseId: string | undefined, ideaId: string) {
      const dataStore = useDataStore()
      const modalStore = useUIModalStore()

      const currentAim = this.getCurrentAim()
      const isAlreadySelected = currentAim?.id === ideaId && this.activeColumn === columnIndex

      if (isAlreadySelected) {
        const ideas = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
        const ideaIndex = ideas.findIndex((a: any) => a && a.id === ideaId)
        if (ideaIndex !== -1) {
          const editIds = this.multiSelectedAimIds.includes(ideaId) && this.multiSelectedAimIds.length > 1
            ? this.multiSelectedAimIds
            : [ideaId]
          modalStore.openAimEditModal(ideaId, editIds)
        }
        return
      }

      const ideas = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims

      const topLevelIndex = ideas.findIndex((a: any) => a && a.id === ideaId)

      if (topLevelIndex >= 0) {
        await this.selectAim(columnIndex, phaseId, topLevelIndex)
        return
      }

      const path = findPathToAimHelper(ideaId, ideas, dataStore)
      if (!path || path.length === 0) return

      let stateTree = phaseId ? this.getPhaseAimUIStates(phaseId) : this.floatingAimUIStates
      for (let i = 0; i < path.length - 1; i++) {
        const step = path[i]
        const nextStep = path[i + 1]
        if (!step || !nextStep || nextStep.indexInParent === undefined) continue
        const state = ensureAimUIState(stateTree, step.ideaId)
        state.expanded = true
        state.selectedIncomingIndex = nextStep.indexInParent
        stateTree = state.children
      }

      const topLevel = path[0]
      this.setActiveColumn(columnIndex)

      if (phaseId && columnIndex >= 0) {
        const entries = dataStore.getSelectableColumnEntries(columnIndex)
        const phaseIndex = entries.findIndex((entry) => entry.type === 'phase' && entry.phase.id === phaseId)
        if (phaseIndex !== -1) {
          this.applyPhaseSelection(columnIndex, phaseIndex)
        }
      }

      this.navigatingAims = true
      if (topLevel) {
        this.setCurrentAimIndex(topLevel.topLevelIndex, dataStore)
      }
    },

    // Click-to-select: focus an idea (set column, phase, mode, and idea)
    async selectAim(columnIndex: number, phaseId: string | undefined, ideaIndex: number) {
      const dataStore = useDataStore()

      this.setActiveColumn(columnIndex)

      if (phaseId && columnIndex >= 0) {
        const entries = dataStore.getSelectableColumnEntries(columnIndex)
        const phaseIndex = entries.findIndex((entry) => entry.type === 'phase' && entry.phase.id === phaseId)

        if (phaseIndex !== -1) {
          this.applyPhaseSelection(columnIndex, phaseIndex)
        }
      }

      this.navigatingAims = true
      this.setCurrentAimIndex(ideaIndex, dataStore)
    },

    setPendingDeletePhase(phaseId: string | null) {
      this.pendingDeletePhaseId = phaseId
    },

    deselectAim() {
      this.navigatingAims = false
    },

    // --- Multi-select for bulk actions (current-week feature: merge ideas etc.) ---
    toggleMultiSelect(ideaId: string) {
      this.cleanMultiSelect()
      this.multiSelectMode = true
      this.pendingBulkDelete = false
      const idx = this.multiSelectedAimIds.indexOf(ideaId)
      if (idx >= 0) {
        this.multiSelectedAimIds.splice(idx, 1)
      } else {
        this.multiSelectedAimIds.push(ideaId)
        this.multiAnchorId = ideaId
      }
      if (this.multiSelectedAimIds.length === 0) {
        this.clearMultiSelect()
      }
    },

    enterMultiSelect(ideaId: string) {
      this.multiSelectMode = true
      this.multiSelectedAimIds = [ideaId]
      this.multiAnchorId = ideaId
      this.pendingBulkDelete = false
    },

    addToMultiSelect(ideaId: string) {
      this.multiSelectMode = true
      this.pendingBulkDelete = false
      if (!this.multiSelectedAimIds.includes(ideaId)) {
        this.multiSelectedAimIds.push(ideaId)
      }
    },

    clearMultiSelect() {
      this.multiSelectMode = false
      this.multiSelectedAimIds = []
      this.multiAnchorId = null
      this.pendingBulkDelete = false
    },

    // Auto-clear stale IDs (e.g. after merge/archive/delete or data reload)
    cleanMultiSelect() {
      const dataStore = useDataStore()
      this.multiSelectedAimIds = this.multiSelectedAimIds.filter(id => id && dataStore.ideas[id])
      if (this.multiSelectedAimIds.length === 0) {
        this.clearMultiSelect()
      }
    },

    // Shift-range selection within a provided ordered list of idea IDs (e.g. sibling ideas in a list or phase)
    selectMultiRange(targetAimId: string, orderedAimIds: string[]) {
      this.cleanMultiSelect()
      if (!orderedAimIds || orderedAimIds.length === 0) {
        this.toggleMultiSelect(targetAimId)
        this.multiAnchorId = targetAimId
        return
      }
      const selectedAnchor = this.multiSelectedAimIds[0]
      const anchor = this.multiAnchorId && orderedAimIds.includes(this.multiAnchorId)
        ? this.multiAnchorId
        : (selectedAnchor && orderedAimIds.includes(selectedAnchor) ? selectedAnchor : orderedAimIds[0]!)

      const startIdx = orderedAimIds.indexOf(anchor)
      const endIdx = orderedAimIds.indexOf(targetAimId)
      if (startIdx < 0 || endIdx < 0) {
        this.addToMultiSelect(targetAimId)
        this.multiAnchorId = targetAimId
        return
      }
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
      const range = orderedAimIds.slice(lo, hi + 1)
      // Replace multi with the range (standard shift behavior), but keep primary separate
      this.multiSelectMode = true
      this.multiSelectedAimIds = [...range]
      this.multiAnchorId = anchor
      this.pendingBulkDelete = false
    },

    setMultiAnchor(ideaId: string | null) {
      this.multiAnchorId = ideaId
    },

    async requestBulkDelete() {
      this.cleanMultiSelect()
      if (!this.multiSelectMode || this.multiSelectedAimIds.length === 0) return false
      if (!this.pendingBulkDelete) {
        this.pendingBulkDelete = true
        return false
      }

      const dataStore = useDataStore()
      const ids = [...this.multiSelectedAimIds]
      for (const ideaId of ids) {
        if (dataStore.ideas[ideaId]) {
          await dataStore.deleteAimFromStore(useProjectStore().projectPath, ideaId)
          delete dataStore.ideas[ideaId]
          dataStore.floatingAimsIds = dataStore.floatingAimsIds.filter(id => id !== ideaId)
        }
      }
      this.clearMultiSelect()
      dataStore.recalculateValues()
      return true
    },

    // Merge all currently multi-selected (except the target) into the target idea.
    // Uses the existing backend merge (target keeps identity + connections + reflections; sources archived).
    async mergeSelectedInto(targetId: string) {
      const projectStore = useProjectStore()
      const projectPath = projectStore.projectPath
      if (!projectPath || !targetId) return { success: false, error: 'No project or target' }

      const others = this.multiSelectedAimIds.filter(id => id !== targetId)
      if (others.length === 0) {
        return { success: false, error: 'No other ideas selected to merge' }
      }

      const results: any[] = []
      let mergedCount = 0
      for (const sourceId of others) {
        try {
          const res = await trpc.idea.merge.mutate({ projectPath, targetId, sourceId })
          results.push({ sourceId, ...res })
          mergedCount++
        } catch (e: any) {
          console.error('merge failed for', sourceId, e)
          results.push({ sourceId, error: String(e) })
        }
      }

      const dataStore = useDataStore()
      if (mergedCount > 0) {
        // Merge rewires parents, children, phases, and archives sources. Refresh
        // the complete graph so every affected list/column reflects the result.
        await dataStore.loadAllAims(projectPath)
      }
      this.clearMultiSelect()

      const failedCount = others.length - mergedCount
      return {
        success: failedCount === 0,
        partial: mergedCount > 0 && failedCount > 0,
        results,
        mergedCount,
        failedCount
      }
    },

    async calculateAimPaths(ideaId: string): Promise<IdeaPath[]> {
      const projectStore = useProjectStore()
      const dataStore = useDataStore()
      const paths: IdeaPath[] = []
      const visited = new Set<string>()

      const trace = async (currentId: string, pathAcc: Idea[]) => {
        if (visited.has(currentId)) return
        visited.add(currentId)

        let idea = dataStore.ideas[currentId]
        if (!idea) {
          try {
            idea = await trpc.idea.get.query({ projectPath: projectStore.projectPath, ideaId: currentId })
            dataStore.replaceAim(idea.id, idea)
          } catch {
            console.error('failed to load idea', currentId)
            return
          }
        }

        const newPath = [idea, ...pathAcc]
        let isRoot = true

        if (idea.committedIn && idea.committedIn.length > 0) {
          isRoot = false
          for (const phaseId of idea.committedIn) {
            paths.push({ phaseId, ideas: newPath })
          }
        }

        if (idea.supportedAims && idea.supportedAims.length > 0) {
          isRoot = false
          for (const parentId of idea.supportedAims) {
            await trace(parentId, newPath)
          }
        }

        if (isRoot) {
          paths.push({ phaseId: undefined, ideas: newPath })
        }

        visited.delete(currentId)
      }

      await trace(ideaId, [])
      return paths
    },

    async prepareNavigation(ideaId: string): Promise<IdeaPath[]> {
      return await this.calculateAimPaths(ideaId)
    },

    async executeNavigation(path: IdeaPath) {
      const projectStore = useProjectStore()
      const dataStore = useDataStore()
      const rootAim = path.ideas[0]
      const phaseId = path.phaseId

      if (phaseId) {
        // Walk up to the root to get the phase id for every column.
        const phasePath: Phase[] = []
        let currentPhase = dataStore.phases[phaseId]
        while (currentPhase && !phasePath.includes(currentPhase)) {
          phasePath.unshift(currentPhase)
          currentPhase = currentPhase.parent ? dataStore.phases[currentPhase.parent] : undefined
        }

        await this.restoreSelectionPath(
          Object.fromEntries(phasePath.map((phase, level) => [level, phase.id])),
          undefined,
          phasePath.length - 1
        )

        this.activeColumn = phasePath.length - 1
        this.setMaxColumn(phasePath.length)
      } else {
        this.activeColumn = -1
      }

      const contextAims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
      if (rootAim) {
        const rootIndex = contextAims.findIndex((a: any) => a && a.id === rootAim.id)
        if (rootIndex !== -1) {
          if (phaseId) {
            const phase = dataStore.phases[phaseId]
            if (phase) phase.selectedAimIndex = rootIndex
          } else {
            this.floatingAimIndex = rootIndex
          }
        }
      }

      let stateTree = phaseId ? this.getPhaseAimUIStates(phaseId) : this.floatingAimUIStates
      for (let i = 0; i < path.ideas.length - 1; i++) {
        const parentStep = path.ideas[i]
        if (!parentStep) continue
        const parent = dataStore.ideas[parentStep.id]
        const child = path.ideas[i + 1]
        if (!parent || !child) continue

        const parentState = ensureAimUIState(stateTree, parent.id)
        parentState.expanded = true

        const childIndex = parent.supportingConnections.findIndex((c: any) => c.ideaId === child.id)
        if (childIndex !== -1) {
          parentState.selectedIncomingIndex = childIndex
        }
        stateTree = parentState.children
      }

      this.navigatingAims = true
      this.ensureSelectionVisible()
    },

    async navigateToAim(ideaId: string) {
      const paths = await this.prepareNavigation(ideaId)
      const firstPath = paths[0]
      if (firstPath) {
        await this.executeNavigation(firstPath)
      }
    },

    // Global keyboard handler - single source of truth for all navigation
    async handleGraphKeydown(event: KeyboardEvent, dataStore: any) {
      await handleGraphKeydownAction(this, event, dataStore)
    },

    async handleGlobalKeydown(event: KeyboardEvent, dataStore: any) {
      await handleGlobalKeydownAction(this, event, dataStore)
    },

    // The list the idea cursor moves in: a phase's committed ideas (the active
    // column's selected phase unless `phaseId` is given) or, in column -1, the
    // floating ideas — with its UI-state tree and top-level cursor setter.
    getAimListScope(phaseId?: string): IdeaListScope | undefined {
      const dataStore = useDataStore()
      if (phaseId === undefined && this.activeColumn === -1) {
        return {
          ideas: dataStore.floatingAims,
          tree: this.getFloatingAimUIStates(),
          setTopIndex: (index: number) => { this.floatingAimIndex = index }
        }
      }
      const phase = dataStore.phases[phaseId ?? this.getSelectedPhaseId(this.activeColumn) ?? '']
      if (!phase) return undefined
      return {
        ideas: dataStore.getAimsForPhase(phase.id),
        tree: this.getPhaseAimUIStates(phase.id),
        setTopIndex: (index: number) => { phase.selectedAimIndex = index }
      }
    },

    // Points the selection chain at `row`, ending the chain there.
    selectAimRow(scope: IdeaListScope, row: IdeaRow) {
      const dataStore = useDataStore()
      const [topIndex, ...connectionIndices] = row.indexPath
      scope.setTopIndex(topIndex!)
      let idea: Idea | undefined = scope.ideas[topIndex!]
      let state = idea ? ensureAimUIState(scope.tree, idea.id) : undefined
      for (const connectionIndex of connectionIndices) {
        if (!idea || !state) return
        state.selectedIncomingIndex = connectionIndex
        const connection = idea.supportingConnections?.[connectionIndex]
        idea = connection ? dataStore.ideas[connection.ideaId] : undefined
        state = idea ? ensureAimUIState(state.children, idea.id) : undefined
      }
      if (state) state.selectedIncomingIndex = undefined
    },

    // Moves the idea cursor one visible row (into expanded children and back
    // out, like a vim tree view). Returns false at either end of the list.
    stepAimRow(delta: -1 | 1): boolean {
      const scope = this.getAimListScope()
      const path = this.getSelectionPath()
      if (!scope || path.ideas.length === 0) return false

      const topIndex = path.phase
        ? path.phase.selectedAimIndex ?? 0
        : Math.max(0, Math.min(this.floatingAimIndex, scope.ideas.length - 1))
      const currentPath = [topIndex, ...path.ideaStates.slice(0, -1).map((state) => state.selectedIncomingIndex!)]
      const rows = getVisibleAimRows(scope.ideas, scope.tree, useDataStore())
      const currentRow = rows.findIndex((row) =>
        row.indexPath.length === currentPath.length && row.indexPath.every((index, depth) => index === currentPath[depth])
      )
      const target = rows[currentRow + delta]
      if (currentRow < 0 || !target) return false
      this.selectAimRow(scope, target)
      return true
    },

    // Universal navigation down (j)
    async navigateDown() {
      const previousStates = this.getSelectionPath().ideaStates
      const previousAimState = previousStates[previousStates.length - 1]
      if (previousAimState) previousAimState.pendingDelete = false
      logNav('navigateDown:start', {
        activeColumn: this.activeColumn,
        navigatingAims: this.navigatingAims
      })

      if (this.stepAimRow(1)) return
      if (this.activeColumn >= 0) {
        await this.continueAimBoundaryPhaseMove(1)
      }
    },

    // Universal navigation up (k)
    async navigateUp() {
      const path = this.getSelectionPath()
      const previousAimState = path.ideaStates[path.ideaStates.length - 1]
      if (previousAimState) previousAimState.pendingDelete = false
      logNav('navigateUp:start', {
        activeColumn: this.activeColumn,
        navigatingAims: this.navigatingAims
      })

      if (path.ideas.length > 0 && !this.navigatingAims) return
      if (this.stepAimRow(-1)) return
      if (this.activeColumn >= 0) {
        await this.continueAimBoundaryPhaseMove(-1)
      }
    },

    // Move idea down (J)
    // Queues a structural edit behind the ones in flight; see structuralEditQueue.
    runStructuralEdit<T>(edit: () => Promise<T>): Promise<T> {
      const run = structuralEditQueue.then(edit, edit)
      structuralEditQueue = run.catch(() => undefined)
      return run
    },

    async moveAimDown() {
      await this.runStructuralEdit(() => moveAimDownAction(this))
    },

    // Move idea up (K)
    async moveAimUp() {
      await this.runStructuralEdit(() => moveAimUpAction(this))
    },

    // Move idea out of sub-idea list (H) - make it sibling of parent
    async moveAimOut() {
      await this.runStructuralEdit(() => moveAimOutAction(this))
    },

    // Move idea in (L) - make it a sub-idea of previous sibling
    async moveAimIn() {
      await this.runStructuralEdit(() => moveAimInAction(this))
    },

    cutAimForTeleport() {
      const modalStore = useUIModalStore()
      const path = this.getSelectionPath()
      const currentAim = path.ideas[path.ideas.length - 1]
      if (!currentAim) return

      let source: TeleportSource | null = null
      if (path.ideas.length > 1) {
        const parentAim = path.ideas[path.ideas.length - 2]
        if (parentAim) {
          source = { parentAimId: parentAim.id }
        }
      } else if (path.phase) {
        source = { phaseId: path.phase.id }
      }

      modalStore.teleportCutAimId = currentAim.id
      modalStore.teleportSource = source
      modalStore.movingAimId = currentAim.id
    },

    copyAimForTeleport() {
      const modalStore = useUIModalStore()
      const path = this.getSelectionPath()
      const currentAim = path.ideas[path.ideas.length - 1]
      if (!currentAim) return

      let source: TeleportSource | null = null
      if (path.ideas.length > 1) {
        const parentAim = path.ideas[path.ideas.length - 2]
        if (parentAim) {
          source = { parentAimId: parentAim.id }
        }
      } else if (path.phase) {
        source = { phaseId: path.phase.id }
      }

      modalStore.teleportCopyAimId = currentAim.id
      modalStore.teleportCopySource = source
    },

    async pasteCutAim(dataStore: any) {
      await this.runStructuralEdit(() => pasteCutAimAction(this, dataStore))
    },

    async pasteCopiedAim(dataStore: any) {
      await this.runStructuralEdit(() => pasteCopiedAimAction(this, dataStore))
    },

    // Keyboard navigation handlers
    async handleColumnNavigationKeys(event: KeyboardEvent, dataStore: any) {
      await handleColumnNavigationKeysAction(this, event, dataStore)
    },

    // Ideas edit mode: j/k = navigate ideas, J/K = move ideas, h/l = expand/collapse, H = move out, d = delete, o/O = create, x/p = cut/paste, c/p = copy/paste
    async handleAimNavigationKeys(event: KeyboardEvent, dataStore: any) {
      await handleAimNavigationKeysAction(this, event, dataStore)
    },

    resetViewState() {
      this.activeColumn = 0
      this.windowStart = 0
      this.windowSize = 2
      this.maxColumn = 0
      this.floatingAimIndex = -1
      this.navigatingAims = false
      if (this.uiStatePersistTimeout) {
        clearTimeout(this.uiStatePersistTimeout)
        this.uiStatePersistTimeout = null
      }
      this.selectedEntryKeyByColumn = {}
      this.lastSelectedSubPhaseIndexByPhase = {}
      this.scrollTopByColumn = {}
      const graphStore = useGraphUIStore()
      graphStore.deselectLink()
      graphStore.clearGraphSelection()
    },
  }
})

export const useUIStore = useListStore
