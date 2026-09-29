import { nextTick, watch, type Ref } from 'vue'
import { useUIStore } from '../stores/ui'

// Keeps the selected aim of a column in view while navigating aims.
//
// Aims used to request their own scroll when their `isThisAimSelected`/`isActive`
// props flipped. Selection moves that don't flip those props on the newly
// selected aim (returning to a parent with k/h, reordering with J/K, stale
// sub-selection indices) then never scrolled. Watching the whole selection path
// from the column covers every move with one mechanism.
export function useKeepSelectedAimVisible(
  containerRef: Ref<HTMLElement | null>,
  isColumnActive: () => boolean,
  scrollToElement: (element: HTMLElement) => void
) {
  const uiStore = useUIStore()

  const selectionKey = () => {
    if (!uiStore.navigatingAims || !isColumnActive()) return ''
    const path = uiStore.getSelectionPath()
    if (path.aims.length === 0) return ''
    return [
      path.phase?.id ?? 'floating',
      path.phase?.selectedAimIndex ?? uiStore.floatingAimIndex,
      ...path.aims.map((aim: { id: string }, depth: number) => `${aim.id}@${path.aimStates[depth]?.selectedIncomingIndex ?? ''}`)
    ].join('/')
  }

  watch(selectionKey, async (key) => {
    if (!key) return
    await nextTick()
    const container = containerRef.value
    if (!container) return
    // Every aim on the selection path carries `.active`; ancestors precede their
    // descendants in document order, so the last match is the selected aim.
    const activeAims = container.querySelectorAll<HTMLElement>('.aim-item.active')
    const selected = activeAims[activeAims.length - 1]
    if (selected) scrollToElement(selected)
  }, { flush: 'post' })
}
