import { trpc } from '../../trpc'
import { useDataStore } from '../data'
import { isIdeaInTree as isIdeaInTreeHelper } from './navigation-helpers'
import { useProjectStore } from '../project-store'
import { useUIModalStore } from './modal-store'
import { ensureIdeaUIState } from './idea-ui-state'

function getProjectPath(): string {
  return useProjectStore().projectPath
}

export async function moveIdeaDownAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.ideas.length === 0) return

  const currentIdea = path.ideas[path.ideas.length - 1]!

  if (path.ideas.length > 1) {
    const parentIdea = path.ideas[path.ideas.length - 2]
    const parentState = path.ideaStates[path.ideaStates.length - 2]
    if (parentIdea && parentState?.selectedIncomingIndex !== undefined) {
      const currentIndex = parentState.selectedIncomingIndex
      const parentConnections = parentIdea.supportingConnections || []

      if (currentIndex < parentConnections.length - 1) {
        const nextIndex = currentIndex + 1

        if (parentIdea.supportingConnections) {
          const temp = parentIdea.supportingConnections[currentIndex]!
          parentIdea.supportingConnections[currentIndex] = parentIdea.supportingConnections[nextIndex]!
          parentIdea.supportingConnections[nextIndex] = temp
        }
        parentState.selectedIncomingIndex = nextIndex

        try {
          await trpc.idea.connectIdeas.mutate({
            projectPath: getProjectPath(),
            parentIdeaId: parentIdea.id,
            childIdeaId: currentIdea.id,
            parentIncomingIndex: nextIndex,
            childSupportedIdeasIndex: currentIdea.supportedIdeas.indexOf(parentIdea.id)
          })

          const updatedParent = await trpc.idea.get.query({
            projectPath: getProjectPath(),
            ideaId: parentIdea.id
          })
          dataStore.replaceIdea(parentIdea.id, updatedParent)

          parentState.selectedIncomingIndex = nextIndex
        } catch (e) {
          console.error('Move failed', e)
        }
      }
    }
  } else if (path.phase) {
    const phaseId = path.phase.id
    const currentIndex = path.phase.selectedIdeaIndex!

    if (currentIndex < path.phase.commitments.length - 1) {
      const nextIndex = currentIndex + 1

      const ph = dataStore.phases[phaseId]
      if (ph && ph.commitments) {
        const temp = ph.commitments[currentIndex]!
        ph.commitments[currentIndex] = ph.commitments[nextIndex]!
        ph.commitments[nextIndex] = temp
        ph.selectedIdeaIndex = nextIndex
      }

      try {
        await trpc.idea.commitToPhase.mutate({
          projectPath: getProjectPath(),
          ideaId: currentIdea.id,
          phaseId,
          insertionIndex: nextIndex
        })

        const updatedPhase = await trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId
        })
        dataStore.replacePhase(phaseId, updatedPhase)

        const reloadedPhase = dataStore.phases[phaseId]
        if (reloadedPhase) {
          reloadedPhase.selectedIdeaIndex = nextIndex
        }
      } catch (e) {
        console.error('Move failed', e)
      }
    } else {
      const col = uiStore.activeColumn
      const allPhasesAtLevel = col >= 0 ? dataStore.getActualPhasesForColumn(col) : []
      const flatIndex = allPhasesAtLevel.findIndex((p: any) => p.id === phaseId)

      const nextPhase = flatIndex !== -1 && flatIndex < allPhasesAtLevel.length - 1
        ? allPhasesAtLevel[flatIndex + 1]
        : undefined

      if (nextPhase) {
        const nextPhaseId = nextPhase.id

        const ph = dataStore.phases[phaseId]
        if (ph && ph.commitments) {
          ph.commitments.splice(currentIndex, 1)
        }
        const nextPh = dataStore.phases[nextPhaseId]
        if (nextPh) {
          if (!nextPh.commitments) nextPh.commitments = []
          nextPh.commitments.unshift(currentIdea.id)
          nextPh.selectedIdeaIndex = 0
        }

        if (col >= 0) {
          const nextPhaseIndex = uiStore.findSelectableIndexForPhase(col, nextPhaseId)
          if (nextPhaseIndex >= 0) {
            await uiStore.selectPhase(col, nextPhaseIndex, 'preserve')
          }
        }

        try {
          await trpc.idea.removeFromPhase.mutate({
            projectPath: getProjectPath(),
            ideaId: currentIdea.id,
            phaseId
          })
          await trpc.idea.commitToPhase.mutate({
            projectPath: getProjectPath(),
            ideaId: currentIdea.id,
            phaseId: nextPhaseId,
            insertionIndex: 0
          })

          const [updatedOld, updatedNew] = await Promise.all([
            trpc.phase.get.query({ projectPath: getProjectPath(), phaseId }),
            trpc.phase.get.query({ projectPath: getProjectPath(), phaseId: nextPhaseId })
          ])
          dataStore.replacePhase(phaseId, updatedOld)
          dataStore.replacePhase(nextPhaseId, updatedNew)

          const reloadedNew = dataStore.phases[nextPhaseId]
          if (reloadedNew) reloadedNew.selectedIdeaIndex = 0
        } catch (e) {
          console.error('Move across phases failed', e)
        }
      }
    }
  }
}

export async function moveIdeaUpAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.ideas.length === 0) return

  const currentIdea = path.ideas[path.ideas.length - 1]!

  if (path.ideas.length > 1) {
    const parentIdea = path.ideas[path.ideas.length - 2]
    const parentState = path.ideaStates[path.ideaStates.length - 2]
    if (parentIdea && parentState?.selectedIncomingIndex !== undefined) {
      const currentIndex = parentState.selectedIncomingIndex
      if (currentIndex > 0) {
        const prevIndex = currentIndex - 1

        if (parentIdea.supportingConnections) {
          const temp = parentIdea.supportingConnections[currentIndex]!
          parentIdea.supportingConnections[currentIndex] = parentIdea.supportingConnections[prevIndex]!
          parentIdea.supportingConnections[prevIndex] = temp
        }
        parentState.selectedIncomingIndex = prevIndex

        try {
          await trpc.idea.connectIdeas.mutate({
            projectPath: getProjectPath(),
            parentIdeaId: parentIdea.id,
            childIdeaId: currentIdea.id,
            parentIncomingIndex: prevIndex,
            childSupportedIdeasIndex: currentIdea.supportedIdeas.indexOf(parentIdea.id)
          })

          const updatedParent = await trpc.idea.get.query({
            projectPath: getProjectPath(),
            ideaId: parentIdea.id
          })
          dataStore.replaceIdea(parentIdea.id, updatedParent)

          parentState.selectedIncomingIndex = prevIndex
        } catch (e) {
          console.error('Move failed', e)
        }
      }
    }
  } else if (path.phase) {
    const phaseId = path.phase.id
    const currentIndex = path.phase.selectedIdeaIndex!

    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1
      const ph = dataStore.phases[phaseId]
      if (ph && ph.commitments) {
        const temp = ph.commitments[currentIndex]!
        ph.commitments[currentIndex] = ph.commitments[prevIndex]!
        ph.commitments[prevIndex] = temp
        ph.selectedIdeaIndex = prevIndex
      }

      try {
        await trpc.idea.commitToPhase.mutate({
          projectPath: getProjectPath(),
          ideaId: currentIdea.id,
          phaseId,
          insertionIndex: prevIndex
        })

        const updatedPhase = await trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId
        })
        dataStore.replacePhase(phaseId, updatedPhase)

        const reloadedPhase = dataStore.phases[phaseId]
        if (reloadedPhase) {
          reloadedPhase.selectedIdeaIndex = prevIndex
        }
      } catch (e) {
        console.error('Move failed', e)
      }
    } else {
      const col = uiStore.activeColumn
      const allPhasesAtLevel = col >= 0 ? dataStore.getActualPhasesForColumn(col) : []
      const flatIndex = allPhasesAtLevel.findIndex((p: any) => p.id === phaseId)

      const prevPhase = flatIndex > 0 ? allPhasesAtLevel[flatIndex - 1] : undefined

      if (prevPhase) {
        const prevPhaseId = prevPhase.id

        const ph = dataStore.phases[phaseId]
        if (ph && ph.commitments) {
          ph.commitments.splice(currentIndex, 1)
        }
        const prevPh = dataStore.phases[prevPhaseId]
        let newIndex = 0
        if (prevPh) {
          if (!prevPh.commitments) prevPh.commitments = []
          newIndex = prevPh.commitments.length
          prevPh.commitments.push(currentIdea.id)
          prevPh.selectedIdeaIndex = newIndex
        }

        if (col >= 0) {
          const prevPhaseIndex = uiStore.findSelectableIndexForPhase(col, prevPhaseId)
          if (prevPhaseIndex >= 0) {
            await uiStore.selectPhase(col, prevPhaseIndex, 'preserve')
          }
        }

        try {
          await trpc.idea.removeFromPhase.mutate({
            projectPath: getProjectPath(),
            ideaId: currentIdea.id,
            phaseId
          })
          await trpc.idea.commitToPhase.mutate({
            projectPath: getProjectPath(),
            ideaId: currentIdea.id,
            phaseId: prevPhaseId,
            insertionIndex: newIndex
          })

          const [updatedOld, updatedNew] = await Promise.all([
            trpc.phase.get.query({ projectPath: getProjectPath(), phaseId }),
            trpc.phase.get.query({ projectPath: getProjectPath(), phaseId: prevPhaseId })
          ])
          dataStore.replacePhase(phaseId, updatedOld)
          dataStore.replacePhase(prevPhaseId, updatedNew)

          const reloadedPrev = dataStore.phases[prevPhaseId]
          if (reloadedPrev) reloadedPrev.selectedIdeaIndex = reloadedPrev.commitments.length - 1
        } catch (e) {
          console.error('Move across phases failed', e)
        }
      }
    }
  }
}

export async function moveIdeaOutAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.ideas.length <= 1) return

  const currentIdea = path.ideas[path.ideas.length - 1]!
  const currentIdeaId = currentIdea.id
  const parentIdea = path.ideas[path.ideas.length - 2]
  if (!parentIdea) return

  const parentId = parentIdea.id
  const parentConnections = parentIdea.supportingConnections || []
  const updatedConnections = parentConnections.filter((c: any) => c.ideaId !== currentIdeaId)
  const updatedSupportedIdeas = currentIdea.supportedIdeas.filter((id: string) => id !== parentId)

  let grandparentId: string | undefined
  let newIndex: number | undefined
  let targetPhaseId: string | undefined

  if (path.ideas.length > 2) {
    const grandparentIdea = path.ideas[path.ideas.length - 3]!
    const grandparentState = path.ideaStates[path.ideaStates.length - 3]!
    grandparentId = grandparentIdea.id
    const parentIndexInGrandparent = grandparentState.selectedIncomingIndex!
    newIndex = parentIndexInGrandparent + 1
  } else if (path.phase) {
    targetPhaseId = path.phase.id
    const parentIndex = path.phase.selectedIdeaIndex!
    newIndex = parentIndex + 1
  } else {
    const parentIndex = dataStore.floatingIdeas.findIndex((a: any) => a.id === parentId)
    if (parentIndex !== -1) {
      newIndex = parentIndex + 1
    }
  }

  if (parentIdea.supportingConnections) {
    parentIdea.supportingConnections = updatedConnections
  }
  currentIdea.supportedIdeas = updatedSupportedIdeas

  if (grandparentId) {
    const gp = dataStore.ideas[grandparentId]
    if (gp && newIndex !== undefined) {
      if (!gp.supportingConnections) gp.supportingConnections = []
      gp.supportingConnections.splice(newIndex, 0, { ideaId: currentIdeaId, weight: 1 } as any)
      const gpState = path.ideaStates[path.ideaStates.length - 3]
      if (gpState) gpState.selectedIncomingIndex = newIndex
      currentIdea.supportedIdeas.push(grandparentId)
    }
  } else if (targetPhaseId) {
    const ph = dataStore.phases[targetPhaseId]
    if (ph && newIndex !== undefined) {
      if (!ph.commitments) ph.commitments = []
      ph.commitments.splice(newIndex, 0, currentIdeaId)
      ph.selectedIdeaIndex = newIndex
      if (!currentIdea.committedIn) currentIdea.committedIn = []
      currentIdea.committedIn.push(targetPhaseId)
    }
  } else if (newIndex !== undefined) {
    dataStore.floatingIdeasIds.splice(newIndex, 0, currentIdeaId)
    uiStore.floatingIdeaIndex = newIndex
  }

  try {
    await trpc.idea.disconnect.mutate({
      projectPath: getProjectPath(),
      parentIdeaId: parentId,
      childIdeaId: currentIdeaId
    })

    if (grandparentId) {
      await trpc.idea.connectIdeas.mutate({
        projectPath: getProjectPath(),
        parentIdeaId: grandparentId,
        childIdeaId: currentIdeaId,
        parentIncomingIndex: newIndex!,
        childSupportedIdeasIndex: 0
      })
    } else if (targetPhaseId) {
      await trpc.idea.commitToPhase.mutate({
        projectPath: getProjectPath(),
        ideaId: currentIdeaId,
        phaseId: targetPhaseId,
        insertionIndex: newIndex!
      })
    }

    const reloads = []
    reloads.push(
      trpc.idea.get.query({
        projectPath: getProjectPath(),
        ideaId: parentId
      }).then((updated: any) => dataStore.replaceIdea(parentId, updated))
    )

    if (grandparentId) {
      reloads.push(
        trpc.idea.get.query({
          projectPath: getProjectPath(),
          ideaId: grandparentId
        }).then((updated: any) => dataStore.replaceIdea(grandparentId, updated))
      )
    } else if (targetPhaseId) {
      reloads.push(
        trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId: targetPhaseId
        }).then((updated: any) => dataStore.replacePhase(targetPhaseId, updated)),
        trpc.idea.get.query({
          projectPath: getProjectPath(),
          ideaId: currentIdeaId
        }).then((updated: any) => dataStore.replaceIdea(currentIdeaId, updated))
      )
    } else {
      reloads.push(
        trpc.idea.get.query({
          projectPath: getProjectPath(),
          ideaId: currentIdeaId
        }).then((updated: any) => {
          dataStore.replaceIdea(currentIdeaId, updated)
        })
      )
    }

    await Promise.all(reloads)
  } catch (e) {
    console.error('Move failed', e)
  }
}

export async function moveIdeaInAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.ideas.length === 0) return

  const currentIdea = path.ideas[path.ideas.length - 1]!
  const currentIdeaId = currentIdea.id

  let previousSiblingId: string | undefined
  let currentIndex: number
  let oldParentId: string | undefined
  let oldPhaseId: string | undefined

  if (path.ideas.length > 1) {
    const parentIdea = path.ideas[path.ideas.length - 2]
    const parentState = path.ideaStates[path.ideaStates.length - 2]
    if (!parentIdea || parentState?.selectedIncomingIndex === undefined) return

    currentIndex = parentState.selectedIncomingIndex
    if (currentIndex === 0) return

    const parentConnections = parentIdea.supportingConnections || []
    const prevConn = parentConnections[currentIndex - 1]
    if (prevConn) previousSiblingId = prevConn.ideaId
    oldParentId = parentIdea.id
  } else if (path.phase) {
    currentIndex = path.phase.selectedIdeaIndex!
    if (currentIndex === 0) return
    previousSiblingId = path.phase.commitments[currentIndex - 1]
    oldPhaseId = path.phase.id
  } else {
    currentIndex = uiStore.floatingIdeaIndex
    if (currentIndex === 0) return
    const floatingIdeas = dataStore.floatingIdeas || []
    const prev = floatingIdeas[currentIndex - 1]
    if (prev) previousSiblingId = prev.id
  }

  if (!previousSiblingId) return
  const previousSibling = dataStore.ideas[previousSiblingId]
  if (!previousSibling) return

  const prevSiblingConnections = previousSibling.supportingConnections || []
  const insertionIndex = prevSiblingConnections.length

  if (oldParentId) {
    const oldParent = dataStore.ideas[oldParentId]
    if (oldParent && oldParent.supportingConnections) {
      oldParent.supportingConnections = oldParent.supportingConnections.filter((c: any) => c.ideaId !== currentIdeaId)
    }
    currentIdea.supportedIdeas = currentIdea.supportedIdeas.filter((id: string) => id !== oldParentId)
  } else if (oldPhaseId) {
    const ph = dataStore.phases[oldPhaseId]
    if (ph && ph.commitments) {
      ph.commitments = ph.commitments.filter((id: string) => id !== currentIdeaId)
    }
    if (currentIdea.committedIn) {
      currentIdea.committedIn = currentIdea.committedIn.filter((id: string) => id !== oldPhaseId)
    }
  } else {
    const idx = dataStore.floatingIdeasIds.indexOf(currentIdeaId)
    if (idx !== -1) {
      dataStore.floatingIdeasIds.splice(idx, 1)
    }
  }

  if (previousSibling) {
    if (!previousSibling.supportingConnections) previousSibling.supportingConnections = []
    previousSibling.supportingConnections.splice(insertionIndex, 0, { ideaId: currentIdeaId, weight: 1 } as any)
    const siblingStateTree = path.ideas.length > 1
      ? path.ideaStates[path.ideaStates.length - 2]?.children
      : oldPhaseId
        ? uiStore.getPhaseIdeaUIStates(oldPhaseId)
        : uiStore.floatingIdeaUIStates
    const previousSiblingState = siblingStateTree ? ensureIdeaUIState(siblingStateTree, previousSiblingId) : undefined
    if (previousSiblingState) {
      previousSiblingState.expanded = true
      previousSiblingState.selectedIncomingIndex = insertionIndex
    }
    if (!currentIdea.supportedIdeas) currentIdea.supportedIdeas = []
    currentIdea.supportedIdeas.push(previousSiblingId)
  }

  if (oldPhaseId) {
    const phase = dataStore.phases[oldPhaseId]
    if (phase) {
      phase.selectedIdeaIndex = Math.max(0, currentIndex - 1)
    }
  }

  if (oldParentId) {
    const oldParentState = path.ideaStates[path.ideaStates.length - 2]
    if (oldParentState?.selectedIncomingIndex !== undefined) {
      oldParentState.selectedIncomingIndex = Math.max(0, currentIndex - 1)
    }
  }

  if (!oldPhaseId && !oldParentId) {
    uiStore.floatingIdeaIndex = Math.max(0, currentIndex - 1)
  }

  try {
    await trpc.idea.connectIdeas.mutate({
      projectPath: getProjectPath(),
      parentIdeaId: previousSiblingId,
      childIdeaId: currentIdeaId,
      parentIncomingIndex: insertionIndex,
      childSupportedIdeasIndex: 0
    })

    if (oldParentId) {
      await trpc.idea.disconnect.mutate({
        projectPath: getProjectPath(),
        parentIdeaId: oldParentId,
        childIdeaId: currentIdeaId
      })
    } else if (oldPhaseId) {
      await trpc.idea.removeFromPhase.mutate({
        projectPath: getProjectPath(),
        ideaId: currentIdeaId,
        phaseId: oldPhaseId
      })
    }

    const reloads = []
    reloads.push(
      trpc.idea.get.query({
        projectPath: getProjectPath(),
        ideaId: previousSiblingId
      }).then((updated: any) => dataStore.replaceIdea(previousSiblingId, updated))
    )

    if (oldParentId) {
      reloads.push(
        trpc.idea.get.query({
          projectPath: getProjectPath(),
          ideaId: oldParentId
        }).then((updated: any) => dataStore.replaceIdea(oldParentId, updated))
      )
    } else if (oldPhaseId) {
      reloads.push(
        trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId: oldPhaseId
        }).then((updated: any) => dataStore.replacePhase(oldPhaseId, updated))
      )
    }

    await Promise.all(reloads)
  } catch (e) {
    console.error('Move failed', e)
  }
}

export async function pasteCutIdeaAction(uiStore: any, dataStore: any) {
  const modalStore = useUIModalStore()
  const cutIdeaId = modalStore.teleportCutIdeaId
  const source = modalStore.teleportSource
  if (!cutIdeaId) return

  const path = uiStore.getSelectionPath()

  let destinationParentIdeaId: string | undefined
  let destinationPhaseId: string | undefined
  let destinationFloating = false
  let insertionIndex = 0
  let destinationParentState: any

  if (path.ideas.length > 1) {
    const parentIdea = path.ideas[path.ideas.length - 2]
    destinationParentState = path.ideaStates[path.ideaStates.length - 2]
    if (!parentIdea) return
    destinationParentIdeaId = parentIdea.id
    insertionIndex = (destinationParentState?.selectedIncomingIndex ?? 0) + 1
  } else if (path.phase) {
    destinationPhaseId = path.phase.id
    insertionIndex = (path.phase.selectedIdeaIndex ?? -1) + 1
  } else if (uiStore.activeColumn === -1) {
    destinationFloating = true
    insertionIndex = uiStore.floatingIdeaIndex + 1
  } else {
    return
  }

  const cutIdea = dataStore.ideas[cutIdeaId]
  if (destinationParentIdeaId && cutIdea && isIdeaInTreeHelper(destinationParentIdeaId, cutIdea, dataStore)) {
    return
  }

  const sourceParentIdeaId = source?.parentIdeaId
  const sourcePhaseId = source?.phaseId

  try {
    if (destinationParentIdeaId && sourceParentIdeaId === destinationParentIdeaId) {
      await trpc.idea.connectIdeas.mutate({
        projectPath: getProjectPath(),
        parentIdeaId: destinationParentIdeaId,
        childIdeaId: cutIdeaId,
        parentIncomingIndex: insertionIndex
      })
    } else if (destinationPhaseId && sourcePhaseId === destinationPhaseId) {
      await trpc.idea.commitToPhase.mutate({
        projectPath: getProjectPath(),
        ideaId: cutIdeaId,
        phaseId: destinationPhaseId,
        insertionIndex
      })
    } else {
      if (sourceParentIdeaId) {
        await trpc.idea.disconnect.mutate({
          projectPath: getProjectPath(),
          parentIdeaId: sourceParentIdeaId,
          childIdeaId: cutIdeaId
        })
      } else if (sourcePhaseId) {
        await trpc.idea.removeFromPhase.mutate({
          projectPath: getProjectPath(),
          ideaId: cutIdeaId,
          phaseId: sourcePhaseId
        })
      }

      if (destinationParentIdeaId) {
        await trpc.idea.connectIdeas.mutate({
          projectPath: getProjectPath(),
          parentIdeaId: destinationParentIdeaId,
          childIdeaId: cutIdeaId,
          parentIncomingIndex: insertionIndex
        })
      } else if (destinationPhaseId) {
        await trpc.idea.commitToPhase.mutate({
          projectPath: getProjectPath(),
          ideaId: cutIdeaId,
          phaseId: destinationPhaseId,
          insertionIndex
        })
      }
    }

    const reloads: Promise<any>[] = [
      trpc.idea.get.query({
        projectPath: getProjectPath(),
        ideaId: cutIdeaId
      }).then((updatedIdea: any) => dataStore.replaceIdea(cutIdeaId, updatedIdea))
    ]

    if (sourceParentIdeaId) {
      reloads.push(
        trpc.idea.get.query({
          projectPath: getProjectPath(),
          ideaId: sourceParentIdeaId
        }).then((updatedIdea: any) => dataStore.replaceIdea(sourceParentIdeaId, updatedIdea))
      )
    }

    if (destinationParentIdeaId) {
      reloads.push(
        trpc.idea.get.query({
          projectPath: getProjectPath(),
          ideaId: destinationParentIdeaId
        }).then((updatedIdea: any) => dataStore.replaceIdea(destinationParentIdeaId, updatedIdea))
      )
    }

    if (sourcePhaseId) {
      reloads.push(
        trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId: sourcePhaseId
        }).then((updatedPhase: any) => dataStore.replacePhase(sourcePhaseId, updatedPhase))
      )
    }

    if (destinationPhaseId) {
      reloads.push(
        trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId: destinationPhaseId
        }).then((updatedPhase: any) => dataStore.replacePhase(destinationPhaseId, updatedPhase))
      )
    }

    await Promise.all(reloads)

    if (destinationParentIdeaId) {
      const destinationParent = dataStore.ideas[destinationParentIdeaId]
      if (destinationParent && destinationParentState) {
        destinationParentState.expanded = true
        destinationParentState.selectedIncomingIndex = Math.max(
          0,
          (destinationParent.supportingConnections || []).findIndex((c: any) => c.ideaId === cutIdeaId)
        )
      }
    } else if (destinationPhaseId) {
      const destinationPhase = dataStore.phases[destinationPhaseId]
      if (destinationPhase) {
        destinationPhase.selectedIdeaIndex = Math.max(0, destinationPhase.commitments.indexOf(cutIdeaId))
      }
    } else if (destinationFloating) {
      const idx = dataStore.floatingIdeasIds.indexOf(cutIdeaId)
      if (idx >= 0) uiStore.floatingIdeaIndex = idx
    }

    modalStore.clearTeleportBuffer()
  } catch (e) {
    console.error('Teleport paste failed', e)
  }
}

export async function pasteCopiedIdeaAction(uiStore: any, dataStore: any) {
  const modalStore = useUIModalStore()
  const copyIdeaId = modalStore.teleportCopyIdeaId
  if (!copyIdeaId) return

  const path = uiStore.getSelectionPath()

  let destinationParentIdeaId: string | undefined
  let destinationPhaseId: string | undefined
  let insertionIndex = 0
  let destinationParentState: any

  if (path.ideas.length > 1) {
    const parentIdea = path.ideas[path.ideas.length - 2]
    destinationParentState = path.ideaStates[path.ideaStates.length - 2]
    if (!parentIdea) return
    destinationParentIdeaId = parentIdea.id
    insertionIndex = (destinationParentState?.selectedIncomingIndex ?? 0) + 1
  } else if (path.phase) {
    destinationPhaseId = path.phase.id
    insertionIndex = (path.phase.selectedIdeaIndex ?? -1) + 1
  } else {
    return
  }

  const copyIdea = dataStore.ideas[copyIdeaId]
  if (destinationParentIdeaId && copyIdea && isIdeaInTreeHelper(destinationParentIdeaId, copyIdea, dataStore)) {
    return
  }

  try {
    if (destinationParentIdeaId) {
      await trpc.idea.connectIdeas.mutate({
        projectPath: getProjectPath(),
        parentIdeaId: destinationParentIdeaId,
        childIdeaId: copyIdeaId,
        parentIncomingIndex: insertionIndex
      })
    } else if (destinationPhaseId) {
      await trpc.idea.commitToPhase.mutate({
        projectPath: getProjectPath(),
        ideaId: copyIdeaId,
        phaseId: destinationPhaseId,
        insertionIndex
      })
    }

    const reloads: Promise<any>[] = []

    if (destinationParentIdeaId) {
      reloads.push(
        trpc.idea.get.query({
          projectPath: getProjectPath(),
          ideaId: destinationParentIdeaId
        }).then((updatedIdea: any) => dataStore.replaceIdea(destinationParentIdeaId, updatedIdea))
      )
    }

    if (destinationPhaseId) {
      reloads.push(
        trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId: destinationPhaseId
        }).then((updatedPhase: any) => dataStore.replacePhase(destinationPhaseId, updatedPhase))
      )
    }

    reloads.push(
      trpc.idea.get.query({
        projectPath: getProjectPath(),
        ideaId: copyIdeaId
      }).then((updatedIdea: any) => dataStore.replaceIdea(copyIdeaId, updatedIdea))
    )

    await Promise.all(reloads)

    if (destinationParentIdeaId) {
      const destinationParent = dataStore.ideas[destinationParentIdeaId]
      if (destinationParent && destinationParentState) {
        destinationParentState.expanded = true
        destinationParentState.selectedIncomingIndex = Math.max(
          0,
          (destinationParent.supportingConnections || []).findIndex((c: any) => c.ideaId === copyIdeaId)
        )
      }
    } else if (destinationPhaseId) {
      const destinationPhase = dataStore.phases[destinationPhaseId]
      if (destinationPhase) {
        destinationPhase.selectedIdeaIndex = Math.max(0, destinationPhase.commitments.indexOf(copyIdeaId))
      }
    }

    modalStore.clearTeleportBuffer()
  } catch (e) {
    console.error('Copy paste failed', e)
  }
}
