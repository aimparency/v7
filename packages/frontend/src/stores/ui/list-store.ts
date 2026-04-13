import { defineStore } from 'pinia'
import { useDataStore, type Aim, type Phase, type AimCreationParams, type PhaseLevelPhaseEntry, type PhaseLevelPlaceholderEntry } from '../data'
import { AIM_DEFAULTS } from '../../constants/aimDefaults'
import {
  setViewportSize as setViewportSizeHelper,
} from './view-helpers'
import {
  getSelectionPathFromState,
  setCurrentAimIndexInState,
  findPathToAim as findPathToAimHelper,
  type SelectionPath
} from './navigation-helpers'
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

type TeleportSource = {
  parentAimId?: string
  phaseId?: string
}

export type AimPath = {
  phaseId?: string
  aims: Aim[]
}

function logNav(event: string, details: Record<string, unknown> = {}) {
  console.log(`[PhaseNav] ${event}`, details)
}

type PhaseMoveDirection = 'forward' | 'backward' | 'preserve'

export const useListStore = defineStore('ui', {
  state: () => ({
    // Navigation mode system
    navigatingAims: false, 
    
    // Column tracking for navigation
    rightmostColumnIndex: 0, // Track the rightmost (empty) column index
    selectedColumn: parseInt(localStorage.getItem('aimparency-selected-column') || '0'), // Currently selected column (visual selection)

    // Phase selection by column
    selectedPhaseByColumn: JSON.parse(localStorage.getItem('aimparency-selected-phases') || '{}') as Record<number, number>, // columnIndex -> phaseIndex
    selectedPhaseIdByColumn: JSON.parse(localStorage.getItem('aimparency-selected-phase-ids') || '{}') as Record<number, string>, // columnIndex -> phaseId

    // Root aims selection (for column -1)
    floatingAimIndex: parseInt(localStorage.getItem('aimparency-floating-index') || '0'),

    // Viewport for column scrolling
    viewportStart: parseInt(localStorage.getItem('aimparency-viewport-start') || '-1'), // Left edge of visible window
    viewportSize: parseInt(localStorage.getItem('aimparency-viewport-size') || '3'), // Number of columns visible at once

    // Delete pending states
    pendingDeletePhaseId: null as string | null,
    pendingDeleteAimId: null as string | null,

    // Scroll Request
    columnScrollRequest: null as { col: number, direction: 'bottom' | 'top' } | null,

    // Remember last selected sub-phase index per parent phase
    lastSelectedSubPhaseIndexByPhase: JSON.parse(localStorage.getItem('aimparency-last-sub-phase-index') || '{}') as Record<string, number>,

    // Debounced shared cursor persistence to project meta
    phaseCursorPersistTimeout: null as ReturnType<typeof setTimeout> | null,
  }),
  
  getters: {
    isInProjectSelection: () => useProjectStore().isInProjectSelection,

    // Reactive phase selection getters
    getSelectedPhase: (state) => (columnIndex: number): number => {
      const dataStore = useDataStore()
      const liveCount = dataStore.getSelectablePhaseLevelEntries(columnIndex).length
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

    getPhaseCount: (state) => (columnIndex: number): number => {
      const dataStore = useDataStore()
      return dataStore.getSelectablePhaseLevelEntries(columnIndex).length
    },
    graphSelectedAimId: () => useGraphUIStore().graphSelectedAimId,
    currentView: () => useProjectStore().currentView,
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

      useProjectStore().setCurrentView(view)
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
    
    clearTeleportBuffer() {
      useUIModalStore().clearTeleportBuffer()
    },

    // Create aim and update selection
    async createAim(aimTextOrId: string, isExistingAim: boolean = false, description?: string, tags?: string[], intrinsicValue: number = AIM_DEFAULTS.intrinsicValue, loopWeight: number = AIM_DEFAULTS.loopWeight, cost: number = AIM_DEFAULTS.cost, weight: number = 1, supportedAims: string[] = [], supportingConnections: { aimId: string, weight?: number, relativePosition?: [number, number] }[] = []) {
      const dataStore = useDataStore()
      const modalStore = useUIModalStore()
      const projectStore = useProjectStore()

      const aimAttributes: AimCreationParams = {
        text: aimTextOrId,
        description,
        tags: tags || [],
        reflections: [],
        status: { state: 'open' as const, comment: '', date: Date.now() },
        supportingConnections,
        supportedAims,
        intrinsicValue: intrinsicValue ?? 0,
        loopWeight,
        cost,
        duration: 1,
        costVariance: 0,
        valueVariance: 0,
        archived: false
      }

      const path = this.getSelectionPath()
      let newAimId: string | undefined
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
        if (!currentAim) {
          modalStore.showAimModal = false
          return
        }

        if (currentAim.expanded && modalStore.aimModalInsertPosition === 'after') {
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

          const freshParent = dataStore.aims[currentAim.id]
          if (freshParent) {
            freshParent.selectedIncomingIndex = 0
          }
        } else if (path.aims.length > 1) {
          const parentAim = path.aims[path.aims.length - 2]
          if (parentAim) {
            let insertionIndex = parentAim.selectedIncomingIndex ?? 0
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

            const freshParent = dataStore.aims[parentAim.id]
            if (freshParent) {
              freshParent.selectedIncomingIndex = insertionIndex
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

      if (newAimId) {
        if (modalStore.aimCreationCallback) {
          modalStore.aimCreationCallback(newAimId)
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
        projectStore.currentView === 'graph'

      modalStore.closeAimModal()

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
    setRightmostColumn(columnIndex: number) {
      this.rightmostColumnIndex = columnIndex
    },

    setMinRightmost(columnIndex: number) {
      this.rightmostColumnIndex = Math.max(this.rightmostColumnIndex, columnIndex)
    },

    setFocusedColumn(columnIndex: number) {
      logNav('setFocusedColumn', {
        from: this.selectedColumn,
        to: columnIndex
      })
      this.selectedColumn = columnIndex
    },

    setSelectedColumn(columnIndex: number) {
      logNav('setSelectedColumn', {
        from: this.selectedColumn,
        to: columnIndex,
        navigatingAims: this.navigatingAims
      })
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

    getPhaseCursorSnapshot() {
      const phaseCursors: Record<string, number> = {}
      for (let level = 0; level <= this.rightmostColumnIndex; level++) {
        const index = this.selectedPhaseByColumn[level]
        if (index !== undefined) {
          phaseCursors[String(level)] = index
        }
      }

      return {
        phaseCursors,
        phaseActiveLevel: Math.max(0, this.selectedColumn)
      }
    },

    async persistPhaseCursorState() {
      const dataStore = useDataStore()
      const projectStore = useProjectStore()

      if (!projectStore.projectPath || !dataStore.meta) {
        return
      }

      const { phaseCursors, phaseActiveLevel } = this.getPhaseCursorSnapshot()
      const nextMeta = {
        ...dataStore.meta,
        phaseCursors,
        phaseActiveLevel
      }

      const currentCursors = JSON.stringify(dataStore.meta.phaseCursors || {})
      const nextCursors = JSON.stringify(phaseCursors)
      if (currentCursors === nextCursors && dataStore.meta.phaseActiveLevel === phaseActiveLevel) {
        return
      }

      logNav('persistPhaseCursorState', {
        phaseCursors,
        phaseActiveLevel
      })
      await dataStore.updateProjectMeta(projectStore.projectPath, nextMeta)
    },

    schedulePhaseCursorPersist() {
      if (this.phaseCursorPersistTimeout) {
        clearTimeout(this.phaseCursorPersistTimeout)
      }

      this.phaseCursorPersistTimeout = setTimeout(() => {
        this.phaseCursorPersistTimeout = null
        void this.persistPhaseCursorState()
      }, 150)
    },

    async restorePhaseCursorsFromMeta(phaseCursors?: Record<string, number>, phaseActiveLevel?: number) {
      const dataStore = useDataStore()
      logNav('restorePhaseCursorsFromMeta:start', {
        phaseCursors,
        phaseActiveLevel
      })

      const visibleRightmost = this.getVisibleRightmostPhaseColumn()
      await this.ensurePhaseLevelsLoaded(visibleRightmost)
      const rootEntries = dataStore.getSelectablePhaseLevelEntries(0)
      if (rootEntries.length === 0) {
        this.setRightmostColumn(0)
        this.setSelectedColumn(0)
        return
      }

      let deepestRestoredLevel = 0

      for (let level = 0; level <= visibleRightmost; level++) {
        const entries = dataStore.getSelectablePhaseLevelEntries(level)
        if (entries.length === 0) {
          break
        }

        const requestedIndex = phaseCursors?.[String(level)] ?? 0
        const clampedIndex = Math.max(0, Math.min(requestedIndex, entries.length - 1))
        this.selectedPhaseByColumn[level] = clampedIndex
        deepestRestoredLevel = level
      }

      const targetLevel = phaseActiveLevel ?? deepestRestoredLevel
      this.setSelectedColumn(Math.max(0, Math.min(targetLevel, visibleRightmost)))
      await this.reconcilePhaseSelection(this.selectedColumn, 'preserve')
      logNav('restorePhaseCursorsFromMeta:done', {
        selectedColumn: this.selectedColumn,
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn },
        rightmostColumnIndex: this.rightmostColumnIndex
      })
    },

    async loadPhaseLevel(columnIndex: number) {
      const dataStore = useDataStore()
      const projectStore = useProjectStore()
      logNav('loadPhaseLevel:start', {
        columnIndex,
        projectPath: projectStore.projectPath
      })

      if (columnIndex < 0) {
        return
      }

      if (columnIndex === 0) {
        await dataStore.loadPhases(projectStore.projectPath, null)
      } else {
        const parentLevelPhases = dataStore.getActualPhasesForLevel(columnIndex - 1)
        await Promise.all(parentLevelPhases.map((phase) => dataStore.loadPhases(projectStore.projectPath, phase.id)))
      }

      logNav('loadPhaseLevel', {
        columnIndex,
        phaseCount: dataStore.getSelectablePhaseLevelEntries(columnIndex).length,
        selectedPhaseId: this.selectedPhaseIdByColumn[columnIndex]
      })
    },

    getVisibleRightmostPhaseColumn() {
      return Math.max(0, this.viewportStart + this.viewportSize - 1)
    },

    getSelectableEntries(columnIndex: number): Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry> {
      const dataStore = useDataStore()
      return dataStore.getSelectablePhaseLevelEntries(columnIndex)
    },

    getSelectedPhaseEntry(columnIndex: number): PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry | undefined {
      const entries = this.getSelectableEntries(columnIndex)
      return entries[this.getSelectedPhase(columnIndex)]
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

      return entry
    },

    async ensurePhaseLevelsLoaded(maxLevel: number) {
      for (let level = 0; level <= maxLevel; level++) {
        await this.loadPhaseLevel(level)
      }
    },

    repairSelectionLeft(fromLevel: number) {
      let currentParentId = this.getSelectedPhaseEntry(fromLevel)?.parentPhaseId ?? null
      for (let level = fromLevel - 1; level >= 0 && currentParentId; level--) {
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
      const maxVisibleLevel = this.getVisibleRightmostPhaseColumn()
      let lastVisibleLevel = Math.max(0, Math.min(fromLevel, maxVisibleLevel))

      for (let level = fromLevel + 1; level <= maxVisibleLevel; level++) {
        const parentPhaseId = this.selectedPhaseIdByColumn[level - 1]
        if (!parentPhaseId) {
          break
        }

        await this.loadPhaseLevel(level)
        const ownedEntries = this.getOwnedEntries(level, parentPhaseId)
        if (ownedEntries.length === 0) {
          break
        }

        const targetEntry = this.chooseOwnedEntry(
          ownedEntries,
          this.getSelectedPhaseEntry(level),
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

      this.rightmostColumnIndex = lastVisibleLevel
    },

    async reconcilePhaseSelection(fromLevel: number, direction: PhaseMoveDirection = 'preserve') {
      this.repairSelectionLeft(fromLevel)
      await this.repairSelectionRight(fromLevel, direction)
      this.rightmostColumnIndex = Math.max(fromLevel, this.rightmostColumnIndex)
      logNav('reconcilePhaseSelection', {
        fromLevel,
        direction,
        selectedColumn: this.selectedColumn,
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn },
        rightmostColumnIndex: this.rightmostColumnIndex
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
        selectedColumn: this.selectedColumn,
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn }
      })

      this.setSelectedColumn(columnIndex)
      if (!alreadyLoaded) {
        await this.loadPhaseLevel(columnIndex)
      }
      const selectedEntry = this.applyPhaseSelection(columnIndex, phaseIndex)
      if (!selectedEntry) {
        this.setRightmostColumn(columnIndex)
        return
      }

      await this.reconcilePhaseSelection(columnIndex, direction)
      logNav('selectPhase:done', {
        columnIndex,
        selectedColumn: this.selectedColumn,
        selectedPhaseByColumn: { ...this.selectedPhaseByColumn },
        selectedPhaseIdByColumn: { ...this.selectedPhaseIdByColumn },
        rightmostColumnIndex: this.rightmostColumnIndex
      })
    },

    async moveActivePhase(delta: number) {
      const columnIndex = this.selectedColumn
      if (columnIndex < 0) {
        return false
      }

      const direction: PhaseMoveDirection = delta < 0 ? 'backward' : 'forward'
      await this.loadPhaseLevel(columnIndex)
      const entries = this.getSelectableEntries(columnIndex)
      if (entries.length === 0) {
        return false
      }

      const currentIndex = this.getSelectedPhase(columnIndex)
      const nextIndex = currentIndex + delta
      if (nextIndex < 0 || nextIndex >= entries.length) {
        return false
      }

      await this.selectPhase(columnIndex, nextIndex, direction, true)
      return true
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
      const isAlreadySelected = currentAim?.id === aimId && this.selectedColumn === columnIndex

      if (isAlreadySelected) {
        const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
        const aimIndex = aims.findIndex((a: any) => a && a.id === aimId)
        if (aimIndex !== -1) {
          modalStore.showAimModal = true
          modalStore.aimModalMode = 'edit'
        }
        return
      }

      const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims

      Object.values(dataStore.aims).forEach((aim: any) => {
        aim.selectedIncomingIndex = undefined
      })

      const topLevelIndex = aims.findIndex((a: any) => a && a.id === aimId)

      if (topLevelIndex >= 0) {
        await this.selectAim(columnIndex, phaseId, topLevelIndex)
        return
      }

      const path = findPathToAimHelper(aimId, aims, dataStore)
      if (!path || path.length === 0) return

      for (let i = 0; i < path.length - 1; i++) {
        const step = path[i]
        if (!step) continue
        const parentAim = dataStore.aims[step.aimId]
        const nextStep = path[i + 1]
        if (parentAim && nextStep && nextStep.indexInParent !== undefined) {
          parentAim.selectedIncomingIndex = nextStep.indexInParent
        }
      }

      const topLevel = path[0]
      this.setSelectedColumn(columnIndex)

      if (phaseId && columnIndex >= 0) {
        const entries = dataStore.getSelectablePhaseLevelEntries(columnIndex)
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

      this.setSelectedColumn(columnIndex)

      if (phaseId && columnIndex >= 0) {
        const entries = dataStore.getSelectablePhaseLevelEntries(columnIndex)
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
          await this.loadPhaseLevel(i)
          const siblings = dataStore.getSelectablePhaseLevelEntries(i)
          const index = siblings.findIndex((entry) => entry.type === 'phase' && entry.phase.id === p.id)
          if (index !== -1) {
            this.setSelection(i, index)
            if (i < phasePath.length - 1) {
              await dataStore.loadPhases(projectStore.projectPath, p.id)
                          }
          }
        }

        this.selectedColumn = phasePath.length - 1
        this.setRightmostColumn(phasePath.length)
        await dataStore.loadPhaseAims(projectStore.projectPath, phaseId)
      } else {
        this.selectedColumn = -1
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

      for (let i = 0; i < path.aims.length - 1; i++) {
        const parentStep = path.aims[i]
        if (!parentStep) continue
        const parent = dataStore.aims[parentStep.id]
        const child = path.aims[i + 1]
        if (!parent || !child) continue

        parent.expanded = true
        if (parent.supportingConnections && parent.supportingConnections.length > 0) {
          await dataStore.loadAims(
            projectStore.projectPath,
            parent.supportingConnections.map((c: any) => c.aimId)
          )
        }

        const childIndex = parent.supportingConnections.findIndex((c: any) => c.aimId === child.id)
        if (childIndex !== -1) {
          parent.selectedIncomingIndex = childIndex
        }
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
        selectedColumn: this.selectedColumn,
        navigatingAims: this.navigatingAims
      })

      const col = this.selectedColumn
      const path = this.getSelectionPath()

      if (path.aims.length === 0) {
        if (path.phase && col >= 0) {
          if (await this.moveActivePhase(1)) {
            const newPhaseId = this.getSelectedPhaseId(col)
            if (newPhaseId) {
              const newPhase = dataStore.phases[newPhaseId]
              if (newPhase) {
                newPhase.selectedAimIndex = 0
              }
            }
          }
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
            if (await this.moveActivePhase(1)) {
              const newPhaseId = this.getSelectedPhaseId(col)
              if (newPhaseId) {
                const newPhase = dataStore.phases[newPhaseId]
                if (newPhase && newPhase.commitments.length > 0) {
                  newPhase.selectedAimIndex = 0
                }
              }
            }
          }
        }
      } else {
        let broke = false
        for (let i = path.aims.length - 2; i >= 0; i--) {
          const ancestorAim = path.aims[i]
          if (!ancestorAim) continue
          const ancestorConnections = ancestorAim.supportingConnections || []
          if (ancestorAim.selectedIncomingIndex !== undefined && ancestorAim.selectedIncomingIndex < ancestorConnections.length - 1) {
            ancestorAim.selectedIncomingIndex++
            broke = true
            break
          }
        }

        if (!broke) {
          if (path.phase) {
            if (path.phase.selectedAimIndex! < path.phase.commitments.length - 1) {
              path.phase.selectedAimIndex!++
            } else if (col >= 0) {
              if (await this.moveActivePhase(1)) {
                const newPhaseId = this.getSelectedPhaseId(col)
                if (newPhaseId) {
                  const newPhase = dataStore.phases[newPhaseId]
                  if (newPhase && newPhase.commitments.length > 0) {
                    newPhase.selectedAimIndex = 0
                  }
                }
              }
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
      this.pendingDeleteAimId = null
      logNav('navigateUp:start', {
        selectedColumn: this.selectedColumn,
        navigatingAims: this.navigatingAims
      })

      const path = this.getSelectionPath()
      const col = this.selectedColumn

      if (path.aims.length === 0) {
        if (path.phase && col >= 0) {
          if (await this.moveActivePhase(-1)) {
            const newPhaseId = this.getSelectedPhaseId(col)
            if (newPhaseId) {
              const newPhase = dataStore.phases[newPhaseId]
              if (newPhase && newPhase.commitments.length > 0) {
                newPhase.selectedAimIndex = newPhase.commitments.length - 1
              }
            }
          }
        }
        return
      }

      if (!this.navigatingAims) return

      if (path.aims.length === 1) {
        if (col === -1) {
          if (this.floatingAimIndex > 0) {
            this.floatingAimIndex--
            const target = dataStore.floatingAims[this.floatingAimIndex]
            if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
              this.goToLastChildAim(target)
            }
          }
        } else if (col >= 0 && path.phase) {
          if (path.phase.selectedAimIndex !== undefined && path.phase.selectedAimIndex > 0) {
            path.phase.selectedAimIndex--
            const target = dataStore.getAimsForPhase(path.phase.id)[path.phase.selectedAimIndex]
            if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
              this.goToLastChildAim(target)
            }
          } else {
            if (await this.moveActivePhase(-1)) {
              const newPhaseId = this.getSelectedPhaseId(col)
              if (newPhaseId) {
                const newPhase = dataStore.phases[newPhaseId]
                if (newPhase && newPhase.commitments.length > 0) {
                  newPhase.selectedAimIndex = newPhase.commitments.length - 1
                  const aims = dataStore.getAimsForPhase(newPhaseId)
                  const target = aims[newPhase.selectedAimIndex]
                  if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
                    this.goToLastChildAim(target)
                  }
                }
              }
            }
          }
        }
      } else {
        const parentAim = path.aims[path.aims.length - 2]
        if (parentAim) {
          if (parentAim.selectedIncomingIndex == 0) {
            parentAim.selectedIncomingIndex = undefined
          } else if (parentAim.selectedIncomingIndex !== undefined) {
            parentAim.selectedIncomingIndex--
            const parentConnections = parentAim.supportingConnections || []
            const targetConn = parentConnections[parentAim.selectedIncomingIndex]
            if (targetConn) {
              const target = dataStore.aims[targetConn.aimId]
              if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
                this.goToLastChildAim(target)
              }
            }
          }
        }
      }
    },

    goToLastChildAim(target: Aim) {
      const dataStore = useDataStore()
      let connections = target.supportingConnections || []
      while (target.expanded && connections.length > 0) {
        const lastIdx = connections.length - 1
        target.selectedIncomingIndex = lastIdx
        const nextTargetConn = connections[lastIdx]
        if (!nextTargetConn) break
        const nextTarget = dataStore.aims[nextTargetConn.aimId]
        if (!nextTarget) break
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
      this.selectedColumn = 0
      this.viewportStart = 0
      this.viewportSize = 2
      this.rightmostColumnIndex = 0
      this.floatingAimIndex = -1
      this.navigatingAims = false
      if (this.phaseCursorPersistTimeout) {
        clearTimeout(this.phaseCursorPersistTimeout)
        this.phaseCursorPersistTimeout = null
      }
      const graphStore = useGraphUIStore()
      graphStore.deselectLink()
      graphStore.clearGraphSelection()
      localStorage.setItem('aimparency-selected-column', '0')
    },
  }
})

export const useUIStore = useListStore
