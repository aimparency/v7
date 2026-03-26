import { trpc } from '../../trpc'
import { useDataStore } from '../data'
import { isAimInTree as isAimInTreeHelper } from './navigation-helpers'
import { useProjectStore } from '../project-store'
import { useUIModalStore } from './modal-store'

function getProjectPath(): string {
  return useProjectStore().projectPath
}

export async function moveAimDownAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.aims.length === 0) return

  const currentAim = path.aims[path.aims.length - 1]!

  if (path.aims.length > 1) {
    const parentAim = path.aims[path.aims.length - 2]
    if (parentAim && parentAim.selectedIncomingIndex !== undefined) {
      const currentIndex = parentAim.selectedIncomingIndex
      const parentConnections = parentAim.supportingConnections || []

      if (currentIndex < parentConnections.length - 1) {
        const nextIndex = currentIndex + 1

        if (parentAim.supportingConnections) {
          const temp = parentAim.supportingConnections[currentIndex]!
          parentAim.supportingConnections[currentIndex] = parentAim.supportingConnections[nextIndex]!
          parentAim.supportingConnections[nextIndex] = temp
        }
        parentAim.selectedIncomingIndex = nextIndex

        try {
          await trpc.aim.connectAims.mutate({
            projectPath: getProjectPath(),
            parentAimId: parentAim.id,
            childAimId: currentAim.id,
            parentIncomingIndex: nextIndex,
            childSupportedAimsIndex: currentAim.supportedAims.indexOf(parentAim.id)
          })

          const updatedParent = await trpc.aim.get.query({
            projectPath: getProjectPath(),
            aimId: parentAim.id
          })
          dataStore.replaceAim(parentAim.id, updatedParent)

          const reloadedParent = dataStore.aims[parentAim.id]
          if (reloadedParent) {
            reloadedParent.selectedIncomingIndex = nextIndex
          }
        } catch (e) {
          console.error('Move failed', e)
        }
      }
    }
  } else if (path.phase) {
    const phaseId = path.phase.id
    const currentIndex = path.phase.selectedAimIndex!

    if (currentIndex < path.phase.commitments.length - 1) {
      const nextIndex = currentIndex + 1

      const ph = dataStore.phases[phaseId]
      if (ph && ph.commitments) {
        const temp = ph.commitments[currentIndex]!
        ph.commitments[currentIndex] = ph.commitments[nextIndex]!
        ph.commitments[nextIndex] = temp
        ph.selectedAimIndex = nextIndex
      }

      try {
        await trpc.aim.commitToPhase.mutate({
          projectPath: getProjectPath(),
          aimId: currentAim.id,
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
          reloadedPhase.selectedAimIndex = nextIndex
        }
      } catch (e) {
        console.error('Move failed', e)
      }
    } else {
      const parentPhaseId = path.phase.parent
      const siblings = dataStore.getPhasesByParentId(parentPhaseId)
      const currentPhaseIndex = siblings.findIndex((p: any) => p.id === phaseId)

      if (currentPhaseIndex !== -1 && currentPhaseIndex < siblings.length - 1) {
        const nextPhase = siblings[currentPhaseIndex + 1]
        if (!nextPhase) return
        const nextPhaseId = nextPhase.id

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

        const col = uiStore.selectedColumn
        if (col >= 0) {
          await uiStore.selectPhase(col, currentPhaseIndex + 1)
        }

        try {
          await trpc.aim.removeFromPhase.mutate({
            projectPath: getProjectPath(),
            aimId: currentAim.id,
            phaseId
          })
          await trpc.aim.commitToPhase.mutate({
            projectPath: getProjectPath(),
            aimId: currentAim.id,
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
          if (reloadedNew) reloadedNew.selectedAimIndex = 0
        } catch (e) {
          console.error('Move across phases failed', e)
        }
      }
    }
  }
}

export async function moveAimUpAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.aims.length === 0) return

  const currentAim = path.aims[path.aims.length - 1]!

  if (path.aims.length > 1) {
    const parentAim = path.aims[path.aims.length - 2]
    if (parentAim && parentAim.selectedIncomingIndex !== undefined) {
      const currentIndex = parentAim.selectedIncomingIndex
      if (currentIndex > 0) {
        const prevIndex = currentIndex - 1

        if (parentAim.supportingConnections) {
          const temp = parentAim.supportingConnections[currentIndex]!
          parentAim.supportingConnections[currentIndex] = parentAim.supportingConnections[prevIndex]!
          parentAim.supportingConnections[prevIndex] = temp
        }
        parentAim.selectedIncomingIndex = prevIndex

        try {
          await trpc.aim.connectAims.mutate({
            projectPath: getProjectPath(),
            parentAimId: parentAim.id,
            childAimId: currentAim.id,
            parentIncomingIndex: prevIndex,
            childSupportedAimsIndex: currentAim.supportedAims.indexOf(parentAim.id)
          })

          const updatedParent = await trpc.aim.get.query({
            projectPath: getProjectPath(),
            aimId: parentAim.id
          })
          dataStore.replaceAim(parentAim.id, updatedParent)

          const reloadedParent = dataStore.aims[parentAim.id]
          if (reloadedParent) {
            reloadedParent.selectedIncomingIndex = prevIndex
          }
        } catch (e) {
          console.error('Move failed', e)
        }
      }
    }
  } else if (path.phase) {
    const phaseId = path.phase.id
    const currentIndex = path.phase.selectedAimIndex!

    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1
      const ph = dataStore.phases[phaseId]
      if (ph && ph.commitments) {
        const temp = ph.commitments[currentIndex]!
        ph.commitments[currentIndex] = ph.commitments[prevIndex]!
        ph.commitments[prevIndex] = temp
        ph.selectedAimIndex = prevIndex
      }

      try {
        await trpc.aim.commitToPhase.mutate({
          projectPath: getProjectPath(),
          aimId: currentAim.id,
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
          reloadedPhase.selectedAimIndex = prevIndex
        }
      } catch (e) {
        console.error('Move failed', e)
      }
    } else {
      const parentPhaseId = path.phase.parent
      const siblings = dataStore.getPhasesByParentId(parentPhaseId)
      const currentPhaseIndex = siblings.findIndex((p: any) => p.id === phaseId)

      if (currentPhaseIndex > 0) {
        const prevPhase = siblings[currentPhaseIndex - 1]
        if (!prevPhase) return
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
          prevPh.commitments.push(currentAim.id)
          prevPh.selectedAimIndex = newIndex
        }

        const col = uiStore.selectedColumn
        if (col >= 0) {
          await uiStore.selectPhase(col, currentPhaseIndex - 1)
        }

        try {
          await trpc.aim.removeFromPhase.mutate({
            projectPath: getProjectPath(),
            aimId: currentAim.id,
            phaseId
          })
          await trpc.aim.commitToPhase.mutate({
            projectPath: getProjectPath(),
            aimId: currentAim.id,
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
          if (reloadedPrev) reloadedPrev.selectedAimIndex = reloadedPrev.commitments.length - 1
        } catch (e) {
          console.error('Move across phases failed', e)
        }
      }
    }
  }
}

export async function moveAimOutAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.aims.length <= 1) return

  const currentAim = path.aims[path.aims.length - 1]!
  const currentAimId = currentAim.id
  const parentAim = path.aims[path.aims.length - 2]
  if (!parentAim) return

  const parentId = parentAim.id
  const parentConnections = parentAim.supportingConnections || []
  const updatedConnections = parentConnections.filter((c: any) => c.aimId !== currentAimId)
  const updatedSupportedAims = currentAim.supportedAims.filter((id: string) => id !== parentId)

  let grandparentId: string | undefined
  let newIndex: number | undefined
  let targetPhaseId: string | undefined

  if (path.aims.length > 2) {
    const grandparentAim = path.aims[path.aims.length - 3]!
    grandparentId = grandparentAim.id
    const parentIndexInGrandparent = grandparentAim.selectedIncomingIndex!
    newIndex = parentIndexInGrandparent + 1
  } else if (path.phase) {
    targetPhaseId = path.phase.id
    const parentIndex = path.phase.selectedAimIndex!
    newIndex = parentIndex + 1
  } else {
    const parentIndex = dataStore.floatingAims.findIndex((a: any) => a.id === parentId)
    if (parentIndex !== -1) {
      newIndex = parentIndex + 1
    }
  }

  if (parentAim.supportingConnections) {
    parentAim.supportingConnections = updatedConnections
  }
  currentAim.supportedAims = updatedSupportedAims

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
  } else if (newIndex !== undefined) {
    dataStore.floatingAimsIds.splice(newIndex, 0, currentAimId)
    uiStore.floatingAimIndex = newIndex
  }

  try {
    await trpc.aim.update.mutate({
      projectPath: getProjectPath(),
      aimId: parentId,
      aim: { supportingConnections: updatedConnections }
    })
    await trpc.aim.update.mutate({
      projectPath: getProjectPath(),
      aimId: currentAimId,
      aim: { supportedAims: updatedSupportedAims }
    })

    if (grandparentId) {
      await trpc.aim.connectAims.mutate({
        projectPath: getProjectPath(),
        parentAimId: grandparentId,
        childAimId: currentAimId,
        parentIncomingIndex: newIndex!,
        childSupportedAimsIndex: 0
      })
    } else if (targetPhaseId) {
      await trpc.aim.commitToPhase.mutate({
        projectPath: getProjectPath(),
        aimId: currentAimId,
        phaseId: targetPhaseId,
        insertionIndex: newIndex!
      })
    }

    const reloads = []
    reloads.push(
      trpc.aim.get.query({
        projectPath: getProjectPath(),
        aimId: parentId
      }).then((updated: any) => dataStore.replaceAim(parentId, updated))
    )

    if (grandparentId) {
      reloads.push(
        trpc.aim.get.query({
          projectPath: getProjectPath(),
          aimId: grandparentId
        }).then((updated: any) => dataStore.replaceAim(grandparentId, updated))
      )
    } else if (targetPhaseId) {
      reloads.push(
        trpc.phase.get.query({
          projectPath: getProjectPath(),
          phaseId: targetPhaseId
        }).then((updated: any) => dataStore.replacePhase(targetPhaseId, updated)),
        trpc.aim.get.query({
          projectPath: getProjectPath(),
          aimId: currentAimId
        }).then((updated: any) => dataStore.replaceAim(currentAimId, updated))
      )
    } else {
      reloads.push(
        trpc.aim.get.query({
          projectPath: getProjectPath(),
          aimId: currentAimId
        }).then((updated: any) => {
          dataStore.replaceAim(currentAimId, updated)
        })
      )
    }

    await Promise.all(reloads)
  } catch (e) {
    console.error('Move failed', e)
  }
}

export async function moveAimInAction(uiStore: any) {
  const dataStore = useDataStore()
  const path = uiStore.getSelectionPath()

  if (path.aims.length === 0) return

  const currentAim = path.aims[path.aims.length - 1]!
  const currentAimId = currentAim.id

  let previousSiblingId: string | undefined
  let currentIndex: number
  let oldParentId: string | undefined
  let oldPhaseId: string | undefined

  if (path.aims.length > 1) {
    const parentAim = path.aims[path.aims.length - 2]
    if (!parentAim || parentAim.selectedIncomingIndex === undefined) return

    currentIndex = parentAim.selectedIncomingIndex
    if (currentIndex === 0) return

    const parentConnections = parentAim.supportingConnections || []
    const prevConn = parentConnections[currentIndex - 1]
    if (prevConn) previousSiblingId = prevConn.aimId
    oldParentId = parentAim.id
  } else if (path.phase) {
    currentIndex = path.phase.selectedAimIndex!
    if (currentIndex === 0) return
    previousSiblingId = path.phase.commitments[currentIndex - 1]
    oldPhaseId = path.phase.id
  } else {
    currentIndex = uiStore.floatingAimIndex
    if (currentIndex === 0) return
    const floatingAims = dataStore.floatingAims || []
    const prev = floatingAims[currentIndex - 1]
    if (prev) previousSiblingId = prev.id
  }

  if (!previousSiblingId) return
  const previousSibling = dataStore.aims[previousSiblingId]
  if (!previousSibling) return

  const prevSiblingConnections = previousSibling.supportingConnections || []
  const insertionIndex = prevSiblingConnections.length

  if (oldParentId) {
    const oldParent = dataStore.aims[oldParentId]
    if (oldParent && oldParent.supportingConnections) {
      oldParent.supportingConnections = oldParent.supportingConnections.filter((c: any) => c.aimId !== currentAimId)
    }
    currentAim.supportedAims = currentAim.supportedAims.filter((id: string) => id !== oldParentId)
  } else if (oldPhaseId) {
    const ph = dataStore.phases[oldPhaseId]
    if (ph && ph.commitments) {
      ph.commitments = ph.commitments.filter((id: string) => id !== currentAimId)
    }
    if (currentAim.committedIn) {
      currentAim.committedIn = currentAim.committedIn.filter((id: string) => id !== oldPhaseId)
    }
  } else {
    const idx = dataStore.floatingAimsIds.indexOf(currentAimId)
    if (idx !== -1) {
      dataStore.floatingAimsIds.splice(idx, 1)
    }
  }

  if (previousSibling) {
    if (!previousSibling.supportingConnections) previousSibling.supportingConnections = []
    previousSibling.supportingConnections.splice(insertionIndex, 0, { aimId: currentAimId, weight: 1 } as any)
    previousSibling.expanded = true
    previousSibling.selectedIncomingIndex = insertionIndex
    if (!currentAim.supportedAims) currentAim.supportedAims = []
    currentAim.supportedAims.push(previousSiblingId)
  }

  if (oldPhaseId) {
    const phase = dataStore.phases[oldPhaseId]
    if (phase) {
      phase.selectedAimIndex = Math.max(0, currentIndex - 1)
    }
  }

  if (oldParentId) {
    const oldP = dataStore.aims[oldParentId]
    if (oldP && oldP.selectedIncomingIndex !== undefined) {
      oldP.selectedIncomingIndex = Math.max(0, currentIndex - 1)
    }
  }

  if (!oldPhaseId && !oldParentId) {
    uiStore.floatingAimIndex = Math.max(0, currentIndex - 1)
  }

  try {
    await trpc.aim.connectAims.mutate({
      projectPath: getProjectPath(),
      parentAimId: previousSiblingId,
      childAimId: currentAimId,
      parentIncomingIndex: insertionIndex,
      childSupportedAimsIndex: 0
    })

    if (oldParentId) {
      const oldParent = dataStore.aims[oldParentId]
      if (oldParent) {
        const oldParentConnections = oldParent.supportingConnections || []
        const updatedConnections = oldParentConnections.filter((c: any) => c.aimId !== currentAimId)

        await trpc.aim.update.mutate({
          projectPath: getProjectPath(),
          aimId: oldParentId,
          aim: { supportingConnections: updatedConnections }
        })
      }
      await trpc.aim.update.mutate({
        projectPath: getProjectPath(),
        aimId: currentAimId,
        aim: { supportedAims: currentAim.supportedAims.filter((id: string) => id !== oldParentId) }
      })
    } else if (oldPhaseId) {
      await trpc.aim.removeFromPhase.mutate({
        projectPath: getProjectPath(),
        aimId: currentAimId,
        phaseId: oldPhaseId
      })
    }

    const reloads = []
    reloads.push(
      trpc.aim.get.query({
        projectPath: getProjectPath(),
        aimId: previousSiblingId
      }).then((updated: any) => dataStore.replaceAim(previousSiblingId, updated))
    )

    if (oldParentId) {
      reloads.push(
        trpc.aim.get.query({
          projectPath: getProjectPath(),
          aimId: oldParentId
        }).then((updated: any) => dataStore.replaceAim(oldParentId, updated))
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

export async function pasteCutAimAction(uiStore: any, dataStore: any) {
  const modalStore = useUIModalStore()
  const cutAimId = modalStore.teleportCutAimId
  const source = modalStore.teleportSource
  if (!cutAimId) return

  const path = uiStore.getSelectionPath()

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
  } else if (uiStore.selectedColumn === -1) {
    destinationFloating = true
    insertionIndex = uiStore.floatingAimIndex + 1
  } else {
    return
  }

  const cutAim = dataStore.aims[cutAimId]
  if (destinationParentAimId && cutAim && isAimInTreeHelper(destinationParentAimId, cutAim, dataStore)) {
    return
  }

  const sourceParentAimId = source?.parentAimId
  const sourcePhaseId = source?.phaseId

  try {
    if (destinationParentAimId && sourceParentAimId === destinationParentAimId) {
      await trpc.aim.connectAims.mutate({
        projectPath: getProjectPath(),
        parentAimId: destinationParentAimId,
        childAimId: cutAimId,
        parentIncomingIndex: insertionIndex
      })
    } else if (destinationPhaseId && sourcePhaseId === destinationPhaseId) {
      await trpc.aim.commitToPhase.mutate({
        projectPath: getProjectPath(),
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
            projectPath: getProjectPath(),
            aimId: sourceParentAimId,
            aim: { supportingConnections: updatedConnections }
          })
        }
      } else if (sourcePhaseId) {
        await trpc.aim.removeFromPhase.mutate({
          projectPath: getProjectPath(),
          aimId: cutAimId,
          phaseId: sourcePhaseId
        })
      }

      if (destinationParentAimId) {
        await trpc.aim.connectAims.mutate({
          projectPath: getProjectPath(),
          parentAimId: destinationParentAimId,
          childAimId: cutAimId,
          parentIncomingIndex: insertionIndex
        })
      } else if (destinationPhaseId) {
        await trpc.aim.commitToPhase.mutate({
          projectPath: getProjectPath(),
          aimId: cutAimId,
          phaseId: destinationPhaseId,
          insertionIndex
        })
      }
    }

    const reloads: Promise<any>[] = [
      trpc.aim.get.query({
        projectPath: getProjectPath(),
        aimId: cutAimId
      }).then((updatedAim: any) => dataStore.replaceAim(cutAimId, updatedAim))
    ]

    if (sourceParentAimId) {
      reloads.push(
        trpc.aim.get.query({
          projectPath: getProjectPath(),
          aimId: sourceParentAimId
        }).then((updatedAim: any) => dataStore.replaceAim(sourceParentAimId, updatedAim))
      )
    }

    if (destinationParentAimId) {
      reloads.push(
        trpc.aim.get.query({
          projectPath: getProjectPath(),
          aimId: destinationParentAimId
        }).then((updatedAim: any) => dataStore.replaceAim(destinationParentAimId, updatedAim))
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
      await dataStore.loadFloatingAims(getProjectPath())
      const idx = dataStore.floatingAimsIds.indexOf(cutAimId)
      if (idx >= 0) uiStore.floatingAimIndex = idx
    }

    modalStore.clearTeleportBuffer()
  } catch (e) {
    console.error('Teleport paste failed', e)
  }
}

export async function pasteCopiedAimAction(uiStore: any, dataStore: any) {
  const modalStore = useUIModalStore()
  const copyAimId = modalStore.teleportCopyAimId
  if (!copyAimId) return

  const path = uiStore.getSelectionPath()

  let destinationParentAimId: string | undefined
  let destinationPhaseId: string | undefined
  let insertionIndex = 0

  if (path.aims.length > 1) {
    const parentAim = path.aims[path.aims.length - 2]
    if (!parentAim) return
    destinationParentAimId = parentAim.id
    insertionIndex = (parentAim.selectedIncomingIndex ?? 0) + 1
  } else if (path.phase) {
    destinationPhaseId = path.phase.id
    insertionIndex = (path.phase.selectedAimIndex ?? -1) + 1
  } else {
    return
  }

  const copyAim = dataStore.aims[copyAimId]
  if (destinationParentAimId && copyAim && isAimInTreeHelper(destinationParentAimId, copyAim, dataStore)) {
    return
  }

  try {
    if (destinationParentAimId) {
      await trpc.aim.connectAims.mutate({
        projectPath: getProjectPath(),
        parentAimId: destinationParentAimId,
        childAimId: copyAimId,
        parentIncomingIndex: insertionIndex
      })
    } else if (destinationPhaseId) {
      await trpc.aim.commitToPhase.mutate({
        projectPath: getProjectPath(),
        aimId: copyAimId,
        phaseId: destinationPhaseId,
        insertionIndex
      })
    }

    const reloads: Promise<any>[] = []

    if (destinationParentAimId) {
      reloads.push(
        trpc.aim.get.query({
          projectPath: getProjectPath(),
          aimId: destinationParentAimId
        }).then((updatedAim: any) => dataStore.replaceAim(destinationParentAimId, updatedAim))
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
      trpc.aim.get.query({
        projectPath: getProjectPath(),
        aimId: copyAimId
      }).then((updatedAim: any) => dataStore.replaceAim(copyAimId, updatedAim))
    )

    await Promise.all(reloads)

    if (destinationParentAimId) {
      const destinationParent = dataStore.aims[destinationParentAimId]
      if (destinationParent) {
        destinationParent.expanded = true
        destinationParent.selectedIncomingIndex = Math.max(
          0,
          (destinationParent.supportingConnections || []).findIndex((c: any) => c.aimId === copyAimId)
        )
      }
    } else if (destinationPhaseId) {
      const destinationPhase = dataStore.phases[destinationPhaseId]
      if (destinationPhase) {
        destinationPhase.selectedAimIndex = Math.max(0, destinationPhase.commitments.indexOf(copyAimId))
      }
    }

    modalStore.clearTeleportBuffer()
  } catch (e) {
    console.error('Copy paste failed', e)
  }
}
