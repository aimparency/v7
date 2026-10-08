import { defineStore } from 'pinia'
import { useDataStore, type Idea, type Phase, type IdeaCreationParams, type PhaseLevelPhaseEntry, type PhaseLevelPlaceholderEntry } from '../data'
import { IDEA_DEFAULTS } from '../../constants/ideaDefaults'
import type { IdeaStatusState } from 'shared'
import {
  setWindowSize as setWindowSizeHelper,
} from './view-helpers'
import {
  getSelectionPathFromState,
  setCurrentIdeaIndexInState,
  findPathToIdea as findPathToIdeaHelper,
  getVisibleIdeaRows,
  type IdeaRow,
  type SelectionPath
} from './navigation-helpers'
import { ensureIdeaUIState, type IdeaUIState, type IdeaUIStateTree } from './idea-ui-state'
import {
  handleIdeaNavigationKeysAction,
  handleColumnNavigationKeysAction,
  handleGlobalKeydownAction,
  handleGraphKeydownAction
} from './keyboard-actions'
import {
  moveIdeaDownAction,
  moveIdeaInAction,
  moveIdeaOutAction,
  moveIdeaUpAction,
  pasteCutIdeaAction,
  pasteCopiedIdeaAction
} from './move-actions'
import { useGraphUIStore } from './graph-store'
import { deleteIdeasAsking } from './idea-removal'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'
import { trpc } from '../../trpc'
import { placeIdea } from './idea-creation'
import {
  PHASE_KEY_PREFIX,
  listViewStateSnapshot,
  persistProjectUIState,
  persistedUIStateKey,
  restoreCursorFromMeta,
  restoreProjectUIState,
  type PersistedListViewState
} from './ui-persistence'
import { hasQueryFlag } from '../../utils/perf-log'

// A new idea from the idea modal; unset fields take the defaults.
export type NewIdea = {
  text: string
  description?: string
  tags?: string[]
  intrinsicValue?: number
  loopWeight?: number
  cost?: number
  supportedIdeas?: string[]
  supportingConnections?: { ideaId: string, weight?: number, relativePosition?: [number, number] }[]
  color?: string | null
  statusState?: IdeaStatusState
  statusComment?: string
  duration?: number
  valueRationale?: string
}

type TeleportSource = {
  parentIdeaId?: string
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



// Structural edits (J/K/H/L on ideas or phases, paste) run one after another.
// Each computes its target from the current, index-based selection and applies
// an optimistic change; a key pressed while the previous edit's server round
// trip is in flight would otherwise start from optimistic state that the
// arriving push then overwrites, leaving the index on a different idea — so
// fast repeated J/K moved other ideas.
let structuralEditQueue: Promise<unknown> = Promise.resolve()

// The list the idea cursor moves in; see getIdeaListScope.
type IdeaListScope = {
  ideas: Idea[]
  tree: IdeaUIStateTree
  setTopIndex: (index: number) => void
}

export const useUIStore = defineStore('ui', {
  state: () => ({
    // Navigation mode system
    navigatingIdeas: false, 
    
    // Column tracking for navigation
    maxColumn: 0,
    activeColumn: 0,

    // Phase selection by column (transient browsing focus — does NOT define the current phase).
    // Holds the selected entry's key (`phase:<id>` or `placeholder:<parentId>`); the
    // selected index and phase id are derived from it so they can never disagree.
    selectedEntryKeyByColumn: {} as Record<number, string>,

    // The explicit "current" phase path (root → marked phase).
    // Set only via `c` (markPhaseAsCurrent); persisted to meta.phaseCursors and read by the
    // autonomous loop as the active phase. Independent of browsing focus above.
    currentPhaseIdByLevel: {} as Record<string, string>, // level -> phaseId

    // Root ideas selection (for column -1)
    floatingIdeaIndex: 0,

    // Viewport for column scrolling
    windowStart: 0,
    windowSize: 3,

    // Delete pending states
    pendingDeletePhaseId: null as string | null,

    // Multi-selection (separate from primary navigation/focus selection).
    // Used for bulk actions like "merge ideas" (current week UI feature).
    // Ctrl/Cmd+click or shift+click to populate. Primary click still drives nav selection.
    multiSelectMode: false,
    multiSelectedIdeaIds: [] as string[],
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
    floatingIdeaUIStates: {} as IdeaUIStateTree,
    phaseIdeaUIStatesByPhaseId: {} as Record<string, IdeaUIStateTree>,
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
    graphSelectedIdeaId: () => useGraphUIStore().graphSelectedIdeaId,
    currentView: () => useProjectStore().currentView,

    // Multi-select helpers (for bulk actions like merge)
    multiSelectedSet: (state): Set<string> => new Set(state.multiSelectedIdeaIds),
    isMultiSelected: (state) => (ideaId: string): boolean => state.multiSelectedIdeaIds.includes(ideaId),
    multiSelectCount: (state): number => state.multiSelectedIdeaIds.length,
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
      return persistedUIStateKey(projectPath)
    },

    setColumnScrollTop(columnIndex: number, top: number) {
      this.scrollTopByColumn[columnIndex] = top
    },

    getListViewStateSnapshot(): PersistedListViewState {
      return listViewStateSnapshot(this)
    },

    async persistProjectUIState(): Promise<void> {
      await persistProjectUIState(this)
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

    // Mark a phase as the current/active phase: build the path root → phaseId via parents.
    // The path ends at the marked phase even when it has children.
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

      const cursors: Record<string, string> = {}
      upChain.forEach((id, level) => { cursors[String(level)] = id })
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
      return restoreCursorFromMeta(this)
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

    async restoreProjectUIState(): Promise<boolean> {
      return restoreProjectUIState(this)
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
        const current = this.getCurrentIdea()
        graphStore.setGraphSelection(current ? current.id : null)
      } else if (view === 'columns' && graphStore.graphSelectedIdeaId) {
        this.navigateToIdea(graphStore.graphSelectedIdeaId)
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

    // Create a new idea where the idea modal was opened (see placeIdea).
    async createIdea(idea: NewIdea, weight: number = 1): Promise<void> {
      const attributes: IdeaCreationParams = {
        text: idea.text,
        description: idea.description,
        tags: idea.tags || [],
        reflections: [],
        status: { state: idea.statusState ?? 'open', comment: idea.statusComment ?? '', date: Date.now() },
        supportingConnections: idea.supportingConnections ?? [],
        supportedIdeas: idea.supportedIdeas ?? [],
        intrinsicValue: idea.intrinsicValue ?? IDEA_DEFAULTS.intrinsicValue,
        valueRationale: (idea.valueRationale ?? IDEA_DEFAULTS.valueRationale).trim() || undefined,
        loopWeight: idea.loopWeight ?? IDEA_DEFAULTS.loopWeight,
        cost: idea.cost ?? useDataStore().defaultCost,
        duration: idea.duration ?? IDEA_DEFAULTS.duration,
        costVariance: 0,
        valueVariance: 0,
        archived: false,
        color: idea.color || undefined
      }
      await placeIdea(this, undefined, attributes, weight)
    },

    // Link an existing idea where the idea modal was opened (see placeIdea).
    async linkExistingIdea(ideaId: string, weight: number = 1): Promise<void> {
      await placeIdea(this, ideaId, undefined, weight)
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
        navigatingIdeas: this.navigatingIdeas
      })
      this.activeColumn = columnIndex
    },

    getCurrentIdea(): Idea | undefined {
      const path = this.getSelectionPath()
      return path.ideas[path.ideas.length - 1]
    }, 

    getCurrentIdeaUIState(): IdeaUIState | undefined {
      const path = this.getSelectionPath()
      return path.ideaStates[path.ideaStates.length - 1]
    },

    getFloatingIdeaUIStates(): IdeaUIStateTree {
      return this.floatingIdeaUIStates
    },

    getPhaseIdeaUIStates(phaseId: string): IdeaUIStateTree {
      this.phaseIdeaUIStatesByPhaseId[phaseId] ??= {}
      return this.phaseIdeaUIStatesByPhaseId[phaseId]
    },

    ensureIdeaUIState(tree: IdeaUIStateTree, ideaId: string): IdeaUIState {
      return ensureIdeaUIState(tree, ideaId)
    },

    getSelectionPath(): SelectionPath {
      return getSelectionPathFromState(
        this.navigatingIdeas,
        this.activeColumn,
        this.floatingIdeaIndex,
        (columnIndex) => this.getSelectedPhaseId(columnIndex),
        () => this.getFloatingIdeaUIStates(),
        (phaseId) => this.getPhaseIdeaUIStates(phaseId)
      )
    },

    // Helper to set current idea index (replaces setSelectedIdea)
    setCurrentIdeaIndex(ideaIndex: number, dataStore: any) {
      setCurrentIdeaIndexInState(
        this.activeColumn,
        (columnIndex) => this.getSelectedPhaseId(columnIndex),
        (index) => { this.floatingIdeaIndex = index },
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

    async continueIdeaBoundaryPhaseMove(delta: -1 | 1) {
      const dataStore = useDataStore()
      const col = this.activeColumn
      const selectLastIdea = delta < 0

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
          const scope = this.getIdeaListScope(newPhase.id)
          const rows = scope ? getVisibleIdeaRows(scope.ideas, scope.tree, dataStore) : []
          const row = selectLastIdea ? rows[rows.length - 1] : rows[0]
          if (scope && row) this.selectIdeaRow(scope, row)
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
    async selectIdeaById(columnIndex: number, phaseId: string | undefined, ideaId: string) {
      const dataStore = useDataStore()
      const modalStore = useUIModalStore()

      const currentIdea = this.getCurrentIdea()
      const isAlreadySelected = currentIdea?.id === ideaId && this.activeColumn === columnIndex

      if (isAlreadySelected) {
        const editIds = this.multiSelectedIdeaIds.includes(ideaId) && this.multiSelectedIdeaIds.length > 1
          ? this.multiSelectedIdeaIds
          : [ideaId]
        modalStore.openIdeaEditModal(ideaId, editIds)
        return
      }

      const ideas = phaseId ? dataStore.getIdeasForPhase(phaseId) : dataStore.floatingIdeas
      const path = findPathToIdeaHelper(ideaId, ideas, dataStore)
      if (!path || path.length === 0) return

      this.setActiveColumn(columnIndex)

      if (phaseId && columnIndex >= 0) {
        const entries = dataStore.getSelectableColumnEntries(columnIndex)
        const phaseIndex = entries.findIndex((entry) => entry.type === 'phase' && entry.phase.id === phaseId)
        if (phaseIndex !== -1) {
          this.applyPhaseSelection(columnIndex, phaseIndex)
        }
      }

      const scope = this.getIdeaListScope(phaseId)
      if (!scope) return

      // Expand the ancestors, then end the chain at the clicked idea — a stale
      // selectedIncomingIndex on it would keep its old child as the action target.
      let stateTree = scope.tree
      for (const step of path.slice(0, -1)) {
        const state = ensureIdeaUIState(stateTree, step.ideaId)
        state.expanded = true
        stateTree = state.children
      }
      const indexPath = [path[0]!.topLevelIndex, ...path.slice(1).map((step) => step.indexInParent!)]
      this.selectIdeaRow(scope, { ideaId, indexPath })

      this.navigatingIdeas = true
    },

    setPendingDeletePhase(phaseId: string | null) {
      this.pendingDeletePhaseId = phaseId
    },

    deselectIdea() {
      this.navigatingIdeas = false
    },

    // --- Multi-select for bulk actions (current-week feature: merge ideas etc.) ---
    toggleMultiSelect(ideaId: string) {
      this.cleanMultiSelect()
      this.multiSelectMode = true
      this.pendingBulkDelete = false
      const idx = this.multiSelectedIdeaIds.indexOf(ideaId)
      if (idx >= 0) {
        this.multiSelectedIdeaIds.splice(idx, 1)
      } else {
        this.multiSelectedIdeaIds.push(ideaId)
        this.multiAnchorId = ideaId
      }
      if (this.multiSelectedIdeaIds.length === 0) {
        this.clearMultiSelect()
      }
    },

    enterMultiSelect(ideaId: string) {
      this.multiSelectMode = true
      this.multiSelectedIdeaIds = [ideaId]
      this.multiAnchorId = ideaId
      this.pendingBulkDelete = false
    },

    addToMultiSelect(ideaId: string) {
      this.multiSelectMode = true
      this.pendingBulkDelete = false
      if (!this.multiSelectedIdeaIds.includes(ideaId)) {
        this.multiSelectedIdeaIds.push(ideaId)
      }
    },

    clearMultiSelect() {
      this.multiSelectMode = false
      this.multiSelectedIdeaIds = []
      this.multiAnchorId = null
      this.pendingBulkDelete = false
    },

    // Auto-clear stale IDs (e.g. after merge/archive/delete or data reload)
    cleanMultiSelect() {
      const dataStore = useDataStore()
      this.multiSelectedIdeaIds = this.multiSelectedIdeaIds.filter(id => id && dataStore.ideas[id])
      if (this.multiSelectedIdeaIds.length === 0) {
        this.clearMultiSelect()
      }
    },

    // Shift-range selection within a provided ordered list of idea IDs (e.g. sibling ideas in a list or phase)
    selectMultiRange(targetIdeaId: string, orderedIdeaIds: string[]) {
      this.cleanMultiSelect()
      if (!orderedIdeaIds || orderedIdeaIds.length === 0) {
        this.toggleMultiSelect(targetIdeaId)
        this.multiAnchorId = targetIdeaId
        return
      }
      const selectedAnchor = this.multiSelectedIdeaIds[0]
      const anchor = this.multiAnchorId && orderedIdeaIds.includes(this.multiAnchorId)
        ? this.multiAnchorId
        : (selectedAnchor && orderedIdeaIds.includes(selectedAnchor) ? selectedAnchor : orderedIdeaIds[0]!)

      const startIdx = orderedIdeaIds.indexOf(anchor)
      const endIdx = orderedIdeaIds.indexOf(targetIdeaId)
      if (startIdx < 0 || endIdx < 0) {
        this.addToMultiSelect(targetIdeaId)
        this.multiAnchorId = targetIdeaId
        return
      }
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
      const range = orderedIdeaIds.slice(lo, hi + 1)
      // Replace multi with the range (standard shift behavior), but keep primary separate
      this.multiSelectMode = true
      this.multiSelectedIdeaIds = [...range]
      this.multiAnchorId = anchor
      this.pendingBulkDelete = false
    },

    setMultiAnchor(ideaId: string | null) {
      this.multiAnchorId = ideaId
    },

    async requestBulkDelete() {
      this.cleanMultiSelect()
      if (!this.multiSelectMode || this.multiSelectedIdeaIds.length === 0) return false
      if (!this.pendingBulkDelete) {
        this.pendingBulkDelete = true
        return false
      }

      this.pendingBulkDelete = false
      if (!await deleteIdeasAsking(useDataStore(), useProjectStore().projectPath, [...this.multiSelectedIdeaIds])) return false
      this.clearMultiSelect()
      return true
    },

    // Merge all currently multi-selected (except the target) into the target idea.
    // Uses the existing backend merge (target keeps identity + connections + reflections; sources archived).
    async mergeSelectedInto(targetId: string) {
      const projectStore = useProjectStore()
      const projectPath = projectStore.projectPath
      if (!projectPath || !targetId) return { success: false, error: 'No project or target' }

      const others = this.multiSelectedIdeaIds.filter(id => id !== targetId)
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
        await dataStore.loadAllIdeas(projectPath)
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

    async calculateIdeaPaths(ideaId: string): Promise<IdeaPath[]> {
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
            dataStore.replaceIdea(idea.id, idea)
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

        if (idea.supportedIdeas && idea.supportedIdeas.length > 0) {
          isRoot = false
          for (const parentId of idea.supportedIdeas) {
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
      return await this.calculateIdeaPaths(ideaId)
    },

    async executeNavigation(path: IdeaPath) {
      const dataStore = useDataStore()
      const rootIdea = path.ideas[0]
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

      const contextIdeas = phaseId ? dataStore.getIdeasForPhase(phaseId) : dataStore.floatingIdeas
      if (rootIdea) {
        const rootIndex = contextIdeas.findIndex((a: any) => a && a.id === rootIdea.id)
        if (rootIndex !== -1) {
          if (phaseId) {
            const phase = dataStore.phases[phaseId]
            if (phase) phase.selectedIdeaIndex = rootIndex
          } else {
            this.floatingIdeaIndex = rootIndex
          }
        }
      }

      let stateTree = phaseId ? this.getPhaseIdeaUIStates(phaseId) : this.floatingIdeaUIStates
      for (let i = 0; i < path.ideas.length - 1; i++) {
        const parentStep = path.ideas[i]
        if (!parentStep) continue
        const parent = dataStore.ideas[parentStep.id]
        const child = path.ideas[i + 1]
        if (!parent || !child) continue

        const parentState = ensureIdeaUIState(stateTree, parent.id)
        parentState.expanded = true

        const childIndex = parent.supportingConnections.findIndex((c: any) => c.ideaId === child.id)
        if (childIndex !== -1) {
          parentState.selectedIncomingIndex = childIndex
        }
        stateTree = parentState.children
      }

      this.navigatingIdeas = true
      this.ensureSelectionVisible()
    },

    async navigateToIdea(ideaId: string) {
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
    getIdeaListScope(phaseId?: string): IdeaListScope | undefined {
      const dataStore = useDataStore()
      if (phaseId === undefined && this.activeColumn === -1) {
        return {
          ideas: dataStore.floatingIdeas,
          tree: this.getFloatingIdeaUIStates(),
          setTopIndex: (index: number) => { this.floatingIdeaIndex = index }
        }
      }
      const phase = dataStore.phases[phaseId ?? this.getSelectedPhaseId(this.activeColumn) ?? '']
      if (!phase) return undefined
      return {
        ideas: dataStore.getIdeasForPhase(phase.id),
        tree: this.getPhaseIdeaUIStates(phase.id),
        setTopIndex: (index: number) => { phase.selectedIdeaIndex = index }
      }
    },

    // Points the selection chain at `row`, ending the chain there.
    selectIdeaRow(scope: IdeaListScope, row: IdeaRow) {
      const dataStore = useDataStore()
      const [topIndex, ...connectionIndices] = row.indexPath
      scope.setTopIndex(topIndex!)
      let idea: Idea | undefined = scope.ideas[topIndex!]
      let state = idea ? ensureIdeaUIState(scope.tree, idea.id) : undefined
      for (const connectionIndex of connectionIndices) {
        if (!idea || !state) return
        state.selectedIncomingIndex = connectionIndex
        const connection = idea.supportingConnections?.[connectionIndex]
        idea = connection ? dataStore.ideas[connection.ideaId] : undefined
        state = idea ? ensureIdeaUIState(state.children, idea.id) : undefined
      }
      if (state) state.selectedIncomingIndex = undefined
    },

    // Moves the idea cursor one visible row (into expanded children and back
    // out, like a vim tree view). Returns false at either end of the list.
    stepIdeaRow(delta: -1 | 1): boolean {
      const scope = this.getIdeaListScope()
      const path = this.getSelectionPath()
      if (!scope || path.ideas.length === 0) return false

      const topIndex = path.phase
        ? path.phase.selectedIdeaIndex ?? 0
        : Math.max(0, Math.min(this.floatingIdeaIndex, scope.ideas.length - 1))
      const currentPath = [topIndex, ...path.ideaStates.slice(0, -1).map((state) => state.selectedIncomingIndex!)]
      const rows = getVisibleIdeaRows(scope.ideas, scope.tree, useDataStore())
      const currentRow = rows.findIndex((row) =>
        row.indexPath.length === currentPath.length && row.indexPath.every((index, depth) => index === currentPath[depth])
      )
      const target = rows[currentRow + delta]
      if (currentRow < 0 || !target) return false
      this.selectIdeaRow(scope, target)
      return true
    },

    // Universal navigation down (j)
    async navigateDown() {
      const previousStates = this.getSelectionPath().ideaStates
      const previousIdeaState = previousStates[previousStates.length - 1]
      if (previousIdeaState) previousIdeaState.pendingDelete = false
      logNav('navigateDown:start', {
        activeColumn: this.activeColumn,
        navigatingIdeas: this.navigatingIdeas
      })

      if (this.stepIdeaRow(1)) return
      if (this.activeColumn >= 0) {
        await this.continueIdeaBoundaryPhaseMove(1)
      }
    },

    // Universal navigation up (k)
    async navigateUp() {
      const path = this.getSelectionPath()
      const previousIdeaState = path.ideaStates[path.ideaStates.length - 1]
      if (previousIdeaState) previousIdeaState.pendingDelete = false
      logNav('navigateUp:start', {
        activeColumn: this.activeColumn,
        navigatingIdeas: this.navigatingIdeas
      })

      if (path.ideas.length > 0 && !this.navigatingIdeas) return
      if (this.stepIdeaRow(-1)) return
      if (this.activeColumn >= 0) {
        await this.continueIdeaBoundaryPhaseMove(-1)
      }
    },

    // Move idea down (J)
    // Queues a structural edit behind the ones in flight; see structuralEditQueue.
    runStructuralEdit<T>(edit: () => Promise<T>): Promise<T> {
      const run = structuralEditQueue.then(edit, edit)
      structuralEditQueue = run.catch(() => undefined)
      return run
    },

    async moveIdeaDown() {
      await this.runStructuralEdit(() => moveIdeaDownAction(this))
    },

    // Move idea up (K)
    async moveIdeaUp() {
      await this.runStructuralEdit(() => moveIdeaUpAction(this))
    },

    // Move idea out of sub-idea list (H) - make it sibling of parent
    async moveIdeaOut() {
      await this.runStructuralEdit(() => moveIdeaOutAction(this))
    },

    // Move idea in (L) - make it a sub-idea of previous sibling
    async moveIdeaIn() {
      await this.runStructuralEdit(() => moveIdeaInAction(this))
    },

    cutIdeaForTeleport() {
      const modalStore = useUIModalStore()
      const path = this.getSelectionPath()
      const currentIdea = path.ideas[path.ideas.length - 1]
      if (!currentIdea) return

      let source: TeleportSource | null = null
      if (path.ideas.length > 1) {
        const parentIdea = path.ideas[path.ideas.length - 2]
        if (parentIdea) {
          source = { parentIdeaId: parentIdea.id }
        }
      } else if (path.phase) {
        source = { phaseId: path.phase.id }
      }

      modalStore.teleportCutIdeaId = currentIdea.id
      modalStore.teleportSource = source
      modalStore.movingIdeaId = currentIdea.id
    },

    copyIdeaForTeleport() {
      const modalStore = useUIModalStore()
      const path = this.getSelectionPath()
      const currentIdea = path.ideas[path.ideas.length - 1]
      if (!currentIdea) return

      let source: TeleportSource | null = null
      if (path.ideas.length > 1) {
        const parentIdea = path.ideas[path.ideas.length - 2]
        if (parentIdea) {
          source = { parentIdeaId: parentIdea.id }
        }
      } else if (path.phase) {
        source = { phaseId: path.phase.id }
      }

      modalStore.teleportCopyIdeaId = currentIdea.id
      modalStore.teleportCopySource = source
    },

    async pasteCutIdea(dataStore: any) {
      await this.runStructuralEdit(() => pasteCutIdeaAction(this, dataStore))
    },

    async pasteCopiedIdea(dataStore: any) {
      await this.runStructuralEdit(() => pasteCopiedIdeaAction(this, dataStore))
    },

    // Keyboard navigation handlers
    async handleColumnNavigationKeys(event: KeyboardEvent, dataStore: any) {
      await handleColumnNavigationKeysAction(this, event, dataStore)
    },

    // Ideas edit mode: j/k = navigate ideas, J/K = move ideas, h/l = expand/collapse, H = move out, d = delete, o/O = create, x/p = cut/paste, c/p = copy/paste
    async handleIdeaNavigationKeys(event: KeyboardEvent, dataStore: any) {
      await handleIdeaNavigationKeysAction(this, event, dataStore)
    },

    resetViewState() {
      this.activeColumn = 0
      this.windowStart = 0
      this.windowSize = 2
      this.maxColumn = 0
      this.floatingIdeaIndex = -1
      this.navigatingIdeas = false
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
