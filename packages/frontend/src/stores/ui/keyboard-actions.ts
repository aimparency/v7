import { trpc } from '../../trpc'
import { useDataStore } from '../data'
import { useGraphUIStore } from './graph-store'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'
import { hasQueryFlag } from '../../utils/perf-log'
import { useHistoryStore } from '../history'
import type { SelectionPath } from './navigation-helpers'
import { deleteIdeasAsking, removeIdeaFromList } from './idea-removal'

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

      graphStore.deselectLink()
      await dataStore.removeConnection(projectStore.projectPath, selectedLink.parentId, selectedLink.childId)
      return
    }

    const ideaId = graphStore.graphSelectedIdeaId
    if (!ideaId) return

    if (graphStore.pendingDeleteIdeaId === ideaId) {
      graphStore.setPendingDeleteIdea(null)
      if (await deleteIdeasAsking(dataStore, projectStore.projectPath, [ideaId])) graphStore.setGraphSelection(null)
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
    // Column 0 is always reachable, even without root phases: its empty state is
    // where the first phase gets created (o).
    uiStore.ensureColumnSelection(0)
    uiStore.ensureMaxColumn(0)
    uiStore.setActiveColumn(0)
    uiStore.ensureSelectionVisible()
    if (dataStore.getSelectableColumnEntries(0).length > 0) {
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

      // In the floating list 'd' is an idea key, handled while navigating ideas.
      if (currentCol === -1) break

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

// 'dd' in a list takes the selected idea out of the list it is shown in (its
// parent or phase), asking first if that would leave it unanchored. The
// selection then moves to the successor, or the new last entry.
async function removeSelectedIdea(uiStore: any, dataStore: any, projectPath: string, path: SelectionPath) {
  const idea = path.ideas[path.ideas.length - 1]!
  const parent = path.ideas[path.ideas.length - 2]
  const parentState = path.ideaStates[path.ideaStates.length - 2]
  const from = parent
    ? { context: { parentId: parent.id }, label: parent.text || '(untitled)' }
    : path.phase
      ? { context: { phaseId: path.phase.id }, label: path.phase.name }
      : null
  if (!await removeIdeaFromList(dataStore, projectPath, idea, from)) return

  // Counted without the removed idea: the change events may not have arrived yet.
  if (parent && parentState) {
    const remaining = (dataStore.ideas[parent.id]?.supportingConnections ?? [])
      .filter((connection: { ideaId: string }) => connection.ideaId !== idea.id).length
    parentState.selectedIncomingIndex = remaining > 0
      ? Math.min(parentState.selectedIncomingIndex ?? 0, remaining - 1)
      : undefined
    return
  }
  const siblings = (path.phase ? dataStore.getIdeasForPhase(path.phase.id) : dataStore.floatingIdeas)
    .filter((sibling: { id: string }) => sibling.id !== idea.id)
  if (siblings.length === 0) {
    uiStore.navigatingIdeas = false
  } else if (path.phase) {
    const phase = dataStore.phases[path.phase.id]
    if (phase?.selectedIdeaIndex !== undefined) phase.selectedIdeaIndex = Math.min(phase.selectedIdeaIndex, siblings.length - 1)
  } else {
    uiStore.floatingIdeaIndex = Math.min(uiStore.floatingIdeaIndex, siblings.length - 1)
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
          await removeSelectedIdea(uiStore, dataStore, projectStore.projectPath, path)
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

// u / r, plus the conventional Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z (Cmd on macOS).
function historyActionFor(event: KeyboardEvent): 'undo' | 'redo' | undefined {
  if (event.altKey) return undefined
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    return undefined
  }
  if (event.key === 'u') return 'undo'
  if (event.key === 'r') return 'redo'
  return undefined
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

  if (modalStore.showPhaseModal || modalStore.showIdeaModal || modalStore.showIdeaSearch || modalStore.showPhaseSearchPrompt || modalStore.showIdeaEditModal || modalStore.showSettingsModal) {
    return
  }

  const historyAction = historyActionFor(event)
  if (historyAction) {
    event.preventDefault()
    const historyStore = useHistoryStore()
    await (historyAction === 'undo' ? historyStore.undo() : historyStore.redo())
    // The restored state may have removed or re-added the selected entries.
    if (projectStore.currentView === 'columns' && uiStore.activeColumn >= 0) {
      uiStore.ensureColumnSelection(uiStore.activeColumn)
    }
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
