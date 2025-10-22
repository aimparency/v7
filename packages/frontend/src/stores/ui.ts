import { defineStore } from 'pinia'
import type { Hint } from 'shared'
import { timestampToLocalDate, timestampToLocalTime } from 'shared'
import { trpc } from '../trpc'
import { useDataStore, type Aim, type Phase } from './data'

type RelativePosition = 'before' | 'after' 

export const useUIStore = defineStore('ui', {
  state: () => ({
    // Project state
    projectPath: localStorage.getItem('aimparency-project-path') || '',
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
    newPhaseName: '',
    newPhaseStartDate: '',
    newPhaseStartTime: '',
    newPhaseEndDate: '',
    newPhaseEndTime: '',
    // TODO: remove these things. place the new phase based on the selection path. determine position on creation time
    phaseModalColumnIndex: 0, // Track which column the modal was opened from
    phaseModalParentPhase: null as any, // Track the parent phase for new phase creation
    phaseModalSelectedIndex: 0, // Track selected phase index for date calculation
    // TODO: instead just save: 
    phaseModalInsertPosition: 'before' as RelativePosition, 

  
    showAimModal: false,
    aimModalMode: 'create' as 'create' | 'edit',
    // TODO: remove these things. place the new aim based on the selection path. determine position on creation time
    aimModalEditingAimId: null as string | null, // Track which aim is being edited
    aimModalPhaseId: null as string | null, // Track phase to add aim to
    aimModalInsertionIndex: 0, // Track where to insert the aim
    aimModalParentAimId: null as string | null, // Track parent aim for sub-aim creation
    // TODO: instead just save:
    aimModalInsertPosition: 'before' as RelativePosition,

    // Navigation mode system
    navigatingAims: false, 
    
    // Column tracking for navigation
    rightmostColumnIndex: 0, // Track the rightmost (empty) column index
    selectedColumn: 0, // Currently selected column (visual selection)

    // Phase selection by column
    selectedPhaseByColumn: {} as Record<number, number>, // columnIndex -> phaseIndex
    selectedPhaseIdByColumn: {} as Record<number, string>, // columnIndex -> phaseId
    phaseCountByColumn: {} as Record<number, number>, // columnIndex -> total phase count
    columnParentPhaseId: { 0: null } as Record<number, string | null>, // columnIndex -> parent phase ID whose children this column shows (0 = root phases)

    // Root aims selection (for column -1)
    floatingAimIndex: 0,

    // Viewport for column scrolling
    viewportStart: -1, // Left edge of visible window
    viewportSize: 3, // Number of columns visible at once

    // Phase reload trigger (increment to force reload)
    phaseReloadTrigger: 0,

    // Delete pending states
    pendingDeletePhaseId: null as string | null,
    pendingDeleteAimId: null as string | null,

    // Remember last selected sub-phase index per parent phase
    // TODO: remove this store selected sub phase in phase object 
    lastSelectedSubPhaseIndexByPhase: {} as Record<string, number>,

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

    getSelectedPhaseId: (state) => (columnIndex: number): string | null => {
      return state.selectedPhaseIdByColumn[columnIndex] ?? null
    },

    getPhaseCount: (state) => (columnIndex: number): number => {
      return state.phaseCountByColumn[columnIndex] ?? 0
    },
  },
  
  actions: {
    setProjectPath(path: string) {
      this.projectPath = path
      if (path) {
        localStorage.setItem('aimparency-project-path', path)
      } else {
        localStorage.removeItem('aimparency-project-path')
      }
    },

    addProjectToHistory(path: string) {
      // Remove existing occurrences of this path
      this.projectHistory = this.projectHistory.filter(p => p.path !== path)

      // Add to top
      this.projectHistory.unshift({
        path,
        lastOpened: Date.now(),
        failedToLoad: false
      })

      // Limit to 30 entries
      this.projectHistory = this.projectHistory.slice(0, 30)

      // Save to localStorage
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    removeProjectFromHistory(path: string) {
      this.projectHistory = this.projectHistory.filter(p => p.path !== path)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    markProjectAsFailed(path: string) {
      const project = this.projectHistory.find(p => p.path === path)
      if (project) {
        project.failedToLoad = true
        localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
      }
    },

    clearProjectFailure(path: string) {
      const project = this.projectHistory.find(p => p.path === path)
      if (project) {
        project.failedToLoad = false
        localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
      }
    },
    
    setConnectionStatus(status: typeof this.connectionStatus) {
      this.connectionStatus = status
    },
    
    // Phase creation/editing actions
    openPhaseModal(columnIndex: number = 0, parentPhase: any = null, selectedIndex: number = 0) {
      this.showPhaseModal = true
      this.phaseModalMode = 'create'
      this.phaseModalEditingPhaseId = null
      this.newPhaseName = ''
      this.phaseModalColumnIndex = columnIndex
      this.phaseModalParentPhase = parentPhase
      this.phaseModalSelectedIndex = selectedIndex

      // Set default dates based on context
      const now = new Date()
      const currentDate = now.toISOString().split('T')[0] // YYYY-MM-DD
      const currentTime = now.toTimeString().slice(0, 5) // HH:MM

      // Priority 1: Copy from currently selected phase
      if (this.selectedColumn >= 0) {
        const selectedPhaseId = this.getSelectedPhaseId(this.selectedColumn)
        if (selectedPhaseId) {
          // We need to fetch the phase data to get its dates
          // For now, set a placeholder - the modal component will handle this
          this.newPhaseStartDate = currentDate
          this.newPhaseStartTime = currentTime
          this.newPhaseEndDate = currentDate
          this.newPhaseEndTime = currentTime
        }
      }

      // Priority 2: Copy from parent phase (one column to the left)
      if (!this.newPhaseStartDate && columnIndex > 0) {
        const parentColumn = columnIndex - 1
        const parentPhaseId = this.getSelectedPhaseId(parentColumn)
        if (parentPhaseId) {
          // We need to fetch the parent phase data to get its dates
          // For now, set a placeholder - the modal component will handle this
          this.newPhaseStartDate = currentDate
          this.newPhaseStartTime = currentTime
          this.newPhaseEndDate = currentDate
          this.newPhaseEndTime = currentTime
        }
      }

      // Priority 3: Default for root phases (column 1, "very first phase" scenario)
      if (!this.newPhaseStartDate) {
        // Current date 00:00 to current date + 7 days 00:00
        this.newPhaseStartDate = currentDate
        this.newPhaseStartTime = '00:00'
        const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        this.newPhaseEndDate = sevenDaysLater.toISOString().split('T')[0]
        this.newPhaseEndTime = '00:00'
      }
    },

    openPhaseEditModal(phaseId: string, phaseName: string, phaseFrom: number, phaseTo: number, columnIndex: number = 0) {
      this.showPhaseModal = true
      this.phaseModalMode = 'edit'
      this.phaseModalEditingPhaseId = phaseId
      this.newPhaseName = phaseName

      // Extract local date and time from timestamps
      this.newPhaseStartDate = timestampToLocalDate(phaseFrom)
      this.newPhaseStartTime = timestampToLocalTime(phaseFrom)
      this.newPhaseEndDate = timestampToLocalDate(phaseTo)
      this.newPhaseEndTime = timestampToLocalTime(phaseTo)

      this.phaseModalColumnIndex = columnIndex
    },

    closePhaseModal() {
      this.showPhaseModal = false
      this.phaseModalMode = 'create'
      this.phaseModalEditingPhaseId = null
      this.newPhaseName = ''
      this.newPhaseStartDate = ''
      this.newPhaseStartTime = ''
      this.newPhaseEndDate = ''
      this.newPhaseEndTime = ''
      this.phaseModalParentPhase = null
      this.phaseModalSelectedIndex = 0
    },
    
    // Aim creation/editing actions
    openAimModal(phaseId: string | null = null, insertionIndex: number = 0) {
      this.showAimModal = true
      this.aimModalMode = 'create'
      this.aimModalEditingAimId = null
      this.aimModalPhaseId = phaseId
      this.aimModalInsertionIndex = insertionIndex
      this.aimModalParentAimId = null
    },

    openAimEditModal(aimId: string, phaseId: string, aimIndex: number) {
      this.showAimModal = true
      this.aimModalMode = 'edit'
      this.aimModalEditingAimId = aimId
      this.aimModalPhaseId = phaseId
      this.aimModalInsertionIndex = aimIndex
    },

    closeAimModal() {
      this.showAimModal = false
      this.aimModalMode = 'create'
      this.aimModalEditingAimId = null
      this.aimModalPhaseId = null
      this.aimModalInsertionIndex = 0
      this.aimModalParentAimId = null
    },

    // Create aim and update selection
    async createAim(aimText: string, dataStore: any) {
      const phaseId = this.aimModalPhaseId
      const insertionIndex = this.aimModalInsertionIndex
      const parentAimId = this.aimModalParentAimId

      // Create the aim in data store
      const result = await dataStore.createAim(this.projectPath, {
        text: aimText,
        incoming: [],
        outgoing: parentAimId ? [parentAimId] : [],
        committedIn: [],
        status: { state: 'open', comment: '', date: Date.now() }
      })
      const aimId = result.id

      // Handle sub-aim vs top-level aim
      if (parentAimId) {
        // Sub-aim: update parent's incoming array
        const parentAim = dataStore.aims[parentAimId]
        if (parentAim) {
          const wasExpanded = parentAim.expanded
          const updatedIncoming = [...parentAim.incoming]
          updatedIncoming.splice(insertionIndex, 0, aimId)
          await dataStore.updateAim(this.projectPath, parentAimId, { incoming: updatedIncoming })

          if (wasExpanded) {
            dataStore.aims[parentAimId].expanded = true
          }

          // Select the newly created sub-aim
          parentAim.selectedIncomingIndex = insertionIndex
        }
      } else {
        // Top-level aim: commit to phase or root
        if (phaseId) {
          await dataStore.commitAimToPhase(this.projectPath, aimId, phaseId, insertionIndex)
          const aims = dataStore.getAimsForPhase(phaseId)
          const newAimIndex = aims.findIndex((aim: any) => aim.id === aimId)

          if (newAimIndex !== -1) {
            const phase = dataStore.phases[phaseId]
            if (phase) {
              phase.selectedAimIndex = newAimIndex
            }
          }
        } else {
          // Root aim
          const aims = dataStore.getAimsForPhase('null')
          const newAimIndex = aims.findIndex((aim: any) => aim.id === aimId)
          if (newAimIndex !== -1) {
            this.floatingAimIndex = newAimIndex
          }
        }
      }

      this.setMode('nav-aims')
      this.closeAimModal()
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

      // If current aim is expanded with incoming, dive into first child
      if (currentAim?.expanded && currentAim.incoming?.length > 0) {
        const firstIncomingId = currentAim.incoming[0]
        const topLevelIndex = this.findTopLevelAncestorIndex(firstIncomingId, topLevelAims, dataStore)
        return { aimId: firstIncomingId, topLevelIndex, parentAimId: currentAimId, indexInParent: 0 }
      }

      // Find current aim in tree and get next sibling or parent's next sibling
      return this.findNextSiblingOrAncestorSibling(currentAimId, topLevelAims, dataStore, null, -1)
    },

    // Helper to find previous aim in depth-first traversal
    findPreviousAimInTree(currentAimId: string, phaseId: string, dataStore: any): {aimId: string, topLevelIndex: number, parentAimId?: string, indexInParent?: number} | null {
      const topLevelAims = dataStore.getAimsForPhase(phaseId)
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

        // Check if aimId is nested in this aim's incoming
        if (aim.expanded && aim.incoming?.length > 0) {
          const incomingAims = aim.incoming.map((id: string) => dataStore.aims[id]).filter(Boolean)
          const result = this.findNextSiblingOrAncestorSibling(aimId, incomingAims, dataStore, aim.id, currentTopLevel)

          if (result) return result

          // If result is null, aimId was last in incoming, so next is this aim's next sibling
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
            const parentTopLevel = this.findTopLevelAncestorIndex(parentAimId, dataStore.getAimsForPhase(this.selectedAim?.phaseId || 'null'), dataStore)
            return { aimId: parentAimId, topLevelIndex: parentTopLevel }
          }
          return null
        }

        // Check nested
        if (aim.expanded && aim.incoming?.length > 0) {
          const incomingAims = aim.incoming.map((id: string) => dataStore.aims[id]).filter(Boolean)
          const result = this.findPreviousSiblingOrAncestor(aimId, incomingAims, dataStore, aim.id, currentTopLevel)
          if (result) return result
        }
      }
      return null
    },

    // Find last descendant of an aim (itself if not expanded, or last child's last descendant)
    findLastDescendant(aim: any, dataStore: any): {id: string, parentId?: string, indexInParent?: number} {
      if (!aim.expanded || !aim.incoming || aim.incoming.length === 0) {
        return { id: aim.id }
      }
      const lastIncomingId = aim.incoming[aim.incoming.length - 1]
      const lastIncoming = dataStore.aims[lastIncomingId]
      const descendant = this.findLastDescendant(lastIncoming, dataStore)
      return { ...descendant, parentId: aim.id, indexInParent: aim.incoming.length - 1 }
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
      if (!rootAim.incoming || rootAim.incoming.length === 0) return false

      for (const incomingId of rootAim.incoming) {
        const incomingAim = dataStore.aims[incomingId]
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

    // Navigation mode actions
    setMode(mode: 'column-navigation' | 'nav-aims' | 'aim-edit') {
      this.mode = mode
    },

    // Helper to get current aim context (replaces selectedAim)
    getCurrentAim() {
      const dataStore = useDataStore()
      if(this.selectedColumn === -1) {
        if(this.in)
        let aim = dataStore.getFloatingAimByIndex(this.floatingAimIndex)
        return this.getSelectedSubAim(aim)
      } else {

      }
    },

    getSelectedSubAim(aim: Aim): Aim {
      const dataStore = useDataStore()
      if(aim.selectedIncomingIndex) {
        const selectedSubAimUUID = aim.incoming[aim.selectedIncomingIndex]
        return this.getSelectedSubAim(dataStore.aims[selectedSubAimUUID])
      } else {
        return aim
      }
    },

    getCurrentAimContext(dataStore: any): { phaseId: string, aim: any, aimIndex: number } | null {
      if (this.mode !== 'nav-aims') return null

      if (this.selectedColumn === -1) {
        // Root aims
        const aims = dataStore.getAimsForPhase('null')
        const aim = aims[this.floatingAimIndex]
        return aim ? { phaseId: 'null', aim, aimIndex: this.floatingAimIndex } : null
      } else {
        // Phase aims
        const phaseId = this.getSelectedPhaseId(this.selectedColumn)
        if (!phaseId) return null
        const phase = dataStore.phases[phaseId]
        const aims = dataStore.getAimsForPhase(phaseId)
        const aimIndex = phase?.selectedAimIndex ?? 0
        const aim = aims[aimIndex]
        return aim ? { phaseId, aim, aimIndex } : null
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

    // Global keyboard handler - single source of truth for all navigation
    async handleGlobalKeydown(event: KeyboardEvent, dataStore: any) {
      console.log('[KEYDOWN]', event.key, 'mode:', this.mode, 'context:', this.getCurrentAimContext(dataStore))

      // Don't handle keys when modals are open
      if (this.showPhaseModal || this.showAimModal) return

      // Handle j/k navigation universally based on selection path
      if (event.key === 'j') {
        await this.navigateDown(dataStore)
        return
      }
      if (event.key === 'k') {
        await this.navigateUp(dataStore)
        return
      }

      if(this.navigatingAims) {
        await this.handleAimNavigationKeys(event, dataStore)
      } else {
        await this.handleColumnNavigationKeys(event, dataStore)
      }
    },

    // Universal navigation down (j) - works on selection path
    async navigateDown(dataStore: any) {
      this.clearPendingDelete()

      // Get selection path
      const path = this.getSelectionPath(dataStore)

      // Based on path length, determine what to navigate
      if (path.aimIndices.length === 0) {
        // Navigating phases in column
        const col = this.selectedColumn
        if (col === -1) {
          // Root aims
          const aims = dataStore.getAimsForPhase('null')
          if (this.floatingAimIndex < aims.length - 1) {
            this.floatingAimIndex++
          }
        } else {
          // Phases
          const currentIndex = this.getSelectedPhase(col)
          const phaseCount = this.phaseCountByColumn[col] ?? 0
          if (currentIndex < phaseCount - 1) {
            await this.selectPhase(col, currentIndex + 1)
          }
        }
      } else {
        // Navigating aims - try to increase deepest index
        const deepestIdx = path.aimIndices[path.aimIndices.length - 1]
        const deepestAim = path.aims[path.aims.length - 1]

        // First try to dive into expanded children
        if (deepestAim.expanded && deepestAim.incoming?.length > 0) {
          deepestAim.selectedIncomingIndex = 0
          return
        }

        // Try to increment current level
        const parentAim = path.aims.length > 1 ? path.aims[path.aims.length - 2] : null
        const siblings = parentAim
          ? parentAim.incoming.map((id: string) => dataStore.aims[id]).filter(Boolean)
          : dataStore.getAimsForPhase(path.phaseId)

        if (deepestIdx < siblings.length - 1) {
          if (parentAim) {
            parentAim.selectedIncomingIndex = deepestIdx + 1
          } else {
            this.setCurrentAimIndex(deepestIdx + 1, dataStore)
          }
          return
        }

        // Can't increment, pop up to parent and try again
        for (let i = path.aims.length - 2; i >= 0; i--) {
          const aim = path.aims[i]
          const idx = path.aimIndices[i]
          const parent = i > 0 ? path.aims[i - 1] : null
          const sibs = parent
            ? parent.incoming.map((id: string) => dataStore.aims[id]).filter(Boolean)
            : dataStore.getAimsForPhase(path.phaseId)

          if (idx < sibs.length - 1) {
            if (parent) {
              parent.selectedIncomingIndex = idx + 1
            } else {
              this.setCurrentAimIndex(idx + 1, dataStore)
            }
            // Clear deeper selections
            for (let j = i; j < path.aims.length; j++) {
              path.aims[j].selectedIncomingIndex = undefined
            }
            return
          }
        }
      }
    },

    // Universal navigation up (k) - works on selection path
    async navigateUp(dataStore: any) {
      this.clearPendingDelete()

      const path = this.getSelectionPath(dataStore)

      if (path.aimIndices.length === 0) {
        // Navigating phases
        const col = this.selectedColumn
        if (col === -1) {
          // Root aims
          if (this.floatingAimIndex > 0) {
            this.floatingAimIndex--
          }
        } else {
          // Phases
          const currentIndex = this.getSelectedPhase(col)
          if (currentIndex > 0) {
            await this.selectPhase(col, currentIndex - 1)
          }
        }
      } else {
        // Navigating aims
        const deepestIdx = path.aimIndices[path.aimIndices.length - 1]

        if (deepestIdx > 0) {
          // Move to previous sibling
          const parentAim = path.aims.length > 1 ? path.aims[path.aims.length - 2] : null
          const siblings = parentAim
            ? parentAim.incoming.map((id: string) => dataStore.aims[id]).filter(Boolean)
            : dataStore.getAimsForPhase(path.phaseId)

          if (parentAim) {
            parentAim.selectedIncomingIndex = deepestIdx - 1
          } else {
            this.setCurrentAimIndex(deepestIdx - 1, dataStore)
          }

          // Dive to last descendant of previous sibling
          let target = siblings[deepestIdx - 1]
          while (target.expanded && target.incoming?.length > 0) {
            const lastIdx = target.incoming.length - 1
            target.selectedIncomingIndex = lastIdx
            target = dataStore.aims[target.incoming[lastIdx]]
          }
        } else {
          // At first sibling, go to parent
          if (path.aims.length > 1) {
            path.aims[path.aims.length - 2].selectedIncomingIndex = undefined
            path.aims[path.aims.length - 1].selectedIncomingIndex = undefined
          }
        }
      }
    },

    // Get current selection path
    getSelectionPath(dataStore: any): {phaseId: string, aimIndices: number[], aims: any[]} {
      // Build path from root to current
      const aimIndices: number[] = []
      const aims: any[] = []
      let currentAim = context.aim

      while (currentAim) {
        if (currentAim.outgoing?.length > 0) {
          // Sub-aim
          const parentId = currentAim.outgoing[0]
          const parentAim = dataStore.aims[parentId]
          if (parentAim) {
            const idx = parentAim.incoming.indexOf(currentAim.id)
            aimIndices.unshift(idx)
            aims.unshift(currentAim)
            currentAim = parentAim
          } else break
        } else {
          // Top-level
          aimIndices.unshift(context.aimIndex)
          aims.unshift(currentAim)
          break
        }
      }

      return { phaseId: context.phaseId, aimIndices, aims }
    },

    // Keyboard navigation handlers
    async handleColumnNavigationKeys(event: KeyboardEvent, dataStore: any) {
      switch (event.key) {
        case 'h':
          event.preventDefault()
          this.navigateLeft()
          break
        case 'l':
          event.preventDefault()
          this.navigateRight()
          break
        case 'i': {
          event.preventDefault()
          // Get the selected phase to enter edit mode
          this.navigatingAims = true
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
            // Determine parent phase based on selected column
            const targetColumn = this.selectedColumn
            let parentPhaseId: string | null = null
            const selectedIndex = this.getSelectedPhase(targetColumn)

            if (targetColumn === 0) {
              // Creating in column 0 -> parent is null (root phase)
              parentPhaseId = null
            } else {
              // Creating in column 1+ -> parent is the selected phase in column to the left
              const parentColumn = targetColumn - 1
              parentPhaseId = this.getSelectedPhaseId(parentColumn)
            }

            this.openPhaseModal(targetColumn, parentPhaseId, selectedIndex)
          }
          break
        case 'd': {
          event.preventDefault()
          const col = this.selectedColumn

          if (col === -1) {
            // Root aims column - delete aims
            const selectedIndex = this.getSelectedPhase(col)
            const aims = dataStore.getAimsForPhase('null')
            if (!aims || selectedIndex >= aims.length) break

            const aimToDelete = aims[selectedIndex]
            if (!aimToDelete) break

            // Check if this is confirmation (second press)
            if (this.pendingDeleteAimId === aimToDelete.id) {
              // Confirm delete
              await dataStore.deleteAim(aimToDelete.id, 'null')
              this.clearPendingDelete()
            } else {
              // First press - mark for deletion
              this.setPendingDeleteAim(aimToDelete.id)
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
              this.clearPendingDelete()

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
      }
    },

    // Aims edit mode: j/k = navigate aims, Esc = exit, h/l = expand/collapse, d = delete, o/O = create
    async handleAimNavigationKeys(event: KeyboardEvent, dataStore: any) {
      const context = this.getCurrentAimContext(dataStore)

      // Allow Escape even when no aims exist
      if (event.key === 'Escape') {
        event.preventDefault()

        // If delete mode is active, only cancel it
        if (this.pendingDeleteAimId !== null) {
          this.clearPendingDelete()
          return
        }

        // Otherwise, exit aims-edit mode
        this.clearPendingDelete()

        // Indices stay in place (rootAimsSelectedIndex or phase.selectedAimIndex)
        // For root aims, also update selection in column navigation
        if (this.selectedColumn === -1 && context) {
          this.setSelection(-1, context.aimIndex)
        }

        this.setMode('column-navigation')
        return
      }

      // Allow o/O even when no aims exist (for creating first aim)
      if (event.key === 'o' || event.key === 'O') {
        event.preventDefault()

        // Get phaseId first to check if we have empty aims
        const phaseId = this.selectedColumn === -1 ? 'null' : this.getSelectedPhaseId(this.selectedColumn)
        if (!phaseId) return

        const aims = dataStore.getAimsForPhase(phaseId)

        // Handle first aim creation - don't need context for empty phase
        if (aims.length === 0) {
          const phaseIdForModal = phaseId === 'null' ? null : phaseId
          this.openAimModal(phaseIdForModal, 0)
          return
        }

        // Now get context for existing aims
        if (!context) return

        const currentAim = context.aim
        if (!currentAim) return

        // Check if we're in a sub-aim (has parent)
        const isSubAim = currentAim.outgoing && currentAim.outgoing.length > 0

        if (isSubAim) {
          // We're in a sub-aim - create sibling sub-aim
          const parentAimId = currentAim.outgoing[0]!
          const parentAim = dataStore.aims[parentAimId]
          if (!parentAim) return

          const currentIndexInParent = parentAim.incoming.indexOf(currentAim.id)
          if (currentIndexInParent === -1) return

          if (event.key === 'O') {
            // O: Create sibling at current index (above)
            this.createSubAim(context.phaseId, parentAim, currentIndexInParent)
          } else {
            // o: If current aim is expanded, create child at 0; else create sibling below
            if (currentAim.expanded) {
              this.createSubAim(context.phaseId, currentAim, 0)
            } else {
              this.createSubAim(context.phaseId, parentAim, currentIndexInParent + 1)
            }
          }
        } else {
          // We're at top level
          if (event.key === 'O') {
            // O: Create at current level at index aimIndex (above)
            const insertionIndex = context.aimIndex
            const phaseIdForModal = context.phaseId === 'null' ? null : context.phaseId
            this.openAimModal(phaseIdForModal, insertionIndex)
          } else {
            // o: If expanded, create sub-aim at index 0; else create at aimIndex + 1
            if (currentAim.expanded) {
              this.createSubAim(context.phaseId, currentAim, 0)
            } else {
              const insertionIndex = context.aimIndex + 1
              const phaseIdForModal = context.phaseId === 'null' ? null : context.phaseId
              this.openAimModal(phaseIdForModal, insertionIndex)
            }
          }
        }
        return
      }

      if (!context) return

      const aims = dataStore.getAimsForPhase(context.phaseId)

      // Ensure selected index is valid
      if (context.aimIndex >= aims.length) {
        // Fix invalid selection
        const validIndex = Math.min(context.aimIndex, aims.length - 1)
        this.setCurrentAimIndex(validIndex, dataStore)
        return
      }

      switch (event.key) {
        case 'e': {
          event.preventDefault()
          // Get the selected aim
          const currentAimId = context.aim.id
          if (currentAimId) {
            this.openAimEditModal(currentAimId, context.phaseId, context.aimIndex)
          }
          break
        }
        case 'd': {
          event.preventDefault()
          // Check if this is confirmation (second press)
          const currentAimId = context.aim.id
          if (!currentAimId) break

          if (this.pendingDeleteAimId === currentAimId) {
            // Confirm delete
            await dataStore.deleteAim(currentAimId, context.phaseId)
            this.clearPendingDelete()
          } else {
            // First press - mark for deletion
            this.setPendingDeleteAim(currentAimId)
          }
          break
        }
        case 'h': {
          event.preventDefault()
          // Collapse the current aim
          context.aim.expanded = false
          break
        }
        case 'l': {
          event.preventDefault()
          // Expand the current aim (even if it has no incoming aims)
          context.aim.expanded = true
          break
        }
      }
    },

    // Select a phase and cascade: load children, restore their selection, repeat
    async selectPhase(columnIndex: number, phaseIndex: number, isTopLevel = true) {
      const dataStore = useDataStore();

      // Set column focus only at top level (not during cascade recursion)
      if (isTopLevel) {
        this.setSelectedColumn(columnIndex);
        // Indices stay in place (rootAimsSelectedIndex, phase.selectedAimIndex)
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
        this.selectedPhaseIdByColumn[columnIndex + 1] = children[childIndex].id;
        this.setMinRightmost(columnIndex + 1);

        // Continue cascade (mark as not top level)
        await this.selectPhase(columnIndex + 1, childIndex, false);
      } else {
        this.columnParentPhaseId[columnIndex + 1] = phaseId;
        this.setRightmostColumn(columnIndex + 1);
      }

      // Set mode to column-navigation only at top level
      if (isTopLevel) {
        this.setMode('column-navigation');
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

    // Open modal to create a sub-aim (incoming aim) for an expanded aim
    createSubAim(phaseId: string, parentAim: any, insertionIndex: number = 0) {
      // Open modal with parent aim context - actual creation happens on modal confirm
      this.showAimModal = true
      this.aimModalMode = 'create'
      this.aimModalEditingAimId = null
      this.aimModalPhaseId = phaseId
      this.aimModalInsertionIndex = insertionIndex
      this.aimModalParentAimId = parentAim.id
    },

    // Click-to-select by aim ID (finds top-level index automatically)
    async selectAimById(columnIndex: number, phaseId: string, aimId: string) {
      const dataStore = useDataStore();

      // Check if this aim is already selected
      const context = this.getCurrentAimContext(dataStore)
      const isAlreadySelected = context?.aim?.id === aimId && this.selectedColumn === columnIndex

      if (isAlreadySelected) {
        // Aim is already selected - open edit modal instead
        this.openAimEditModal(aimId, phaseId, context!.aimIndex)
        return
      }

      const aims = dataStore.getAimsForPhase(phaseId)

      // Clear all selectedIncomingIndex first
      Object.values(dataStore.aims).forEach((aim: any) => {
        aim.selectedIncomingIndex = undefined
      })

      // Find the top-level aim index
      const topLevelIndex = aims.findIndex((a: any) => a.id === aimId)

      if (topLevelIndex >= 0) {
        // It's a top-level aim, use regular selectAim
        this.selectAim(columnIndex, phaseId, topLevelIndex)
      } else {
        // It's a nested aim - find its path from top-level ancestor
        const path = this.findPathToAim(aimId, aims, dataStore)

        if (path && path.length > 0) {
          // Set selectedIncomingIndex on each parent in the path
          for (let i = 0; i < path.length - 1; i++) {
            const parentAim = dataStore.aims[path[i].aimId]
            if (parentAim && path[i + 1].indexInParent !== undefined) {
              parentAim.selectedIncomingIndex = path[i + 1].indexInParent
            }
          }

          const topLevel = path[0]

          // Select column
          this.setSelectedColumn(columnIndex)

          // For non-root aims, ensure the phase is selected
          if (phaseId !== 'null' && columnIndex >= 0) {
            const parentId = this.columnParentPhaseId[columnIndex] ?? null
            const phases = dataStore.getPhasesByParentId(parentId)
            const phaseIndex = phases.findIndex(p => p.id === phaseId)

            if (phaseIndex !== -1) {
              this.selectedPhaseByColumn[columnIndex] = phaseIndex
              this.selectedPhaseIdByColumn[columnIndex] = phaseId
            }
          }

          this.setMode('nav-aims')
          this.setCurrentAimIndex(topLevel.topLevelIndex, dataStore)
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

      if (currentAim.incoming && currentAim.incoming.length > 0) {
        for (let i = 0; i < currentAim.incoming.length; i++) {
          const childId = currentAim.incoming[i]
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
    async selectAim(columnIndex: number, phaseId: string, aimIndex: number) {
      const dataStore = useDataStore();

      // Set column focus
      this.setSelectedColumn(columnIndex);

      // For non-root aims, ensure the phase is selected
      if (phaseId !== 'null' && columnIndex >= 0) {
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

      // Enter aims-edit mode
      this.setMode('nav-aims');

      // Set the current aim index
      this.setCurrentAimIndex(aimIndex, dataStore);
    },

    // Navigation with edge-triggered viewport scrolling
    navigateLeft() {
      const currentIndex = this.selectedColumn

      // Boundary check: can't go left of root aims column
      if (currentIndex === -1) return

      // Clear pending delete when navigating
      this.clearPendingDelete()

      // Edge-triggered viewport scroll
      if (currentIndex === this.viewportStart && this.viewportStart > -1) {
        this.viewportStart--
      }

      // Move selection
      this.selectedColumn = currentIndex - 1
    },

    navigateRight() {
      const currentIndex = this.selectedColumn

      // Boundary check: can't go right beyond empty column
      if (currentIndex >= this.rightmostColumnIndex) return

      // Clear pending delete when navigating
      this.clearPendingDelete()

      // Edge-triggered viewport scroll
      const viewportEnd = this.viewportStart + this.viewportSize - 1
      if (currentIndex === viewportEnd) {
        const maxViewportStart = Math.max(0, this.rightmostColumnIndex - this.viewportSize + 1)
        if (this.viewportStart < maxViewportStart) {
          this.viewportStart++
        }
      }

      // Move selection
      this.selectedColumn = currentIndex + 1
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

    clearPendingDelete() {
      // No need to save them here
      this.pendingDeletePhaseId = null
      this.pendingDeleteAimId = null
    },


  }
})