import type { Aim } from '../data'
import { useDataStore } from '../data'

export async function navigateDownAction(uiStore: any) {
  const dataStore = useDataStore()
  uiStore.pendingDeleteAimId = null

  const col = uiStore.selectedColumn
  const path = uiStore.getSelectionPath()

  if (path.aims.length === 0) {
    if (path.phase && col >= 0) {
      const currentPhaseIndex = uiStore.getSelectedPhase(col)
      const phaseCount = uiStore.getPhaseCount(col)
      if (currentPhaseIndex < phaseCount - 1) {
        await uiStore.selectPhase(col, currentPhaseIndex + 1)
        const newPhaseId = uiStore.getSelectedPhaseId(col)
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

  if (path.aims.length === 1) {
    if (col === -1) {
      if (uiStore.floatingAimIndex < dataStore.floatingAims.length - 1) {
        uiStore.floatingAimIndex++
      }
    } else if (path.phase) {
      if (path.phase.selectedAimIndex! < path.phase.commitments.length - 1) {
        path.phase.selectedAimIndex!++
      } else if (col >= 0) {
        const currentPhaseIndex = uiStore.getSelectedPhase(col)
        const phaseCount = uiStore.getPhaseCount(col)
        if (currentPhaseIndex < phaseCount - 1) {
          await uiStore.selectPhase(col, currentPhaseIndex + 1)
          const newPhaseId = uiStore.getSelectedPhaseId(col)
          if (newPhaseId) {
            const newPhase = dataStore.phases[newPhaseId]
            if (newPhase && newPhase.commitments.length > 0) {
              newPhase.selectedAimIndex = 0
            }
          }
        }
      }
    }
  } else {
    let broke = false
    for (let i = path.aims.length - 2; i >= 0; i--) {
      const ancestorAim = path.aims[i]
      if (!ancestorAim) continue
      const ancestorConnections = ancestorAim.supportingConnections || []
      if (ancestorAim.selectedIncomingIndex !== undefined && ancestorAim.selectedIncomingIndex < ancestorConnections.length - 1) {
        ancestorAim.selectedIncomingIndex++
        broke = true
        break
      }
    }

    if (!broke) {
      if (path.phase) {
        if (path.phase.selectedAimIndex! < path.phase.commitments.length - 1) {
          path.phase.selectedAimIndex!++
        } else if (col >= 0) {
          const currentPhaseIndex = uiStore.getSelectedPhase(col)
          const phaseCount = uiStore.getPhaseCount(col)
          if (currentPhaseIndex < phaseCount - 1) {
            await uiStore.selectPhase(col, currentPhaseIndex + 1)
            const newPhaseId = uiStore.getSelectedPhaseId(col)
            if (newPhaseId) {
              const newPhase = dataStore.phases[newPhaseId]
              if (newPhase && newPhase.commitments.length > 0) {
                newPhase.selectedAimIndex = 0
              }
            }
          }
        }
      } else if (uiStore.floatingAimIndex < dataStore.floatingAims.length - 1) {
        uiStore.floatingAimIndex++
      }
    }
  }
}

export async function navigateUpAction(uiStore: any) {
  const dataStore = useDataStore()
  uiStore.pendingDeleteAimId = null

  const path = uiStore.getSelectionPath()
  const col = uiStore.selectedColumn

  if (path.aims.length === 0) {
    if (path.phase && col >= 0) {
      const currentPhaseIndex = uiStore.getSelectedPhase(col)
      if (currentPhaseIndex > 0) {
        await uiStore.selectPhase(col, currentPhaseIndex - 1)
        const newPhaseId = uiStore.getSelectedPhaseId(col)
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

  if (!uiStore.navigatingAims) return

  if (path.aims.length === 1) {
    if (col === -1) {
      if (uiStore.floatingAimIndex > 0) {
        uiStore.floatingAimIndex--
        const target = dataStore.floatingAims[uiStore.floatingAimIndex]
        if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
          goToLastChildAimAction(target)
        }
      }
    } else if (col >= 0 && path.phase) {
      if (path.phase.selectedAimIndex !== undefined && path.phase.selectedAimIndex > 0) {
        path.phase.selectedAimIndex--
        const target = dataStore.getAimsForPhase(path.phase.id)[path.phase.selectedAimIndex]
        if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
          goToLastChildAimAction(target)
        }
      } else {
        const currentPhaseIndex = uiStore.getSelectedPhase(col)
        if (currentPhaseIndex > 0) {
          await uiStore.selectPhase(col, currentPhaseIndex - 1)
          const newPhaseId = uiStore.getSelectedPhaseId(col)
          if (newPhaseId) {
            const newPhase = dataStore.phases[newPhaseId]
            if (newPhase && newPhase.commitments.length > 0) {
              newPhase.selectedAimIndex = newPhase.commitments.length - 1
              const aims = dataStore.getAimsForPhase(newPhaseId)
              const target = aims[newPhase.selectedAimIndex]
              if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
                goToLastChildAimAction(target)
              }
            }
          }
        }
      }
    }
  } else {
    const parentAim = path.aims[path.aims.length - 2]
    if (parentAim) {
      if (parentAim.selectedIncomingIndex == 0) {
        parentAim.selectedIncomingIndex = undefined
      } else if (parentAim.selectedIncomingIndex !== undefined) {
        parentAim.selectedIncomingIndex--
        const parentConnections = parentAim.supportingConnections || []
        const targetConn = parentConnections[parentAim.selectedIncomingIndex]
        if (targetConn) {
          const target = dataStore.aims[targetConn.aimId]
          if (target && target.expanded && target.selectedIncomingIndex !== undefined) {
            goToLastChildAimAction(target)
          }
        }
      }
    }
  }
}

export function goToLastChildAimAction(target: Aim) {
  const dataStore = useDataStore()
  let connections = target.supportingConnections || []
  while (target.expanded && connections.length > 0) {
    const lastIdx = connections.length - 1
    target.selectedIncomingIndex = lastIdx
    const nextTargetConn = connections[lastIdx]
    if (!nextTargetConn) break
    const nextTarget = dataStore.aims[nextTargetConn.aimId]
    if (!nextTarget) break
    target = nextTarget
    connections = target.supportingConnections || []
  }
}
