import { watch } from 'vue'
import { useUIStore } from '../stores/ui'

// Asks the column to reveal its focus whenever the selected idea changes,
// including moves that keep the ids (J/K reorders) or return to a parent (h).
export function useKeepSelectedIdeaVisible(
  isColumnActive: () => boolean,
  reveal: () => void
) {
  const uiStore = useUIStore()

  const selectionKey = () => {
    if (!uiStore.navigatingIdeas || !isColumnActive()) return ''
    const path = uiStore.getSelectionPath()
    if (path.ideas.length === 0) return ''
    // Each idea's position in its list too: J/K reorders keep the ids but must scroll.
    const topLevelIds = uiStore.getIdeaListScope()?.ideas.map((idea: { id: string }) => idea.id) ?? []
    return [
      path.phase?.id ?? 'floating',
      ...path.ideas.map((idea: { id: string }, depth: number) => {
        const siblingIds = depth === 0
          ? topLevelIds
          : (path.ideas[depth - 1]!.supportingConnections ?? []).map((connection: { ideaId: string }) => connection.ideaId)
        return `${idea.id}@${siblingIds.indexOf(idea.id)}`
      })
    ].join('/')
  }

  // Leaving idea navigation ('') moves the focus back to the phase: reveal too.
  watch(selectionKey, reveal, { flush: 'post' })
}
