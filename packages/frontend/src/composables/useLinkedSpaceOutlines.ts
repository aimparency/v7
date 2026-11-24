import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { useDataStore } from '../stores/data'
import { graphOutline, outlineContains, outlinePath, type Circle, type Outline } from '../utils/graph-outline'
import type { GraphNode } from './useGraphSimulation'

const DEFAULT_COLOR = '#8fa3bf'
const MARGIN = 40 // logical units between the outermost idea and the string

export type LinkedSpaceOutline = { repoId: string; color: string; outline: Outline; path: string; pending: boolean; collapsed: boolean }

// One wobbly string per linked space: around its ideas while it is open in
// place, and as its node while it is closed, so opening reads as the node
// growing to show what is inside. The strings move slowly.
export function useLinkedSpaceOutlines(nodes: Ref<GraphNode[]>, trigger: Ref<number>) {
  const dataStore = useDataStore()
  const time = ref(0)

  const shownIds = computed(() =>
    Object.entries(dataStore.linkedSpaceViews).filter(([, view]) => view.state === 'shown').map(([repoId]) => repoId)
  )
  const anySpace = computed(() => {
    trigger.value
    return shownIds.value.length > 0 || nodes.value.some(node => node.isRepo)
  })

  let frame: number | undefined
  const tick = (now: number) => {
    time.value = now / 1600
    frame = requestAnimationFrame(tick)
  }
  watch(anySpace, (any) => {
    if (any && frame === undefined) frame = requestAnimationFrame(tick)
    if (!any && frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
  }, { immediate: true })
  onUnmounted(() => { if (frame !== undefined) cancelAnimationFrame(frame) })

  const outlines = computed<LinkedSpaceOutline[]>(() => {
    trigger.value // positions move with the simulation
    const members = new Map<string, Circle[]>(shownIds.value.map(id => [id, []]))
    const pending = new Set(dataStore.offers.flatMap(offer => offer.offeredSpace && !dataStore.meta?.linkedRepos?.some((link: { repoId: string }) => link.repoId === offer.offeredSpace!.repoId) ? [offer.offeredSpace.repoId] : []))
    const closed: LinkedSpaceOutline[] = []
    for (const node of nodes.value) {
      if (node.space) members.get(node.space)?.push({ x: node.renderPos[0], y: node.renderPos[1], r: node.r })
      if (!node.isRepo) continue
      // Closed: the ring is the node, its wobble moving around the node's edge.
      const outline = graphOutline([{ x: node.renderPos[0], y: node.renderPos[1], r: node.r * 0.82 }], node.r * 0.18, time.value + node.id.charCodeAt(0))
      if (outline) closed.push({ repoId: node.id, color: DEFAULT_COLOR, outline, path: outlinePath(outline), pending: node.pending ?? false, collapsed: true })
    }
    const open = [...members].flatMap(([repoId, circles]) => {
      const outline = graphOutline(circles, MARGIN, time.value + repoId.charCodeAt(0))
      if (!outline) return []
      const view = dataStore.linkedSpaceViews[repoId]
      const color = (view?.state === 'shown' && view.color) || DEFAULT_COLOR
      return [{ repoId, color, outline, path: outlinePath(outline), pending: pending.has(repoId), collapsed: false }]
    })
    return [...closed, ...open]
  })

  /** The linked space whose string the logical point lies inside. */
  const spaceAt = (pos: readonly number[]) =>
    outlines.value.find(o => outlineContains(o.outline, pos[0]!, pos[1]!))?.repoId

  return { outlines, spaceAt }
}
