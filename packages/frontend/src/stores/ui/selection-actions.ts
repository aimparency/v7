import { trpc } from '../../trpc'
import { useDataStore, type Aim, type Phase } from '../data'
import { findPathToAim as findPathToAimHelper } from './navigation-helpers'
import { useUIModalStore } from './modal-store'
import { useUIProjectStore } from '../project-store'

export type AimPath = {
  phaseId?: string
  aims: Aim[]
}

export async function selectAimByIdAction(
  uiStore: any,
  columnIndex: number,
  phaseId: string | undefined,
  aimId: string
) {
  const dataStore = useDataStore()
  const modalStore = useUIModalStore()

  const currentAim = uiStore.getCurrentAim()
  const isAlreadySelected = currentAim?.id === aimId && uiStore.selectedColumn === columnIndex

  if (isAlreadySelected) {
    const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
    const aimIndex = aims.findIndex((a: any) => a && a.id === aimId)
    if (aimIndex !== -1) {
      modalStore.showAimModal = true
      modalStore.aimModalMode = 'edit'
    }
    return
  }

  const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims

  Object.values(dataStore.aims).forEach((aim: any) => {
    aim.selectedIncomingIndex = undefined
  })

  const topLevelIndex = aims.findIndex((a: any) => a && a.id === aimId)

  if (topLevelIndex >= 0) {
    await selectAimAction(uiStore, columnIndex, phaseId, topLevelIndex)
    return
  }

  const path = findPathToAimHelper(aimId, aims, dataStore)
  if (!path || path.length === 0) return

  for (let i = 0; i < path.length - 1; i++) {
    const step = path[i]
    if (!step) continue
    const parentAim = dataStore.aims[step.aimId]
    const nextStep = path[i + 1]
    if (parentAim && nextStep && nextStep.indexInParent !== undefined) {
      parentAim.selectedIncomingIndex = nextStep.indexInParent
    }
  }

  const topLevel = path[0]
  uiStore.setSelectedColumn(columnIndex)

  if (phaseId && columnIndex >= 0) {
    const parentId = uiStore.columnParentPhaseId[columnIndex] ?? null
    const phases = dataStore.getPhasesByParentId(parentId)
    const phaseIndex = phases.findIndex((p: any) => p.id === phaseId)
    if (phaseIndex !== -1) {
      uiStore.selectedPhaseByColumn[columnIndex] = phaseIndex
      uiStore.selectedPhaseIdByColumn[columnIndex] = phaseId
    }
  }

  uiStore.navigatingAims = true
  if (topLevel) {
    uiStore.setCurrentAimIndex(topLevel.topLevelIndex, dataStore)
  }
}

export async function selectAimAction(
  uiStore: any,
  columnIndex: number,
  phaseId: string | undefined,
  aimIndex: number
) {
  const dataStore = useDataStore()

  uiStore.setSelectedColumn(columnIndex)

  if (phaseId && columnIndex >= 0) {
    const parentId = uiStore.columnParentPhaseId[columnIndex] ?? null
    const phases = dataStore.getPhasesByParentId(parentId)
    const phaseIndex = phases.findIndex((p: any) => p.id === phaseId)

    if (phaseIndex !== -1) {
      uiStore.selectedPhaseByColumn[columnIndex] = phaseIndex
      uiStore.selectedPhaseIdByColumn[columnIndex] = phaseId
    }
  }

  uiStore.navigatingAims = true
  uiStore.setCurrentAimIndex(aimIndex, dataStore)
}

export async function calculateAimPathsAction(uiStore: any, aimId: string): Promise<AimPath[]> {
  const projectStore = useUIProjectStore()
  const paths: AimPath[] = []
  const visited = new Set<string>()

  const trace = async (currentId: string, pathAcc: Aim[]) => {
    if (visited.has(currentId)) return
    visited.add(currentId)

    const dataStore = useDataStore()
    let aim = dataStore.aims[currentId]
    if (!aim) {
      try {
        aim = await trpc.aim.get.query({ projectPath: projectStore.projectPath, aimId: currentId })
        dataStore.replaceAim(aim.id, aim)
      } catch {
        console.error('failed to load aim', currentId)
        return
      }
    }

    const newPath = [aim, ...pathAcc]
    let isRoot = true

    if (aim.committedIn && aim.committedIn.length > 0) {
      isRoot = false
      for (const phaseId of aim.committedIn) {
        paths.push({ phaseId, aims: newPath })
      }
    }

    if (aim.supportedAims && aim.supportedAims.length > 0) {
      isRoot = false
      for (const parentId of aim.supportedAims) {
        await trace(parentId, newPath)
      }
    }

    if (isRoot) {
      paths.push({ phaseId: undefined, aims: newPath })
    }

    visited.delete(currentId)
  }

  await trace(aimId, [])
  return paths
}

export async function prepareNavigationAction(uiStore: any, aimId: string): Promise<AimPath[]> {
  return await calculateAimPathsAction(uiStore, aimId)
}

export async function executeNavigationAction(uiStore: any, path: AimPath) {
  const projectStore = useUIProjectStore()
  const dataStore = useDataStore()
  const rootAim = path.aims[0]
  const phaseId = path.phaseId

  if (phaseId) {
    const phasePath: Phase[] = []
    let currentPhase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId })

    while (currentPhase) {
      dataStore.replacePhase(currentPhase.id, currentPhase)
      const storedPhase = dataStore.phases[currentPhase.id]
      if (storedPhase) phasePath.unshift(storedPhase)

      if (currentPhase.parent) {
        currentPhase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: currentPhase.parent })
      } else {
        break
      }
    }

    for (let i = 0; i < phasePath.length; i++) {
      const p = phasePath[i]
      if (!p) continue
      const parentId = p.parent
      await dataStore.loadPhases(projectStore.projectPath, parentId)
      const siblings = dataStore.getPhasesByParentId(parentId)
      const index = siblings.findIndex((x: any) => x && x.id === p.id)
      if (index !== -1) {
        uiStore.setSelection(i, index)
        if (i < phasePath.length - 1) {
          await dataStore.loadPhases(projectStore.projectPath, p.id)
          uiStore.columnParentPhaseId[i + 1] = p.id
        }
      }
    }

    uiStore.selectedColumn = phasePath.length - 1
    uiStore.setRightmostColumn(phasePath.length)
    await dataStore.loadPhaseAims(projectStore.projectPath, phaseId)
  } else {
    uiStore.selectedColumn = -1
    await dataStore.loadFloatingAims(projectStore.projectPath)
  }

  const contextAims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
  if (rootAim) {
    const rootIndex = contextAims.findIndex((a: any) => a && a.id === rootAim.id)
    if (rootIndex !== -1) {
      if (phaseId) {
        const phase = dataStore.phases[phaseId]
        if (phase) phase.selectedAimIndex = rootIndex
      } else {
        uiStore.floatingAimIndex = rootIndex
      }
    }
  }

  for (let i = 0; i < path.aims.length - 1; i++) {
    const parentStep = path.aims[i]
    if (!parentStep) continue
    const parent = dataStore.aims[parentStep.id]
    const child = path.aims[i + 1]
    if (!parent || !child) continue

    parent.expanded = true
    if (parent.supportingConnections && parent.supportingConnections.length > 0) {
      await dataStore.loadAims(
        projectStore.projectPath,
        parent.supportingConnections.map((c: any) => c.aimId)
      )
    }

    const childIndex = parent.supportingConnections.findIndex((c: any) => c.aimId === child.id)
    if (childIndex !== -1) {
      parent.selectedIncomingIndex = childIndex
    }
  }

  uiStore.navigatingAims = true
  uiStore.ensureSelectionVisible()
}

export async function navigateToAimAction(uiStore: any, aimId: string) {
  const paths = await prepareNavigationAction(uiStore, aimId)
  const firstPath = paths[0]
  if (firstPath) {
    await executeNavigationAction(uiStore, firstPath)
  }
}
