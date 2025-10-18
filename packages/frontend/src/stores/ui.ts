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
    selectedAim: null as { phaseId: string, aimIndex: number } | null,

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
      console.log('Key pressed:', event.key, 'mode:', this.mode, 'column:', this.selectedColumn)

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
              this.scrollIntoViewIfNeeded()
            }
          } else {
            // Phase columns - navigate using selectedPhase
            const currentPhaseIndex = this.getSelectedPhase(col)
            const maxIndex = this.getPhaseCount(col) - 1
            console.log('asd')
            if (currentPhaseIndex < maxIndex) {
            console.log('asb')
              // Update parent phase selection (this will handle child column restoration)
              this.selectPhase(col, currentPhaseIndex + 1)
              this.scrollIntoViewIfNeeded()
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
              this.scrollIntoViewIfNeeded()
            }
          } else {
            // Phase columns - navigate using selectedPhase
            const currentPhaseIndex = this.getSelectedPhase(col)
            if (currentPhaseIndex > 0) {
              // Update parent phase selection (this will handle child column restoration)
              this.selectPhase(col, currentPhaseIndex - 1)
              this.scrollIntoViewIfNeeded()
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
            this.setSelectedAim(phaseId, aimIndex)
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
        this.openAimModal(selectedAim.phaseId, insertionIndex)
        return
      }

      if (!selectedAim) return

      const aims = dataStore.getAimsForPhase(selectedAim.phaseId)

      // Ensure selected index is valid
      if (selectedAim.aimIndex >= aims.length) {
        // Fix invalid selection
        const validIndex = Math.min(selectedAim.aimIndex, aims.length - 1)
        this.setSelectedAim(selectedAim.phaseId, validIndex)
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
          if (selectedAim.aimIndex < aims.length - 1) {
            const newIndex = selectedAim.aimIndex + 1
            this.setSelectedAim(selectedAim.phaseId, newIndex)
            if (selectedAim.phaseId !== 'null') {
              this.lastSelectedAimIndexByPhase[selectedAim.phaseId] = newIndex
            } else {
              this.lastSelectedRootAimIndex = newIndex
            }
            this.scrollIntoViewIfNeeded()
          } else {
            // Force scroll into view even when not moving
            this.scrollIntoViewIfNeeded()
          }
          this.clearPendingDelete() // Navigation cancels pending delete

          // Store sub-phase selection for persistence
          if (this.selectedColumn > 1) {
            const parentColumn = this.selectedColumn - 1
            const parentPhaseId = this.getSelectedPhaseId(parentColumn)
            if (parentPhaseId) {
              console.log(`Storing sub-phase selection: parent ${parentPhaseId} -> index ${this.getSelectedPhase(this.selectedColumn)}`)
              this.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = this.getSelectedPhase(this.selectedColumn)
            }
          }
          break
        }
        case 'k': {
          event.preventDefault()
          if (selectedAim.aimIndex > 0) {
            const newIndex = selectedAim.aimIndex - 1
            this.setSelectedAim(selectedAim.phaseId, newIndex)
            if (selectedAim.phaseId !== 'null') {
              this.lastSelectedAimIndexByPhase[selectedAim.phaseId] = newIndex
            } else {
              this.lastSelectedRootAimIndex = newIndex
            }
            this.scrollIntoViewIfNeeded()
          } else {
            // Force scroll into view even when not moving
            this.scrollIntoViewIfNeeded()
          }
          this.clearPendingDelete() // Navigation cancels pending delete

          // Store sub-phase selection for persistence
          if (this.selectedColumn > 1) {
            const parentColumn = this.selectedColumn - 1
            const parentPhaseId = this.getSelectedPhaseId(parentColumn)
            if (parentPhaseId) {
              console.log(`Storing sub-phase selection: parent ${parentPhaseId} -> index ${this.getSelectedPhase(this.selectedColumn)}`)
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
        case 'h':
          event.preventDefault()
          // TODO: Collapse aim
          break
        case 'l':
          event.preventDefault()
          // TODO: Expand aim or navigate to child column
          break
      }
    },

    // Aim edit mode: field editing
    handleAimEditKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.setMode('phase-edit')
      }
    },

    // Selects a phase and triggers the cascade of loading and selecting children.
    async selectPhase(columnIndex: number, phaseIndex: number) {
      const dataStore = useDataStore();

      // Get the actual phase ID from the data store
      const parentId = this.columnParentPhaseId[columnIndex] ?? null;
      const phases = dataStore.getPhasesByParentId(parentId);
      this.phaseCountByColumn[columnIndex] = phases.length;
      const phase = phases[phaseIndex];
      const phaseId = phase?.id;

      // Update selection for the current column
      this.selectedPhaseByColumn[columnIndex] = phaseIndex;
      if (phaseId) {
        this.selectedPhaseIdByColumn[columnIndex] = phaseId;
      } else {
        delete this.selectedPhaseIdByColumn[columnIndex];
      }

      // Clear state for deeper columns to prevent showing stale data
      // We set a non-existent parent ID to ensure they render as empty
      for (let i = columnIndex + 1; i <= this.rightmostColumnIndex; i++) {
        this.columnParentPhaseId[i] = 'cleared';
        this.phaseCountByColumn[i] = 0;
        this.selectedPhaseByColumn[i] = 0;
        delete this.selectedPhaseIdByColumn[i];
      }
      
      // If we are selecting a placeholder or an invalid index, stop the cascade.
      if (!phaseId) {
        this.setRightmostColumn(columnIndex);
        return;
      }

      // --- Start Cascade ---

      // Set the parent for the *next* column immediately.
      // The column will appear empty until the data is loaded.
      this.columnParentPhaseId[columnIndex + 1] = phaseId;

      // 1. Load children for the next column
      const children = await dataStore.loadPhases(this.projectPath, phaseId);
      this.phaseCountByColumn[columnIndex + 1] = children.length;
      
      // 2. Update column visibility
      this.setMinRightmost(columnIndex + 1);

      // 3. If children exist, select one and continue the cascade
      if (children.length > 0) {
        const rememberedIndex = this.lastSelectedSubPhaseIndexByPhase[phaseId] ?? 0;
        const childIndex = Math.min(rememberedIndex, children.length - 1);
        
        // Recursively call to continue the cascade
        await this.selectPhase(columnIndex + 1, childIndex);
      } else {
        // No children, this is the end of the line
        this.setRightmostColumn(columnIndex + 1);
      }
    },

    // Simply sets the selection for a column without triggering any loading.
    // Used for up/down keyboard navigation.
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

    setSelectedAim(phaseId: string | null, aimIndex: number | null) {
      if (phaseId === null || aimIndex === null) {
        this.selectedAim = null
      } else {
        this.selectedAim = { phaseId, aimIndex }
      }
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

    // Scroll selected element into 1/4 to 3/4 viewport range
    async scrollIntoViewIfNeeded() {
      await nextTick()

      // Find the active column's scrollable container
      const container = document.querySelector('.selected-outlined .phase-list, .selected-outlined .aims-list') as HTMLElement
      if (!container) return

      // Find the selected element
      const selected = container.querySelector('.phase-container.selected-outlined, .aim-item.selected-outlined') as HTMLElement
      if (!selected) return

      const selectedRect = selected.getBoundingClientRect()

      const viewportHeight = window.innerHeight
      const quarterMark = viewportHeight * 0.25
      const threeQuarterMark = viewportHeight * 0.75

      // Check if element is outside 1/4 to 3/4 range
      const isAboveRange = selectedRect.top < quarterMark
      const isBelowRange = selectedRect.bottom > threeQuarterMark

      if (!isAboveRange && !isBelowRange) return

      // Calculate target scroll position to keep element in range
      let targetScroll = container.scrollTop

      if (isBelowRange) {
        // Scroll down: position element so its bottom is at 3/4 mark
        const offset = selectedRect.bottom - threeQuarterMark
        targetScroll += offset
      } else if (isAboveRange) {
        // Scroll up: position element so its top is at 1/4 mark
        const offset = selectedRect.top - quarterMark
        targetScroll += offset
      }

      // Clamp to valid scroll range
      const maxScroll = container.scrollHeight - container.clientHeight
      targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

      container.scrollTo({ top: targetScroll, behavior: 'smooth' })
    },

  }
})