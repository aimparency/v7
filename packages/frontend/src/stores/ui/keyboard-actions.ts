import { trpc } from '../../trpc'
import { useDataStore } from '../data'
import { useGraphUIStore } from './graph-store'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'
import { hasQueryFlag } from '../../utils/perf-log'
import { useHistoryStore } from '../history'

export async function handleGraphKeydownAction(uiStore: any, event: KeyboardEvent, dataStore: any) {
  const graphStore = useGraphUIStore()
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()
  if (event.key === ' ' && uiStore.multiSelectMode) {
    event.preventDefault()
    const ideaId = graphStore.graphSelectedIdeaId
    if (ideaId) uiStore.toggleMultiSelect(ideaId)
  } else if (event.key === 'd') {
    event.preventDefault()
    if (uiStore.multiSelectMode && uiStore.multiSelectCount > 0) {
      const deleted = await uiStore.requestBulkDelete()
      if (deleted) graphStore.setGraphSelection(null)
      return
    }
    const selectedLink = graphStore.selectedLink
    if (selectedLink) {
      const pendingLink = graphStore.pendingDeleteLink
      const isConfirmed =
        pendingLink?.parentId === selectedLink.parentId &&
        pendingLink?.childId === selectedLink.childId

      if (!isConfirmed) {
        graphStore.setPendingDeleteLink(selectedLink)
        return
      }

      const parent = dataStore.ideas[selectedLink.parentId]
      const child = dataStore.ideas[selectedLink.childId]
      if (!parent || !child) return

      const updatedConnections = (parent.supportingConnections || []).filter((connection: any) => connection.ideaId !== child.id)
      const updatedChildSupported = (child.supportedIdeas || []).filter((ideaId: string) => ideaId !== parent.id)

      dataStore.replaceIdea(parent.id, { ...parent, supportingConnections: updatedConnections })
      dataStore.replaceIdea(child.id, { ...child, supportedIdeas: updatedChildSupported })
      dataStore.recalculateValues()
      graphStore.deselectLink()

      await dataStore.updateIdea(projectStore.projectPath, parent.id, {
        supportingConnections: updatedConnections
      })
      await dataStore.updateIdea(projectStore.projectPath, child.id, {
        supportedIdeas: updatedChildSupported
      })
      return
    }

    const ideaId = graphStore.graphSelectedIdeaId
    if (!ideaId) return

    if (graphStore.pendingDeleteIdeaId === ideaId) {
      await dataStore.deleteIdea(ideaId)
      graphStore.setPendingDeleteIdea(null)
      graphStore.setGraphSelection(null)
    } else {
      graphStore.setPendingDeleteIdea(ideaId)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (graphStore.pendingDeleteLink) {
      graphStore.setPendingDeleteLink(null)
    } else if (graphStore.pendingDeleteIdeaId) {
      graphStore.setPendingDeleteIdea(null)
    } else {
      graphStore.setGraphSelection(null)
      graphStore.deselectLink()
    }
  } else if (event.key === 'e' || event.key === 'Enter') {
    event.preventDefault()
    const ideaId = graphStore.graphSelectedIdeaId
    if (uiStore.multiSelectMode && uiStore.multiSelectCount > 0) {
      modalStore.openIdeaEditModal(uiStore.multiSelectedIdeaIds[0], [...uiStore.multiSelectedIdeaIds])
    } else if (ideaId) {
      modalStore.openIdeaEditModal(ideaId, [ideaId])
    }
  }
}

// Move focus one column towards the root (left). Shared by the `h` key and
// right-swipe touch gesture.
export async function navigateColumnBackward(uiStore: any) {
  const col = uiStore.activeColumn
  if (col < 0) return

  uiStore.pendingDeletePhaseId = null
  const nextColumn = col - 1
  if (nextColumn < 0) {
    uiStore.setActiveColumn(-1)
    uiStore.ensureSelectionVisible()
  } else {
    if (nextColumn < uiStore.windowStart) {
      uiStore.windowStart = nextColumn
    }
    uiStore.setActiveColumn(nextColumn)
  }
}

// Move focus one column deeper (right), lazily loading the next column.
// Shared by the `l` key and left-swipe touch gesture.
export async function navigateColumnForward(uiStore: any, dataStore: any) {
  const col = uiStore.activeColumn
  uiStore.pendingDeletePhaseId = null

  if (col === -1) {
    uiStore.ensureColumnSelection(0)
    const rootEntries = dataStore.getSelectableColumnEntries(0)
    if (rootEntries.length > 0) {
      uiStore.ensureMaxColumn(0)
      uiStore.setActiveColumn(0)
      uiStore.ensureSelectionVisible()
      await uiStore.resolveSelectionPath(0, 'preserve', Math.min(uiStore.maxColumn, uiStore.getVisibleMaxColumn()))
    }
    return
  }

  if (col < 0) return

  const nextColumn = col + 1
  const windowEnd = uiStore.windowStart + uiStore.windowSize - 1
  const wasVisible = nextColumn <= windowEnd

  if (nextColumn > uiStore.maxColumn) {
    uiStore.ensureColumnSelection(nextColumn)
    // Only descend when the current selection is a phase with an owned child
    // entry; a selected placeholder has nothing to its right.
    if (uiStore.selectOwnedChild(nextColumn)) {
      uiStore.ensureMaxColumn(nextColumn)
    }
  }

  if (nextColumn <= uiStore.maxColumn) {
    if (nextColumn > windowEnd) {
      const maxWindowStart = Math.max(0, uiStore.maxColumn - uiStore.windowSize + 1)
      if (uiStore.windowStart < maxWindowStart) {
        uiStore.windowStart++
      }
    }
    uiStore.setActiveColumn(nextColumn)
    if (!wasVisible) {
      await uiStore.resolveSelectionPath(nextColumn, 'preserve', Math.min(uiStore.maxColumn, uiStore.getVisibleMaxColumn()))
    }
  }
}

export async function handleColumnNavigationKeysAction(uiStore: any, event: KeyboardEvent, dataStore: any) {
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()
  const col = uiStore.activeColumn

  const reorderSelectedPhase = async (delta: -1 | 1) => {
    if (col < 0) return

    const selectedEntry = uiStore.getSelectedPhaseEntry(col)
    if (!selectedEntry || selectedEntry.type !== 'phase') return

    const selectableEntries = dataStore.getSelectableColumnEntries(col)
    const currentSelectableIndex = selectableEntries.findIndex((entry: any) => entry.type === 'phase' && entry.phase.id === selectedEntry.phase.id)
    if (currentSelectableIndex < 0) return

    const targetSelectableIndex = currentSelectableIndex + delta
    const targetEntry = selectableEntries[targetSelectableIndex]
    if (!targetEntry) return

    if (targetEntry.parentPhaseId === selectedEntry.parentPhaseId) {
      const siblingIds = dataStore.getOrderedSiblingIds(selectedEntry.parentPhaseId)
      const currentIndex = siblingIds.indexOf(selectedEntry.phase.id)
      if (currentIndex < 0) return

      const targetIndex = currentIndex + delta
      const siblingCount = siblingIds.length
      if (targetIndex < 0 || targetIndex >= siblingCount) return

      await dataStore.reorderPhase(projectStore.projectPath, selectedEntry.phase.id, targetIndex)
    } else {
      const targetParentId = targetEntry.parentPhaseId ?? null
      const targetIndex =
        targetEntry.type === 'phase' && delta < 0
          ? targetEntry.childIndex + 1
          : targetEntry.childIndex

      await dataStore.movePhase(projectStore.projectPath, selectedEntry.phase.id, targetParentId, targetIndex)
    }

    uiStore.ensureColumnSelection(col)
    const nextIndex = uiStore.findSelectableIndexForPhase(col, selectedEntry.phase.id)
    if (nextIndex >= 0) {
      uiStore.setSelection(col, nextIndex)
      await uiStore.reconcilePhaseSelection(col, delta > 0 ? 'forward' : 'backward')
    }
  }

  switch (event.key) {
    case 'c': {
      // Mark the focused phase as the current/active phase.
      event.preventDefault()
      const entry = uiStore.getSelectedPhaseEntry(col)
      if (entry && entry.type === 'phase') {
        await uiStore.markPhaseAsCurrent(entry.phase.id)
      }
      break
    }
    case 'J':
      event.preventDefault()
      await uiStore.runStructuralEdit(() => reorderSelectedPhase(1))
      break
    case 'j':
      if (event.shiftKey) {
        event.preventDefault()
        await uiStore.runStructuralEdit(() => reorderSelectedPhase(1))
        break
      }
      if (col >= 0) {
        const moved = await uiStore.moveActivePhase(1)
        if (!moved) {
          uiStore.requestColumnScroll(col, 'bottom')
        }
      }
      break
    case 'K':
      event.preventDefault()
      await uiStore.runStructuralEdit(() => reorderSelectedPhase(-1))
      break
    case 'k':
      if (event.shiftKey) {
        event.preventDefault()
        await uiStore.runStructuralEdit(() => reorderSelectedPhase(-1))
        break
      }
      if (col >= 0) {
        const moved = await uiStore.moveActivePhase(-1)
        if (!moved) {
          uiStore.requestColumnScroll(col, 'top')
        }
      }
      break
    case 'h':
      event.preventDefault()
      await navigateColumnBackward(uiStore)
      break
    case 'l':
      event.preventDefault()
      await navigateColumnForward(uiStore, dataStore)
      break
    case 'i': {
      event.preventDefault()
      const localDataStore = useDataStore()

      const currentIdeaState = uiStore.getCurrentIdeaUIState()
      if (currentIdeaState) currentIdeaState.pendingDelete = false

      if (uiStore.activeColumn >= 0) {
        const selectableEntries = localDataStore.getSelectableColumnEntries(uiStore.activeColumn)
        if (selectableEntries.length > 0) {
          const selectedIndex = uiStore.getSelectedPhase(uiStore.activeColumn)
          const selectedEntry = selectableEntries[selectedIndex] ?? selectableEntries[0]
          if (selectedEntry?.type === 'phase') {
            uiStore.applyPhaseSelection(uiStore.activeColumn, selectableEntries.indexOf(selectedEntry))
            const selectedPhase = selectedEntry.phase
            const ideas = localDataStore.getIdeasForPhase(selectedPhase.id)
            if (ideas.length > 0 && selectedPhase.selectedIdeaIndex === undefined) {
              selectedPhase.selectedIdeaIndex = 0
            }
            uiStore.navigatingIdeas = true
          }
        }
      } else {
        const floatingIdeas = localDataStore.floatingIdeas
        if (floatingIdeas.length > 0) {
          if (uiStore.floatingIdeaIndex < 0 || uiStore.floatingIdeaIndex >= floatingIdeas.length) {
            uiStore.floatingIdeaIndex = 0
          }
          uiStore.navigatingIdeas = true
        }
      }
      break
    }
    case 'e': {
      event.preventDefault()
      const currentCol = uiStore.activeColumn

      if (currentCol === -1) break

      const selectedPhaseId = uiStore.getSelectedPhaseId(currentCol)
      if (!selectedPhaseId) break

      const selectedPhase = await trpc.phase.get.query({
        projectPath: projectStore.projectPath,
        phaseId: selectedPhaseId
      })

      if (!selectedPhase) break

      modalStore.openPhaseEditModal(
        selectedPhase.id,
        selectedPhase.name,
        selectedPhase.parent
      )
      break
    }
    case 'o':
    case 'O':
      event.preventDefault()
      if (uiStore.activeColumn === -1) {
        modalStore.openIdeaModal()
      } else {
        modalStore.openPhaseModal(event.key === 'o' ? 'after' : 'before')
      }
      break
    case 'd': {
      event.preventDefault()
      const currentCol = uiStore.activeColumn

      if (currentCol === -1) {
        if (uiStore.navigatingIdeas) {
          const selectedIndex = uiStore.getSelectedPhase(currentCol)

          const ideas = dataStore.floatingIdeas
          if (!ideas || selectedIndex >= ideas.length) break

          const ideaToDelete = ideas[selectedIndex]
          if (!ideaToDelete) break
          const ideaState = uiStore.ensureIdeaUIState(uiStore.floatingIdeaUIStates, ideaToDelete.id)

          if (ideaState.pendingDelete) {
            await dataStore.deleteIdea(ideaToDelete.id)
            ideaState.pendingDelete = false
          } else {
            ideaState.pendingDelete = true
          }
        }
      } else {
        const selectedPhaseId = uiStore.getSelectedPhaseId(currentCol)
        if (!selectedPhaseId) break

        const selectedPhase = await trpc.phase.get.query({
          projectPath: projectStore.projectPath,
          phaseId: selectedPhaseId
        })

        if (!selectedPhase) break

        if (uiStore.pendingDeletePhaseId === selectedPhase.id) {
          // The deleted phase's key disappears from the column, so capture its
          // position to select the entry that takes its place.
          const deletedIndex = uiStore.getSelectedPhase(currentCol)
          await dataStore.deletePhase(selectedPhase.id)
          uiStore.pendingDeletePhaseId = null

          uiStore.ensureColumnSelection(currentCol)
          const selectableEntries = dataStore.getSelectableColumnEntries(currentCol)
          const newIndex = Math.min(deletedIndex, Math.max(0, selectableEntries.length - 1))

          if (selectableEntries.length > 0) {
            await uiStore.selectPhase(currentCol, newIndex)
          } else {
            uiStore.applyPhaseSelection(currentCol, 0)
            uiStore.setMaxColumn(currentCol)
          }
        } else {
          uiStore.setPendingDeletePhase(selectedPhase.id)
        }
      }
      break
    }
    case 'Escape':
      event.preventDefault()
      if (uiStore.pendingDeletePhaseId) {
        uiStore.pendingDeletePhaseId = null
      }
      const escapePath = uiStore.getSelectionPath()
      const escapeIdeaState = escapePath.ideaStates[escapePath.ideaStates.length - 1]
      if (escapeIdeaState) escapeIdeaState.pendingDelete = false
      if (uiStore.navigatingIdeas) {
        uiStore.navigatingIdeas = false
      }
      break
    case 'g':
      event.preventDefault()
      uiStore.setView(projectStore.currentView === 'columns' ? 'graph' : 'columns')
      break
  }
}

export async function handleIdeaNavigationKeysAction(uiStore: any, event: KeyboardEvent, dataStore: any) {
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()
  const path = uiStore.getSelectionPath()
  const currentIdea = path.ideas[path.ideas.length - 1]
  const currentIdeaState = path.ideaStates[path.ideaStates.length - 1]

  if (event.key === 'j') {
    await uiStore.navigateDown()
    return
  }

  if (event.key === 'k') {
    await uiStore.navigateUp()
    return
  }

  if (event.key === 'J') {
    event.preventDefault()
    await uiStore.moveIdeaDown()
    return
  }

  if (event.key === 'K') {
    event.preventDefault()
    await uiStore.moveIdeaUp()
    return
  }

  if (event.key === 'x') {
    event.preventDefault()
    uiStore.cutIdeaForTeleport()
    return
  }

  if (event.key === 'c') {
    event.preventDefault()
    uiStore.copyIdeaForTeleport()
    return
  }

  if (event.key === 'p') {
    event.preventDefault()
    const modalStore = useUIModalStore()
    // Paste handles both cut and copy - prioritize cut if both are present
    if (modalStore.teleportCutIdeaId) {
      await uiStore.pasteCutIdea(dataStore)
    } else if (modalStore.teleportCopyIdeaId) {
      await uiStore.pasteCopiedIdea(dataStore)
    }
    return
  }

  if (event.key === 's') {
    event.preventDefault()
    if (currentIdea) {
      // Show parent paths
      modalStore.openParentPathsModal(currentIdea.id)
    }
    return
  }

  if (event.key === 'H') {
    event.preventDefault()
    await uiStore.moveIdeaOut()
    return
  }

  if (event.key === 'L') {
    event.preventDefault()
    await uiStore.moveIdeaIn()
    return
  }

  let creationPos: 'before' | 'after' | undefined
  if (event.key === 'o') {
    event.preventDefault()
    creationPos = 'after'
  } else if (event.key === 'O') {
    event.preventDefault()
    creationPos = 'before'
  }

  if (creationPos !== undefined && currentIdea) {
    modalStore.showIdeaModal = true
    modalStore.ideaModalInsertPosition = creationPos
  } else if (creationPos !== undefined && path.phase) {
    modalStore.showIdeaModal = true
    modalStore.ideaModalInsertPosition = creationPos
  }

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      if (uiStore.multiSelectMode) {
        uiStore.clearMultiSelect()
      } else if (currentIdeaState?.pendingDelete) {
        currentIdeaState.pendingDelete = false
      } else {
        uiStore.navigatingIdeas = false
      }
      break
    case ' ':
      if (currentIdea) {
        event.preventDefault()
        if (uiStore.multiSelectMode) {
          uiStore.toggleMultiSelect(currentIdea.id)
        } else {
          uiStore.enterMultiSelect(currentIdea.id)
        }
      }
      break
    case 'e':
    case 'Enter': {
      event.preventDefault()
      if (uiStore.multiSelectMode && uiStore.multiSelectCount > 0) {
        modalStore.openIdeaEditModal(uiStore.multiSelectedIdeaIds[0], [...uiStore.multiSelectedIdeaIds])
      } else if (currentIdea) {
        modalStore.openIdeaEditModal(currentIdea.id, [currentIdea.id])
      }
      break
    }
    case 'd': {
      event.preventDefault()
      if (uiStore.multiSelectMode && uiStore.multiSelectCount > 0) {
        await uiStore.requestBulkDelete()
      } else if (currentIdea) {
        if (currentIdeaState?.pendingDelete) {
          await dataStore.deleteIdea(currentIdea.id)
          currentIdeaState.pendingDelete = false
        } else {
          if (currentIdeaState) currentIdeaState.pendingDelete = true
        }
        break
      }
    }
      break
    case 'h': {
      event.preventDefault()
      if (currentIdeaState) {
        if (currentIdeaState.expanded) {
          currentIdeaState.expanded = false
        } else if (path.ideas.length > 1) {
          const parentIdeaState = path.ideaStates[path.ideaStates.length - 2]
          if (parentIdeaState) {
            parentIdeaState.selectedIncomingIndex = undefined
          }
        }
      }
      break
    }
    case 'l': {
      event.preventDefault()
      if (uiStore.activeColumn === -1) {
        uiStore.navigatingIdeas = false
        await handleColumnNavigationKeysAction(uiStore, event, dataStore)
        return
      }

      const selectedIdea = uiStore.getCurrentIdea()
      const selectedIdeaState = uiStore.getCurrentIdeaUIState()
      if (selectedIdea && selectedIdeaState) {
        if (!selectedIdeaState.expanded) {
          selectedIdeaState.expanded = true
          const connections = selectedIdea.supportingConnections || []
          if (connections.length > 0) {
            dataStore.loadIdeas(projectStore.projectPath, connections.map((connection: any) => connection.ideaId))
          }
        } else if (selectedIdea.supportingConnections && selectedIdea.supportingConnections.length > 0) {
          if (selectedIdeaState.selectedIncomingIndex === undefined) {
            selectedIdeaState.selectedIncomingIndex = 0
          }
        }
      }
      break
    }
  }
}

export async function handleGlobalKeydownAction(uiStore: any, event: KeyboardEvent, dataStore: any) {
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()
  if (hasQueryFlag('logkeys')) {
    console.log('[PhaseNav] keydown', {
      key: event.key,
      activeColumn: uiStore.activeColumn,
      navigatingIdeas: uiStore.navigatingIdeas,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      view: projectStore.currentView,
      modalOpen:
        modalStore.showPhaseModal ||
        modalStore.showIdeaModal ||
        modalStore.showIdeaSearch ||
        modalStore.showPhaseSearchPrompt ||
        modalStore.showIdeaEditModal ||
        modalStore.showSettingsModal
    })
  }

  if (event.ctrlKey || event.metaKey) return

  if (modalStore.showPhaseModal || modalStore.showIdeaModal || modalStore.showIdeaSearch || modalStore.showPhaseSearchPrompt || modalStore.showIdeaEditModal || modalStore.showSettingsModal) {
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return
  }

  if (event.key === '/') {
    event.preventDefault()
    modalStore.openIdeaSearch()
    return
  }

  if (event.key === 'u' || event.key === 'r') {
    event.preventDefault()
    const historyStore = useHistoryStore()
    await (event.key === 'u' ? historyStore.undo() : historyStore.redo())
    // The restored state may have removed or re-added the selected entries.
    if (projectStore.currentView === 'columns' && uiStore.activeColumn >= 0) {
      uiStore.ensureColumnSelection(uiStore.activeColumn)
    }
    return
  }

  if (event.key === 'g') {
    event.preventDefault()
    uiStore.setView(projectStore.currentView === 'columns' ? 'graph' : 'columns')
    return
  }

  if (projectStore.currentView === 'graph') {
    await uiStore.handleGraphKeydown(event, dataStore)
    return
  }

  if (uiStore.navigatingIdeas) {
    await uiStore.handleIdeaNavigationKeys(event, dataStore)
  } else {
    await uiStore.handleColumnNavigationKeys(event, dataStore)
  }
}
