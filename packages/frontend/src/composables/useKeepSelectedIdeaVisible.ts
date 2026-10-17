import { nextTick, watch, type Ref } from 'vue'
import { useUIStore } from '../stores/ui'

// Keeps the selected idea of a column in view while navigating ideas.
//
// Ideas used to request their own scroll when their `isThisIdeaSelected`/`isActive`
// props flipped. Selection moves that don't flip those props on the newly
// selected idea (returning to a parent with k/h, reordering with J/K) then
// never scrolled. Watching the whole selection path from the column covers
// every move with one mechanism.
export function useKeepSelectedIdeaVisible(
  containerRef: Ref<HTMLElement | null>,
  isColumnActive: () => boolean,
  scrollToElement: (element: HTMLElement) => void
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

  watch(selectionKey, async (key) => {
    if (!key) return
    await nextTick()
    const container = containerRef.value
    if (!container) return
    // Every idea on the selection path carries `.active`; ancestors precede their
    // descendants in document order, so the last match is the selected idea.
    const activeIdeas = container.querySelectorAll<HTMLElement>('.idea-item.active')
    const selected = activeIdeas[activeIdeas.length - 1]
    if (selected) scrollToElement(selected)
  }, { flush: 'post' })
}
