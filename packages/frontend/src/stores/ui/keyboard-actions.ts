import { trpc } from '../../trpc'
import { useDataStore } from '../data'
import { useGraphUIStore } from './graph-store'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'

export async function handleGraphKeydownAction(uiStore: any, event: KeyboardEvent, dataStore: any) {
  const graphStore = useGraphUIStore()
  const modalStore = useUIModalStore()
  if (event.key === 'd') {
    event.preventDefault()
    const aimId = graphStore.graphSelectedAimId
    if (!aimId) return

    if (uiStore.pendingDeleteAimId === aimId) {
      await dataStore.deleteAim(aimId)
      uiStore.pendingDeleteAimId = null
      graphStore.setGraphSelection(null)
    } else {
      uiStore.setPendingDeleteAim(aimId)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (uiStore.pendingDeleteAimId) {
      uiStore.pendingDeleteAimId = null
    } else {
      graphStore.setGraphSelection(null)
    }
  } else if (event.key === 'e') {
    event.preventDefault()
    const aimId = graphStore.graphSelectedAimId
    if (!aimId) return
    modalStore.openAimEditModal(aimId)
  }
}

export async function handleColumnNavigationKeysAction(uiStore: any, event: KeyboardEvent, dataStore: any) {
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()
  const col = uiStore.selectedColumn
  switch (event.key) {
    case 'j':
      if (col >= 0) {
        const currentIndex = uiStore.getSelectedPhase(col)
        const phaseCount = uiStore.getPhaseCount(col)
        if (currentIndex < phaseCount - 1) {
          await uiStore.selectPhase(col, currentIndex + 1)
        } else {
          uiStore.requestColumnScroll(col, 'bottom')
        }
      }
      break
    case 'k':
      if (col >= 0) {
        const currentIndex = uiStore.getSelectedPhase(col)
        if (currentIndex > 0) {
          await uiStore.selectPhase(col, currentIndex - 1)
        } else {
          uiStore.requestColumnScroll(col, 'top')
        }
      }
      break
    case 'h':
      event.preventDefault()
      if (col >= 0) {
        uiStore.pendingDeletePhaseId = null
        if (col === uiStore.viewportStart && uiStore.viewportStart > -1) {
          uiStore.viewportStart--
        }
        uiStore.setSelectedColumn(col - 1)
      }
      break
    case 'l':
      event.preventDefault()
      if (col < uiStore.rightmostColumnIndex) {
        uiStore.pendingDeletePhaseId = null
        const viewportEnd = uiStore.viewportStart + uiStore.viewportSize - 1
        if (col === viewportEnd) {
          const maxViewportStart = Math.max(0, uiStore.rightmostColumnIndex - uiStore.viewportSize + 1)
          if (uiStore.viewportStart < maxViewportStart) {
            uiStore.viewportStart++
          }
        }
        uiStore.setSelectedColumn(col + 1)
      }
      break
    case 'i': {
      event.preventDefault()
      const localDataStore = useDataStore()

      uiStore.pendingDeleteAimId = null

      if (uiStore.selectedColumn >= 0) {
        const parentId = uiStore.columnParentPhaseId[uiStore.selectedColumn] ?? null
        const phases = localDataStore.getPhasesByParentId(parentId)
        if (phases.length > 0) {
          const selectedIndex = uiStore.getSelectedPhase(uiStore.selectedColumn)
          const selectedPhase = phases[selectedIndex] ?? phases[0]
          if (selectedPhase) {
            uiStore.selectedPhaseByColumn[uiStore.selectedColumn] = phases.indexOf(selectedPhase)
            uiStore.selectedPhaseIdByColumn[uiStore.selectedColumn] = selectedPhase.id
            const aims = localDataStore.getAimsForPhase(selectedPhase.id)
            if (aims.length > 0 && selectedPhase.selectedAimIndex === undefined) {
              selectedPhase.selectedAimIndex = 0
            }
            uiStore.navigatingAims = true
          }
        }
      } else {
        const floatingAims = localDataStore.floatingAims
        if (floatingAims.length > 0) {
          if (uiStore.floatingAimIndex < 0 || uiStore.floatingAimIndex >= floatingAims.length) {
            uiStore.floatingAimIndex = 0
          }
          uiStore.navigatingAims = true
        }
      }
      break
    }
    case 'e': {
      event.preventDefault()
      const currentCol = uiStore.selectedColumn

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
        selectedPhase.from,
        selectedPhase.to,
        selectedPhase.parent
      )
      break
    }
    case 'o':
    case 'O':
      event.preventDefault()
      if (uiStore.selectedColumn === -1) {
        modalStore.openAimModal()
      } else {
        modalStore.openPhaseModal()
      }
      break
    case 'd': {
      event.preventDefault()
      const currentCol = uiStore.selectedColumn

      if (currentCol === -1) {
        if (uiStore.navigatingAims) {
          const selectedIndex = uiStore.getSelectedPhase(currentCol)

          const aims = dataStore.floatingAims
          if (!aims || selectedIndex >= aims.length) break

          const aimToDelete = aims[selectedIndex]
          if (!aimToDelete) break

          if (uiStore.pendingDeleteAimId === aimToDelete.id) {
            await dataStore.deleteAim(aimToDelete.id)
            uiStore.pendingDeleteAimId = null
          } else {
            uiStore.setPendingDeleteAim(aimToDelete.id)
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
          const parentId = selectedPhase.parent
          await dataStore.deletePhase(selectedPhase.id, parentId)
          uiStore.pendingDeletePhaseId = null

          await dataStore.loadPhases(projectStore.projectPath, parentId)

          const phases = dataStore.getPhasesByParentId(parentId)
          uiStore.phaseCountByColumn[currentCol] = phases.length
          const newIndex = Math.min(uiStore.selectedPhaseByColumn[currentCol] || 0, Math.max(0, phases.length - 1))

          if (phases.length > 0) {
            await uiStore.selectPhase(currentCol, newIndex)
          } else {
            uiStore.selectedPhaseByColumn[currentCol] = 0
            delete uiStore.selectedPhaseIdByColumn[currentCol]
            uiStore.setRightmostColumn(currentCol)
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
      if (uiStore.pendingDeleteAimId) {
        uiStore.pendingDeleteAimId = null
      }
      if (uiStore.navigatingAims) {
        uiStore.navigatingAims = false
      }
      break
    case 'g':
      event.preventDefault()
      uiStore.setView(projectStore.currentView === 'columns' ? 'graph' : 'columns')
      break
  }
}

export async function handleAimNavigationKeysAction(uiStore: any, event: KeyboardEvent, dataStore: any) {
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()
  const path = uiStore.getSelectionPath()
  const currentAim = path.aims[path.aims.length - 1]

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
    await uiStore.moveAimDown()
    return
  }

  if (event.key === 'K') {
    event.preventDefault()
    await uiStore.moveAimUp()
    return
  }

  if (event.key === 'x') {
    event.preventDefault()
    uiStore.cutAimForTeleport()
    return
  }

  if (event.key === 'c') {
    event.preventDefault()
    uiStore.copyAimForTeleport()
    return
  }

  if (event.key === 'p') {
    event.preventDefault()
    const modalStore = useUIModalStore()
    // Paste handles both cut and copy - prioritize cut if both are present
    if (modalStore.teleportCutAimId) {
      await uiStore.pasteCutAim(dataStore)
    } else if (modalStore.teleportCopyAimId) {
      await uiStore.pasteCopiedAim(dataStore)
    }
    return
  }

  if (event.key === 's') {
    event.preventDefault()
    if (currentAim) {
      // Show parent paths
      modalStore.openParentPathsModal(currentAim.id)
    }
    return
  }

  if (event.key === 'H') {
    event.preventDefault()
    await uiStore.moveAimOut()
    return
  }

  if (event.key === 'L') {
    event.preventDefault()
    await uiStore.moveAimIn()
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

  if (creationPos !== undefined && currentAim) {
    modalStore.showAimModal = true
    modalStore.aimModalMode = 'create'
    modalStore.aimModalInsertPosition = creationPos
  } else if (creationPos !== undefined && path.phase) {
    modalStore.showAimModal = true
    modalStore.aimModalMode = 'create'
    modalStore.aimModalInsertPosition = creationPos
  }

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      if (uiStore.pendingDeleteAimId) {
        uiStore.pendingDeleteAimId = null
      } else {
        uiStore.navigatingAims = false
      }
      break
    case 'e': {
      event.preventDefault()
      if (currentAim) {
        modalStore.openAimEditModal(currentAim.id)
      }
      break
    }
    case 'd': {
      event.preventDefault()
      if (currentAim) {
        if (uiStore.pendingDeleteAimId === currentAim.id) {
          await dataStore.deleteAim(currentAim.id)
          uiStore.pendingDeleteAimId = null
        } else {
          uiStore.setPendingDeleteAim(currentAim.id)
        }
        break
      }
    }
      break
    case 'h': {
      event.preventDefault()
      if (currentAim) {
        if (currentAim.expanded) {
          currentAim.expanded = false
        } else if (path.aims.length > 1) {
          const parentAim = path.aims[path.aims.length - 2]
          if (parentAim) {
            parentAim.selectedIncomingIndex = undefined
          }
        }
      }
      break
    }
    case 'l': {
      event.preventDefault()
      const selectedAim = uiStore.getCurrentAim()
      if (selectedAim) {
        if (!selectedAim.expanded) {
          selectedAim.expanded = true
          const connections = selectedAim.supportingConnections || []
          if (connections.length > 0) {
            dataStore.loadAims(projectStore.projectPath, connections.map((connection: any) => connection.aimId))
          }
        } else if (selectedAim.supportingConnections && selectedAim.supportingConnections.length > 0) {
          if (selectedAim.selectedIncomingIndex === undefined) {
            selectedAim.selectedIncomingIndex = 0
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
  console.log('pressed', event.key, '. nav aims? ', uiStore.navigatingAims)

  if (event.ctrlKey || event.metaKey) return

  if (modalStore.showPhaseModal || modalStore.showAimModal || modalStore.showAimSearch || modalStore.showPhaseSearchPrompt || modalStore.showAimEditModal || modalStore.showSettingsModal) {
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return
  }

  if (event.key === '/') {
    event.preventDefault()
    modalStore.openAimSearch()
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

  if (uiStore.navigatingAims) {
    await uiStore.handleAimNavigationKeys(event, dataStore)
  } else {
    await uiStore.handleColumnNavigationKeys(event, dataStore)
  }
}
