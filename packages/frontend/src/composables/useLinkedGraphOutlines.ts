import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { useDataStore } from '../stores/data'
import { graphOutline, outlineContains, outlinePath, type Circle, type Outline } from '../utils/graph-outline'
import type { GraphNode } from './useGraphSimulation'

const DEFAULT_COLOR = '#8fa3bf'
const MARGIN = 40 // logical units between the outermost idea and the string

export type LinkedGraphOutline = { repoId: string; color: string; outline: Outline; path: string; pending: boolean }

// One wobbly string around each linked graph opened in place: around its node
// and its ideas. The string moves slowly for as long as one is shown.
export function useLinkedGraphOutlines(nodes: Ref<GraphNode[]>, trigger: Ref<number>) {
  const dataStore = useDataStore()
  const time = ref(0)

  const shownIds = computed(() =>
    Object.entries(dataStore.linkedGraphViews).filter(([, view]) => view.state === 'shown').map(([repoId]) => repoId)
  )

  let frame: number | undefined
  const tick = (now: number) => {
    time.value = now / 1600
    frame = requestAnimationFrame(tick)
  }
  watch(() => shownIds.value.length > 0, (any) => {
    if (any && frame === undefined) frame = requestAnimationFrame(tick)
    if (!any && frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
  }, { immediate: true })
  onUnmounted(() => { if (frame !== undefined) cancelAnimationFrame(frame) })

  const outlines = computed<LinkedGraphOutline[]>(() => {
    trigger.value // positions move with the simulation
    if (shownIds.value.length === 0) return []
    const members = new Map<string, Circle[]>(shownIds.value.map(id => [id, []]))
    const pending = new Set<string>()
    for (const node of nodes.value) {
      if (node.isRepo && node.pending) pending.add(node.id)
      const repoId = node.space ?? (node.isRepo ? node.id : undefined)
      members.get(repoId ?? '')?.push({ x: node.renderPos[0], y: node.renderPos[1], r: node.r })
    }
    return [...members].flatMap(([repoId, circles]) => {
      const outline = graphOutline(circles, MARGIN, time.value + repoId.charCodeAt(0))
      if (!outline) return []
      const view = dataStore.linkedGraphViews[repoId]
      const color = (view?.state === 'shown' && view.color) || DEFAULT_COLOR
      return [{ repoId, color, outline, path: outlinePath(outline), pending: pending.has(repoId) }]
    })
  })

  /** The linked graph whose string the logical point lies inside. */
  const graphAt = (pos: readonly number[]) =>
    outlines.value.find(o => outlineContains(o.outline, pos[0]!, pos[1]!))?.repoId

  return { outlines, graphAt }
}
