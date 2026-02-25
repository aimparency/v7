import { useDataStore } from '../data'

export async function selectPhaseAction(
  uiStore: any,
  columnIndex: number,
  phaseIndex: number,
  isTopLevel = true
) {
  const dataStore = useDataStore()

  if (isTopLevel) {
    uiStore.setSelectedColumn(columnIndex)
  }

  const parentId = uiStore.columnParentPhaseId[columnIndex] ?? null
  const phases = dataStore.getPhasesByParentId(parentId)
  uiStore.phaseCountByColumn[columnIndex] = phases.length
  const phase = phases[phaseIndex]
  const phaseId = phase?.id

  const oldPhaseId = uiStore.selectedPhaseIdByColumn[columnIndex]
  if (oldPhaseId && oldPhaseId !== phaseId && columnIndex >= 0) {
    const childSelection = uiStore.selectedPhaseByColumn[columnIndex + 1] ?? 0
    uiStore.lastSelectedSubPhaseIndexByPhase[oldPhaseId] = childSelection
  }

  uiStore.selectedPhaseByColumn[columnIndex] = phaseIndex
  if (phaseId) {
    uiStore.selectedPhaseIdByColumn[columnIndex] = phaseId
  } else {
    delete uiStore.selectedPhaseIdByColumn[columnIndex]
  }

  if (!phaseId) {
    uiStore.setRightmostColumn(columnIndex)
    return
  }

  const rememberedIndex = uiStore.lastSelectedSubPhaseIndexByPhase[phaseId] ?? 0
  const children = await dataStore.loadPhases(uiStore.projectPath, phaseId)
  uiStore.phaseCountByColumn[columnIndex + 1] = children.length

  if (children.length > 0) {
    const childIndex = Math.min(rememberedIndex, children.length - 1)

    uiStore.columnParentPhaseId[columnIndex + 1] = phaseId
    uiStore.selectedPhaseByColumn[columnIndex + 1] = childIndex
    const child = children[childIndex]
    if (child) {
      uiStore.selectedPhaseIdByColumn[columnIndex + 1] = child.id
    }
    uiStore.setMinRightmost(columnIndex + 1)

    await uiStore.selectPhase(columnIndex + 1, childIndex, false)
  } else {
    uiStore.columnParentPhaseId[columnIndex + 1] = phaseId
    uiStore.setRightmostColumn(columnIndex + 1)
  }
}

export function setSelectionAction(uiStore: any, columnIndex: number, phaseIndex: number) {
  const dataStore = useDataStore()
  const parentId = uiStore.columnParentPhaseId[columnIndex] ?? null
  const phases = dataStore.getPhasesByParentId(parentId)
  const phase = phases[phaseIndex]

  uiStore.selectedPhaseByColumn[columnIndex] = phaseIndex
  if (phase) {
    uiStore.selectedPhaseIdByColumn[columnIndex] = phase.id
  } else {
    delete uiStore.selectedPhaseIdByColumn[columnIndex]
  }

  if (columnIndex > 0) {
    const parentColumn = columnIndex - 1
    const parentPhaseId = uiStore.selectedPhaseIdByColumn[parentColumn]
    if (parentPhaseId) {
      uiStore.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = phaseIndex
    }
  }
}
