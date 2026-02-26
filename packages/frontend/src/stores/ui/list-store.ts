import { defineStore } from 'pinia'
import { useDataStore, type Aim, type Phase, type AimCreationParams } from '../data'
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
  pasteCutAimAction
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

    // Scroll Request
    columnScrollRequest: null as { col: number, direction: 'bottom' | 'top' } | null,

    // Remember last selected sub-phase index per parent phase
    lastSelectedSubPhaseIndexByPhase: JSON.parse(localStorage.getItem('aimparency-last-sub-phase-index') || '{}') as Record<string, number>,
  }),
  
  getters: {
    isInProjectSelection: () => useProjectStore().isInProjectSelection,

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

      if (path.aims.length === 0) {
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

      modalStore.showAimModal = false
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
      const dataStore = useDataStore()
      const projectStore = useProjectStore()

      if (isTopLevel) {
        this.setSelectedColumn(columnIndex)
      }

      const parentId = this.columnParentPhaseId[columnIndex] ?? null
      const phases = dataStore.getPhasesByParentId(parentId)
      this.phaseCountByColumn[columnIndex] = phases.length
      const phase = phases[phaseIndex]
      const phaseId = phase?.id

      const oldPhaseId = this.selectedPhaseIdByColumn[columnIndex]
      if (oldPhaseId && oldPhaseId !== phaseId && columnIndex >= 0) {
        const childSelection = this.selectedPhaseByColumn[columnIndex + 1] ?? 0
        this.lastSelectedSubPhaseIndexByPhase[oldPhaseId] = childSelection
      }

      this.selectedPhaseByColumn[columnIndex] = phaseIndex
      if (phaseId) {
        this.selectedPhaseIdByColumn[columnIndex] = phaseId
      } else {
        delete this.selectedPhaseIdByColumn[columnIndex]
      }

      if (!phaseId) {
        this.setRightmostColumn(columnIndex)
        return
      }

      const rememberedIndex = this.lastSelectedSubPhaseIndexByPhase[phaseId] ?? 0
      const children = await dataStore.loadPhases(projectStore.projectPath, phaseId)
      this.phaseCountByColumn[columnIndex + 1] = children.length

      if (children.length > 0) {
        const childIndex = Math.min(rememberedIndex, children.length - 1)

        this.columnParentPhaseId[columnIndex + 1] = phaseId
        this.selectedPhaseByColumn[columnIndex + 1] = childIndex
        const child = children[childIndex]
        if (child) {
          this.selectedPhaseIdByColumn[columnIndex + 1] = child.id
        }
        this.setMinRightmost(columnIndex + 1)

        await this.selectPhase(columnIndex + 1, childIndex, false)
      } else {
        this.columnParentPhaseId[columnIndex + 1] = phaseId
        this.setRightmostColumn(columnIndex + 1)
      }
    },

    // Set selection without loading (j/k navigation)
    setSelection(columnIndex: number, phaseIndex: number) {
      const dataStore = useDataStore()
      const parentId = this.columnParentPhaseId[columnIndex] ?? null
      const phases = dataStore.getPhasesByParentId(parentId)
      const phase = phases[phaseIndex]

      this.selectedPhaseByColumn[columnIndex] = phaseIndex
      if (phase) {
        this.selectedPhaseIdByColumn[columnIndex] = phase.id
      } else {
        delete this.selectedPhaseIdByColumn[columnIndex]
      }

      if (columnIndex > 0) {
        const parentColumn = columnIndex - 1
        const parentPhaseId = this.selectedPhaseIdByColumn[parentColumn]
        if (parentPhaseId) {
          this.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = phaseIndex
        }
      }
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
        const parentId = this.columnParentPhaseId[columnIndex] ?? null
        const phases = dataStore.getPhasesByParentId(parentId)
        const phaseIndex = phases.findIndex((p: any) => p.id === phaseId)
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
        const parentId = this.columnParentPhaseId[columnIndex] ?? null
        const phases = dataStore.getPhasesByParentId(parentId)
        const phaseIndex = phases.findIndex((p: any) => p.id === phaseId)

        if (phaseIndex !== -1) {
          this.selectedPhaseByColumn[columnIndex] = phaseIndex
          this.selectedPhaseIdByColumn[columnIndex] = phaseId
        }
      }

      this.navigatingAims = true
      this.setCurrentAimIndex(aimIndex, dataStore)
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
          await dataStore.loadPhases(projectStore.projectPath, parentId)
          const siblings = dataStore.getPhasesByParentId(parentId)
          const index = siblings.findIndex((x: any) => x && x.id === p.id)
          if (index !== -1) {
            this.setSelection(i, index)
            if (i < phasePath.length - 1) {
              await dataStore.loadPhases(projectStore.projectPath, p.id)
              this.columnParentPhaseId[i + 1] = p.id
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

      const col = this.selectedColumn
      const path = this.getSelectionPath()

      if (path.aims.length === 0) {
        if (path.phase && col >= 0) {
          const currentPhaseIndex = this.getSelectedPhase(col)
          const phaseCount = this.getPhaseCount(col)
          if (currentPhaseIndex < phaseCount - 1) {
            await this.selectPhase(col, currentPhaseIndex + 1)
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
            const currentPhaseIndex = this.getSelectedPhase(col)
            const phaseCount = this.getPhaseCount(col)
            if (currentPhaseIndex < phaseCount - 1) {
              await this.selectPhase(col, currentPhaseIndex + 1)
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
              const currentPhaseIndex = this.getSelectedPhase(col)
              const phaseCount = this.getPhaseCount(col)
              if (currentPhaseIndex < phaseCount - 1) {
                await this.selectPhase(col, currentPhaseIndex + 1)
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

      const path = this.getSelectionPath()
      const col = this.selectedColumn

      if (path.aims.length === 0) {
        if (path.phase && col >= 0) {
          const currentPhaseIndex = this.getSelectedPhase(col)
          if (currentPhaseIndex > 0) {
            await this.selectPhase(col, currentPhaseIndex - 1)
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
            const currentPhaseIndex = this.getSelectedPhase(col)
            if (currentPhaseIndex > 0) {
              await this.selectPhase(col, currentPhaseIndex - 1)
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

export const useUIStore = useListStore
