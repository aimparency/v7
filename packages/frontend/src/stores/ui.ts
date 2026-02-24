import { defineStore } from 'pinia'
import type { Hint } from 'shared'
import { timestampToLocalDate, timestampToLocalTime, AIMPARENCY_DIR_NAME } from 'shared'
import { trpc } from '../trpc'
import { useDataStore, type Aim, type Phase, type AimCreationParams } from './data'
import { AIM_DEFAULTS } from '../constants/aimDefaults'

type RelativePosition = 'before' | 'after' 
type SelectionPath = {
  phase: Phase | undefined
  aims: Aim[]
}

type TeleportSource = {
  parentAimId?: string
  phaseId?: string
}

export type AimPath = {
  phaseId?: string
  aims: Aim[] // Root to Leaf
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
    projectHistory: JSON.parse(localStorage.getItem('aimparency-project-history') || '[]') as Array<{
      path: string
      lastOpened: number
      failedToLoad: boolean
    }>,

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

    // Selected Link (Flow)
    selectedLink: null as { parentId: string, childId: string } | null,

    // Scroll Request
    columnScrollRequest: null as { col: number, direction: 'bottom' | 'top' } | null,

    // Graph specific selection
    graphSelectedAimId: null as string | null,
    graphColorMode: (localStorage.getItem('aimparency-graph-color-mode') || 'status') as 'status' | 'priority',
    graphPanelWidth: parseInt(localStorage.getItem('aimparency-graph-panel-width') || '300'),
    graphShowLabels: localStorage.getItem('aimparency-graph-show-labels') !== 'false',

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
      const suffix = '/' + AIMPARENCY_DIR_NAME;
      const cleanPath = path.endsWith(suffix) ? path.slice(0, -suffix.length) : (path.endsWith(AIMPARENCY_DIR_NAME) ? path.slice(0, -AIMPARENCY_DIR_NAME.length) : path);
      
      this.projectPath = cleanPath
      if (cleanPath) {
        localStorage.setItem('aimparency-project-path', cleanPath)
      } else {
        localStorage.removeItem('aimparency-project-path')
      }
    },

    addProjectToHistory(path: string) {
      const suffix = '/' + AIMPARENCY_DIR_NAME;
      const cleanPath = path.endsWith(suffix) ? path.slice(0, -suffix.length) : (path.endsWith(AIMPARENCY_DIR_NAME) ? path.slice(0, -AIMPARENCY_DIR_NAME.length) : path);
      
      // Remove existing occurrences of this path
      this.projectHistory = this.projectHistory.filter(p => p.path !== cleanPath)

      // Add to top
      this.projectHistory.unshift({
        path: cleanPath,
        lastOpened: Date.now(),
        failedToLoad: false
      })

      // Limit to 30 entries
      this.projectHistory = this.projectHistory.slice(0, 30)

      // Save to localStorage
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    removeProjectFromHistory(path: string) {
      const suffix = '/' + AIMPARENCY_DIR_NAME;
      const cleanPath = path.endsWith(suffix) ? path.slice(0, -suffix.length) : (path.endsWith(AIMPARENCY_DIR_NAME) ? path.slice(0, -AIMPARENCY_DIR_NAME.length) : path);
      
      this.projectHistory = this.projectHistory.filter(p => p.path !== cleanPath)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    markProjectAsFailed(path: string) {
      const suffix = '/' + AIMPARENCY_DIR_NAME;
      const cleanPath = path.endsWith(suffix) ? path.slice(0, -suffix.length) : (path.endsWith(AIMPARENCY_DIR_NAME) ? path.slice(0, -AIMPARENCY_DIR_NAME.length) : path);
      
      const project = this.projectHistory.find(p => p.path === cleanPath)
      if (project) {
        project.failedToLoad = true
        localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
      }
    },

    clearProjectFailure(path: string) {
      const suffix = '/' + AIMPARENCY_DIR_NAME;
      const cleanPath = path.endsWith(suffix) ? path.slice(0, -suffix.length) : (path.endsWith(AIMPARENCY_DIR_NAME) ? path.slice(0, -AIMPARENCY_DIR_NAME.length) : path);
      
      const project = this.projectHistory.find(p => p.path === cleanPath)
      if (project) {
        project.failedToLoad = false
        localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
      }
    },
    
    setConnectionStatus(status: typeof this.connectionStatus) {
      this.connectionStatus = status
    },

    setViewportSize(size: number) {
      const newSize = Math.max(1, Math.min(size, 10))
      this.viewportSize = newSize
      localStorage.setItem('aimparency-viewport-size', newSize.toString())
      this.ensureSelectionVisible()
    },

    setView(view: 'columns' | 'graph' | 'voice') {
      if (view === 'graph') {
        // Sync List -> Graph
        const current = this.getCurrentAim()
        this.graphSelectedAimId = current ? current.id : null
      } else if (view === 'columns') {
        // Sync Graph -> List
        if (this.graphSelectedAimId) {
          this.navigateToAim(this.graphSelectedAimId)
        }
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
      this.showPhaseModal = true
      this.phaseModalMode = 'create'
      this.phaseModalEditingPhaseId = null
      this.phaseModalEditingParentId = null
      this.newPhaseName = ''
      // Date calculation will be handled by PhaseCreationModal component
    },

    openPhaseEditModal(phaseId: string, phaseName: string, phaseFrom: number, phaseTo: number, parentPhaseId: string | null, columnIndex: number = 0) {
      this.showPhaseModal = true
      this.phaseModalMode = 'edit'
      this.phaseModalEditingPhaseId = phaseId
      this.phaseModalEditingParentId = parentPhaseId
      this.newPhaseName = phaseName

      // Extract local date and time from timestamps
      this.newPhaseStartDate = timestampToLocalDate(phaseFrom)
      this.newPhaseStartTime = timestampToLocalTime(phaseFrom)
      this.newPhaseEndDate = timestampToLocalDate(phaseTo)
      this.newPhaseEndTime = timestampToLocalTime(phaseTo)

    },

    closePhaseModal() {
      this.showPhaseModal = false
      this.phaseModalMode = 'create'
      this.phaseModalEditingPhaseId = null
      this.phaseModalEditingParentId = null
      this.newPhaseName = ''
      this.newPhaseStartDate = ''
      this.newPhaseStartTime = ''
      this.newPhaseEndDate = ''
      this.newPhaseEndTime = ''
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
      this.showAimModal = false
      this.aimModalMode = 'create'
      this.aimModalEditingAimId = null
    },
    
    // Aim creation/editing actions
    openAimModal(phaseId?: string, insertionIndex: number = 0) {
      this.showAimModal = true
      this.aimModalMode = 'create'
    },

    openAimSearch(mode: 'navigate' | 'pick' = 'navigate', callback?: (aim: Aim) => void, initialAimId?: string) {
      this.showAimSearch = true
      this.aimSearchMode = mode
      this.aimSearchCallback = callback || null
      this.aimSearchInitialAimId = initialAimId || null
    },

    closeAimSearch() {
      this.showAimSearch = false
      this.aimSearchMode = 'navigate'
      this.aimSearchCallback = null
      this.aimSearchInitialAimId = null
    },

    clearTeleportBuffer() {
      this.teleportCutAimId = null
      this.teleportSource = null
      this.movingAimId = null
    },

    openSettingsModal() {
      this.showSettingsModal = true
    },

    closeSettingsModal() {
      this.showSettingsModal = false
    },

    // Create aim and update selection
    async createAim(aimTextOrId: string, isExistingAim: boolean = false, description?: string, tags?: string[], intrinsicValue: number = AIM_DEFAULTS.intrinsicValue, loopWeight: number = AIM_DEFAULTS.loopWeight, cost: number = AIM_DEFAULTS.cost, weight: number = 1, supportedAims: string[] = [], supportingConnections: { aimId: string, weight?: number, relativePosition?: [number, number] }[] = []) {
      const dataStore = useDataStore()

      const path = this.getSelectionPath()

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

      let newAimId: string | undefined

      if(path.aims.length == 0){
        if(path.phase) {
          console.log(isExistingAim ? 'link existing aim to phase' : 'create first top-level aim in phase', path.phase)
          if (isExistingAim) {
            await trpc.aim.commitToPhase.mutate({
              projectPath: this.projectPath,
              aimId: aimTextOrId,
              phaseId: path.phase.id,
              insertionIndex: 0
            })
            newAimId = aimTextOrId
          } else {
            const result = await dataStore.createCommittedAim(this.projectPath, path.phase.id, aimAttributes, 0)
            newAimId = result.id
          }

          // Update local state
          await dataStore.loadPhaseAims(this.projectPath, path.phase.id)
        } else {
          if (isExistingAim) {
            // If there's a callback (e.g., from graph view drag), allow it - callback will handle connection
            if (this.aimCreationCallback) {
              console.log('Existing aim selected with callback - callback will handle connection')
              newAimId = aimTextOrId
            } else {
              console.warn('Cannot link existing aim as floating aim - ignoring')
              this.showAimModal = false
              return
            }
          } else {
            console.log('create floating aim', aimAttributes)
            const result = await dataStore.createFloatingAim(this.projectPath, aimAttributes)
            newAimId = result.id
          }
        }
      } else if (path.aims.length > 0) {
        const currentAim = path.aims[path.aims.length - 1]
        if(currentAim) {
          if(currentAim.expanded && this.aimModalInsertPosition == 'after') {
            console.log(isExistingAim ? 'link existing aim as first sub-aim' : 'create first sub-aim of expanded aim', currentAim)

            if (isExistingAim) {
              await trpc.aim.connectAims.mutate({
                projectPath: this.projectPath,
                parentAimId: currentAim.id,
                childAimId: aimTextOrId,
                parentIncomingIndex: 0,
                weight
              })
              newAimId = aimTextOrId
              
              // We need to reload parent manually here because connectAims doesn't do it via dataStore action
              const updatedParent = await trpc.aim.get.query({
                projectPath: this.projectPath,
                aimId: currentAim.id
              })
              dataStore.replaceAim(currentAim.id, updatedParent)
            } else {
              const result = await dataStore.createSubAim(this.projectPath, currentAim.id, aimAttributes, 0, weight)
              newAimId = result.id
            }

            // Update selection on the FRESH object in store
            const freshParent = dataStore.aims[currentAim.id]
            if (freshParent) {
              freshParent.selectedIncomingIndex = 0
            }
          } else {
            // distinguish 3 cases: free floating, phase top-level, sub-aim
            if(path.aims.length > 1) {
              console.log(isExistingAim ? 'link existing aim as sub-aim' : 'create sub-aim of aim', currentAim)

              const parentAim = path.aims[path.aims.length - 2]
              if (parentAim) {
                let insertionIndex = parentAim.selectedIncomingIndex ?? 0
                if(this.aimModalInsertPosition === 'after') {
                    insertionIndex ++
                }

                if (isExistingAim) {
                    await trpc.aim.connectAims.mutate({
                    projectPath: this.projectPath,
                    parentAimId: parentAim.id,
                    childAimId: aimTextOrId,
                    parentIncomingIndex: insertionIndex,
                    weight
                    })
                    newAimId = aimTextOrId

                    // Manually reload parent
                    const updatedParent = await trpc.aim.get.query({
                    projectPath: this.projectPath,
                    aimId: parentAim.id
                    })
                    dataStore.replaceAim(parentAim.id, updatedParent)
                } else {
                    const result = await dataStore.createSubAim(this.projectPath, parentAim.id, aimAttributes, insertionIndex, weight)
                    newAimId = result.id
                }

                // Update selection on the FRESH object in store
                console.log('parent selected index', insertionIndex)
                const freshParent = dataStore.aims[parentAim.id]
                if (freshParent) {
                    freshParent.selectedIncomingIndex = insertionIndex
                }
              }
            } else if(path.phase) {
              // ... existing phase logic (weight doesn't apply to phase commitments yet, or phase links are implicit)
              // Actually phase commitments don't have weights in this model, they are just order.
              // So weight is ignored here.
              console.log(isExistingAim ? 'link existing aim to phase (top-level)' : 'create top-level aim in phase', path.phase)
              let insertionIndex = 0
              const phase = dataStore.phases[path.phase.id]
              if (phase && phase.selectedAimIndex !== undefined) {
                insertionIndex = phase.selectedAimIndex + (this.aimModalInsertPosition === 'after' ? 1 : 0)
              }

              if (isExistingAim) {
                await trpc.aim.commitToPhase.mutate({
                  projectPath: this.projectPath,
                  aimId: aimTextOrId,
                  phaseId: path.phase.id,
                  insertionIndex
                })
                newAimId = aimTextOrId
                
                // Manually reload phase
                const updatedPhase = await trpc.phase.get.query({
                   projectPath: this.projectPath,
                   phaseId: path.phase.id
                })
                dataStore.replacePhase(path.phase.id, updatedPhase)
              } else {
                const result = await dataStore.createCommittedAim(this.projectPath, path.phase.id, aimAttributes, insertionIndex)
                newAimId = result.id
              }

              // Update local state - ensure aim is loaded if needed (createCommittedAim does it mostly)
              // createCommittedAim reloads phase, so we just update selection
              const freshPhase = dataStore.phases[path.phase.id]
              if (freshPhase) {
                freshPhase.selectedAimIndex = insertionIndex
              }
              // Also ensure the new aim is in the list (createCommittedAim adds it to aims map)
            } else {
              // ... existing floating logic (weight ignored as no parent)
              if (isExistingAim) {
                // If there's a callback (e.g., from graph view drag), allow it - callback will handle connection
                if (this.aimCreationCallback) {
                  console.log('Existing aim selected with callback - callback will handle connection')
                  newAimId = aimTextOrId
                } else {
                  console.warn('Cannot link existing aim as floating aim - ignoring')
                  this.showAimModal = false
                  return
                }
              } else {
                // free floating - use createFloatingAim
                const result = await dataStore.createFloatingAim(this.projectPath, aimAttributes)
                newAimId = result.id
              }
            }
          }
        }
      }

      // Update selection to the newly created aim
      if (newAimId) {
        if (this.aimCreationCallback) {
            this.aimCreationCallback(newAimId)
            this.aimCreationCallback = null
        }

        if (path.phase) {
          // For phase aims, find the new aim's index and select it
          const aims = dataStore.getAimsForPhase(path.phase.id)
          const newAimIndex = aims.findIndex(aim => aim.id === newAimId)
          if (newAimIndex !== -1) {
            const phase = dataStore.phases[path.phase.id]
            if (phase) {
              phase.selectedAimIndex = newAimIndex
            }
          }
        } else {
          // For floating aims, find the new aim's index and select it
          const newAimIndex = dataStore.floatingAims.findIndex(aim => aim.id === newAimId)
          if (newAimIndex !== -1) {
            this.floatingAimIndex = newAimIndex
          }
        }
      }

      this.showAimModal = false
    },

    // Keyboard hints actions
    setKeyboardHints(hints: Hint[]) {
      this.keyboardHints = hints
    },

    // Helper to find next aim in depth-first traversal
    // Returns { aimId, topLevelIndex, parentAimId, indexInParent } or null
    findNextAimInTree(currentAimId: string, phaseId: string, dataStore: any): {aimId: string, topLevelIndex: number, parentAimId?: string, indexInParent?: number} | null {
      const topLevelAims = dataStore.getAimsForPhase(phaseId)
      const currentAim = dataStore.aims[currentAimId]

      // If current aim is expanded with supportingConnections, dive into first child
      if (currentAim?.expanded && currentAim.supportingConnections?.length > 0) {
        const firstIncomingId = currentAim.supportingConnections[0].aimId
        const topLevelIndex = this.findTopLevelAncestorIndex(firstIncomingId, topLevelAims, dataStore)
        return { aimId: firstIncomingId, topLevelIndex, parentAimId: currentAimId, indexInParent: 0 }
      }

      // Find current aim in tree and get next sibling or parent's next sibling
      return this.findNextSiblingOrAncestorSibling(currentAimId, topLevelAims, dataStore, null, -1)
    },

    // Helper to find previous aim in depth-first traversal
    findPreviousAimInTree(currentAimId: string, phaseId: string | undefined, dataStore: any): {aimId: string, topLevelIndex: number, parentAimId?: string, indexInParent?: number} | null {
      const topLevelAims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
      return this.findPreviousSiblingOrAncestor(currentAimId, topLevelAims, dataStore, null, -1)
    },

    // Recursive helper to find next sibling or pop up to parent's next sibling
    findNextSiblingOrAncestorSibling(aimId: string, aims: any[], dataStore: any, parentAimId: string | null, topLevelIndex: number): {aimId: string, topLevelIndex: number, parentAimId?: string, indexInParent?: number} | null {
      for (let i = 0; i < aims.length; i++) {
        const aim = aims[i]
        const currentTopLevel = parentAimId === null ? i : topLevelIndex

        if (aim.id === aimId) {
          // Found current aim, try next sibling
          if (i < aims.length - 1) {
            const nextSibling = aims[i + 1]
            return { aimId: nextSibling.id, topLevelIndex: currentTopLevel, parentAimId: parentAimId ?? undefined, indexInParent: i + 1 }
          }
          // No next sibling, return null (caller will pop up)
          return null
        }

        // Check if aimId is nested in this aim's supportingConnections
        if (aim.expanded && aim.supportingConnections?.length > 0) {
          const incomingAims = aim.supportingConnections.map((c: any) => dataStore.aims[c.aimId]).filter(Boolean)
          const result = this.findNextSiblingOrAncestorSibling(aimId, incomingAims, dataStore, aim.id, currentTopLevel)

          if (result) return result

          // If result is null, aimId was last in supportingConnections, so next is this aim's next sibling
          const wasInIncoming = incomingAims.some((a: any) => a.id === aimId || this.isAimInTree(aimId, a, dataStore))
          if (wasInIncoming) {
            if (i < aims.length - 1) {
              const nextSibling = aims[i + 1]
              return { aimId: nextSibling.id, topLevelIndex: currentTopLevel, parentAimId: parentAimId ?? undefined, indexInParent: i + 1 }
            }
            return null
          }
        }
      }
      return null
    },

    // Recursive helper to find previous sibling (or its last descendant) or parent
    findPreviousSiblingOrAncestor(aimId: string, aims: any[], dataStore: any, parentAimId: string | null, topLevelIndex: number): {aimId: string, topLevelIndex: number, parentAimId?: string, indexInParent?: number} | null {
      for (let i = 0; i < aims.length; i++) {
        const aim = aims[i]
        const currentTopLevel = parentAimId === null ? i : topLevelIndex

        if (aim.id === aimId) {
          // Found current aim
          if (i > 0) {
            // Has previous sibling - get its last descendant or itself
            const prevSibling = aims[i - 1]
            const prevSiblingTopLevel = parentAimId === null ? i - 1 : topLevelIndex
            const lastDescendant = this.findLastDescendant(prevSibling, dataStore)
            return { aimId: lastDescendant.id, topLevelIndex: prevSiblingTopLevel, parentAimId: lastDescendant.parentId, indexInParent: lastDescendant.indexInParent }
          }
          // No previous sibling, return parent
          if (parentAimId) {
            // topLevelIndex is already set correctly when recursing
            return { aimId: parentAimId, topLevelIndex }
          }
          return null
        }

        // Check nested
        if (aim.expanded && aim.supportingConnections?.length > 0) {
          const incomingAims = aim.supportingConnections.map((c: any) => dataStore.aims[c.aimId]).filter(Boolean)
          const result = this.findPreviousSiblingOrAncestor(aimId, incomingAims, dataStore, aim.id, currentTopLevel)
          if (result) return result
        }
      }
      return null
    },

    // Find last descendant of an aim (itself if not expanded, or last child's last descendant)
    findLastDescendant(aim: any, dataStore: any): {id: string, parentId?: string, indexInParent?: number} {
      if (!aim.expanded || !aim.supportingConnections || aim.supportingConnections.length === 0) {
        return { id: aim.id }
      }
      const lastIncomingId = aim.supportingConnections[aim.supportingConnections.length - 1].aimId
      const lastIncoming = dataStore.aims[lastIncomingId]
      const descendant = this.findLastDescendant(lastIncoming, dataStore)
      return { ...descendant, parentId: aim.id, indexInParent: aim.supportingConnections.length - 1 }
    },

    // Find top-level ancestor index for a nested aim
    findTopLevelAncestorIndex(aimId: string, topLevelAims: any[], dataStore: any): number {
      // Check if it's already top-level
      const directIndex = topLevelAims.findIndex(a => a.id === aimId)
      if (directIndex >= 0) return directIndex

      // Search recursively
      for (let i = 0; i < topLevelAims.length; i++) {
        if (this.isAimInTree(aimId, topLevelAims[i], dataStore)) {
          return i
        }
      }
      return -1
    },

    // Check if aimId exists anywhere in the tree rooted at rootAim
    isAimInTree(aimId: string, rootAim: any, dataStore: any): boolean {
      if (rootAim.id === aimId) return true
      if (!rootAim.supportingConnections || rootAim.supportingConnections.length === 0) return false

      for (const conn of rootAim.supportingConnections) {
        const incomingAim = dataStore.aims[conn.aimId]
        if (incomingAim && this.isAimInTree(aimId, incomingAim, dataStore)) {
          return true
        }
      }
      return false
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
      const dataStore = useDataStore()
      if(this.navigatingAims) {
        if(this.selectedColumn === -1) {
          const floatingAims = dataStore.floatingAims
          if (floatingAims.length > 0) {
            // Clamp floatingAimIndex to valid range
            const validIndex = Math.max(0, Math.min(this.floatingAimIndex, floatingAims.length - 1))
            let aim = floatingAims[validIndex]
            const aimPath: Aim[] = []
            if (aim) {
                this.makeSelectedAimPath(aim, aimPath)
            }
            return { phase: undefined, aims: aimPath }
          }
        } else {
          let phaseId = this.getSelectedPhaseId(this.selectedColumn)
          if(phaseId) {
            let phase = dataStore.phases[phaseId]
            let aims = dataStore.getAimsForPhase(phaseId)
            const aimPath: Aim[] = []
            if(phase && phase.selectedAimIndex !== undefined) {
              let aim = aims[phase.selectedAimIndex]
              if (aim) {
                this.makeSelectedAimPath(aim, aimPath)
              }
            }
            return { phase, aims: aimPath }
          }
        }
      }
      return { phase: undefined, aims: [] }
    },

    makeSelectedAimPath(aim: Aim, path: Aim[]): Aim {
      const dataStore = useDataStore()
      if (!aim) return path[path.length - 1] as Aim // Safe guard
      
      path.push(aim)
      if(aim.expanded && aim.selectedIncomingIndex !== undefined) {
        // Use supportingConnections instead of incoming
        const connections = aim.supportingConnections || []
        if (aim.selectedIncomingIndex < connections.length) {
            // SAFE ACCESS: using guard instead of !
            const selectedConn = connections[aim.selectedIncomingIndex]
            if (selectedConn) {
              const subAim = dataStore.aims[selectedConn.aimId]
              if (subAim) {
                  // Ensure subAim is not undefined before passing
                  const subPath = this.makeSelectedAimPath(subAim as Aim, path)
                  if (subPath) return subPath
              }
            }
        }
        return aim
      } else {
        return aim
      }
    },

    // Helper to set current aim index (replaces setSelectedAim)
    setCurrentAimIndex(aimIndex: number, dataStore: any) {
      if (this.selectedColumn === -1) {
        this.floatingAimIndex = aimIndex
      } else {
        const phaseId = this.getSelectedPhaseId(this.selectedColumn)
        if (phaseId) {
          const phase = dataStore.phases[phaseId]
          if (phase) {
            phase.selectedAimIndex = aimIndex
          }
        }
      }
    },

    async selectPhase(columnIndex: number, phaseIndex: number, isTopLevel = true) {
      const dataStore = useDataStore();

      // Set column focus only at top level (not during cascade recursion)
      if (isTopLevel) {
        this.setSelectedColumn(columnIndex);
        // Indices stay in place (floatingAimIndex, phase.selectedAimIndex)
      }

      // Get current column's data
      const parentId = this.columnParentPhaseId[columnIndex] ?? null;
      const phases = dataStore.getPhasesByParentId(parentId);
      this.phaseCountByColumn[columnIndex] = phases.length;
      const phase = phases[phaseIndex];
      const phaseId = phase?.id;

      // Preserve child selection when switching parents
      const oldPhaseId = this.selectedPhaseIdByColumn[columnIndex];
      if (oldPhaseId && oldPhaseId !== phaseId && columnIndex >= 0) {
        const childSelection = this.selectedPhaseByColumn[columnIndex + 1] ?? 0;
        this.lastSelectedSubPhaseIndexByPhase[oldPhaseId] = childSelection;
      }

      // Update current column selection
      this.selectedPhaseByColumn[columnIndex] = phaseIndex;
      if (phaseId) {
        this.selectedPhaseIdByColumn[columnIndex] = phaseId;
      } else {
        delete this.selectedPhaseIdByColumn[columnIndex];
      }

      if (!phaseId) {
        this.setRightmostColumn(columnIndex);
        return;
      }

      // Cascade: load children and restore their selection
      const rememberedIndex = this.lastSelectedSubPhaseIndexByPhase[phaseId] ?? 0;
      const children = await dataStore.loadPhases(this.projectPath, phaseId);
      this.phaseCountByColumn[columnIndex + 1] = children.length;

      if (children.length > 0) {
        const childIndex = Math.min(rememberedIndex, children.length - 1);

        // Update all state atomically to prevent flicker
        this.columnParentPhaseId[columnIndex + 1] = phaseId;
        this.selectedPhaseByColumn[columnIndex + 1] = childIndex;
        const child = children[childIndex]
        if (child) {
            this.selectedPhaseIdByColumn[columnIndex + 1] = child.id;
        }
        this.setMinRightmost(columnIndex + 1);

        // Continue cascade (mark as not top level)
        await this.selectPhase(columnIndex + 1, childIndex, false);
      } else {
        this.columnParentPhaseId[columnIndex + 1] = phaseId;
        this.setRightmostColumn(columnIndex + 1);
      }
    },

    // Set selection without loading (j/k navigation)
    setSelection(columnIndex: number, phaseIndex: number) {
      const dataStore = useDataStore();
      const parentId = this.columnParentPhaseId[columnIndex] ?? null;
      const phases = dataStore.getPhasesByParentId(parentId);
      const phase = phases[phaseIndex];

      this.selectedPhaseByColumn[columnIndex] = phaseIndex;
      if (phase) {
        this.selectedPhaseIdByColumn[columnIndex] = phase.id;
      } else {
        delete this.selectedPhaseIdByColumn[columnIndex];
      }

      // Also store the selection for persistence when changing parent
      if (columnIndex > 0) {
        const parentColumn = columnIndex - 1;
        const parentPhaseId = this.selectedPhaseIdByColumn[parentColumn];
        if (parentPhaseId) {
          this.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = phaseIndex;
        }
      }
    },

    // Click-to-select by aim ID (finds top-level index automatically)
    async selectAimById(columnIndex: number, phaseId: string | undefined, aimId: string) {
      const dataStore = useDataStore();

      // Check if this aim is already selected
      const currentAim = this.getCurrentAim()
      const isAlreadySelected = currentAim?.id === aimId && this.selectedColumn === columnIndex

      if (isAlreadySelected) {
        // Aim is already selected - open edit modal instead
        const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
        const aimIndex = aims.findIndex((a: any) => a && a.id === aimId)
        if (aimIndex !== -1) {
          this.showAimModal = true
          this.aimModalMode = 'edit'
        }
        return
      }

      const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims

      // Clear all selectedIncomingIndex first
      Object.values(dataStore.aims).forEach((aim: any) => {
        aim.selectedIncomingIndex = undefined
      })

      // Find the top-level aim index
      const topLevelIndex = aims.findIndex((a: any) => a && a.id === aimId)

      if (topLevelIndex >= 0) {
        // It's a top-level aim, use regular selectAim
        this.selectAim(columnIndex, phaseId, topLevelIndex)
      } else {
        // It's a nested aim - find its path from top-level ancestor
        const path = this.findPathToAim(aimId, aims, dataStore)

        if (path && path.length > 0) {
          // Set selectedIncomingIndex on each parent in the path
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

          // Select column
          this.setSelectedColumn(columnIndex)

          // For phase aims, ensure the phase is selected
          if (phaseId && columnIndex >= 0) {
            const parentId = this.columnParentPhaseId[columnIndex] ?? null
            const phases = dataStore.getPhasesByParentId(parentId)
            const phaseIndex = phases.findIndex(p => p.id === phaseId)

            if (phaseIndex !== -1) {
              this.selectedPhaseByColumn[columnIndex] = phaseIndex
              this.selectedPhaseIdByColumn[columnIndex] = phaseId
            }
          }

          this.navigatingAims = true
          if (topLevel) {
            this.setCurrentAimIndex(topLevel.topLevelIndex, dataStore)
          }
        }
      }
    },

    // Helper to find path from top-level to target aim
    // Returns array of {aimId, topLevelIndex, indexInParent} from root to target
    findPathToAim(targetId: string, topLevelAims: any[], dataStore: any): Array<{aimId: string, topLevelIndex: number, indexInParent?: number}> | null {
      for (let i = 0; i < topLevelAims.length; i++) {
        const path = this.findPathInTree(targetId, topLevelAims[i], dataStore, i, undefined)
        if (path) return path
      }
      return null
    },

    // Recursive helper to find path to aim in tree
    findPathInTree(targetId: string, currentAim: any, dataStore: any, topLevelIndex: number, indexInParent: number | undefined): Array<{aimId: string, topLevelIndex: number, indexInParent?: number}> | null {
      if (currentAim.id === targetId) {
        return [{ aimId: currentAim.id, topLevelIndex, indexInParent }]
      }

      if (currentAim.supportingConnections && currentAim.supportingConnections.length > 0) {
        for (let i = 0; i < currentAim.supportingConnections.length; i++) {
          const childId = currentAim.supportingConnections[i].aimId
          const child = dataStore.aims[childId]
          if (!child) continue

          const childPath = this.findPathInTree(targetId, child, dataStore, topLevelIndex, i)
          if (childPath) {
            return [{ aimId: currentAim.id, topLevelIndex, indexInParent }, ...childPath]
          }
        }
      }

      return null
    },

    // Click-to-select: focus an aim (set column, phase, mode, and aim)
    async selectAim(columnIndex: number, phaseId: string | undefined, aimIndex: number) {
      const dataStore = useDataStore();

      // Set column focus
      this.setSelectedColumn(columnIndex);

      // For phase aims, ensure the phase is selected
      if (phaseId && columnIndex >= 0) {
        // Find the phase index
        const parentId = this.columnParentPhaseId[columnIndex] ?? null;
        const phases = dataStore.getPhasesByParentId(parentId);
        const phaseIndex = phases.findIndex(p => p.id === phaseId);

        if (phaseIndex !== -1) {
          // Select the phase (but don't cascade - just set selection)
          this.selectedPhaseByColumn[columnIndex] = phaseIndex;
          this.selectedPhaseIdByColumn[columnIndex] = phaseId;
        }
      }

      // Enter aim navigation mode
      this.navigatingAims = true;

      // Set the current aim index
      this.setCurrentAimIndex(aimIndex, dataStore);
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

    selectLink(parentId: string, childId: string) {
      this.selectedLink = { parentId, childId }
      // Deselect aim if link is selected (Reference behavior: selectFlow sets selectedAim = undefined)
      // But here `selectedColumn` / `floatingAimIndex` tracks aim selection.
      // We might want to keep aim selection separate or clear it.
      // For now, just set selectedLink.
    },

    deselectLink() {
      this.selectedLink = null
    },

    deselectAim() {
      this.navigatingAims = false
    },

    setGraphSelection(aimId: string | null) {
      this.graphSelectedAimId = aimId
    },

    setGraphColorMode(mode: 'status' | 'priority') {
      this.graphColorMode = mode
      localStorage.setItem('aimparency-graph-color-mode', mode)
    },

    setGraphPanelWidth(width: number) {
      this.graphPanelWidth = Math.max(200, Math.min(width, 600))
      localStorage.setItem('aimparency-graph-panel-width', this.graphPanelWidth.toString())
    },

    toggleGraphShowLabels() {
      this.graphShowLabels = !this.graphShowLabels
      localStorage.setItem('aimparency-graph-show-labels', String(this.graphShowLabels))
    },

    async calculateAimPaths(aimId: string): Promise<AimPath[]> {
      const paths: AimPath[] = []
      const visited = new Set<string>()
      
      const trace = async (currentId: string, pathAcc: Aim[]) => {
        if (visited.has(currentId)) return
        visited.add(currentId)
        
        // Load aim if not in store
        let aim = useDataStore().aims[currentId]
        if (!aim) {
             try {
                aim = await trpc.aim.get.query({ projectPath: this.projectPath, aimId: currentId })
                useDataStore().replaceAim(aim.id, aim)
             } catch (e) {
                console.error("failed to load aim", currentId)
                return
             }
        }
        
        const newPath = [aim, ...pathAcc]
        
        let isRoot = true

        // 1. Is it a root of a phase?
        if (aim.committedIn && aim.committedIn.length > 0) {
            isRoot = false
            for (const phaseId of aim.committedIn) {
                paths.push({ phaseId, aims: newPath })
            }
        }
        
        // 2. Does it have parents?
        if (aim.supportedAims && aim.supportedAims.length > 0) {
            isRoot = false
            for (const parentId of aim.supportedAims) {
                await trace(parentId, newPath) 
            }
        }
        
        // 3. Is it a floating root? (No parents, not in phase)
        if (isRoot) {
            paths.push({ phaseId: undefined, aims: newPath })
        }
        
        visited.delete(currentId) // Backtracking
      }
      
      await trace(aimId, [])
      return paths
    },

    async prepareNavigation(aimId: string): Promise<AimPath[]> {
      return await this.calculateAimPaths(aimId)
    },

    async executeNavigation(path: AimPath) {
      const dataStore = useDataStore()
      
      const rootAim = path.aims[0]
      const phaseId = path.phaseId

      // 1. Setup Columns (Phases)
      if (phaseId) {
        // It's in a phase. Need to find phase path.
        const phasePath: Phase[] = []
        let currentPhase = await trpc.phase.get.query({ projectPath: this.projectPath, phaseId })
        
        while (currentPhase) {
          dataStore.replacePhase(currentPhase.id, currentPhase)
          const storedPhase = dataStore.phases[currentPhase.id]
          if (storedPhase) phasePath.unshift(storedPhase)
          
          if (currentPhase.parent) {
            currentPhase = await trpc.phase.get.query({ projectPath: this.projectPath, phaseId: currentPhase.parent })
          } else {
            break
          }
        }

        // Select Phases
        for (let i = 0; i < phasePath.length; i++) {
          const p = phasePath[i]
          if (!p) continue
          const parentId = p.parent
          // We need the index of p in parent's list
          await dataStore.loadPhases(this.projectPath, parentId)
          const siblings = dataStore.getPhasesByParentId(parentId)
          const index = siblings.findIndex(x => x && x.id === p.id)
          if (index !== -1) {
            this.setSelection(i, index)
            // Load next level children for next iteration
            if (i < phasePath.length - 1) {
              await dataStore.loadPhases(this.projectPath, p.id)
              this.columnParentPhaseId[i + 1] = p.id
            }
          }
        }
        
        // Set focus to the last phase column
        this.selectedColumn = phasePath.length - 1
        this.setRightmostColumn(phasePath.length)
        
        // Load aims for the specific phase
        await dataStore.loadPhaseAims(this.projectPath, phaseId)
        
      } else {
        // Floating
        this.selectedColumn = -1
        await dataStore.loadFloatingAims(this.projectPath)
      }

      // 2. Select Root Aim
      const contextAims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
      if (rootAim) {
        const rootIndex = contextAims.findIndex(a => a && a.id === rootAim.id)
      
        if (rootIndex !== -1) {
            if (phaseId) {
            const phase = dataStore.phases[phaseId]
            if (phase) {
                phase.selectedAimIndex = rootIndex
            }
            } else {
            this.floatingAimIndex = rootIndex
            }
        }
      }

      // 3. Expand path to target
      for (let i = 0; i < path.aims.length - 1; i++) {
        const parentStep = path.aims[i]
        if (!parentStep) continue
        const parentId = parentStep.id
        
        // Re-fetch parent from store to ensure we have latest reference
        const parent = dataStore.aims[parentId]
        const child = path.aims[i + 1]
        
        if (parent && child) {
            parent.expanded = true
            // Load children for this parent
            if (parent.supportingConnections && parent.supportingConnections.length > 0) {
               await dataStore.loadAims(this.projectPath, parent.supportingConnections.map(c => c.aimId))
            }
            
            const childIndex = parent.supportingConnections.findIndex(c => c.aimId === child.id)
            if (childIndex !== -1) {
              parent.selectedIncomingIndex = childIndex
            }
        }
      }

      this.navigatingAims = true
      this.ensureSelectionVisible()
    },

    async navigateToAim(aimId: string) {
        // Wrapper for backward compatibility or if we want auto-selection here
        const paths = await this.prepareNavigation(aimId)
        const firstPath = paths[0]
        if (firstPath) {
            await this.executeNavigation(firstPath)
        }
    },

    // Global keyboard handler - single source of truth for all navigation
    async handleGraphKeydown(event: KeyboardEvent, dataStore: any) {
        if (event.key === 'd') {
            event.preventDefault()
            const aimId = this.graphSelectedAimId
            if (!aimId) return

            if (this.pendingDeleteAimId === aimId) {
                await dataStore.deleteAim(aimId)
                this.pendingDeleteAimId = null
                this.setGraphSelection(null)
            } else {
                this.setPendingDeleteAim(aimId)
            }
        } else if (event.key === 'Escape') {
            event.preventDefault()
            if (this.pendingDeleteAimId) {
                this.pendingDeleteAimId = null
            } else {
                this.setGraphSelection(null)
            }
        }
    },

    async handleGlobalKeydown(event: KeyboardEvent, dataStore: any) {
      console.log('pressed', event.key, '. nav aims? ', this.navigatingAims)

      // Ignore if Ctrl or Meta is pressed (allow browser defaults)
      if (event.ctrlKey || event.metaKey) return

      if (this.showPhaseModal || this.showAimModal || this.showAimSearch) {
        // Modals handle their own keys (including Escape).
        // We do nothing here to avoid conflicts.
        return
      } else {
        // Ignore modifiers (Ctrl, Alt, Meta) to allow browser shortcuts
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return
        }

        if (event.key === '/') {
          event.preventDefault()
          this.openAimSearch()
          return
        }

        if (event.key === 'g') {
          event.preventDefault()
          this.setView(this.currentView === 'columns' ? 'graph' : 'columns')
          return
        }

        if (this.currentView === 'graph') {
            await this.handleGraphKeydown(event, dataStore)
            return
        }

        if(this.navigatingAims) {
          await this.handleAimNavigationKeys(event, dataStore)
        } else {
          await this.handleColumnNavigationKeys(event, dataStore)
        }
      }
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

      const currentAim = path.aims.length > 0 ? path.aims[path.aims.length - 1] : undefined

      const currentConnections = currentAim?.supportingConnections || []
      
      // Removed automatic dive on 'j'. User must use 'l' to enter sub-aims.
      if (path.aims.length === 1) {
        // At top level
          if (col === -1) {
            // next floating aim
            if (this.floatingAimIndex < dataStore.floatingAims.length - 1) {
              this.floatingAimIndex++
            }
          } else {
            // next aim in phase
            if (path.phase) {
              if (path.phase.selectedAimIndex! < path.phase.commitments.length - 1 ) {
                path.phase.selectedAimIndex!++
              } else if (col >= 0) {
                 // End of phase, try next phase
                 const currentPhaseIndex = this.getSelectedPhase(col)
                 const phaseCount = this.getPhaseCount(col)
                 if (currentPhaseIndex < phaseCount - 1) {
                     await this.selectPhase(col, currentPhaseIndex + 1)
                     const newPhaseId = this.getSelectedPhaseId(col)
                     if (newPhaseId) {
                         const newPhase = dataStore.phases[newPhaseId]
                         // If new phase has aims, select the first one. 
                         // Note: selectPhase doesn't reset selectedAimIndex usually (it might preserve it? no, distinct objects).
                         // But we want to ensure it's 0.
                         if (newPhase && newPhase.commitments.length > 0) {
                             newPhase.selectedAimIndex = 0
                         }
                     }
                 }
              }
            }
          }
        } else if (path.aims.length > 1) {
          let broke = false
          
          for(let i = path.aims.length - 2; i >= 0; i--) {
            // SAFE ACCESS: using guard instead of !
            const ancestorAim = path.aims[i]
            if (!ancestorAim) continue 

            const ancestorConnections = ancestorAim.supportingConnections || []
            
            if (ancestorAim.selectedIncomingIndex !== undefined && ancestorAim.selectedIncomingIndex < ancestorConnections.length - 1) {
              ancestorAim.selectedIncomingIndex ++
              broke = true
              break
            }           
          }

          if(!broke) {
            if(path.phase) {
              if(path.phase.selectedAimIndex! < path.phase.commitments.length - 1) {
                path.phase.selectedAimIndex! ++
              } else if (col >= 0) {
                 // End of phase (from nested), try next phase
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
            } else {
              if(this.floatingAimIndex < dataStore.floatingAims.length - 1) {
                this.floatingAimIndex++
              }
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

      if(this.navigatingAims) {
        if(path.aims.length === 1) {
          if (col === -1) {
            // previous floating aim
            if (this.floatingAimIndex > 0) {
              this.floatingAimIndex--
              const target = dataStore.floatingAims[this.floatingAimIndex]
              if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
                  this.goToLastChildAim(target)
              }
            }
          } else if (col >= 0) {
            // previous aim in phase
            if (path.phase) {
              if (path.phase.selectedAimIndex !== undefined && path.phase.selectedAimIndex > 0) {
                path.phase.selectedAimIndex--
                const target = dataStore.getAimsForPhase(path.phase.id)[path.phase.selectedAimIndex]
                if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
                    this.goToLastChildAim(target)
                }
              } else {
                 // Start of phase, try previous phase
                 const currentPhaseIndex = this.getSelectedPhase(col)
                 if (currentPhaseIndex > 0) {
                     await this.selectPhase(col, currentPhaseIndex - 1)
                     const newPhaseId = this.getSelectedPhaseId(col)
                     if (newPhaseId) {
                         const newPhase = dataStore.phases[newPhaseId]
                         if (newPhase && newPhase.commitments.length > 0) {
                             newPhase.selectedAimIndex = newPhase.commitments.length - 1
                             
                             // Check for deep dive into last aim
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
          }
        } else if (path.aims.length > 1) {
          // Nested aims
          const parentAim = path.aims[path.aims.length - 2]
          if (parentAim) {
            if(parentAim.selectedIncomingIndex == 0) {
                parentAim.selectedIncomingIndex = undefined
            } else {
                if (parentAim.selectedIncomingIndex !== undefined) {
                    parentAim.selectedIncomingIndex --
                    const parentConnections = parentAim.supportingConnections || []
                    
                    // SAFE ACCESS: using guard instead of !
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
        }
      }
    },

    goToLastChildAim(target: Aim) {
      console.log('going to last child of', target)
      const dataStore = useDataStore()
      let connections = target.supportingConnections || []
      while (target.expanded && connections.length > 0) {
        const lastIdx = connections.length - 1
        target.selectedIncomingIndex = lastIdx
        
        // SAFE ACCESS: using guard instead of !
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
      const dataStore = useDataStore()
      const path = this.getSelectionPath()

      if (path.aims.length === 0) return

      const currentAim = path.aims[path.aims.length - 1]!
      const currentAimId = currentAim.id

      if (path.aims.length > 1) {
        // Sub-aim: swap with next sibling in parent's incoming array
        const parentAim = path.aims[path.aims.length - 2]
        if (parentAim && parentAim.selectedIncomingIndex !== undefined) {
            const currentIndex = parentAim.selectedIncomingIndex
            const parentConnections = parentAim.supportingConnections || []

            if (currentIndex < parentConnections.length - 1) {
                const nextIndex = currentIndex + 1

                // Optimistic Update
                if (parentAim.supportingConnections) {
                    const temp = parentAim.supportingConnections[currentIndex]!
                    parentAim.supportingConnections[currentIndex] = parentAim.supportingConnections[nextIndex]!
                    parentAim.supportingConnections[nextIndex] = temp
                }
                parentAim.selectedIncomingIndex = nextIndex

                try {
                    await trpc.aim.connectAims.mutate({
                        projectPath: this.projectPath,
                        parentAimId: parentAim.id,
                        childAimId: currentAim.id,
                        parentIncomingIndex: nextIndex,
                        childSupportedAimsIndex: currentAim.supportedAims.indexOf(parentAim.id)
                    })

                    // Reload parent to get updated incoming array
                    const updatedParent = await trpc.aim.get.query({
                        projectPath: this.projectPath,
                        aimId: parentAim.id
                    })
                    dataStore.replaceAim(parentAim.id, updatedParent)

                    // Update selection AFTER reload confirms the move
                    const reloadedParent = dataStore.aims[parentAim.id]
                    if (reloadedParent) {
                        reloadedParent.selectedIncomingIndex = nextIndex
                    }
                } catch (e) {
                    console.error("Move failed", e)
                }
            }
        }
      } else if (path.phase) {
        // Top-level aim in phase: move within phase's commitments
        const phaseId = path.phase.id
        const currentIndex = path.phase.selectedAimIndex!

        if (currentIndex < path.phase.commitments.length - 1) {
          const nextIndex = currentIndex + 1

          // Optimistic Update
          const ph = dataStore.phases[phaseId]
          if (ph && ph.commitments) {
              const temp = ph.commitments[currentIndex]!
              ph.commitments[currentIndex] = ph.commitments[nextIndex]!
              ph.commitments[nextIndex] = temp
              ph.selectedAimIndex = nextIndex
          }

          try {
              await trpc.aim.commitToPhase.mutate({
                projectPath: this.projectPath,
                aimId: currentAim.id,
                phaseId: phaseId,
                insertionIndex: nextIndex
              })

              // Reload phase
              const updatedPhase = await trpc.phase.get.query({
                projectPath: this.projectPath,
                phaseId: phaseId
              })
              dataStore.replacePhase(phaseId, updatedPhase)

              // Update selection AFTER reload confirms the move
              const reloadedPhase = dataStore.phases[phaseId]
              if (reloadedPhase) {
                reloadedPhase.selectedAimIndex = nextIndex
              }
          } catch (e) {
              console.error("Move failed", e)
          }
        } else {
          // Move to next phase
          const parentPhaseId = path.phase.parent
          const siblings = dataStore.getPhasesByParentId(parentPhaseId)
          const currentPhaseIndex = siblings.findIndex(p => p.id === phaseId)
          
          if (currentPhaseIndex !== -1 && currentPhaseIndex < siblings.length - 1) {
            const nextPhase = siblings[currentPhaseIndex + 1]
            if (!nextPhase) return
            const nextPhaseId = nextPhase.id
            
            // Optimistic Update
            const ph = dataStore.phases[phaseId]
            if (ph && ph.commitments) {
                ph.commitments.splice(currentIndex, 1)
            }
            const nextPh = dataStore.phases[nextPhaseId]
            if (nextPh) {
                if (!nextPh.commitments) nextPh.commitments = []
                nextPh.commitments.unshift(currentAim.id)
                nextPh.selectedAimIndex = 0
            }

            // Update UI selection to next phase
            const col = this.selectedColumn
            if (col >= 0) {
               await this.selectPhase(col, currentPhaseIndex + 1)
            }

            try {
                // Backend
                await trpc.aim.removeFromPhase.mutate({
                    projectPath: this.projectPath,
                    aimId: currentAim.id,
                    phaseId: phaseId
                })
                await trpc.aim.commitToPhase.mutate({
                    projectPath: this.projectPath,
                    aimId: currentAim.id,
                    phaseId: nextPhaseId,
                    insertionIndex: 0
                })
                
                // Reload both phases
                const [updatedOld, updatedNew] = await Promise.all([
                    trpc.phase.get.query({ projectPath: this.projectPath, phaseId }),
                    trpc.phase.get.query({ projectPath: this.projectPath, phaseId: nextPhaseId })
                ])
                dataStore.replacePhase(phaseId, updatedOld)
                dataStore.replacePhase(nextPhaseId, updatedNew)
                
                // Ensure selection on new phase
                const reloadedNew = dataStore.phases[nextPhaseId]
                if (reloadedNew) reloadedNew.selectedAimIndex = 0
            } catch(e) {
                console.error("Move across phases failed", e)
            }
          }
        }
      }
    },

    // Move aim up (K)
    async moveAimUp() {
      const dataStore = useDataStore()
      const path = this.getSelectionPath()

      if (path.aims.length === 0) return

      const currentAim = path.aims[path.aims.length - 1]!
      const currentAimId = currentAim.id

      if (path.aims.length > 1) {
        // Sub-aim: swap with previous sibling
        const parentAim = path.aims[path.aims.length - 2]
        if (parentAim && parentAim.selectedIncomingIndex !== undefined) {
            const currentIndex = parentAim.selectedIncomingIndex

            if (currentIndex > 0) {
                const prevIndex = currentIndex - 1

                // Optimistic Update
                if (parentAim.supportingConnections) {
                    const temp = parentAim.supportingConnections[currentIndex]!
                    parentAim.supportingConnections[currentIndex] = parentAim.supportingConnections[prevIndex]!
                    parentAim.supportingConnections[prevIndex] = temp
                }
                parentAim.selectedIncomingIndex = prevIndex

                try {
                    await trpc.aim.connectAims.mutate({
                        projectPath: this.projectPath,
                        parentAimId: parentAim.id,
                        childAimId: currentAim.id,
                        parentIncomingIndex: prevIndex,
                        childSupportedAimsIndex: currentAim.supportedAims.indexOf(parentAim.id)
                    })

                    // Reload parent
                    const updatedParent = await trpc.aim.get.query({
                        projectPath: this.projectPath,
                        aimId: parentAim.id
                    })
                    dataStore.replaceAim(parentAim.id, updatedParent)

                    // Update selection AFTER reload confirms the move
                    const reloadedParent = dataStore.aims[parentAim.id]
                    if (reloadedParent) {
                        reloadedParent.selectedIncomingIndex = prevIndex
                    }
                } catch (e) {
                    console.error("Move failed", e)
                }
            }
        }
      } else if (path.phase) {
        // Top-level aim in phase
        const phaseId = path.phase.id
        const currentIndex = path.phase.selectedAimIndex!

        if (currentIndex > 0) {
          const prevIndex = currentIndex - 1

          // Optimistic Update
          const ph = dataStore.phases[phaseId]
          if (ph && ph.commitments) {
              const temp = ph.commitments[currentIndex]!
              ph.commitments[currentIndex] = ph.commitments[prevIndex]!
              ph.commitments[prevIndex] = temp
              ph.selectedAimIndex = prevIndex
          }

          try {
              await trpc.aim.commitToPhase.mutate({
                projectPath: this.projectPath,
                aimId: currentAim.id,
                phaseId: phaseId,
                insertionIndex: prevIndex
              })

              // Reload phase
              const updatedPhase = await trpc.phase.get.query({
                projectPath: this.projectPath,
                phaseId: phaseId
              })
              dataStore.replacePhase(phaseId, updatedPhase)

              // Update selection AFTER reload confirms the move
              const reloadedPhase = dataStore.phases[phaseId]
              if (reloadedPhase) {
                reloadedPhase.selectedAimIndex = prevIndex
              }
          } catch (e) {
              console.error("Move failed", e)
          }
        } else {
          // Move to prev phase
          const parentPhaseId = path.phase.parent
          const siblings = dataStore.getPhasesByParentId(parentPhaseId)
          const currentPhaseIndex = siblings.findIndex(p => p.id === phaseId)

          if (currentPhaseIndex > 0) {
            const prevPhase = siblings[currentPhaseIndex - 1]
            if (!prevPhase) return
            const prevPhaseId = prevPhase.id
            
            // Optimistic Update
            const ph = dataStore.phases[phaseId]
            if (ph && ph.commitments) {
                ph.commitments.splice(currentIndex, 1)
            }
            const prevPh = dataStore.phases[prevPhaseId]
            let newIndex = 0
            if (prevPh) {
                if (!prevPh.commitments) prevPh.commitments = []
                newIndex = prevPh.commitments.length
                prevPh.commitments.push(currentAim.id)
                prevPh.selectedAimIndex = newIndex
            }

            // Update UI selection
            const col = this.selectedColumn
            if (col >= 0) {
               await this.selectPhase(col, currentPhaseIndex - 1)
            }

            try {
                // Backend
                await trpc.aim.removeFromPhase.mutate({
                    projectPath: this.projectPath,
                    aimId: currentAim.id,
                    phaseId: phaseId
                })
                await trpc.aim.commitToPhase.mutate({
                    projectPath: this.projectPath,
                    aimId: currentAim.id,
                    phaseId: prevPhaseId,
                    insertionIndex: newIndex
                })
                
                // Reload both
                const [updatedOld, updatedNew] = await Promise.all([
                    trpc.phase.get.query({ projectPath: this.projectPath, phaseId }),
                    trpc.phase.get.query({ projectPath: this.projectPath, phaseId: prevPhaseId })
                ])
                dataStore.replacePhase(phaseId, updatedOld)
                dataStore.replacePhase(prevPhaseId, updatedNew)

                const reloadedPrev = dataStore.phases[prevPhaseId]
                if (reloadedPrev) reloadedPrev.selectedAimIndex = reloadedPrev.commitments.length - 1
            } catch(e) {
                console.error("Move across phases failed", e)
            }
          }
        }
      }
    },

    // Move aim out of sub-aim list (H) - make it sibling of parent
    async moveAimOut() {
      const dataStore = useDataStore()
      const path = this.getSelectionPath()

      if (path.aims.length <= 1) return // Can't move out if not a sub-aim

      const currentAim = path.aims[path.aims.length - 1]!
      const currentAimId = currentAim.id
      const parentAim = path.aims[path.aims.length - 2]
      if (!parentAim) return
      
      const parentId = parentAim.id

      // Calculate where the aim will end up (read before mutations)
      const parentConnections = parentAim.supportingConnections || []
      const updatedConnections = parentConnections.filter(c => c.aimId !== currentAimId)
      
      const updatedSupportedAims = currentAim.supportedAims.filter(id => id !== parentId)

      let grandparentId: string | undefined
      let newIndex: number | undefined
      let targetPhaseId: string | undefined

      if (path.aims.length > 2) {
        // Will become grandparent's sub-aim
        const grandparentAim = path.aims[path.aims.length - 3]!
        grandparentId = grandparentAim.id
        const parentIndexInGrandparent = grandparentAim.selectedIncomingIndex!
        newIndex = parentIndexInGrandparent + 1
      } else if (path.phase) {
        // Will become top-level in phase
        targetPhaseId = path.phase.id
        const parentIndex = path.phase.selectedAimIndex!
        newIndex = parentIndex + 1
      } else {
        // Will become floating root (sibling of parent)
        const parentIndex = dataStore.floatingAims.findIndex(a => a.id === parentId)
        if (parentIndex !== -1) {
            newIndex = parentIndex + 1
        }
      }

      // --- Optimistic Update ---
      
      // 1. Remove from parent locally
      if (parentAim.supportingConnections) {
          parentAim.supportingConnections = updatedConnections
      }

      // 2. Remove parent from child locally
      currentAim.supportedAims = updatedSupportedAims
      
      // 3. Add to new location locally & Update Selection
      if (grandparentId) {
         const gp = dataStore.aims[grandparentId]
         if (gp && newIndex !== undefined) {
             if (!gp.supportingConnections) gp.supportingConnections = []
             gp.supportingConnections.splice(newIndex, 0, { aimId: currentAimId, weight: 1 } as any)
             gp.selectedIncomingIndex = newIndex
             currentAim.supportedAims.push(grandparentId)
         }
      } else if (targetPhaseId) {
         const ph = dataStore.phases[targetPhaseId]
         if (ph && newIndex !== undefined) {
             if (!ph.commitments) ph.commitments = []
             ph.commitments.splice(newIndex, 0, currentAimId)
             ph.selectedAimIndex = newIndex
             
             if (!currentAim.committedIn) currentAim.committedIn = []
             currentAim.committedIn.push(targetPhaseId)
         }
      } else {
         // Floating
         if (newIndex !== undefined) {
             dataStore.floatingAimsIds.splice(newIndex, 0, currentAimId)
             this.floatingAimIndex = newIndex
         }
      }

      try {
        // Perform backend mutations sequentially
        // First disconnect from parent
        await trpc.aim.update.mutate({
            projectPath: this.projectPath,
            aimId: parentId,
            aim: { supportingConnections: updatedConnections }
        })
        await trpc.aim.update.mutate({
            projectPath: this.projectPath,
            aimId: currentAimId,
            aim: { supportedAims: updatedSupportedAims }
        })

        // Connect to new location
        if (grandparentId) {
            await trpc.aim.connectAims.mutate({
            projectPath: this.projectPath,
            parentAimId: grandparentId,
            childAimId: currentAimId,
            parentIncomingIndex: newIndex!,
            childSupportedAimsIndex: 0
            })
        } else if (targetPhaseId) {
            await trpc.aim.commitToPhase.mutate({
            projectPath: this.projectPath,
            aimId: currentAimId,
            phaseId: targetPhaseId,
            insertionIndex: newIndex!
            })
        }

        // Single reload pass - all in parallel
        const reloads = []

        reloads.push(
            trpc.aim.get.query({
            projectPath: this.projectPath,
            aimId: parentId
            }).then(updated => dataStore.replaceAim(parentId, updated))
        )

        if (grandparentId) {
            reloads.push(
            trpc.aim.get.query({
                projectPath: this.projectPath,
                aimId: grandparentId
            }).then(updated => dataStore.replaceAim(grandparentId, updated))
            )
        } else if (targetPhaseId) {
            reloads.push(
            trpc.phase.get.query({
                projectPath: this.projectPath,
                phaseId: targetPhaseId
            }).then(updated => dataStore.replacePhase(targetPhaseId, updated)),
            trpc.aim.get.query({
                projectPath: this.projectPath,
                aimId: currentAimId
            }).then(updated => dataStore.replaceAim(currentAimId, updated))
            )
        } else {
            // Floating aim
            reloads.push(
            trpc.aim.get.query({
                projectPath: this.projectPath,
                aimId: currentAimId
            }).then(updated => {
                dataStore.replaceAim(currentAimId, updated)
            })
            )
        }

        await Promise.all(reloads)
      } catch (e) {
          console.error("Move failed", e)
          // TODO: Rollback logic?
      }
    },

    // Move aim in (L) - make it a sub-aim of previous sibling
    async moveAimIn() {
      const dataStore = useDataStore()
      const path = this.getSelectionPath()

      if (path.aims.length === 0) return

      const currentAim = path.aims[path.aims.length - 1]!
      const currentAimId = currentAim.id

      // Determine context and previous sibling
      let previousSiblingId: string | undefined
      let currentIndex: number
      let oldParentId: string | undefined
      let oldPhaseId: string | undefined

      if (path.aims.length > 1) {
        // Sub-aim: check for previous sibling in parent's incoming
        const parentAim = path.aims[path.aims.length - 2]
        if (!parentAim || parentAim.selectedIncomingIndex === undefined) return
        
        currentIndex = parentAim.selectedIncomingIndex
        if (currentIndex === 0) return // Can't indent first item

        const parentConnections = parentAim.supportingConnections || []
        const prevConn = parentConnections[currentIndex - 1]
        if (prevConn) previousSiblingId = prevConn.aimId
        oldParentId = parentAim.id
      } else if (path.phase) {
        // Top-level in phase
        currentIndex = path.phase.selectedAimIndex!
        if (currentIndex === 0) return // Can't indent first item

        previousSiblingId = path.phase.commitments[currentIndex - 1]
        oldPhaseId = path.phase.id
      } else {
        // Floating aim
        currentIndex = this.floatingAimIndex
        if (currentIndex === 0) return // Can't indent first item

        const floatingAims = dataStore.floatingAims || []
        const prev = floatingAims[currentIndex - 1]
        if (prev) previousSiblingId = prev.id
      }

      if (!previousSiblingId) return

      // Get insertion index (read before mutations)
      const previousSibling = dataStore.aims[previousSiblingId]
      if (!previousSibling) return
      
      const prevSiblingConnections = previousSibling.supportingConnections || []
      const insertionIndex = prevSiblingConnections.length

      // --- Optimistic Update ---

      // 1. Remove from old location
      if (oldParentId) {
         const oldParent = dataStore.aims[oldParentId]
         if (oldParent && oldParent.supportingConnections) {
             oldParent.supportingConnections = oldParent.supportingConnections.filter(c => c.aimId !== currentAimId)
         }
         currentAim.supportedAims = currentAim.supportedAims.filter(id => id !== oldParentId)
      } else if (oldPhaseId) {
         const ph = dataStore.phases[oldPhaseId]
         if (ph && ph.commitments) {
             ph.commitments = ph.commitments.filter(id => id !== currentAimId)
         }
         if (currentAim.committedIn) {
            currentAim.committedIn = currentAim.committedIn.filter(id => id !== oldPhaseId)
         }
      } else {
         // Floating
         const idx = dataStore.floatingAimsIds.indexOf(currentAimId)
         if (idx !== -1) {
             dataStore.floatingAimsIds.splice(idx, 1)
         }
      }

      // 2. Add to new location (previous sibling)
      if (previousSibling) {
          if (!previousSibling.supportingConnections) previousSibling.supportingConnections = []
          previousSibling.supportingConnections.splice(insertionIndex, 0, { aimId: currentAimId, weight: 1 } as any)
          previousSibling.expanded = true
          previousSibling.selectedIncomingIndex = insertionIndex
          
          if (!currentAim.supportedAims) currentAim.supportedAims = []
          currentAim.supportedAims.push(previousSiblingId)
      }

      // 3. Update Selections
      // Adjust Phase Selection (if moved from top level)
      if (oldPhaseId) {
          const phase = dataStore.phases[oldPhaseId]
          if (phase) {
              phase.selectedAimIndex = Math.max(0, currentIndex - 1)
          }
      }
      
      // Adjust Old Parent Selection (if moved from sub-aim)
      if (oldParentId) {
          const oldP = dataStore.aims[oldParentId]
          if (oldP && oldP.selectedIncomingIndex !== undefined) {
              oldP.selectedIncomingIndex = Math.max(0, currentIndex - 1)
          }
      }
      
      // Adjust Floating Selection
      if (!oldPhaseId && !oldParentId) {
          this.floatingAimIndex = Math.max(0, currentIndex - 1)
      }

      try {
        // Perform backend mutations sequentially
        
        // 1. Connect to new parent FIRST
        await trpc.aim.connectAims.mutate({
            projectPath: this.projectPath,
            parentAimId: previousSiblingId,
            childAimId: currentAimId,
            parentIncomingIndex: insertionIndex,
            childSupportedAimsIndex: 0
        })

        // 2. Then disconnect from old location
        if (oldParentId) {
            // Get old parent's current incoming and filter out the child
            const oldParent = dataStore.aims[oldParentId]
            if (oldParent) {
                const oldParentConnections = oldParent.supportingConnections || []
                const updatedConnections = oldParentConnections.filter(c => c.aimId !== currentAimId)

                await trpc.aim.update.mutate({
                projectPath: this.projectPath,
                aimId: oldParentId,
                aim: { supportingConnections: updatedConnections }
                })
            }
            // Also update child's supportedAims to remove old parent
            await trpc.aim.update.mutate({
            projectPath: this.projectPath,
            aimId: currentAimId,
            aim: { supportedAims: currentAim.supportedAims.filter(id => id !== oldParentId) }
            })
        } else if (oldPhaseId) {
            // Remove from phase
            await trpc.aim.removeFromPhase.mutate({
            projectPath: this.projectPath,
            aimId: currentAimId,
            phaseId: oldPhaseId
            })
        }

        // Single reload pass
        const reloads = []

        reloads.push(
            trpc.aim.get.query({
            projectPath: this.projectPath,
            aimId: previousSiblingId
            }).then(updated => dataStore.replaceAim(previousSiblingId, updated))
        )

        if (oldParentId) {
            reloads.push(
            trpc.aim.get.query({
                projectPath: this.projectPath,
                aimId: oldParentId
            }).then(updated => dataStore.replaceAim(oldParentId, updated))
            )
        } else if (oldPhaseId) {
            reloads.push(
            trpc.phase.get.query({
                projectPath: this.projectPath,
                phaseId: oldPhaseId
            }).then(updated => dataStore.replacePhase(oldPhaseId, updated))
            )
        }

        await Promise.all(reloads)
      } catch (e) {
          console.error("Move failed", e)
      }
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
      const cutAimId = this.teleportCutAimId
      const source = this.teleportSource
      if (!cutAimId) return

      const path = this.getSelectionPath()
      const currentAim = path.aims[path.aims.length - 1]

      let destinationParentAimId: string | undefined
      let destinationPhaseId: string | undefined
      let destinationFloating = false
      let insertionIndex = 0

      if (path.aims.length > 1) {
        const parentAim = path.aims[path.aims.length - 2]
        if (!parentAim) return
        destinationParentAimId = parentAim.id
        insertionIndex = (parentAim.selectedIncomingIndex ?? 0) + 1
      } else if (path.phase) {
        destinationPhaseId = path.phase.id
        insertionIndex = (path.phase.selectedAimIndex ?? -1) + 1
      } else if (this.selectedColumn === -1) {
        destinationFloating = true
        insertionIndex = this.floatingAimIndex + 1
      } else {
        return
      }

      const cutAim = dataStore.aims[cutAimId]
      if (destinationParentAimId && cutAim && this.isAimInTree(destinationParentAimId, cutAim, dataStore)) {
        console.warn('Cannot paste aim into its own subtree')
        return
      }

      const sourceParentAimId = source?.parentAimId
      const sourcePhaseId = source?.phaseId

      try {
        if (destinationParentAimId && sourceParentAimId === destinationParentAimId) {
          await trpc.aim.connectAims.mutate({
            projectPath: this.projectPath,
            parentAimId: destinationParentAimId,
            childAimId: cutAimId,
            parentIncomingIndex: insertionIndex
          })
        } else if (destinationPhaseId && sourcePhaseId === destinationPhaseId) {
          await trpc.aim.commitToPhase.mutate({
            projectPath: this.projectPath,
            aimId: cutAimId,
            phaseId: destinationPhaseId,
            insertionIndex
          })
        } else {
          if (sourceParentAimId) {
            const sourceParent = dataStore.aims[sourceParentAimId]
            if (sourceParent) {
              const updatedConnections = (sourceParent.supportingConnections || []).filter((c: any) => c.aimId !== cutAimId)
              await trpc.aim.update.mutate({
                projectPath: this.projectPath,
                aimId: sourceParentAimId,
                aim: { supportingConnections: updatedConnections }
              })
            }
          } else if (sourcePhaseId) {
            await trpc.aim.removeFromPhase.mutate({
              projectPath: this.projectPath,
              aimId: cutAimId,
              phaseId: sourcePhaseId
            })
          }

          if (destinationParentAimId) {
            await trpc.aim.connectAims.mutate({
              projectPath: this.projectPath,
              parentAimId: destinationParentAimId,
              childAimId: cutAimId,
              parentIncomingIndex: insertionIndex
            })
          } else if (destinationPhaseId) {
            await trpc.aim.commitToPhase.mutate({
              projectPath: this.projectPath,
              aimId: cutAimId,
              phaseId: destinationPhaseId,
              insertionIndex
            })
          } else if (destinationFloating) {
            // Nothing to add in backend: floating means no parent and no phase.
          }
        }

        const reloads: Promise<any>[] = [
          trpc.aim.get.query({
            projectPath: this.projectPath,
            aimId: cutAimId
          }).then((updatedAim: any) => dataStore.replaceAim(cutAimId, updatedAim))
        ]

        if (sourceParentAimId) {
          reloads.push(
            trpc.aim.get.query({
              projectPath: this.projectPath,
              aimId: sourceParentAimId
            }).then((updatedAim: any) => dataStore.replaceAim(sourceParentAimId, updatedAim))
          )
        }

        if (destinationParentAimId) {
          reloads.push(
            trpc.aim.get.query({
              projectPath: this.projectPath,
              aimId: destinationParentAimId
            }).then((updatedAim: any) => dataStore.replaceAim(destinationParentAimId, updatedAim))
          )
        }

        if (sourcePhaseId) {
          reloads.push(
            trpc.phase.get.query({
              projectPath: this.projectPath,
              phaseId: sourcePhaseId
            }).then((updatedPhase: any) => dataStore.replacePhase(sourcePhaseId, updatedPhase))
          )
        }

        if (destinationPhaseId) {
          reloads.push(
            trpc.phase.get.query({
              projectPath: this.projectPath,
              phaseId: destinationPhaseId
            }).then((updatedPhase: any) => dataStore.replacePhase(destinationPhaseId, updatedPhase))
          )
        }

        await Promise.all(reloads)

        if (destinationParentAimId) {
          const destinationParent = dataStore.aims[destinationParentAimId]
          if (destinationParent) {
            destinationParent.expanded = true
            destinationParent.selectedIncomingIndex = Math.max(
              0,
              (destinationParent.supportingConnections || []).findIndex((c: any) => c.aimId === cutAimId)
            )
          }
        } else if (destinationPhaseId) {
          const destinationPhase = dataStore.phases[destinationPhaseId]
          if (destinationPhase) {
            destinationPhase.selectedAimIndex = Math.max(0, destinationPhase.commitments.indexOf(cutAimId))
          }
        } else if (destinationFloating) {
          await dataStore.loadFloatingAims(this.projectPath)
          const idx = dataStore.floatingAimsIds.indexOf(cutAimId)
          if (idx >= 0) this.floatingAimIndex = idx
        }

        this.clearTeleportBuffer()
      } catch (e) {
        console.error('Teleport paste failed', e)
      }
    },

    // Keyboard navigation handlers
    async handleColumnNavigationKeys(event: KeyboardEvent, dataStore: any) {
      const col = this.selectedColumn
      switch (event.key) {
        case 'Escape': 
          if(this.pendingDeletePhaseId) {
            this.pendingDeletePhaseId = null
          }
          break
        case 'j':
          if(col >= 0) {
            const currentIndex = this.getSelectedPhase(col)
            const phaseCount = this.getPhaseCount(col)
            if (currentIndex < phaseCount - 1) {
              await this.selectPhase(col, currentIndex + 1)
            } else {
              this.requestColumnScroll(col, 'bottom')
            }
          }
          break
        case 'k':
          if(col >= 0) {
            const currentIndex = this.getSelectedPhase(col)
            if (currentIndex > 0) {
              await this.selectPhase(col, currentIndex - 1)
            } else {
              this.requestColumnScroll(col, 'top')
            }
          }
          break
        case 'h':
          event.preventDefault()
          if (col >= 0) {
            this.pendingDeletePhaseId = null
            if (col === this.viewportStart && this.viewportStart > -1) {
              this.viewportStart--
            }
            this.setSelectedColumn(col - 1)
          }
          break
        case 'l':
          event.preventDefault()
          if (col < this.rightmostColumnIndex) {
            this.pendingDeletePhaseId = null
            const viewportEnd = this.viewportStart + this.viewportSize - 1
            if (col === viewportEnd) {
              const maxViewportStart = Math.max(0, this.rightmostColumnIndex - this.viewportSize + 1)
              if (this.viewportStart < maxViewportStart) {
                this.viewportStart++
              }
            }
            this.setSelectedColumn(col + 1)
          }
          break
        case 'i': {
          event.preventDefault()
          const dataStore = useDataStore()

          // Clear any pending deletion state
          this.pendingDeleteAimId = null

          // Initialize aim selection if needed
          if (this.selectedColumn >= 0) {
            const phaseId = this.getSelectedPhaseId(this.selectedColumn)
            if (phaseId) {
              const phase = dataStore.phases[phaseId]
              const aims = dataStore.getAimsForPhase(phaseId)
              if (phase && aims.length > 0 && phase.selectedAimIndex === undefined) {
                phase.selectedAimIndex = 0
              }
              this.navigatingAims = true
            }
          } else {
            // Initialize floating aim selection for root aims column
            const floatingAims = dataStore.floatingAims
            if (floatingAims.length > 0) {
              // Ensure floatingAimIndex is valid (within bounds)
              // This handles cases where localStorage had an old/invalid index
              if (this.floatingAimIndex < 0 || this.floatingAimIndex >= floatingAims.length) {
                this.floatingAimIndex = 0
              }
              // Activate navigation mode
              this.navigatingAims = true
            }
          }
          break
        }
        case 'e': {
          event.preventDefault()
          const col = this.selectedColumn

          // Can't edit in root aims column
          if (col === -1) break

          // Get selected phase ID and fetch phase data
          const selectedPhaseId = this.getSelectedPhaseId(col)
          if (!selectedPhaseId) break

          const selectedPhase = await trpc.phase.get.query({
            projectPath: this.projectPath,
            phaseId: selectedPhaseId
          })

          if (!selectedPhase) break

          this.openPhaseEditModal(
            selectedPhase.id,
            selectedPhase.name,
            selectedPhase.from,
            selectedPhase.to,
            selectedPhase.parent,
            col
          )
          break
        }
        case 'o':
        case 'O':
          event.preventDefault()
          if (this.selectedColumn === -1) {
            this.openAimModal()
          } else {
            this.openPhaseModal()
          }
          break
        case 'd': {
          event.preventDefault()
          const col = this.selectedColumn

          if (col === -1) {
            // Root aims column - delete aims
            if(this.navigatingAims) {
              const selectedIndex = this.getSelectedPhase(col)
              
              const aims = dataStore.floatingAims
              if (!aims || selectedIndex >= aims.length) break

              const aimToDelete = aims[selectedIndex]
              if (!aimToDelete) break

              // Check if this is confirmation (second press)
              if (this.pendingDeleteAimId === aimToDelete.id) {
                // Confirm delete
                await dataStore.deleteAim(aimToDelete.id)
                this.pendingDeleteAimId = null
              } else {
                // First press - mark for deletion
                this.setPendingDeleteAim(aimToDelete.id)
              }
            }
          } else {
            // Phase columns - delete phases
            // Get selected phase ID from store
            const selectedPhaseId = this.getSelectedPhaseId(col)
            if (!selectedPhaseId) break

            // Get the actual phase object to access its parent
            // We need to fetch it since we only have the ID
            const selectedPhase = await trpc.phase.get.query({
              projectPath: this.projectPath,
              phaseId: selectedPhaseId
            })

            if (!selectedPhase) break

            // Check if this is confirmation (second press)
            if (this.pendingDeletePhaseId === selectedPhase.id) {
              // Confirm delete
              const col = this.selectedColumn;
              const deletedIndex = this.getSelectedPhase(col);
              const parentId = selectedPhase.parent; // The parent of the column we are in

              await dataStore.deletePhase(selectedPhase.id, parentId)
              this.pendingDeleteAimId = null

              // After delete, reload the current column's data
              await dataStore.loadPhases(this.projectPath, parentId);

              // Get the new count and determine the new index to select
              const newCount = dataStore.getPhasesByParentId(parentId).length;
              const newIndex = Math.min(deletedIndex, Math.max(0, newCount - 1));

              // Now, re-run the selection cascade from the current column with the new index
              await this.selectPhase(col, newIndex);

            } else {
              // First press - mark for deletion
              this.setPendingDeletePhase(selectedPhase.id)
            }
          }
          break
        }
        case 'g':
          event.preventDefault()
          this.setView(this.currentView === 'columns' ? 'graph' : 'columns')
          break
      }
    },

    // Aims edit mode: j/k = navigate aims, J/K = move aims, h/l = expand/collapse, H = move out, d = delete, o/O = create, x/p = cut/paste teleport
    async handleAimNavigationKeys(event: KeyboardEvent, dataStore: any) {
      const path = this.getSelectionPath()
      const currentAim = path.aims[path.aims.length - 1]

      if (event.key === 'j') {
        await this.navigateDown()
        return
      }

      if (event.key === 'k') {
        await this.navigateUp()
        return
      }

      if (event.key === 'J') {
        event.preventDefault()
        await this.moveAimDown()
        return
      }

      if (event.key === 'K') {
        event.preventDefault()
        await this.moveAimUp()
        return
      }

      if (event.key === 'x') {
        event.preventDefault()
        this.cutAimForTeleport()
        return
      }

      if (event.key === 'p') {
        event.preventDefault()
        await this.pasteCutAim(dataStore)
        return
      }

      if (event.key === 'H') {
        event.preventDefault()
        await this.moveAimOut()
        return
      }

      if (event.key === 'L') {
        event.preventDefault()
        await this.moveAimIn()
        return
      }

      // Allow o/O even when no aims exist (for creating first aim)
      let creationPos = undefined as RelativePosition | undefined
      if (event.key === 'o') {
        event.preventDefault()
        creationPos = 'after' as const
      } else if(event.key === 'O') {
        event.preventDefault()
        creationPos = 'before' as const
      }
      if(creationPos !== undefined){
        this.showAimModal = true
        this.aimModalMode = 'create'
        this.aimModalInsertPosition = creationPos
      }

      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          if(this.pendingDeleteAimId) {
            this.pendingDeleteAimId = null
          } else {
            // Always exit aim navigation mode on ESC
            // This allows quick column switching without navigating through nested aims
            this.navigatingAims = false
          }
          break
        case 'e': {
          event.preventDefault()
          // Get the selected aim
          if (currentAim) {
            this.showAimModal = true
            this.aimModalMode = 'edit'
          }
          break
        }
        case 'd': {
          event.preventDefault()
          // Check if this is confirmation (second press)
          if (currentAim) {

            if (this.pendingDeleteAimId === currentAim.id) {
              // Confirm delete
              await dataStore.deleteAim(currentAim.id)
              this.pendingDeleteAimId = null
            } else {
              // First press - mark for deletion
              this.setPendingDeleteAim(currentAim.id)
            }
            break
          }
        }
        case 'h': {
          event.preventDefault()
          if(currentAim) {
            if(currentAim.expanded) {
              // 1. If expanded, collapse
              currentAim.expanded = false
            } else if (path.aims.length > 1) {
              // 2. If not expanded but is child, go to parent (keep expanded)
              const parentAim = path.aims[path.aims.length - 2]
              if (parentAim) {
                // Just deselect this child
                parentAim.selectedIncomingIndex = undefined
              }
            } else {
                // Top level collapsed: Collapse parent phase (switch to column mode?)
                // Or maybe collapse phase if in phase?
                // Currently 'h' in navigation mode stays in navigation mode.
                // If at root, do nothing? Or maybe exit navigation mode?
                // Let's keep it simple: do nothing if at root and collapsed.
            }
          }
          break
        }
        case 'l': {
          event.preventDefault()
          const currentAim = this.getCurrentAim()
          if (currentAim) {
            // Logic: First 'l' expands, second 'l' enters sub-aim selection
            if (!currentAim.expanded) {
              currentAim.expanded = true
              // Load children when expanding
              const connections = currentAim.supportingConnections || []
              if (connections.length > 0) {
                dataStore.loadAims(this.projectPath, connections.map(c => c.aimId))
              }
            } else {
              // Already expanded: Enter sub-aim selection
              if (currentAim.supportingConnections && currentAim.supportingConnections.length > 0) {
                if (currentAim.selectedIncomingIndex === undefined) {
                  currentAim.selectedIncomingIndex = 0
                }
              }
            }
          }
          break
        }
      }
    },

    resetViewState() {
      // Reset column/viewport state when switching projects
      this.selectedColumn = 0
      this.viewportStart = 0
      this.viewportSize = 2
      this.rightmostColumnIndex = 0
      this.floatingAimIndex = -1
      this.navigatingAims = false
      this.graphSelectedAimId = null
      this.selectedLink = null
      localStorage.setItem('aimparency-selected-column', '0')
    },
  }
})
