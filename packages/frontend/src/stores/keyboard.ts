import { defineStore } from 'pinia'
import { useUIStore } from './ui'
import { useDataStore } from './data'

export interface KeyAction {
  key: string
  description: string
  action: () => void | Promise<void>
}

export const useKeyboardStore = defineStore('keyboard', {
  state: () => ({
    // We'll track available actions for current context
  }),
  
  getters: {
    availableActions(): KeyAction[] {
      const ui = useUIStore()
      const data = useDataStore()
      
      const actions: KeyAction[] = []
      
      if (ui.isInProjectSelection) {
        // No keyboard shortcuts in project selection
        return []
      }
      
      if (ui.isInColumnNavigation) {
        actions.push(
          { key: 'h', description: 'move left', action: () => ui.moveFocusLeft() },
          { key: 'l', description: 'move right', action: () => ui.moveFocusRight() },
          { key: 'j', description: 'move down', action: () => this.handleMoveDown() },
          { key: 'k', description: 'move up', action: () => this.handleMoveUp() },
        )
        
        if (ui.focusedColumn === 'left' && data.leftColumnPhases.length > 0) {
          actions.push({ key: 'i', description: 'enter phase', action: () => ui.enterPhaseEdit() })
        }
        
        // Allow phase creation from right column, or from left column if no phases exist yet
        if (ui.focusedColumn === 'right' || (ui.focusedColumn === 'left' && data.leftColumnPhases.length === 0)) {
          actions.push(
            { key: 'o', description: 'add phase', action: () => ui.openPhaseModal() },
            { key: 'O', description: 'add phase', action: () => ui.openPhaseModal() }
          )
        }
      }
      
      if (ui.isInPhaseEdit) {
        actions.push(
          { key: 'Esc', description: 'exit phase', action: () => ui.exitPhaseEdit() },
          { key: 'j', description: 'next aim', action: () => ui.moveAimDown(data.currentPhaseAims.length) },
          { key: 'k', description: 'prev aim', action: () => ui.moveAimUp() },
          { key: 'l', description: 'expand aim', action: () => this.handleExpandAim() },
          { key: 'h', description: 'collapse aim', action: () => this.handleCollapseAim() },
          { key: 'o', description: 'add aim below', action: () => this.handleAddAimBelow() },
          { key: 'O', description: 'add aim above', action: () => this.handleAddAimAbove() },
          { key: 'i', description: 'edit aim', action: () => this.handleEditAim() }
        )
      }
      
      return actions
    },
    
    keyHelp(): Array<{ keys: string[], description: string }> {
      return this.availableActions.reduce((groups, action) => {
        // Group similar actions
        const existingGroup = groups.find(g => g.description === action.description)
        if (existingGroup) {
          existingGroup.keys.push(action.key)
        } else {
          groups.push({ keys: [action.key], description: action.description })
        }
        return groups
      }, [] as Array<{ keys: string[], description: string }>)
    }
  },
  
  actions: {
    async handleKeydown(event: KeyboardEvent) {
      const ui = useUIStore()
      
      // Don't handle keys when in project selection or when modals are open
      if (ui.isInProjectSelection || ui.showPhaseModal) {
        return
      }
      
      // Find matching action
      const action = this.availableActions.find(a => a.key === event.key)
      if (action) {
        event.preventDefault()
        await action.action()
      }
    },
    
    async handleMoveUp() {
      const ui = useUIStore()
      const data = useDataStore()
      
      const shouldReloadRight = ui.movePhaseUp()
      if (shouldReloadRight) {
        await data.loadRightColumn(ui.projectPath, ui.selectedPhaseIndex)
      }
    },
    
    async handleMoveDown() {
      const ui = useUIStore()
      const data = useDataStore()
      
      const maxIndex = ui.focusedColumn === 'left' 
        ? data.leftColumnPhases.length 
        : data.rightColumnPhases.length
      
      const shouldReloadRight = ui.movePhaseDown(maxIndex)
      if (shouldReloadRight) {
        await data.loadRightColumn(ui.projectPath, ui.selectedPhaseIndex)
      }
    },
    
    handleExpandAim() {
      const ui = useUIStore()
      const data = useDataStore()
      
      if (data.currentPhaseAims.length > ui.selectedAimIndex) {
        const aim = data.currentPhaseAims[ui.selectedAimIndex]
        if (aim.incoming.length > 0) {
          ui.toggleAimExpanded(aim.id)
        }
      }
    },
    
    handleCollapseAim() {
      const ui = useUIStore()
      const data = useDataStore()
      
      if (data.currentPhaseAims.length > ui.selectedAimIndex) {
        const aim = data.currentPhaseAims[ui.selectedAimIndex]
        ui.toggleAimExpanded(aim.id)
      }
    },
    
    handleAddAimBelow() {
      // TODO: Implement aim creation
      console.log('Add aim below')
    },
    
    handleAddAimAbove() {
      // TODO: Implement aim creation
      console.log('Add aim above')
    },
    
    handleEditAim() {
      const ui = useUIStore()
      ui.setMode('aim-edit')
    }
  }
})