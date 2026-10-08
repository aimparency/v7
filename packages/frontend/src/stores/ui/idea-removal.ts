import type { Idea, IdeaContext } from '../data'
import { useUIModalStore } from './modal-store'

// The dialogs before removing ideas. Every removal that could take more than
// the ideas themselves, or that could take an idea out of the graph although
// only its list membership was meant, asks first (r / x / Esc).

type RemovalDataStore = {
  previewCascadingDelete(projectPath: string, ideaIds: string[]): Promise<string[]>
  deleteIdeas(projectPath: string, ideaIds: string[], options: { cascade: boolean }): Promise<string[]>
  detachIdea(projectPath: string, ideaId: string, from: IdeaContext): Promise<void>
}

// Deletes ideas outside of any list (graph, bulk selection). If sub-ideas would
// go along, asks whether to delete only these ideas or their subtrees too.
// Returns false when cancelled.
export async function deleteIdeasAsking(dataStore: RemovalDataStore, projectPath: string, ideaIds: string[]): Promise<boolean> {
  const cascadeIds = await dataStore.previewCascadingDelete(projectPath, ideaIds)
  let cascade = false
  if (cascadeIds.length > ideaIds.length) {
    const choice = await useUIModalStore().askIdeaRemoval({ ideaIds, cascadeIds })
    if (!choice) return false
    cascade = choice === 'cascade'
  }
  await dataStore.deleteIdeas(projectPath, ideaIds, { cascade })
  return true
}

// Takes the idea out of the list it is shown in. If nothing else anchors it,
// asks whether to keep it floating or delete it with its unanchored subtree.
// Returns false when cancelled.
export async function removeIdeaFromList(
  dataStore: RemovalDataStore,
  projectPath: string,
  idea: Idea,
  from: { context: IdeaContext, label: string } | null
): Promise<boolean> {
  if (!from) return deleteIdeasAsking(dataStore, projectPath, [idea.id])

  const { context } = from
  const otherParents = idea.supportedIdeas.filter((id) => !('parentId' in context) || id !== context.parentId)
  const otherPhases = idea.committedIn.filter((id) => !('phaseId' in context) || id !== context.phaseId)
  if (otherParents.length > 0 || otherPhases.length > 0) {
    await dataStore.detachIdea(projectPath, idea.id, context)
    return true
  }

  const cascadeIds = await dataStore.previewCascadingDelete(projectPath, [idea.id])
  const choice = await useUIModalStore().askIdeaRemoval({ ideaIds: [idea.id], fromLabel: from.label, cascadeIds })
  if (!choice) return false
  if (choice === 'keep') {
    await dataStore.detachIdea(projectPath, idea.id, context)
  } else {
    await dataStore.deleteIdeas(projectPath, [idea.id], { cascade: true })
  }
  return true
}
