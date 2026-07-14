import { defineStore } from 'pinia'
import { useDataStore, type Aim, type Phase, type AimCreationParams, type PhaseLevelPhaseEntry, type PhaseLevelPlaceholderEntry } from '../data'
import { AIM_DEFAULTS } from '../../constants/aimDefaults'
import type { AimStatusState } from 'shared'
import {
  setWindowSize as setWindowSizeHelper,
} from './view-helpers'
import {
  getSelectionPathFromState,
  setCurrentAimIndexInState,
  findPathToAim as findPathToAimHelper,
  type SelectionPath
} from './navigation-helpers'
import { createAimUIState, ensureAimUIState, type AimUIState, type AimUIStateTree } from './aim-ui-state'
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

export type AimPath = {
  phaseId?: string
  aims: Aim[]
}

function logNav(event: string, details: Record<string, unknown> = {}) {
  if (!hasQueryFlag('phaseNavDebug')) return
  console.log(`[PhaseNav] ${event}`, details)
}

type PhaseMoveDirection = 'forward' | 'backward' | 'preserve'
type ColumnSelectionToken =
  | { type: 'phase'; phaseId: string }
  | { type: 'placeholder'; parentPhaseId: string }

type PersistedListViewState = {
  activeColumn: number
  windowStart: number
  windowSize: number
  selectedPhaseByColumn: Record<number, number>
  selectedPhaseIdByColumn: Record<number, string>
  floatingAimIndex: number
  lastSelectedSubPhaseIndexByPhase: Record<string, number>
  navigatingAims: boolean
  selectedAimIndexByPhaseId: Record<string, number>
  selectedIncomingIndexByAimId?: Record<string, number>
  expandedAimIds?: string[]
  floatingAimUIStates?: AimUIStateTree
  phaseAimUIStatesByPhaseId?: Record<string, AimUIStateTree>
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

    // Phase selection by column (transient browsing focus — does NOT define the current phase)
    selectedPhaseByColumn: {} as Record<number, number>, // columnIndex -> phaseIndex
    selectedPhaseIdByColumn: {} as Record<number, string>, // columnIndex -> phaseId

    // The explicit "current" phase path (root → marked phase → first child each level down).
    // Set only via `c` (markPhaseAsCurrent); persisted to meta.phaseCursors and read by the
    // autonomous loop as the active phase. Independent of browsing focus above.
    currentPhaseIdByLevel: {} as Record<string, string>, // level -> phaseId

    // Root aims selection (for column -1)
    floatingAimIndex: 0,

    // Viewport for column scrolling
    windowStart: 0,
    windowSize: 3,

    // Delete pending states
    pendingDeletePhaseId: null as string | null,
    pendingDeleteAimId: null as string | null,

    // Multi-selection (separate from primary navigation/focus selection).
    // Used for bulk actions like "merge aims" (current week UI feature).
    // Ctrl/Cmd+click or shift+click to populate. Primary click still drives nav selection.
    multiSelectedAimIds: [] as string[],
    multiAnchorId: null as string | null,

    // Scroll Request
    columnScrollIntent: null as { col: number, direction: 'bottom' | 'top' } | null,

    // Remember last selected sub-phase index per parent phase
    lastSelectedSubPhaseIndexByPhase: {} as Record<string, number>,
    scrollTopByColumn: {} as Record<number, number>,

    uiStatePersistTimeout: null as ReturnType<typeof setTimeout> | null,
    isRestoringUIState: false,
    restoreGeneration: 0,
    floatingAimUIStates: {} as AimUIStateTree,
    phaseAimUIStatesByPhaseId: {} as Record<string, AimUIStateTree>,
  }),
  
  getters: {
    isInProjectSelection: () => useProjectStore().isInProjectSelection,

    getRememberedPhase: (state) => (columnIndex: number): number => {
      return state.selectedPhaseByColumn[columnIndex] ?? 0
    },

    // Reactive phase selection getters
    getSelectedPhase: (state) => (columnIndex: number): number => {
      const dataStore = useDataStore()
      const liveCount = dataStore.getSelectableColumnEntries(columnIndex).length
      const index = state.selectedPhaseByColumn[columnIndex] ?? 0
      const phaseCount = liveCount

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
    isMultiSelected: (state) => (aimId: string): boolean => state.multiSelectedAimIds.includes(aimId),
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
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn },
        floatingAimIndex: this.floatingAimIndex,
        lastSelectedSubPhaseIndexByPhase: { ...this.lastSelectedSubPhaseIndexByPhase },
        navigatingAims: this.navigatingAims,
        selectedAimIndexByPhaseId,
        floatingAimUIStates: this.floatingAimUIStates,
        phaseAimUIStatesByPhaseId: this.phaseAimUIStatesByPhaseId
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
        if (projectStore.projectPath) {
          await dataStore.loadPhases(projectStore.projectPath, node)
        }
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
        if (meta.phaseActiveLevel !== undefined) {
          this.activeColumn = meta.phaseActiveLevel
          this.maxColumn = Math.max(this.activeColumn, 0)
        }

        const maxLevel = Math.max(...Object.keys(meta.phaseCursors).map(Number).filter(n => !isNaN(n)))
        const shouldContinue = () => this.isRestoringUIState && this.restoreGeneration === restoreGeneration

        await this.loadColumn(0)
        if (!shouldContinue()) return true

        for (let level = 0; level <= maxLevel; level++) {
          const phaseId = meta.phaseCursors[String(level)]
          if (!phaseId) break

          const index = this.findSelectableIndexForPhase(level, phaseId)
          if (index >= 0) {
            this.applyPhaseSelection(level, index)
            this.maxColumn = Math.max(this.maxColumn, level)
          } else {
            this.initializeColumnSelection(level, 'preserve')
          }

          if (level < maxLevel) {
            await this.loadColumn(level + 1)
            if (!shouldContinue()) return true
          }
        }

        this.ensureSelectionVisible()
        return true
      } finally {
        if (this.restoreGeneration === restoreGeneration && this.isRestoringUIState) {
          this.endUIStateRestore()
        }
      }
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
          this.maxColumn = Math.max(-1, this.activeColumn)
          this.selectedPhaseByColumn = { ...listViewState.selectedPhaseByColumn }
          this.selectedPhaseIdByColumn = { ...listViewState.selectedPhaseIdByColumn }
          this.floatingAimIndex = listViewState.floatingAimIndex
          this.lastSelectedSubPhaseIndexByPhase = { ...listViewState.lastSelectedSubPhaseIndexByPhase }
          this.navigatingAims = listViewState.navigatingAims
          this.scrollTopByColumn = {}

          const shouldContinue = () => this.isRestoringUIState && this.restoreGeneration === restoreGeneration
          const restoreVisibleMax = Math.max(this.activeColumn, this.getVisibleMaxColumn())

          if (this.windowStart < 0) {
            this.maxColumn = Math.max(this.maxColumn, -1)
          }

          if (restoreVisibleMax >= 0) {
            await this.loadColumn(0)
            if (!shouldContinue()) return true

            const rootSelectedId = this.selectedPhaseIdByColumn[0]
            if (rootSelectedId) {
              const rootIndex = this.findSelectableIndexForPhase(0, rootSelectedId)
              if (rootIndex >= 0) {
                this.applyPhaseSelection(0, rootIndex)
              } else {
                this.initializeColumnSelection(0, 'preserve')
              }
            } else {
              this.initializeColumnSelection(0, 'preserve')
            }

            for (let columnIndex = 1; columnIndex <= restoreVisibleMax; columnIndex++) {
              const parentPhaseId = this.selectedPhaseIdByColumn[columnIndex - 1]
              if (!parentPhaseId) {
                break
              }

              await this.loadColumn(columnIndex)
              if (!shouldContinue()) return true

              const selectedPhaseId = this.selectedPhaseIdByColumn[columnIndex]
              if (selectedPhaseId) {
                const selectedIndex = this.findSelectableIndexForPhase(columnIndex, selectedPhaseId)
                if (selectedIndex >= 0) {
                  this.applyPhaseSelection(columnIndex, selectedIndex)
                } else {
                  this.initializeColumnSelection(columnIndex, 'preserve')
                }
              } else {
                this.initializeColumnSelection(columnIndex, 'preserve')
              }

              if (this.getSelectableEntries(columnIndex).length === 0) {
                break
              }
              this.maxColumn = Math.max(this.maxColumn, columnIndex)
            }
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
            for (const aim of Object.values(dataStore.aims)) {
              if (!aim) continue
              if (!expandedAimIds.has(aim.id) && listViewState.selectedIncomingIndexByAimId?.[aim.id] === undefined) continue
              const state = ensureAimUIState(this.floatingAimUIStates, aim.id)
              state.expanded = expandedAimIds.has(aim.id)
              const selectedIncomingIndex = listViewState.selectedIncomingIndexByAimId?.[aim.id]
              if (selectedIncomingIndex !== undefined) {
                state.selectedIncomingIndex = selectedIncomingIndex
              }
            }
          }

          if (this.navigatingAims && this.activeColumn >= 0) {
            const activePhaseId = this.selectedPhaseIdByColumn[this.activeColumn]
            if (activePhaseId) {
              await dataStore.loadPhaseAims(projectStore.projectPath, activePhaseId)
              if (!shouldContinue()) return true
              const phase = dataStore.phases[activePhaseId]
              if (phase && listViewState.selectedAimIndexByPhaseId[activePhaseId] !== undefined) {
                phase.selectedAimIndex = Math.min(
                  listViewState.selectedAimIndexByPhaseId[activePhaseId]!,
                  Math.max(0, phase.commitments.length - 1)
                )
              }
            }
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

    // Create aim and update selection
    async createAim(
      aimTextOrId: string,
      isExistingAim: boolean = false,
      description?: string,
      tags?: string[],
      intrinsicValue: number = AIM_DEFAULTS.intrinsicValue,
      loopWeight: number = AIM_DEFAULTS.loopWeight,
      cost: number = AIM_DEFAULTS.cost,
      weight: number = 1,
      supportedAims: string[] = [],
      supportingConnections: { aimId: string, weight?: number, relativePosition?: [number, number] }[] = [],
      color?: string | null,
      statusState: AimStatusState = 'open',
      statusComment: string = ''
    ) {
      const dataStore = useDataStore()
      const modalStore = useUIModalStore()
      const projectStore = useProjectStore()

      const aimAttributes: AimCreationParams = {
        text: aimTextOrId,
        description,
        tags: tags || [],
        reflections: [],
        status: { state: statusState, comment: statusComment, date: Date.now() },
        supportingConnections,
        supportedAims,
        intrinsicValue: intrinsicValue ?? 0,
        loopWeight,
        cost,
        duration: 1,
        costVariance: 0,
        valueVariance: 0,
        archived: false,
        color: color || undefined
      }

      const path = this.getSelectionPath()
      let newAimId: string | undefined
      // Parent aim when creating/linking inside a sub-aim list (implicit connection).
      // Used to offer the contribution % + explanation modal afterwards.
      let implicitParentId: string | undefined
      let createdAsPhaseCommitmentWithoutImplicitSupportedAim = false

      if (modalStore.aimModalSource === 'graph') {
        if (isExistingAim) {
          newAimId = aimTextOrId
        } else {
          const result = await dataStore.createFloatingAim(projectStore.projectPath, aimAttributes)
          newAimId = result.id
        }
      } else if (path.aims.length === 0) {
        if (path.phase) {
          if (isExistingAim) {
            await trpc.aim.commitToPhase.mutate({
              projectPath: projectStore.projectPath,
              aimId: aimTextOrId,
              phaseId: path.phase.id,
              insertionIndex: 0
            })
            newAimId = aimTextOrId
          } else {
            const result = await dataStore.createCommittedAim(projectStore.projectPath, path.phase.id, aimAttributes, 0)
            newAimId = result.id
            createdAsPhaseCommitmentWithoutImplicitSupportedAim = true
          }

          await dataStore.loadPhaseAims(projectStore.projectPath, path.phase.id)
        } else if (isExistingAim) {
          if (modalStore.aimCreationCallback) {
            newAimId = aimTextOrId
          } else {
            modalStore.showAimModal = false
            return
          }
        } else {
          const result = await dataStore.createFloatingAim(projectStore.projectPath, aimAttributes)
          newAimId = result.id
        }
      } else {
        const currentAim = path.aims[path.aims.length - 1]
        const currentAimState = path.aimStates[path.aimStates.length - 1]
        if (!currentAim) {
          modalStore.showAimModal = false
          return
        }

        if (currentAimState?.expanded && modalStore.aimModalInsertPosition === 'after') {
          if (isExistingAim) {
            await trpc.aim.connectAims.mutate({
              projectPath: projectStore.projectPath,
              parentAimId: currentAim.id,
              childAimId: aimTextOrId,
              parentIncomingIndex: 0,
              weight
            })
            newAimId = aimTextOrId

            const updatedParent = await trpc.aim.get.query({
              projectPath: projectStore.projectPath,
              aimId: currentAim.id
            })
            dataStore.replaceAim(currentAim.id, updatedParent)
          } else {
            const result = await dataStore.createSubAim(projectStore.projectPath, currentAim.id, aimAttributes, 0, weight)
            newAimId = result.id
          }

          implicitParentId = currentAim.id
          if (currentAimState) {
            currentAimState.selectedIncomingIndex = 0
          }
        } else if (path.aims.length > 1) {
          const parentAim = path.aims[path.aims.length - 2]
          const parentAimState = path.aimStates[path.aimStates.length - 2]
          if (parentAim) {
            let insertionIndex = parentAimState?.selectedIncomingIndex ?? 0
            if (modalStore.aimModalInsertPosition === 'after') {
              insertionIndex++
            }

            if (isExistingAim) {
              await trpc.aim.connectAims.mutate({
                projectPath: projectStore.projectPath,
                parentAimId: parentAim.id,
                childAimId: aimTextOrId,
                parentIncomingIndex: insertionIndex,
                weight
              })
              newAimId = aimTextOrId

              const updatedParent = await trpc.aim.get.query({
                projectPath: projectStore.projectPath,
                aimId: parentAim.id
              })
              dataStore.replaceAim(parentAim.id, updatedParent)
            } else {
              const result = await dataStore.createSubAim(projectStore.projectPath, parentAim.id, aimAttributes, insertionIndex, weight)
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
            insertionIndex = phase.selectedAimIndex + (modalStore.aimModalInsertPosition === 'after' ? 1 : 0)
          }

          if (isExistingAim) {
            await trpc.aim.commitToPhase.mutate({
              projectPath: projectStore.projectPath,
              aimId: aimTextOrId,
              phaseId: path.phase.id,
              insertionIndex
            })
            newAimId = aimTextOrId

            const updatedPhase = await trpc.phase.get.query({
              projectPath: projectStore.projectPath,
              phaseId: path.phase.id
            })
            dataStore.replacePhase(path.phase.id, updatedPhase)
          } else {
            const result = await dataStore.createCommittedAim(projectStore.projectPath, path.phase.id, aimAttributes, insertionIndex)
            newAimId = result.id
            createdAsPhaseCommitmentWithoutImplicitSupportedAim = true
          }

          const freshPhase = dataStore.phases[path.phase.id]
          if (freshPhase) {
            freshPhase.selectedAimIndex = insertionIndex
          }
        } else if (isExistingAim) {
          if (modalStore.aimCreationCallback) {
            newAimId = aimTextOrId
          } else {
            modalStore.showAimModal = false
            return
          }
        } else {
          const result = await dataStore.createFloatingAim(projectStore.projectPath, aimAttributes)
          newAimId = result.id
        }
      }

      let connectionCallbackPromptsPhase = false
      if (newAimId) {
        const shouldPromptForPhaseCommitment =
          !isExistingAim &&
          modalStore.aimModalSource === 'graph' &&
          projectStore.currentView === 'graph'

        if (modalStore.aimCreationCallback) {
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
                  label: 'Skip (leave floating)',
                  description: 'Keep this new graph aim uncommitted to any phase.',
                  showWhenQueryEmptyOnly: true,
                  actsAsEscape: true
                }]
              })
            }
            modalStore.aimCreationCallback(newAimId, promptPhase)
          } else {
            modalStore.aimCreationCallback(newAimId)
          }
          modalStore.aimCreationCallback = null
        }

        if (path.phase) {
          const aims = dataStore.getAimsForPhase(path.phase.id)
          const newAimIndex = aims.findIndex((aim: any) => aim.id === newAimId)
          if (newAimIndex !== -1) {
            const phase = dataStore.phases[path.phase.id]
            if (phase) {
              phase.selectedAimIndex = newAimIndex
            }
          }
        } else {
          const newAimIndex = dataStore.floatingAims.findIndex((aim: any) => aim.id === newAimId)
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
        modalStore.aimModalSource === 'columns' &&
        projectStore.currentView === 'columns'

      const shouldPromptForPhaseCommitment =
        !isExistingAim &&
        !!newAimId &&
        modalStore.aimModalSource === 'graph' &&
        projectStore.currentView === 'graph' &&
        !connectionCallbackPromptsPhase

      modalStore.closeAimModal()

      // Sub-aim list creation/linking: offer contribution % + explanation for the
      // implicit parent->child connection. Reload the parent so its supportingConnections
      // include the freshly-created connection before the modal patches it.
      if (implicitParentId && newAimId && !shouldPromptForSupportedAim && !shouldPromptForPhaseCommitment) {
        await dataStore.loadAims(projectStore.projectPath, [implicitParentId, newAimId])
        modalStore.openConnectionDetailsModal(implicitParentId, newAimId)
      }

      if (shouldPromptForSupportedAim && newAimId) {
        modalStore.openAimSearch('pick', async (payload) => {
          if (payload.type !== 'aim') return

          await trpc.aim.connectAims.mutate({
            projectPath: projectStore.projectPath,
            parentAimId: payload.data.id,
            childAimId: newAimId
          })

          await dataStore.loadAims(projectStore.projectPath, [payload.data.id, newAimId])
        }, undefined, {
          title: 'Connect to Supported Aim',
          placeholder: 'Optional: search for a parent aim...',
          additionalOptions: [{
            id: 'skip-parent',
            label: 'Skip (no supported aim)',
            description: 'Leave this new aim without a supported aim connection.',
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
            label: 'Skip (leave floating)',
            description: 'Keep this new graph aim uncommitted to any phase.',
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

    getCurrentAim(): Aim | undefined {
      const path = this.getSelectionPath()
      return path.aims[path.aims.length - 1]
    }, 

    getCurrentAimUIState(): AimUIState | undefined {
      const path = this.getSelectionPath()
      return path.aimStates[path.aimStates.length - 1]
    },

    getFloatingAimUIStates(): AimUIStateTree {
      return this.floatingAimUIStates
    },

    getPhaseAimUIStates(phaseId: string): AimUIStateTree {
      this.phaseAimUIStatesByPhaseId[phaseId] ??= {}
      return this.phaseAimUIStatesByPhaseId[phaseId]
    },

    ensureAimUIState(tree: AimUIStateTree, aimId: string): AimUIState {
      return ensureAimUIState(tree, aimId)
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

    // Helper to set current aim index (replaces setSelectedAim)
    setCurrentAimIndex(aimIndex: number, dataStore: any) {
      setCurrentAimIndexInState(
        this.activeColumn,
        (columnIndex) => this.getSelectedPhaseId(columnIndex),
        (index) => { this.floatingAimIndex = index },
        aimIndex,
        dataStore
      )
    },

    async loadColumn(columnIndex: number) {
      const startedAt = performance.now()
      const dataStore = useDataStore()
      const projectStore = useProjectStore()
      logNav('loadColumn:start', {
        columnIndex,
        projectPath: projectStore.projectPath
      })

      if (columnIndex < 0) {
        return
      }

      if (columnIndex === 0) {
        await dataStore.loadPhases(projectStore.projectPath, null)
      } else {
        const selectedParentId = this.selectedPhaseIdByColumn[columnIndex - 1]
        if (selectedParentId) {
          await dataStore.loadPhases(projectStore.projectPath, selectedParentId)
        }
      }

      if (columnIndex > 0 && this.selectedPhaseByColumn[columnIndex] === undefined) {
        this.initializeColumnSelection(columnIndex)
      }

      if (columnIndex >= 0) {
        await this.ensureColumnNeighborhoodLoaded(columnIndex)
      }

      perfLog('ui.loadColumn:done', {
        columnIndex,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        entries: dataStore.getSelectableColumnEntries(columnIndex).length,
        selectedPhaseId: this.selectedPhaseIdByColumn[columnIndex]
      })
      logNav('loadColumn', {
        columnIndex,
        phaseCount: dataStore.getSelectableColumnEntries(columnIndex).length,
        selectedPhaseId: this.selectedPhaseIdByColumn[columnIndex]
      })
    },

    getVisibleMaxColumn() {
      return this.windowStart + this.windowSize - 1
    },

    getEstimatedEntryHeight(entry: PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry) {
      return entry.type === 'phase' ? 180 : 44
    },

    getEstimatedSelectableHeight(columnIndex: number) {
      return this.getSelectableEntries(columnIndex).reduce((sum, entry) => sum + this.getEstimatedEntryHeight(entry), 0)
    },

    getSelectableEntries(columnIndex: number): Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry> {
      const dataStore = useDataStore()
      return dataStore.getSelectableColumnEntries(columnIndex)
    },

    getSelectedPhaseEntry(columnIndex: number): PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry | undefined {
      const entries = this.getSelectableEntries(columnIndex)
      return entries[this.getSelectedPhase(columnIndex)]
    },

    getCurrentSelectionToken(columnIndex: number): ColumnSelectionToken | undefined {
      const rememberedPhaseId = this.selectedPhaseIdByColumn[columnIndex]
      if (rememberedPhaseId) {
        return { type: 'phase', phaseId: rememberedPhaseId }
      }

      const entry = this.getSelectedPhaseEntry(columnIndex)
      if (!entry) return undefined
      if (entry.type === 'phase') {
        return { type: 'phase', phaseId: entry.phase.id }
      }
      return { type: 'placeholder', parentPhaseId: entry.parentPhaseId }
    },

    findSelectableIndexForPlaceholderParent(columnIndex: number, parentPhaseId: string): number {
      return this.getSelectableEntries(columnIndex).findIndex((entry) => entry.type === 'placeholder' && entry.parentPhaseId === parentPhaseId)
    },

    restoreColumnSelectionFromToken(columnIndex: number, token: ColumnSelectionToken | undefined) {
      if (!token) return undefined
      const index = token.type === 'phase'
        ? this.findSelectableIndexForPhase(columnIndex, token.phaseId)
        : this.findSelectableIndexForPlaceholderParent(columnIndex, token.parentPhaseId)
      if (index < 0) return undefined
      return this.applyPhaseSelection(columnIndex, index)
    },

    getParentPhasesForColumn(columnIndex: number) {
      const dataStore = useDataStore()
      if (columnIndex <= 0) {
        return []
      }
      return dataStore.getActualPhasesForColumn(columnIndex - 1)
    },

    initializeColumnSelection(columnIndex: number, direction: PhaseMoveDirection = 'preserve') {
      const entries = this.getSelectableEntries(columnIndex)
      if (entries.length === 0) {
        return undefined
      }

      if (columnIndex === 0) {
        if (this.selectedPhaseByColumn[0] !== undefined) {
          const rememberedRootEntry = this.getSelectedPhaseEntry(0)
          if (rememberedRootEntry) {
            return rememberedRootEntry
          }
        }
        return this.applyPhaseSelection(0, 0)
      }

      const parentPhaseId = this.selectedPhaseIdByColumn[columnIndex - 1]
      if (!parentPhaseId) {
        return undefined
      }

      const ownedEntries = this.getOwnedEntries(columnIndex, parentPhaseId)
      const rememberedEntry = this.getRememberedOwnedEntry(columnIndex, parentPhaseId, ownedEntries)
      if (rememberedEntry) {
        const rememberedIndex = entries.findIndex((entry) => entry.key === rememberedEntry.key)
        if (rememberedIndex >= 0) {
          return this.applyPhaseSelection(columnIndex, rememberedIndex)
        }
      }

      const targetEntry = this.chooseOwnedEntry(
        ownedEntries,
        undefined,
        parentPhaseId,
        direction
      )
      if (!targetEntry) {
        return undefined
      }

      const globalIndex = entries.findIndex((entry) => entry.key === targetEntry.key)
      if (globalIndex < 0) {
        return undefined
      }

      return this.applyPhaseSelection(columnIndex, globalIndex)
    },

    getOwnedEntries(columnIndex: number, parentPhaseId: string) {
      return this.getSelectableEntries(columnIndex).filter((entry) => entry.parentPhaseId === parentPhaseId)
    },

    getRememberedOwnedEntry(
      columnIndex: number,
      parentPhaseId: string,
      entries: Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry>
    ) {
      const rememberedPhaseId = this.selectedPhaseIdByColumn[columnIndex]
      if (rememberedPhaseId) {
        const rememberedPhaseEntry = entries.find(
          (entry) => entry.type === 'phase' && entry.phase.id === rememberedPhaseId && entry.parentPhaseId === parentPhaseId
        )
        if (rememberedPhaseEntry) {
          return rememberedPhaseEntry
        }
      }

      return undefined
    },

    findSelectableIndexForPhase(columnIndex: number, phaseId: string): number {
      return this.getSelectableEntries(columnIndex).findIndex((entry) => entry.type === 'phase' && entry.phase.id === phaseId)
    },

    async ensureColumnNeighborhoodLoaded(columnIndex: number) {
      const startedAt = performance.now()
      const dataStore = useDataStore()
      const projectStore = useProjectStore()

      if (columnIndex < 0) return
      if (columnIndex === 0) {
        await dataStore.loadPhases(projectStore.projectPath, null)
        return
      }

      const parentPhases = this.getParentPhasesForColumn(columnIndex)
      if (parentPhases.length === 0) return

      const currentToken = this.getCurrentSelectionToken(columnIndex)
      const selectedParentPhaseId =
        currentToken?.type === 'placeholder'
          ? currentToken.parentPhaseId
          : this.getSelectedPhaseEntry(columnIndex)?.parentPhaseId ?? this.selectedPhaseIdByColumn[columnIndex - 1]

      if (!selectedParentPhaseId) return

      const selectedParentIndex = parentPhases.findIndex((phase) => phase.id === selectedParentPhaseId)
      if (selectedParentIndex < 0) return

      let leftIndex = selectedParentIndex
      let rightIndex = selectedParentIndex
      const targetHeight = typeof window !== 'undefined' ? window.innerHeight * 2 : 1600

      await dataStore.loadPhases(projectStore.projectPath, selectedParentPhaseId)
      this.restoreColumnSelectionFromToken(columnIndex, currentToken)

      let groupsLoaded = 1
      while (true) {
        const entries = this.getSelectableEntries(columnIndex)
        const currentIndex = entries.findIndex((entry) => {
          if (!currentToken) return false
          return currentToken.type === 'phase'
            ? entry.type === 'phase' && entry.phase.id === currentToken.phaseId
            : entry.type === 'placeholder' && entry.parentPhaseId === currentToken.parentPhaseId
        })

        const effectiveIndex = currentIndex >= 0 ? currentIndex : this.getSelectedPhase(columnIndex)
        const hasBefore = effectiveIndex > 0 || leftIndex === 0
        const hasAfter = (effectiveIndex >= 0 && effectiveIndex < entries.length - 1) || rightIndex === parentPhases.length - 1
        const hasVisualPadding = this.getEstimatedSelectableHeight(columnIndex) >= targetHeight || (leftIndex === 0 && rightIndex === parentPhases.length - 1)

        if (hasBefore && hasAfter && hasVisualPadding) {
          break
        }

        let progressed = false

        if ((!hasBefore || !hasVisualPadding) && leftIndex > 0) {
          leftIndex--
          await dataStore.loadPhases(projectStore.projectPath, parentPhases[leftIndex]!.id)
          groupsLoaded++
          progressed = true
          this.restoreColumnSelectionFromToken(columnIndex, currentToken)
        }

        const entriesAfterLeft = this.getSelectableEntries(columnIndex)
        const currentIndexAfterLeft = entriesAfterLeft.findIndex((entry) => {
          if (!currentToken) return false
          return currentToken.type === 'phase'
            ? entry.type === 'phase' && entry.phase.id === currentToken.phaseId
            : entry.type === 'placeholder' && entry.parentPhaseId === currentToken.parentPhaseId
        })
        const effectiveIndexAfterLeft = currentIndexAfterLeft >= 0 ? currentIndexAfterLeft : this.getSelectedPhase(columnIndex)
        const hasAfterAfterLeft = (effectiveIndexAfterLeft >= 0 && effectiveIndexAfterLeft < entriesAfterLeft.length - 1) || rightIndex === parentPhases.length - 1
        const hasVisualPaddingAfterLeft = this.getEstimatedSelectableHeight(columnIndex) >= targetHeight || (leftIndex === 0 && rightIndex === parentPhases.length - 1)

        if ((!hasAfterAfterLeft || !hasVisualPaddingAfterLeft) && rightIndex < parentPhases.length - 1) {
          rightIndex++
          await dataStore.loadPhases(projectStore.projectPath, parentPhases[rightIndex]!.id)
          groupsLoaded++
          progressed = true
          this.restoreColumnSelectionFromToken(columnIndex, currentToken)
        }

        if (!progressed) {
          break
        }
      }
    },

    applyPhaseSelection(columnIndex: number, phaseIndex: number) {
      const entries = this.getSelectableEntries(columnIndex)
      if (entries.length === 0) {
        this.selectedPhaseByColumn[columnIndex] = 0
        delete this.selectedPhaseIdByColumn[columnIndex]
        return undefined
      }

      const clampedIndex = Math.max(0, Math.min(phaseIndex, entries.length - 1))
      const entry = entries[clampedIndex]
      if (!entry) {
        return undefined
      }

      this.selectedPhaseByColumn[columnIndex] = clampedIndex
      if (entry.type === 'phase') {
        this.selectedPhaseIdByColumn[columnIndex] = entry.phase.id
      } else {
        delete this.selectedPhaseIdByColumn[columnIndex]
      }

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

    async ensureColumnsLoaded(maxLevel: number) {
      for (let level = 0; level <= maxLevel; level++) {
        await this.loadColumn(level)
      }
    },

    ensureVisibleColumnSelections(direction: PhaseMoveDirection = 'preserve') {
      const maxVisibleColumn = Math.min(this.maxColumn, this.getVisibleMaxColumn())
      for (let columnIndex = 0; columnIndex <= maxVisibleColumn; columnIndex++) {
        this.initializeColumnSelection(columnIndex, direction)
      }
    },

    async realignVisibleColumnsFrom(fromColumn: number, direction: PhaseMoveDirection = 'preserve') {
      const maxVisibleColumn = Math.min(this.maxColumn, this.getVisibleMaxColumn())

      for (let columnIndex = Math.max(0, fromColumn); columnIndex <= maxVisibleColumn; columnIndex++) {
        await this.loadColumn(columnIndex)

        if (columnIndex === 0) {
          if (this.selectedPhaseByColumn[0] === undefined) {
            this.initializeColumnSelection(0, direction)
          }
          continue
        }

        const parentPhaseId = this.selectedPhaseIdByColumn[columnIndex - 1]
        if (!parentPhaseId) {
          break
        }

        const ownedEntries = this.getOwnedEntries(columnIndex, parentPhaseId)
        if (ownedEntries.length === 0) {
          break
        }

        const targetEntry = this.chooseOwnedEntry(
          ownedEntries,
          this.getRememberedOwnedEntry(columnIndex, parentPhaseId, ownedEntries) ?? this.getSelectedPhaseEntry(columnIndex),
          parentPhaseId,
          direction
        )
        if (!targetEntry) {
          break
        }

        const globalIndex = this.getSelectableEntries(columnIndex).findIndex((entry) => entry.key === targetEntry.key)
        if (globalIndex < 0) {
          break
        }

        this.applyPhaseSelection(columnIndex, globalIndex)
      }
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

      const rememberedChildIndex = this.lastSelectedSubPhaseIndexByPhase[parentPhaseId]
      if (rememberedChildIndex !== undefined) {
        const rememberedEntry = entries.find((entry) => entry.childIndex === rememberedChildIndex)
        if (rememberedEntry) {
          return rememberedEntry
        }
      }

      if (currentEntry && currentEntry.parentPhaseId === parentPhaseId) {
        const currentMatch = entries.find((entry) => entry.key === currentEntry.key)
        if (currentMatch) {
          return currentMatch
        }

        if (currentEntry.childIndex >= 0 && currentEntry.childIndex < entries.length) {
          return entries[currentEntry.childIndex]
        }
      }

      return direction === 'backward' ? entries[entries.length - 1] : entries[0]
    },

    async repairSelectionRight(fromLevel: number, direction: PhaseMoveDirection) {
      const maxVisibleLevel = this.getVisibleMaxColumn()
      let lastVisibleLevel = Math.max(0, Math.min(fromLevel, maxVisibleLevel))

      for (let level = fromLevel + 1; level <= maxVisibleLevel; level++) {
        const parentPhaseId = this.selectedPhaseIdByColumn[level - 1]
        if (!parentPhaseId) {
          break
        }

        await this.loadColumn(level)
        const ownedEntries = this.getOwnedEntries(level, parentPhaseId)
        if (ownedEntries.length === 0) {
          break
        }

        const targetEntry = this.chooseOwnedEntry(
          ownedEntries,
          this.getRememberedOwnedEntry(level, parentPhaseId, ownedEntries) ?? this.getSelectedPhaseEntry(level),
          parentPhaseId,
          direction
        )
        if (!targetEntry) {
          break
        }

        const globalIndex = this.getSelectableEntries(level).findIndex((entry) => entry.key === targetEntry.key)
        if (globalIndex < 0) {
          break
        }

        this.applyPhaseSelection(level, globalIndex)
        lastVisibleLevel = level
        logNav('repairSelectionRight', {
          fromLevel,
          updatedLevel: level,
          parentPhaseId,
          globalIndex,
          direction
        })
      }

      this.maxColumn = lastVisibleLevel
    },

    async reconcilePhaseSelection(fromLevel: number, direction: PhaseMoveDirection = 'preserve') {
      this.repairSelectionLeft(fromLevel)
      await this.repairSelectionRight(fromLevel, direction)
      this.maxColumn = Math.max(fromLevel, this.maxColumn)
      logNav('reconcilePhaseSelection', {
        fromLevel,
        direction,
        activeColumn: this.activeColumn,
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn },
        maxColumn: this.maxColumn
      })
    },

    async selectPhase(
      columnIndex: number,
      phaseIndex: number,
      direction: PhaseMoveDirection = 'preserve',
      alreadyLoaded: boolean = false
    ) {
      logNav('selectPhase:start', {
        columnIndex,
        requestedPhaseIndex: phaseIndex,
        direction,
        alreadyLoaded,
        activeColumn: this.activeColumn,
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn }
      })

      this.setActiveColumn(columnIndex)
      if (!alreadyLoaded) {
        await this.loadColumn(columnIndex)
      }
      const selectedEntry = this.applyPhaseSelection(columnIndex, phaseIndex)
      if (!selectedEntry) {
        this.setMaxColumn(columnIndex)
        return
      }

      await this.reconcilePhaseSelection(columnIndex, direction)
      logNav('selectPhase:done', {
        columnIndex,
        activeColumn: this.activeColumn,
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn },
        maxColumn: this.maxColumn
      })
    },

    async moveActivePhase(delta: number) {
      const columnIndex = this.activeColumn
      if (columnIndex < 0) {
        return false
      }

      const direction: PhaseMoveDirection = delta < 0 ? 'backward' : 'forward'
      const entries = this.getSelectableEntries(columnIndex)
      if (entries.length === 0) {
        await this.loadColumn(columnIndex)
      }

      let refreshedEntries = this.getSelectableEntries(columnIndex)
      if (refreshedEntries.length === 0) {
        return false
      }

      let currentIndex = this.getSelectedPhase(columnIndex)
      let nextIndex = currentIndex + delta
      if (nextIndex < 0 || nextIndex >= refreshedEntries.length) {
        await this.ensureColumnNeighborhoodLoaded(columnIndex)
        refreshedEntries = this.getSelectableEntries(columnIndex)
        currentIndex = this.getSelectedPhase(columnIndex)
        nextIndex = currentIndex + delta
        if (nextIndex < 0 || nextIndex >= refreshedEntries.length) {
          return false
        }
      }

      await this.selectPhase(columnIndex, nextIndex, direction, true)
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

        await dataStore.loadPhaseAims(projectStore.projectPath, selectedEntry.phase.id)
        const newPhase = dataStore.phases[selectedEntry.phase.id]
        if (!newPhase) {
          return false
        }

        if (newPhase.commitments.length > 0) {
          newPhase.selectedAimIndex = selectLastAim ? newPhase.commitments.length - 1 : 0

          if (selectLastAim) {
            const aims = dataStore.getAimsForPhase(selectedEntry.phase.id)
            const target = aims[newPhase.selectedAimIndex]
            const targetState = target ? ensureAimUIState(this.getPhaseAimUIStates(selectedEntry.phase.id), target.id) : undefined
            if (target && targetState?.expanded && targetState.selectedIncomingIndex !== undefined) {
              this.goToLastChildAim(target, targetState)
            }
          }
        }

        return true
      }

      return false
    },

    // Set selection without loading (j/k navigation)
    setSelection(columnIndex: number, phaseIndex: number) {
      this.applyPhaseSelection(columnIndex, phaseIndex)
    },

    // Click-to-select by aim ID (finds top-level index automatically)
    async selectAimById(columnIndex: number, phaseId: string | undefined, aimId: string) {
      const dataStore = useDataStore()
      const modalStore = useUIModalStore()

      const currentAim = this.getCurrentAim()
      const isAlreadySelected = currentAim?.id === aimId && this.activeColumn === columnIndex

      if (isAlreadySelected) {
        const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
        const aimIndex = aims.findIndex((a: any) => a && a.id === aimId)
        if (aimIndex !== -1) {
          modalStore.openAimEditModal(aimId)
        }
        return
      }

      const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims

      const topLevelIndex = aims.findIndex((a: any) => a && a.id === aimId)

      if (topLevelIndex >= 0) {
        await this.selectAim(columnIndex, phaseId, topLevelIndex)
        return
      }

      const path = findPathToAimHelper(aimId, aims, dataStore)
      if (!path || path.length === 0) return

      let stateTree = phaseId ? this.getPhaseAimUIStates(phaseId) : this.floatingAimUIStates
      for (let i = 0; i < path.length - 1; i++) {
        const step = path[i]
        const nextStep = path[i + 1]
        if (!step || !nextStep || nextStep.indexInParent === undefined) continue
        const state = ensureAimUIState(stateTree, step.aimId)
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
          this.selectedPhaseByColumn[columnIndex] = phaseIndex
          this.selectedPhaseIdByColumn[columnIndex] = phaseId
        }
      }

      this.navigatingAims = true
      if (topLevel) {
        this.setCurrentAimIndex(topLevel.topLevelIndex, dataStore)
      }
    },

    // Click-to-select: focus an aim (set column, phase, mode, and aim)
    async selectAim(columnIndex: number, phaseId: string | undefined, aimIndex: number) {
      const dataStore = useDataStore()

      this.setActiveColumn(columnIndex)

      if (phaseId && columnIndex >= 0) {
        const entries = dataStore.getSelectableColumnEntries(columnIndex)
        const phaseIndex = entries.findIndex((entry) => entry.type === 'phase' && entry.phase.id === phaseId)

        if (phaseIndex !== -1) {
          this.selectedPhaseByColumn[columnIndex] = phaseIndex
          this.selectedPhaseIdByColumn[columnIndex] = phaseId
        }
      }

      this.navigatingAims = true
      this.setCurrentAimIndex(aimIndex, dataStore)
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

    // --- Multi-select for bulk actions (current-week feature: merge aims etc.) ---
    toggleMultiSelect(aimId: string) {
      this.cleanMultiSelect()
      const idx = this.multiSelectedAimIds.indexOf(aimId)
      if (idx >= 0) {
        this.multiSelectedAimIds.splice(idx, 1)
      } else {
        this.multiSelectedAimIds.push(aimId)
        this.multiAnchorId = aimId
      }
    },

    addToMultiSelect(aimId: string) {
      if (!this.multiSelectedAimIds.includes(aimId)) {
        this.multiSelectedAimIds.push(aimId)
      }
    },

    clearMultiSelect() {
      this.multiSelectedAimIds = []
    },

    // Auto-clear stale IDs (e.g. after merge/archive/delete or data reload)
    cleanMultiSelect() {
      const dataStore = useDataStore()
      this.multiSelectedAimIds = this.multiSelectedAimIds.filter(id => id && dataStore.aims[id])
    },

    // Shift-range selection within a provided ordered list of aim IDs (e.g. sibling aims in a list or phase)
    selectMultiRange(targetAimId: string, orderedAimIds: string[]) {
      this.cleanMultiSelect()
      if (!orderedAimIds || orderedAimIds.length === 0) {
        this.toggleMultiSelect(targetAimId)
        this.multiAnchorId = targetAimId
        return
      }
      const anchor = this.multiAnchorId && orderedAimIds.includes(this.multiAnchorId)
        ? this.multiAnchorId
        : (this.multiSelectedAimIds.length > 0 && orderedAimIds.includes(this.multiSelectedAimIds[0]) ? this.multiSelectedAimIds[0] : orderedAimIds[0])

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
      this.multiSelectedAimIds = [...range]
      this.multiAnchorId = anchor
    },

    setMultiAnchor(aimId: string | null) {
      this.multiAnchorId = aimId
    },

    // Merge all currently multi-selected (except the target) into the target aim.
    // Uses the existing backend merge (target keeps identity + connections + reflections; sources archived).
    async mergeSelectedInto(targetId: string) {
      const projectStore = useProjectStore()
      const projectPath = projectStore.projectPath
      if (!projectPath || !targetId) return { success: false, error: 'No project or target' }

      const others = this.multiSelectedAimIds.filter(id => id !== targetId)
      if (others.length === 0) {
        return { success: false, error: 'No other aims selected to merge' }
      }

      const results: any[] = []
      for (const sourceId of others) {
        try {
          const res = await trpc.aim.merge.mutate({ projectPath, targetId, sourceId })
          results.push({ sourceId, ...res })
        } catch (e: any) {
          console.error('merge failed for', sourceId, e)
          results.push({ sourceId, error: String(e) })
        }
      }

      // Clean up selection state
      this.clearMultiSelect()

      return { success: true, results, mergedCount: others.length }
    },

    async calculateAimPaths(aimId: string): Promise<AimPath[]> {
      const projectStore = useProjectStore()
      const dataStore = useDataStore()
      const paths: AimPath[] = []
      const visited = new Set<string>()

      const trace = async (currentId: string, pathAcc: Aim[]) => {
        if (visited.has(currentId)) return
        visited.add(currentId)

        let aim = dataStore.aims[currentId]
        if (!aim) {
          try {
            aim = await trpc.aim.get.query({ projectPath: projectStore.projectPath, aimId: currentId })
            dataStore.replaceAim(aim.id, aim)
          } catch {
            console.error('failed to load aim', currentId)
            return
          }
        }

        const newPath = [aim, ...pathAcc]
        let isRoot = true

        if (aim.committedIn && aim.committedIn.length > 0) {
          isRoot = false
          for (const phaseId of aim.committedIn) {
            paths.push({ phaseId, aims: newPath })
          }
        }

        if (aim.supportedAims && aim.supportedAims.length > 0) {
          isRoot = false
          for (const parentId of aim.supportedAims) {
            await trace(parentId, newPath)
          }
        }

        if (isRoot) {
          paths.push({ phaseId: undefined, aims: newPath })
        }

        visited.delete(currentId)
      }

      await trace(aimId, [])
      return paths
    },

    async prepareNavigation(aimId: string): Promise<AimPath[]> {
      return await this.calculateAimPaths(aimId)
    },

    async executeNavigation(path: AimPath) {
      const projectStore = useProjectStore()
      const dataStore = useDataStore()
      const rootAim = path.aims[0]
      const phaseId = path.phaseId

      if (phaseId) {
        const phasePath: Phase[] = []
        let currentPhase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId })

        while (currentPhase) {
          dataStore.replacePhase(currentPhase.id, currentPhase)
          const storedPhase = dataStore.phases[currentPhase.id]
          if (storedPhase) phasePath.unshift(storedPhase)

          if (currentPhase.parent) {
            currentPhase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: currentPhase.parent })
          } else {
            break
          }
        }

        for (let i = 0; i < phasePath.length; i++) {
          const p = phasePath[i]
          if (!p) continue
          const parentId = p.parent
          await this.loadColumn(i)
          const siblings = dataStore.getSelectableColumnEntries(i)
          const index = siblings.findIndex((entry) => entry.type === 'phase' && entry.phase.id === p.id)
          if (index !== -1) {
            this.setSelection(i, index)
            if (i < phasePath.length - 1) {
              await dataStore.loadPhases(projectStore.projectPath, p.id)
                          }
          }
        }

        this.activeColumn = phasePath.length - 1
        this.setMaxColumn(phasePath.length)
        await dataStore.loadPhaseAims(projectStore.projectPath, phaseId)
      } else {
        this.activeColumn = -1
        await dataStore.loadFloatingAims(projectStore.projectPath)
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
      for (let i = 0; i < path.aims.length - 1; i++) {
        const parentStep = path.aims[i]
        if (!parentStep) continue
        const parent = dataStore.aims[parentStep.id]
        const child = path.aims[i + 1]
        if (!parent || !child) continue

        const parentState = ensureAimUIState(stateTree, parent.id)
        parentState.expanded = true
        if (parent.supportingConnections && parent.supportingConnections.length > 0) {
          await dataStore.loadAims(
            projectStore.projectPath,
            parent.supportingConnections.map((c: any) => c.aimId)
          )
        }

        const childIndex = parent.supportingConnections.findIndex((c: any) => c.aimId === child.id)
        if (childIndex !== -1) {
          parentState.selectedIncomingIndex = childIndex
        }
        stateTree = parentState.children
      }

      this.navigatingAims = true
      this.ensureSelectionVisible()
    },

    async navigateToAim(aimId: string) {
      const paths = await this.prepareNavigation(aimId)
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

    // Universal navigation down (j) - works on selection path
    async navigateDown(dontDescend: boolean = false) {
      const dataStore = useDataStore()
      this.pendingDeleteAimId = null
      logNav('navigateDown:start', {
        dontDescend,
        activeColumn: this.activeColumn,
        navigatingAims: this.navigatingAims
      })

      const col = this.activeColumn
      const path = this.getSelectionPath()

      if (path.aims.length === 0) {
        if (col >= 0) {
          await this.continueAimBoundaryPhaseMove(1)
        }
        return
      }

      if (path.aims.length === 1) {
        if (col === -1) {
          if (this.floatingAimIndex < dataStore.floatingAims.length - 1) {
            this.floatingAimIndex++
          }
        } else if (path.phase) {
          if (path.phase.selectedAimIndex! < path.phase.commitments.length - 1) {
            path.phase.selectedAimIndex!++
          } else if (col >= 0) {
            await this.continueAimBoundaryPhaseMove(1)
          }
        }
      } else {
        let broke = false
        for (let i = path.aims.length - 2; i >= 0; i--) {
          const ancestorAim = path.aims[i]
          const ancestorState = path.aimStates[i]
          if (!ancestorAim || !ancestorState) continue
          const ancestorConnections = ancestorAim.supportingConnections || []
          if (ancestorState.selectedIncomingIndex !== undefined && ancestorState.selectedIncomingIndex < ancestorConnections.length - 1) {
            ancestorState.selectedIncomingIndex++
            broke = true
            break
          }
        }

        if (!broke) {
          if (path.phase) {
            if (path.phase.selectedAimIndex! < path.phase.commitments.length - 1) {
              path.phase.selectedAimIndex!++
            } else if (col >= 0) {
              await this.continueAimBoundaryPhaseMove(1)
            }
          } else if (this.floatingAimIndex < dataStore.floatingAims.length - 1) {
            this.floatingAimIndex++
          }
        }
      }
    },

    // Universal navigation up (k) - works on selection path
    async navigateUp() {
      const dataStore = useDataStore()
      const projectStore = useProjectStore()
      this.pendingDeleteAimId = null
      logNav('navigateUp:start', {
        activeColumn: this.activeColumn,
        navigatingAims: this.navigatingAims
      })

      const path = this.getSelectionPath()
      const col = this.activeColumn

      if (path.aims.length === 0) {
        if (col >= 0) {
          await this.continueAimBoundaryPhaseMove(-1)
        }
        return
      }

      if (!this.navigatingAims) return

      if (path.aims.length === 1) {
        if (col === -1) {
          if (this.floatingAimIndex > 0) {
            this.floatingAimIndex--
            const target = dataStore.floatingAims[this.floatingAimIndex]
            const targetState = target ? ensureAimUIState(this.floatingAimUIStates, target.id) : undefined
            if (target && targetState?.expanded && targetState.selectedIncomingIndex !== undefined) {
              this.goToLastChildAim(target, targetState)
            }
          }
        } else if (col >= 0 && path.phase) {
          if (path.phase.selectedAimIndex !== undefined && path.phase.selectedAimIndex > 0) {
            path.phase.selectedAimIndex--
            const target = dataStore.getAimsForPhase(path.phase.id)[path.phase.selectedAimIndex]
            const targetState = target ? ensureAimUIState(this.getPhaseAimUIStates(path.phase.id), target.id) : undefined
            if (target && targetState?.expanded && targetState.selectedIncomingIndex !== undefined) {
              this.goToLastChildAim(target, targetState)
            }
          } else {
            await this.continueAimBoundaryPhaseMove(-1)
          }
        }
      } else {
        const parentAim = path.aims[path.aims.length - 2]
        const parentState = path.aimStates[path.aimStates.length - 2]
        if (parentAim && parentState) {
          if (parentState.selectedIncomingIndex == 0) {
            parentState.selectedIncomingIndex = undefined
          } else if (parentState.selectedIncomingIndex !== undefined) {
            parentState.selectedIncomingIndex--
            const parentConnections = parentAim.supportingConnections || []
            const targetConn = parentConnections[parentState.selectedIncomingIndex]
            if (targetConn) {
              const target = dataStore.aims[targetConn.aimId]
              const targetState = target ? ensureAimUIState(parentState.children, target.id) : undefined
              if (target && targetState?.expanded && targetState.selectedIncomingIndex !== undefined) {
                this.goToLastChildAim(target, targetState)
              }
            }
          }
        }
      }
    },

    goToLastChildAim(target: Aim, targetState: AimUIState) {
      const dataStore = useDataStore()
      let connections = target.supportingConnections || []
      while (targetState.expanded && connections.length > 0) {
        const lastIdx = connections.length - 1
        targetState.selectedIncomingIndex = lastIdx
        const nextTargetConn = connections[lastIdx]
        if (!nextTargetConn) break
        const nextTarget = dataStore.aims[nextTargetConn.aimId]
        if (!nextTarget) break
        targetState = ensureAimUIState(targetState.children, nextTarget.id)
        target = nextTarget
        connections = target.supportingConnections || []
      }
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
      const modalStore = useUIModalStore()
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

      modalStore.teleportCutAimId = currentAim.id
      modalStore.teleportSource = source
      modalStore.movingAimId = currentAim.id
    },

    copyAimForTeleport() {
      const modalStore = useUIModalStore()
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

      modalStore.teleportCopyAimId = currentAim.id
      modalStore.teleportCopySource = source
    },

    async pasteCutAim(dataStore: any) {
      await pasteCutAimAction(this, dataStore)
    },

    async pasteCopiedAim(dataStore: any) {
      await pasteCopiedAimAction(this, dataStore)
    },

    // Keyboard navigation handlers
    async handleColumnNavigationKeys(event: KeyboardEvent, dataStore: any) {
      await handleColumnNavigationKeysAction(this, event, dataStore)
    },

    // Aims edit mode: j/k = navigate aims, J/K = move aims, h/l = expand/collapse, H = move out, d = delete, o/O = create, x/p = cut/paste, c/p = copy/paste
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
      this.selectedPhaseByColumn = {}
      this.selectedPhaseIdByColumn = {}
      this.lastSelectedSubPhaseIndexByPhase = {}
      this.scrollTopByColumn = {}
      const graphStore = useGraphUIStore()
      graphStore.deselectLink()
      graphStore.clearGraphSelection()
    },
  }
})

export const useUIStore = useListStore
