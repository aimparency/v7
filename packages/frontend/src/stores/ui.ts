import { defineStore } from 'pinia'
import { nextTick } from 'vue'
import type { Hint } from 'shared'
import { timestampToLocalDate, timestampToLocalTime } from 'shared'
import { trpc } from '../trpc'
import { useDataStore } from './data'

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
    phaseModalColumnIndex: 0, // Track which column the modal was opened from
    phaseModalParentPhase: null as any, // Track the parent phase for new phase creation
    phaseModalSelectedIndex: 0, // Track selected phase index for date calculation
    showAimModal: false,
    aimModalMode: 'create' as 'create' | 'edit',
    aimModalEditingAimId: null as string | null, // Track which aim is being edited
    aimModalPhaseId: null as string | null, // Track phase to add aim to
    aimModalInsertionIndex: 0, // Track where to insert the aim

    // Navigation mode system
    mode: 'column-navigation' as 'column-navigation' | 'phase-edit' | 'aim-edit',

    // Column tracking for navigation
    rightmostColumnIndex: 0, // Track the rightmost (empty) column index
    focusedColumnIndex: 0, // Track which column is currently focused (deprecated - use selectedColumn)
    selectedColumn: 0, // Currently selected column (visual selection)

    // Phase selection by column
    selectedPhaseByColumn: {} as Record<number, number>, // columnIndex -> phaseIndex
    selectedPhaseIdByColumn: {} as Record<number, string>, // columnIndex -> phaseId
    phaseCountByColumn: {} as Record<number, number>, // columnIndex -> total phase count
    columnParentPhaseId: { 0: null } as Record<number, string | null>, // columnIndex -> parent phase ID whose children this column shows (0 = root phases)

    // Aim selection (only set when in phase-edit or aim-edit mode)
    selectedAim: null as { phaseId: string, aimIndex: number, aimId?: string } | null,

    // Expanded aims tracking
    expandedAims: new Set<string>(),

    // Viewport for column scrolling
    viewportStart: -1, // Left edge of visible window
    viewportSize: 3, // Number of columns visible at once

    // Phase reload trigger (increment to force reload)
    phaseReloadTrigger: 0,

    // Delete pending states
    pendingDeletePhaseId: null as string | null,
    pendingDeleteAimIndex: null as number | null,

    // Remember last selected aim index for root aims
    lastSelectedRootAimIndex: 0,

    // Remember last selected aim index per phase
    lastSelectedAimIndexByPhase: {} as Record<string, number>,

    // Remember last selected sub-phase index per parent phase
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
    },
    
    // Keyboard hints actions
    setKeyboardHints(hints: Hint[]) {
      this.keyboardHints = hints
    },

    // Helper to build a flat list of all visible aims (including expanded nested ones)
    // Returns array of { aim, flatIndex } where flatIndex is the position in the flat list
    buildFlatAimList(phaseId: string, dataStore: any): Array<{ aim: any, flatIndex: number }> {
      const topLevelAims = dataStore.getAimsForPhase(phaseId)
      const flatList: Array<{ aim: any, flatIndex: number }> = []

      const addAimsRecursively = (aims: any[]) => {
        for (const aim of aims) {
          flatList.push({ aim, flatIndex: flatList.length })

          // If this aim is expanded, add its incoming aims recursively
          if (this.expandedAims.has(aim.id) && aim.incoming?.length > 0) {
            const incomingAims = aim.incoming
              .map((aimId: string) => dataStore.aims[aimId])
              .filter(Boolean)
            addAimsRecursively(incomingAims)
          }
        }
      }

      addAimsRecursively(topLevelAims)
      return flatList
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
    setMode(mode: 'column-navigation' | 'phase-edit' | 'aim-edit') {
      this.mode = mode
    },

    // Global keyboard handler - single source of truth for all navigation
    async handleGlobalKeydown(event: KeyboardEvent, dataStore: any) {
      // Don't handle keys when modals are open
      if (this.showPhaseModal || this.showAimModal) return

      const mode = this.mode

      if (mode === 'column-navigation') {
        await this.handleColumnNavigationKeys(event, dataStore)
      } else if (mode === 'phase-edit') {
        await this.handlePhaseEditKeys(event, dataStore)
      } else if (mode === 'aim-edit') {
        this.handleAimEditKeys(event)
      }
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
        case 'j': {
          event.preventDefault()
          this.clearPendingDelete() // Navigation cancels pending delete
          const col = this.selectedColumn

          if (col === -1) {
            // Root aims column - navigate using selectedPhase (since no aim is selected in column-navigation mode)
            const currentIndex = this.getSelectedPhase(col)
            const aims = dataStore.getAimsForPhase('null') || []
            if (aims.length > 0) {
              const newIndex = Math.min(currentIndex + 1, aims.length - 1)
              this.setSelection(col, newIndex)
              this.lastSelectedRootAimIndex = newIndex
            }
          } else {
            // Phase columns - navigate using selectedPhase
            const currentPhaseIndex = this.getSelectedPhase(col)
            const maxIndex = this.getPhaseCount(col) - 1
            if (currentPhaseIndex < maxIndex) {
              this.selectPhase(col, currentPhaseIndex + 1)
            }
          }
          break
        }
        case 'k': {
          event.preventDefault()
          this.clearPendingDelete() // Navigation cancels pending delete
          const col = this.selectedColumn

          if (col === -1) {
            // Root aims column - navigate using selectedPhase
            const currentIndex = this.getSelectedPhase(col)
            const aims = dataStore.getAimsForPhase('null') || []
            if (aims.length > 0) {
              const newIndex = Math.max(currentIndex - 1, 0)
              this.setSelection(col, newIndex)
              this.lastSelectedRootAimIndex = newIndex
            }
          } else {
            // Phase columns - navigate using selectedPhase
            const currentPhaseIndex = this.getSelectedPhase(col)
            if (currentPhaseIndex > 0) {
              // Update parent phase selection (this will handle child column restoration)
              this.selectPhase(col, currentPhaseIndex - 1)
            }
          }
          break
        }
        case 'i': {
          event.preventDefault()
          // Get the selected phase to enter edit mode
          const col = this.selectedColumn
          let phaseId: string | null = null
          let aimIndex = 0

          if (col === -1) {
            // Root aims column - use 'null' as phase ID
            phaseId = 'null'
            // Use the currently selected phase (root aim) index, clamped to valid range
            const aims = dataStore.getAimsForPhase('null') || []
            const selectedIndex = this.getSelectedPhase(col)
            aimIndex = Math.min(selectedIndex, Math.max(0, aims.length - 1))
          } else {
            // For all phase columns (0+), check if there are any phases
            const phaseCount = this.getPhaseCount(col)
            if (phaseCount === 0) {
              // No phases to edit aims in
              break
            }
            // Get the selected phase ID from store
            phaseId = this.getSelectedPhaseId(col)
            if (phaseId) {
              // If no aim is selected for this phase, select the last selected one
              if (!this.selectedAim || this.selectedAim.phaseId !== phaseId) {
                aimIndex = this.lastSelectedAimIndexByPhase[phaseId] ?? 0
              } else {
                aimIndex = this.selectedAim.aimIndex
              }
            }
          }

          if (phaseId) {
            this.setMode('phase-edit')
            // Get the aim to store its ID
            const aims = dataStore.getAimsForPhase(phaseId)
            const aim = aims[aimIndex]
            this.setSelectedAim(phaseId, aimIndex, aim?.id)
            if (phaseId === 'null') {
              this.lastSelectedRootAimIndex = aimIndex
            }
            // Also update selectedPhaseByColumn for consistency
            if (phaseId === 'null') {
              this.setSelection(col, aimIndex)
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

            // Check if this is confirmation (second press)
            if (this.pendingDeleteAimIndex === selectedIndex) {
              // Confirm delete
              await dataStore.deleteAim(aims[selectedIndex].id, 'null')
              this.clearPendingDelete()
            } else {
              // First press - mark for deletion
              this.setPendingDeleteAim(selectedIndex)
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

    // Phase edit mode: j/k = navigate aims, Esc = exit, h/l = expand/collapse, d = delete, o/O = create
    async handlePhaseEditKeys(event: KeyboardEvent, dataStore: any) {
      const selectedAim = this.selectedAim

      // Allow Escape even when no aims exist
      if (event.key === 'Escape') {
        event.preventDefault()
        this.clearPendingDelete()

        // Save last selected aim index for root aims
        if (selectedAim?.phaseId === 'null') {
          this.setSelection(-1, selectedAim.aimIndex)
        }

        this.setMode('column-navigation')
        this.setSelectedAim(null, null)
        return
      }

      // Allow o/O even when no aims exist (for creating first aim)
      if (event.key === 'o' || event.key === 'O') {
        event.preventDefault()
        if (!selectedAim) return
        const aims = dataStore.getAimsForPhase(selectedAim.phaseId)
        const insertionIndex = (aims && aims.length > 0)
          ? (event.key === 'o' ? selectedAim.aimIndex + 1 : selectedAim.aimIndex)
          : 0
        const phaseIdForModal = selectedAim.phaseId === 'null' ? null : selectedAim.phaseId;
        this.openAimModal(phaseIdForModal, insertionIndex)
        return
      }

      if (!selectedAim) return

      const aims = dataStore.getAimsForPhase(selectedAim.phaseId)

      // Ensure selected index is valid
      if (selectedAim.aimIndex >= aims.length) {
        // Fix invalid selection
        const validIndex = Math.min(selectedAim.aimIndex, aims.length - 1)
        const aim = aims[validIndex]
        this.setSelectedAim(selectedAim.phaseId, validIndex, aim?.id)
        if (selectedAim.phaseId !== 'null') {
          this.lastSelectedAimIndexByPhase[selectedAim.phaseId] = validIndex
        } else {
          this.lastSelectedRootAimIndex = validIndex
        }
        return
      }

      switch (event.key) {
        case 'j': {
          event.preventDefault()
          this.clearPendingDelete() // Navigation cancels pending delete

          // Build flat list of all visible aims
          const flatList = this.buildFlatAimList(selectedAim.phaseId, dataStore)

          // Find current aim in flat list using aimId if available, otherwise use index
          const currentAimId = selectedAim.aimId || aims[selectedAim.aimIndex]?.id
          const currentFlatIndex = flatList.findIndex(item => item.aim.id === currentAimId)

          if (currentFlatIndex >= 0 && currentFlatIndex < flatList.length - 1) {
            // Move to next aim in flat list
            const nextAim = flatList[currentFlatIndex + 1].aim

            // Find this aim's index in the top-level aims list
            const topLevelIndex = aims.findIndex((a: any) => a.id === nextAim.id)

            if (topLevelIndex >= 0) {
              // It's a top-level aim
              this.setSelectedAim(selectedAim.phaseId, topLevelIndex, nextAim.id)
              if (selectedAim.phaseId !== 'null') {
                this.lastSelectedAimIndexByPhase[selectedAim.phaseId] = topLevelIndex
              } else {
                this.lastSelectedRootAimIndex = topLevelIndex
              }
            } else {
              // It's a nested aim - keep the same aimIndex but update aimId
              this.setSelectedAim(selectedAim.phaseId, selectedAim.aimIndex, nextAim.id)
            }
          }

          // Store sub-phase selection for persistence
          if (this.selectedColumn > 1) {
            const parentColumn = this.selectedColumn - 1
            const parentPhaseId = this.getSelectedPhaseId(parentColumn)
            if (parentPhaseId) {
              this.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = this.getSelectedPhase(this.selectedColumn)
            }
          }
          break
        }
        case 'k': {
          event.preventDefault()
          this.clearPendingDelete() // Navigation cancels pending delete

          // Build flat list of all visible aims
          const flatList = this.buildFlatAimList(selectedAim.phaseId, dataStore)

          // Find current aim in flat list using aimId if available, otherwise use index
          const currentAimId = selectedAim.aimId || aims[selectedAim.aimIndex]?.id
          const currentFlatIndex = flatList.findIndex(item => item.aim.id === currentAimId)

          if (currentFlatIndex > 0) {
            // Move to previous aim in flat list
            const prevAim = flatList[currentFlatIndex - 1].aim

            // Find this aim's index in the top-level aims list
            const topLevelIndex = aims.findIndex((a: any) => a.id === prevAim.id)

            if (topLevelIndex >= 0) {
              // It's a top-level aim
              this.setSelectedAim(selectedAim.phaseId, topLevelIndex, prevAim.id)
              if (selectedAim.phaseId !== 'null') {
                this.lastSelectedAimIndexByPhase[selectedAim.phaseId] = topLevelIndex
              } else {
                this.lastSelectedRootAimIndex = topLevelIndex
              }
            } else {
              // It's a nested aim - keep the same aimIndex but update aimId
              this.setSelectedAim(selectedAim.phaseId, selectedAim.aimIndex, prevAim.id)
            }
          }

          // Store sub-phase selection for persistence
          if (this.selectedColumn > 1) {
            const parentColumn = this.selectedColumn - 1
            const parentPhaseId = this.getSelectedPhaseId(parentColumn)
            if (parentPhaseId) {
              this.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = this.getSelectedPhase(this.selectedColumn)
            }
          }
          break
        }
        case 'e': {
          event.preventDefault()
          // Get the selected aim
          const aim = aims[selectedAim.aimIndex]
          if (aim) {
            this.openAimEditModal(aim.id, selectedAim.phaseId, selectedAim.aimIndex)
          }
          break
        }
        case 'd': {
          event.preventDefault()
          // Check if this is confirmation (second press)
          if (this.pendingDeleteAimIndex === selectedAim.aimIndex) {
            // Confirm delete
            await dataStore.deleteAim(aims[selectedAim.aimIndex].id, selectedAim.phaseId)
            this.clearPendingDelete()
          } else {
            // First press - mark for deletion
            this.setPendingDeleteAim(selectedAim.aimIndex)
          }
          break
        }
        case 'h': {
          event.preventDefault()
          // Collapse the current aim
          const aim = aims[selectedAim.aimIndex]
          if (aim && this.expandedAims.has(aim.id)) {
            this.expandedAims.delete(aim.id)
          }
          break
        }
        case 'l': {
          event.preventDefault()
          // Expand the current aim (even if it has no incoming aims)
          const aim = aims[selectedAim.aimIndex]
          if (aim) {
            this.expandedAims.add(aim.id)
          }
          break
        }
      }
    },

    // Aim edit mode: field editing
    handleAimEditKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.setMode('phase-edit')
      }
    },

    // Select a phase and cascade: load children, restore their selection, repeat
    async selectPhase(columnIndex: number, phaseIndex: number, isTopLevel = true) {
      const dataStore = useDataStore();

      // Set column focus only at top level (not during cascade recursion)
      if (isTopLevel) {
        this.setSelectedColumn(columnIndex);
        this.setSelectedAim(null, null); // Clear aim selection
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

    setSelectedAim(phaseId: string | null, aimIndex: number | null, aimId?: string) {
      if (phaseId === null || aimIndex === null) {
        this.selectedAim = null
      } else {
        this.selectedAim = { phaseId, aimIndex, aimId }
      }
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

      // Enter phase-edit mode
      this.setMode('phase-edit');

      // Get the aim to store its ID
      const aims = dataStore.getAimsForPhase(phaseId)
      const aim = aims[aimIndex]

      // Set the selected aim
      this.setSelectedAim(phaseId, aimIndex, aim?.id);
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

      // Clear selectedAim unless we are on the root aims column
      if (this.selectedColumn !== -1) {
        this.setSelectedAim(null, null)
      }
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

      // Clear selectedAim unless we are on the root aims column
      if (this.selectedColumn !== -1) {
        this.setSelectedAim(null, null)
      }
    },

    triggerPhaseReload() {
      this.phaseReloadTrigger++
    },

    setPendingDeletePhase(phaseId: string | null) {
      this.pendingDeletePhaseId = phaseId
    },

    setPendingDeleteAim(aimIndex: number | null) {
      this.pendingDeleteAimIndex = aimIndex
    },

    clearPendingDelete() {
      // Remember last selected aim index before clearing
      if (this.selectedAim) {
        if (this.selectedAim.phaseId === 'null') {
          this.lastSelectedRootAimIndex = this.selectedAim.aimIndex
        } else {
          this.lastSelectedAimIndexByPhase[this.selectedAim.phaseId] = this.selectedAim.aimIndex
        }
      }
      this.pendingDeletePhaseId = null
      this.pendingDeleteAimIndex = null
      // Don't clear selectedAim here - only clear it when actually deleting or when leaving phase-edit mode
    },


  }
})