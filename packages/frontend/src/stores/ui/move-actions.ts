import { trpc } from '../../trpc'
import { useDataStore } from '../data'
import { useToastStore } from '../toast'
import { isIdeaInTree as isIdeaInTreeHelper } from './navigation-helpers'
import { useProjectStore } from '../project-store'
import { useUIModalStore } from './modal-store'
import { ensureIdeaUIState } from './idea-ui-state'
import type { SelectionPath } from './navigation-helpers'

function getProjectPath(): string {
  return useProjectStore().projectPath
}

type IdeaContext = { parentId: string } | { phaseId: string }

// One server round trip per move (idea.move); the touched ideas and phases come
// back as stored and replace the local copies. The actions apply their change
// locally first, so a failed move reloads the touched entities instead of
// undoing it by hand, then rethrows.
async function moveOnServer(ideaId: string, move: { from?: IdeaContext; to?: IdeaContext; index?: number }) {
  const dataStore = useDataStore()
  const projectPath = getProjectPath()
  const apply = ({ ideas, phases }: { ideas: readonly any[]; phases: readonly any[] }) => {
    for (const idea of ideas) dataStore.replaceIdea(idea.id, idea)
    for (const phase of phases) dataStore.replacePhase(phase.id, phase)
  }
  try {
    apply(await trpc.idea.move.mutate({ projectPath, ideaId, ...move }))
  } catch (error) {
    const contexts = [move.from, move.to].filter((context) => context !== undefined)
    const ideaIds = [ideaId, ...contexts.flatMap((context) => 'parentId' in context ? [context.parentId] : [])]
    const phaseIds = contexts.flatMap((context) => 'phaseId' in context ? [context.phaseId] : [])
    const [ideas, phases] = await Promise.all([
      trpc.idea.getMany.query({ projectPath, ideaIds }),
      Promise.allSettled(phaseIds.map((phaseId) => trpc.phase.get.query({ projectPath, phaseId })))
    ]).catch(() => [[], []] as const)
    apply({ ideas, phases: phases.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []) })
    throw error
  }
}

// Where the selected idea sits: the ids of the list it is shown in (its parent's
// children, its phase's commitments or the floating ideas) and its index there.
function selectedPosition(path: SelectionPath, dataStore: ReturnType<typeof useDataStore>): { ids: string[]; index: number } {
  const idea = path.ideas[path.ideas.length - 1]
  const parent = path.ideas[path.ideas.length - 2]
  const ids = parent
    ? (parent.supportingConnections ?? []).map((connection) => connection.ideaId)
    : path.phase
      ? path.phase.commitments
      : dataStore.floatingIdeas.map((floating) => floating.id)
  return { ids, index: idea ? ids.indexOf(idea.id) : -1 }
}

// Shift+J/K: swaps the selected idea with its neighbour in its list; at the end
// of a phase it moves on into the next (previous) phase of the column. The
// selection is by id, so it follows the idea.
async function moveIdeaVertically(uiStore: any, delta: 1 | -1) {
  const dataStore = useDataStore()
  const path: SelectionPath = uiStore.getSelectionPath()
  if (path.ideas.length === 0) return

  const currentIdea = path.ideas[path.ideas.length - 1]!
  const { index: currentIndex } = selectedPosition(path, dataStore)
  const targetIndex = currentIndex + delta
  if (currentIndex < 0) return

  if (path.ideas.length > 1) {
    const parentIdea = path.ideas[path.ideas.length - 2]!
    const connections = parentIdea.supportingConnections ?? []
    if (targetIndex < 0 || targetIndex >= connections.length) return
    ;[connections[currentIndex], connections[targetIndex]] = [connections[targetIndex]!, connections[currentIndex]!]
    try {
      const parent = { parentId: parentIdea.id }
      await moveOnServer(currentIdea.id, { from: parent, to: parent, index: targetIndex })
    } catch (e) {
      useToastStore().error('Move failed', e)
    }
    return
  }
  if (!path.phase) return

  const phaseId = path.phase.id
  const ph = dataStore.phases[phaseId]
  if (!ph) return
  if (targetIndex >= 0 && targetIndex < ph.commitments.length) {
    ;[ph.commitments[currentIndex], ph.commitments[targetIndex]] = [ph.commitments[targetIndex]!, ph.commitments[currentIndex]!]
    try {
      await moveOnServer(currentIdea.id, { from: { phaseId }, to: { phaseId }, index: targetIndex })
    } catch (e) {
      useToastStore().error('Move failed', e)
    }
    return
  }

  const col = uiStore.activeColumn
  const allPhasesAtLevel = col >= 0 ? dataStore.getActualPhasesForColumn(col) : []
  const flatIndex = allPhasesAtLevel.findIndex((p: any) => p.id === phaseId)
  const neighbourPhase = flatIndex === -1 ? undefined : allPhasesAtLevel[flatIndex + delta]
  const neighbour = neighbourPhase ? dataStore.phases[neighbourPhase.id] : undefined
  if (!neighbourPhase || !neighbour) return

  // Down enters the next phase at the top, up the previous one at the bottom.
  ph.commitments.splice(currentIndex, 1)
  if (!neighbour.commitments) neighbour.commitments = []
  const newIndex = delta === 1 ? 0 : neighbour.commitments.length
  neighbour.commitments.splice(newIndex, 0, currentIdea.id)
  uiStore.selectTopIdea(neighbour.id, currentIdea.id)

  const neighbourIndex = uiStore.findSelectableIndexForPhase(col, neighbour.id)
  if (neighbourIndex >= 0) {
    await uiStore.selectPhase(col, neighbourIndex, 'preserve')
  }

  try {
    await moveOnServer(currentIdea.id, { from: { phaseId }, to: { phaseId: neighbour.id }, index: newIndex })
  } catch (e) {
    useToastStore().error('Move across phases failed', e)
  }
}

export const moveIdeaDownAction = (uiStore: any) => moveIdeaVertically(uiStore, 1)
export const moveIdeaUpAction = (uiStore: any) => moveIdeaVertically(uiStore, -1)

export async function moveIdeaOutAction(uiStore: any) {
  const dataStore = useDataStore()
  const path: SelectionPath = uiStore.getSelectionPath()

  if (path.ideas.length <= 1) return

  const currentIdea = path.ideas[path.ideas.length - 1]!
  const currentIdeaId = currentIdea.id
  const parentIdea = path.ideas[path.ideas.length - 2]
  if (!parentIdea) return

  const parentId = parentIdea.id
  const parentConnections = parentIdea.supportingConnections || []
  const updatedConnections = parentConnections.filter((c: any) => c.ideaId !== currentIdeaId)
  const updatedSupportedIdeas = currentIdea.supportedIdeas.filter((id: string) => id !== parentId)

  // The idea lands right after its old parent, in the parent's own list.
  const parentPosition = selectedPosition({ ...path, ideas: path.ideas.slice(0, -1), ideaStates: path.ideaStates.slice(0, -1) }, dataStore)
  const newIndex = parentPosition.index === -1 ? undefined : parentPosition.index + 1
  const grandparentIdea = path.ideas[path.ideas.length - 3]
  const grandparentId = grandparentIdea?.id
  const targetPhaseId = grandparentIdea ? undefined : path.phase?.id

  if (parentIdea.supportingConnections) {
    parentIdea.supportingConnections = updatedConnections
  }
  currentIdea.supportedIdeas = updatedSupportedIdeas
  const parentState = path.ideaStates[path.ideaStates.length - 2]
  if (parentState) parentState.selectedChildId = undefined

  if (grandparentId) {
    const gp = dataStore.ideas[grandparentId]
    if (gp && newIndex !== undefined) {
      if (!gp.supportingConnections) gp.supportingConnections = []
      gp.supportingConnections.splice(newIndex, 0, { ideaId: currentIdeaId, weight: 1 } as any)
      const gpState = path.ideaStates[path.ideaStates.length - 3]
      if (gpState) gpState.selectedChildId = currentIdeaId
      currentIdea.supportedIdeas.push(grandparentId)
    }
  } else if (targetPhaseId) {
    const ph = dataStore.phases[targetPhaseId]
    if (ph && newIndex !== undefined) {
      if (!ph.commitments) ph.commitments = []
      ph.commitments.splice(newIndex, 0, currentIdeaId)
      uiStore.selectTopIdea(targetPhaseId, currentIdeaId)
      if (!currentIdea.committedIn) currentIdea.committedIn = []
      currentIdea.committedIn.push(targetPhaseId)
    }
  } else if (newIndex !== undefined) {
    dataStore.floatingIdeasIds.splice(newIndex, 0, currentIdeaId)
    uiStore.selectTopIdea(undefined, currentIdeaId)
  }

  try {
    const to = grandparentId ? { parentId: grandparentId } : targetPhaseId ? { phaseId: targetPhaseId } : undefined
    await moveOnServer(currentIdeaId, { from: { parentId }, to, index: newIndex })
  } catch (e) {
    useToastStore().error('Move failed', e)
  }
}

export async function moveIdeaInAction(uiStore: any) {
  const dataStore = useDataStore()
  const path: SelectionPath = uiStore.getSelectionPath()

  if (path.ideas.length === 0) return

  const currentIdea = path.ideas[path.ideas.length - 1]!
  const currentIdeaId = currentIdea.id
  const { ids: siblingIds, index: currentIndex } = selectedPosition(path, dataStore)
  if (currentIndex <= 0) return

  const previousSiblingId = siblingIds[currentIndex - 1]
  const previousSibling = previousSiblingId ? dataStore.ideas[previousSiblingId] : undefined
  if (!previousSiblingId || !previousSibling) return

  const parentIdea = path.ideas[path.ideas.length - 2]
  const oldParentId = parentIdea?.id
  const oldPhaseId = parentIdea ? undefined : path.phase?.id
  const insertionIndex = (previousSibling.supportingConnections || []).length

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

  if (!previousSibling.supportingConnections) previousSibling.supportingConnections = []
  previousSibling.supportingConnections.splice(insertionIndex, 0, { ideaId: currentIdeaId, weight: 1 } as any)
  if (!currentIdea.supportedIdeas) currentIdea.supportedIdeas = []
  currentIdea.supportedIdeas.push(previousSiblingId)

  // The selection follows the idea into its new parent, the previous sibling.
  const oldParentState = path.ideaStates[path.ideaStates.length - 2]
  const siblingStateTree = oldParentState
    ? oldParentState.children
    : oldPhaseId
      ? uiStore.getPhaseIdeaUIStates(oldPhaseId)
      : uiStore.floatingIdeaUIStates
  const previousSiblingState = ensureIdeaUIState(siblingStateTree, previousSiblingId)
  previousSiblingState.expanded = true
  previousSiblingState.selectedChildId = currentIdeaId
  if (oldParentState) oldParentState.selectedChildId = previousSiblingId
  else uiStore.selectTopIdea(oldPhaseId, previousSiblingId)

  try {
    const from = oldParentId ? { parentId: oldParentId } : oldPhaseId ? { phaseId: oldPhaseId } : undefined
    await moveOnServer(currentIdeaId, { from, to: { parentId: previousSiblingId }, index: insertionIndex })
  } catch (e) {
    useToastStore().error('Move failed', e)
  }
}

// Where a pasted idea goes: right after the selected idea, in its list.
type PasteTarget = { parentState?: any; parentIdeaId?: string; phaseId?: string; floating?: boolean; index: number }

function pasteTarget(uiStore: any, dataStore: ReturnType<typeof useDataStore>, allowFloating: boolean): PasteTarget | undefined {
  const path: SelectionPath = uiStore.getSelectionPath()
  const index = selectedPosition(path, dataStore).index + 1
  if (path.ideas.length > 1) {
    return { parentIdeaId: path.ideas[path.ideas.length - 2]!.id, parentState: path.ideaStates[path.ideaStates.length - 2], index }
  }
  if (path.phase) return { phaseId: path.phase.id, index }
  if (allowFloating && uiStore.activeColumn === -1) return { floating: true, index }
  return undefined
}

// After a paste: select the pasted idea where it landed.
function selectPasted(uiStore: any, dataStore: ReturnType<typeof useDataStore>, target: PasteTarget, ideaId: string) {
  if (target.parentIdeaId) {
    if (target.parentState) {
      target.parentState.expanded = true
      const children = dataStore.ideas[target.parentIdeaId]?.supportingConnections ?? []
      target.parentState.selectedChildId = children.some((c: any) => c.ideaId === ideaId) ? ideaId : children[0]?.ideaId
    }
  } else if (target.phaseId) {
    const commitments = dataStore.phases[target.phaseId]?.commitments ?? []
    const selected = commitments.includes(ideaId) ? ideaId : commitments[0]
    if (selected) uiStore.selectTopIdea(target.phaseId, selected)
  } else if (target.floating && dataStore.floatingIdeasIds.includes(ideaId)) {
    uiStore.selectTopIdea(undefined, ideaId)
  }
}

export async function pasteCutIdeaAction(uiStore: any, dataStore: any) {
  const modalStore = useUIModalStore()
  const cutIdeaId = modalStore.teleportCutIdeaId
  const source = modalStore.teleportSource
  if (!cutIdeaId) return

  const target = pasteTarget(uiStore, dataStore, true)
  if (!target) return

  const cutIdea = dataStore.ideas[cutIdeaId]
  if (target.parentIdeaId && cutIdea && isIdeaInTreeHelper(target.parentIdeaId, cutIdea, dataStore)) {
    return
  }

  const sourceParentIdeaId = source?.parentIdeaId
  const sourcePhaseId = source?.phaseId

  try {
    const from = sourceParentIdeaId ? { parentId: sourceParentIdeaId } : sourcePhaseId ? { phaseId: sourcePhaseId } : undefined
    const to = target.parentIdeaId ? { parentId: target.parentIdeaId } : target.phaseId ? { phaseId: target.phaseId } : undefined
    await moveOnServer(cutIdeaId, { from, to, index: target.index })
    selectPasted(uiStore, dataStore, target, cutIdeaId)
    modalStore.clearTeleportBuffer()
  } catch (e) {
    useToastStore().error('Teleport paste failed', e)
  }
}

export async function pasteCopiedIdeaAction(uiStore: any, dataStore: any) {
  const modalStore = useUIModalStore()
  const copyIdeaId = modalStore.teleportCopyIdeaId
  if (!copyIdeaId) return

  const target = pasteTarget(uiStore, dataStore, false)
  if (!target) return

  const copyIdea = dataStore.ideas[copyIdeaId]
  if (target.parentIdeaId && copyIdea && isIdeaInTreeHelper(target.parentIdeaId, copyIdea, dataStore)) {
    return
  }

  try {
    const to = target.parentIdeaId ? { parentId: target.parentIdeaId } : { phaseId: target.phaseId! }
    await moveOnServer(copyIdeaId, { to, index: target.index })
    selectPasted(uiStore, dataStore, target, copyIdeaId)
    modalStore.clearTeleportBuffer()
  } catch (e) {
    useToastStore().error('Copy paste failed', e)
  }
}
