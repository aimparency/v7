import { useDataStore, type Aim, type Phase } from '../data'

export type SelectionPath = {
  phase: Phase | undefined
  aims: Aim[]
}

export type TreeTraversalResult = {
  aimId: string
  topLevelIndex: number
  parentAimId?: string
  indexInParent?: number
}

type LastDescendantResult = {
  id: string
  parentId?: string
  indexInParent?: number
}

type DataStore = ReturnType<typeof useDataStore>

export function findNextAimInTree(currentAimId: string, phaseId: string, dataStore: DataStore): TreeTraversalResult | null {
  const topLevelAims = dataStore.getAimsForPhase(phaseId)
  const currentAim = dataStore.aims[currentAimId]

  if (currentAim?.expanded && currentAim.supportingConnections?.length > 0) {
    const firstIncomingId = currentAim.supportingConnections[0]?.aimId
    if (!firstIncomingId) {
      return null
    }

    const topLevelIndex = findTopLevelAncestorIndex(firstIncomingId, topLevelAims, dataStore)
    return { aimId: firstIncomingId, topLevelIndex, parentAimId: currentAimId, indexInParent: 0 }
  }

  return findNextSiblingOrAncestorSibling(currentAimId, topLevelAims, dataStore, null, -1)
}

export function findPreviousAimInTree(currentAimId: string, phaseId: string | undefined, dataStore: DataStore): TreeTraversalResult | null {
  const topLevelAims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
  return findPreviousSiblingOrAncestor(currentAimId, topLevelAims, dataStore, null, -1)
}

export function findNextSiblingOrAncestorSibling(
  aimId: string,
  aims: Aim[],
  dataStore: DataStore,
  parentAimId: string | null,
  topLevelIndex: number
): TreeTraversalResult | null {
  for (let i = 0; i < aims.length; i++) {
    const aim = aims[i]
    if (!aim) {
      continue
    }

    const currentTopLevel = parentAimId === null ? i : topLevelIndex

    if (aim.id === aimId) {
      if (i < aims.length - 1) {
        const nextSibling = aims[i + 1]
        if (!nextSibling) {
          return null
        }

        return { aimId: nextSibling.id, topLevelIndex: currentTopLevel, parentAimId: parentAimId ?? undefined, indexInParent: i + 1 }
      }

      return null
    }

    if (aim.expanded && aim.supportingConnections?.length) {
      const incomingAims = aim.supportingConnections
        .map((connection) => dataStore.aims[connection.aimId])
        .filter((child): child is Aim => Boolean(child))
      const result = findNextSiblingOrAncestorSibling(aimId, incomingAims, dataStore, aim.id, currentTopLevel)
      if (result) {
        return result
      }

      const wasInIncoming = incomingAims.some((child) => child.id === aimId || isAimInTree(aimId, child, dataStore))
      if (wasInIncoming) {
        if (i < aims.length - 1) {
          const nextSibling = aims[i + 1]
          if (!nextSibling) {
            return null
          }

          return { aimId: nextSibling.id, topLevelIndex: currentTopLevel, parentAimId: parentAimId ?? undefined, indexInParent: i + 1 }
        }

        return null
      }
    }
  }

  return null
}

export function findPreviousSiblingOrAncestor(
  aimId: string,
  aims: Aim[],
  dataStore: DataStore,
  parentAimId: string | null,
  topLevelIndex: number
): TreeTraversalResult | null {
  for (let i = 0; i < aims.length; i++) {
    const aim = aims[i]
    if (!aim) {
      continue
    }

    const currentTopLevel = parentAimId === null ? i : topLevelIndex

    if (aim.id === aimId) {
      if (i > 0) {
        const prevSibling = aims[i - 1]
        if (!prevSibling) {
          return null
        }

        const prevSiblingTopLevel = parentAimId === null ? i - 1 : topLevelIndex
        const lastDescendant = findLastDescendant(prevSibling, dataStore)
        return {
          aimId: lastDescendant.id,
          topLevelIndex: prevSiblingTopLevel,
          parentAimId: lastDescendant.parentId,
          indexInParent: lastDescendant.indexInParent
        }
      }

      if (parentAimId) {
        return { aimId: parentAimId, topLevelIndex }
      }

      return null
    }

    if (aim.expanded && aim.supportingConnections?.length) {
      const incomingAims = aim.supportingConnections
        .map((connection) => dataStore.aims[connection.aimId])
        .filter((child): child is Aim => Boolean(child))
      const result = findPreviousSiblingOrAncestor(aimId, incomingAims, dataStore, aim.id, currentTopLevel)
      if (result) {
        return result
      }
    }
  }

  return null
}

export function findLastDescendant(aim: Aim, dataStore: DataStore): LastDescendantResult {
  if (!aim.expanded || !aim.supportingConnections?.length) {
    return { id: aim.id }
  }

  const lastConnection = aim.supportingConnections[aim.supportingConnections.length - 1]
  const lastIncoming = lastConnection ? dataStore.aims[lastConnection.aimId] : undefined
  if (!lastIncoming) {
    return { id: aim.id }
  }

  const descendant = findLastDescendant(lastIncoming, dataStore)
  return { ...descendant, parentId: aim.id, indexInParent: aim.supportingConnections.length - 1 }
}

export function findTopLevelAncestorIndex(aimId: string, topLevelAims: Aim[], dataStore: DataStore): number {
  const directIndex = topLevelAims.findIndex((aim) => aim.id === aimId)
  if (directIndex >= 0) {
    return directIndex
  }

  for (let i = 0; i < topLevelAims.length; i++) {
    const candidate = topLevelAims[i]
    if (candidate && isAimInTree(aimId, candidate, dataStore)) {
      return i
    }
  }

  return -1
}

export function isAimInTree(aimId: string, rootAim: Aim, dataStore: DataStore): boolean {
  if (rootAim.id === aimId) {
    return true
  }

  if (!rootAim.supportingConnections?.length) {
    return false
  }

  for (const connection of rootAim.supportingConnections) {
    const child = dataStore.aims[connection.aimId]
    if (child && isAimInTree(aimId, child, dataStore)) {
      return true
    }
  }

  return false
}

export function makeSelectedAimPath(aim: Aim, path: Aim[], dataStore: DataStore): Aim {
  path.push(aim)

  if (aim.expanded && aim.selectedIncomingIndex !== undefined) {
    const connections = aim.supportingConnections || []
    if (aim.selectedIncomingIndex < connections.length) {
      const selectedConnection = connections[aim.selectedIncomingIndex]
      const childAim = selectedConnection ? dataStore.aims[selectedConnection.aimId] : undefined
      if (childAim) {
        return makeSelectedAimPath(childAim, path, dataStore)
      }
    }
  }

  return aim
}

export function getSelectionPathFromState(
  navigatingAims: boolean,
  selectedColumn: number,
  floatingAimIndex: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined
): SelectionPath {
  const dataStore = useDataStore()
  if (!navigatingAims) {
    return { phase: undefined, aims: [] }
  }

  if (selectedColumn === -1) {
    const floatingAims = dataStore.floatingAims
    if (!floatingAims.length) {
      return { phase: undefined, aims: [] }
    }

    const validIndex = Math.max(0, Math.min(floatingAimIndex, floatingAims.length - 1))
    const selectedAim = floatingAims[validIndex]
    if (!selectedAim) {
      return { phase: undefined, aims: [] }
    }

    const aimPath: Aim[] = []
    makeSelectedAimPath(selectedAim, aimPath, dataStore)
    return { phase: undefined, aims: aimPath }
  }

  const phaseId = getSelectedPhaseId(selectedColumn)
  if (!phaseId) {
    return { phase: undefined, aims: [] }
  }

  const phase = dataStore.phases[phaseId]
  const aims = dataStore.getAimsForPhase(phaseId)
  const aimPath: Aim[] = []

  if (phase?.selectedAimIndex !== undefined) {
    const selectedAim = aims[phase.selectedAimIndex]
    if (selectedAim) {
      makeSelectedAimPath(selectedAim, aimPath, dataStore)
    }
  }

  return { phase, aims: aimPath }
}

export function setCurrentAimIndexInState(
  selectedColumn: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  setFloatingAimIndex: (index: number) => void,
  aimIndex: number,
  dataStore: DataStore
): void {
  if (selectedColumn === -1) {
    setFloatingAimIndex(aimIndex)
    return
  }

  const phaseId = getSelectedPhaseId(selectedColumn)
  if (!phaseId) {
    return
  }

  const phase = dataStore.phases[phaseId]
  if (phase) {
    phase.selectedAimIndex = aimIndex
  }
}

export function findPathToAim(targetId: string, topLevelAims: Aim[], dataStore: DataStore): TreeTraversalResult[] | null {
  for (let i = 0; i < topLevelAims.length; i++) {
    const root = topLevelAims[i]
    if (!root) {
      continue
    }

    const path = findPathInTree(targetId, root, dataStore, i, undefined)
    if (path) {
      return path
    }
  }

  return null
}

export function findPathInTree(
  targetId: string,
  currentAim: Aim,
  dataStore: DataStore,
  topLevelIndex: number,
  indexInParent: number | undefined
): TreeTraversalResult[] | null {
  if (currentAim.id === targetId) {
    return [{ aimId: currentAim.id, topLevelIndex, indexInParent }]
  }

  if (currentAim.supportingConnections?.length) {
    for (let i = 0; i < currentAim.supportingConnections.length; i++) {
      const childConnection = currentAim.supportingConnections[i]
      const childAim = childConnection ? dataStore.aims[childConnection.aimId] : undefined
      if (!childAim) {
        continue
      }

      const childPath = findPathInTree(targetId, childAim, dataStore, topLevelIndex, i)
      if (childPath) {
        return [{ aimId: currentAim.id, topLevelIndex, indexInParent }, ...childPath]
      }
    }
  }

  return null
}
