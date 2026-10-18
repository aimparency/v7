<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, computed, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { useToastStore } from '../stores/toast'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import GraphFlowHandle from '../components/GraphFlowHandle.vue'
import GraphSidePanel from '../components/GraphSidePanel.vue'
import PhaseSearchModal from '../components/PhaseSearchModal.vue'
import SpinOffApplyModal from '../components/SpinOffApplyModal.vue'
import type { PhaseSearchSelection } from '../stores/ui/phase-search-types'
import * as vec2 from '../utils/vec2'
import { isIdeaNode, useGraphSimulation, type GraphLink, type GraphNode } from '../composables/useGraphSimulation'
import { useGraphInteraction } from '../composables/useGraphInteraction'
import { useWebGLGraphRenderer } from '../composables/useWebGLGraphRenderer'
import { saveProjectThumbnail } from '../utils/db'
import { calculateArrowGeometry, connectionArrowWidth, hitTestArrow } from '../webgl/utils/arrow-geometry'
import type { LayoutSettings } from 'shared'
import { DEFAULT_LAYOUT_SETTINGS, largestNetworkIds, positionsFromStoredOffsets, sameLayoutSettings, withLayoutDefaults, type LayoutChange, type LayoutPlacement } from '../utils/autolayout'
import { endpointFlowShares } from '../utils/graph-forces'
import type { LayoutMessage, LayoutRequest, LayoutResult } from '../utils/autolayout.worker'
import LayoutPreviewPanel from '../components/LayoutPreviewPanel.vue'
import { trpc } from '../trpc'
import { GitBranch, X } from 'lucide-vue-next'

const dataStore = useDataStore()
const uiStore = useUIStore()
const graphUIStore = useGraphUIStore()
const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const mapStore = useMapStore()

const canvasRef = ref<HTMLCanvasElement>()
const svgOverlayRef = ref<SVGSVGElement>()
const width = ref(0)
const height = ref(0)
const showPhaseFilter = ref(false)

// Composables
const simulation = useGraphSimulation()
const { nodes, links, trigger, randomizeLayout } = simulation

// WebGL renderer
const webglRenderer = useWebGLGraphRenderer(canvasRef, nodes, links)

// Use canvas for interaction (same API as SVG)
const interaction = useGraphInteraction(canvasRef, width, height, simulation)
const { onNodeDown, onNodeUp, onNodeClick, onBackgroundClick, onMouseDown, onMouseMove, onMouseUp, isZooming } = interaction

// Hit test helper - find node at physical position
function hitTestNode(physX: number, physY: number) {
  const logicalPos = mapStore.physicalToLogicalCoord([physX, physY])
  return nodes.value.find(node => {
    const dx = node.renderPos[0] - logicalPos[0]
    const dy = node.renderPos[1] - logicalPos[1]
    const distSq = dx * dx + dy * dy
    return distSq <= node.r * node.r
  })
}

// Hit test helper - find link at physical position (reverse order for front-to-back)
function hitTestLink(physX: number, physY: number) {
  const logicalPos = mapStore.physicalToLogicalCoord([physX, physY])
  const point = { x: logicalPos[0], y: logicalPos[1] }

  // Iterate in reverse (last rendered = on top)
  for (let i = links.value.length - 1; i >= 0; i--) {
    const link = links.value[i]!
    const sourceNode = {
      x: link.source.renderPos[0],
      y: link.source.renderPos[1],
      r: link.source.r
    }
    const targetNode = {
      x: link.target.renderPos[0],
      y: link.target.renderPos[1],
      r: link.target.r
    }

    const geom = calculateArrowGeometry(sourceNode, targetNode, connectionArrowWidth(link))

    if (hitTestArrow(geom, point, i === links.value.length - 1)) {
      return link
    }
  }
  return undefined
}

// Track node hit on mousedown for drag handling
let mouseDownNode: typeof nodes.value[0] | undefined = undefined

function handleCanvasMouseDown(e: MouseEvent) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  const physX = e.clientX - rect.left
  const physY = e.clientY - rect.top
  mouseDownNode = hitTestNode(physX, physY)

  if (mouseDownNode) {
    onNodeDown(e, mouseDownNode)
  }
}

function handleCanvasMouseUp(e: MouseEvent) {
  if (mouseDownNode) {
    const rect = canvasRef.value?.getBoundingClientRect()
    if (rect) {
      const physX = e.clientX - rect.left
      const physY = e.clientY - rect.top
      const releasedNode = hitTestNode(physX, physY)
      if (releasedNode) {
        onNodeUp(releasedNode)
      }
    }
  }
  mouseDownNode = undefined
}

function handleCanvasClick(e: MouseEvent) {
  // Skip hit tests if cursor moved (pan/drag ended) - just handle as background
  if (mapStore.cursorMoved) {
    onBackgroundClick()
    return
  }

  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return onBackgroundClick()

  const physX = e.clientX - rect.left
  const physY = e.clientY - rect.top

  // Nodes render on top of arrows, so test nodes first
  const clickedNode = hitTestNode(physX, physY)
  if (clickedNode) {
    if (clickedNode.loadable) {
      graphUIStore.expandLoadableIdea(clickedNode.id, dataStore.ideas)
    } else {
      onNodeClick(clickedNode, e)
    }
    return
  }

  // Test links (arrows) if no node hit
  // Link goes from source (child) to target (parent), but selectLink expects (parentId, childId)
  const clickedLink = hitTestLink(physX, physY)
  if (clickedLink) {
    graphUIStore.selectLink(clickedLink.target.id, clickedLink.source.id)
    graphUIStore.setGraphSelection(null)
    return
  }

  onBackgroundClick()
}

// Lifecycle
let labelCullInterval: ReturnType<typeof setInterval> | undefined

// A screenshot of the graph for the project selection page: soon after opening, then every minute.
let thumbnailTimeout: ReturnType<typeof setTimeout> | undefined
let thumbnailInterval: ReturnType<typeof setInterval> | undefined
async function saveThumbnail() {
    const path = projectStore.projectPath
    const blob = await webglRenderer.captureThumbnail()
    if (blob && path === projectStore.projectPath) await saveProjectThumbnail(path, blob).catch(() => {})
}

// Dev-only e2e hook: nodes are WebGL-drawn, so tests look up a node's client
// position by idea text to drive clicks and drags.
function getNodeClientPosition(ideaText: string) {
    const node = nodes.value.find((candidate) => candidate.text === ideaText)
    const rect = canvasRef.value?.getBoundingClientRect()
    if (!node || !rect) return null
    const [x, y] = mapStore.logicalToPhysicalCoord([node.renderPos[0], node.renderPos[1]])
    return { x: rect.left + x!, y: rect.top + y! }
}

onMounted(() => {
    mapStore.isTracking = true
    simulation.init()
    interaction.initListeners()
    window.addEventListener('keydown', onKeydown)
    updateVisibleLabels()
    labelCullInterval = setInterval(updateVisibleLabels, 500)
    thumbnailTimeout = setTimeout(saveThumbnail, 3000)
    thumbnailInterval = setInterval(saveThumbnail, 60_000)
    if (import.meta.env.DEV) {
        (window as any).__aimparencyGraph = { getNodeClientPosition }
    }
})

onUnmounted(() => {
    if (import.meta.env.DEV) delete (window as any).__aimparencyGraph
    simulation.cleanup()
    interaction.cleanupListeners()
    window.removeEventListener('keydown', onKeydown)
    if (labelCullInterval !== undefined) clearInterval(labelCullInterval)
    clearTimeout(thumbnailTimeout)
    clearInterval(thumbnailInterval)
})

// Force WebGL update when simulation triggers
watch(trigger, () => {
    webglRenderer.forceUpdate()
})

// Refresh label culling immediately on resize so labels don't wait up to 500ms
watch([width, height], () => updateVisibleLabels())

const onKeydown = (e: KeyboardEvent) => {
    // Ignore if user is typing in an input or textarea
    const target = e.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    if (isInput) return

    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        const nextMode: Record<'status' | 'priority' | 'custom', 'status' | 'priority' | 'custom'> = {
            'status': 'priority',
            'priority': 'custom',
            'custom': 'status'
        }
        // In spin-off preview, the cycle key exits the preview rather than
        // landing on an undefined mode.
        if (graphUIStore.graphColorMode === 'spin-off') {
            graphUIStore.clearSpinOffPreview()
        } else {
            graphUIStore.setGraphColorMode(nextMode[graphUIStore.graphColorMode])
        }
    }

    if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
        showPhaseFilter.value = !showPhaseFilter.value
    }

    if (e.key === 'Escape' && !showPhaseFilter.value) {
        graphUIStore.clearPhaseFilter()
    }
}

function handlePhaseSelect(selection: PhaseSearchSelection) {
    if (selection.type === 'phase') {
        const phase = selection.data
        graphUIStore.setPhaseFilter(phase.id, phase.name, phase.commitments, dataStore.ideas)
    }
    showPhaseFilter.value = false
}

// Rendering Computeds
const visualScale = computed(() => {
    return mapStore.scale * mapStore.halfSide / LOGICAL_HALF_SIDE
})

const transform = computed(() => {
    trigger.value // dependency
    const cx = mapStore.clientOffset[0] + mapStore.halfSide
    const cy = mapStore.clientOffset[1] + mapStore.halfSide
    const s = visualScale.value
    return `translate(${cx}, ${cy}) scale(${s}) translate(${mapStore.offset[0]}, ${mapStore.offset[1]})`
})

// Set of node ids whose labels are currently in view and large enough to
// render. Recomputed on a 500ms cadence (see updateVisibleLabels) so the
// per-node viewport test does not run every frame. Positions stay live —
// only membership is throttled.
const visibleLabelIds = ref<Set<string>>(new Set())

// Ideas whose files fail to load: drawn as red "!" nodes, listed here with why.
const unreadableIdeasSummary = computed(() =>
  dataStore.unreadableIdeas.map((entry) => `${entry.file}: ${entry.error}`).join('\n')
)

const renderNodes = computed(() => {
    trigger.value;
    const currentIdeaId = graphUIStore.graphSelectedIdeaId
    const activeIdea = uiStore.getCurrentIdea()
    const visible = visibleLabelIds.value
    const result = []
    for (const n of nodes.value) {
        if (!visible.has(n.id)) continue
        result.push({
            ...n,
            x: n.renderPos[0],
            y: n.renderPos[1],
            r: n.r,
            text: n.text,
            selected: n.id === currentIdeaId,
            active: n.id === activeIdea?.id,
            scale: visualScale.value
        })
    }
    return result
})

// Cull idea labels to those inside the viewport and large enough to show text
// (matches the `node.r * node.scale > 20` template guard). Off-screen nodes
// would otherwise each emit an empty SVG label group with event handlers,
// which is the dominant cost for large graphs. Throttled to 500ms.
function updateVisibleLabels() {
    const w = width.value
    const h = height.value
    const s = visualScale.value
    if (w <= 0 || h <= 0 || !(s > 0)) return
    const c0 = mapStore.physicalToLogicalCoord([0, 0])
    const c1 = mapStore.physicalToLogicalCoord([w, h])
    const minX = Math.min(c0[0], c1[0])
    const maxX = Math.max(c0[0], c1[0])
    const minY = Math.min(c0[1], c1[1])
    const maxY = Math.max(c0[1], c1[1])
    const next = new Set<string>()
    for (const n of nodes.value) {
        if (n.r * s <= 20) continue
        const x = n.renderPos[0]
        const y = n.renderPos[1]
        const r = n.r
        if (x + r < minX || x - r > maxX || y + r < minY || y - r > maxY) continue
        next.add(n.id)
    }
    visibleLabelIds.value = next
}

const selectedLinkData = computed(() => {
  trigger.value
  if (!graphUIStore.selectedLink) return null
  const link = links.value.find(l => 
    l.source.id === graphUIStore.selectedLink!.childId && 
    l.target.id === graphUIStore.selectedLink!.parentId
  )
  if (!link) return null
  return {
    ...link,
    relativePosition: [link.relativePosition[0], link.relativePosition[1]] as vec2.T
  }
})

const selectedLinkVisuals = computed(() => {
  trigger.value
  const link = selectedLinkData.value
  if (!link) return null
  return {
    sourcePos: [link.source.renderPos[0], link.source.renderPos[1]] as vec2.T,
    targetPos: [link.target.renderPos[0], link.target.renderPos[1]] as vec2.T,
    sourceR: link.source.r || 25,
    targetR: link.target.r || 25
  }
})

const recenterGraph = () => mapStore.centerOnGraph(nodes.value, 1000, {
  percentile: 0.9,
  zoomOut: 1.2,
})

// Layout: a live solver proposes new connection offsets (most relevant first)
// and places parentless ideas, whose positions live in this browser only.
// It keeps running while the panel is open; a settings change continues from
// its current state. Links get the proposed offsets, and every idea glides by
// how far its rest position (where the offsets put it) moves, so a subtree
// moves along with its root. Nothing is saved until Apply; the fader picks
// how many offsets.
type LayoutPreview = {
  request: Omit<LayoutRequest, 'settings'>
  saved: Required<LayoutSettings> // as last applied, from meta.json, defaults filled in
  changes: LayoutChange[]
  placements: LayoutPlacement[]
  linkByKey: Map<string, GraphLink>
  stored: Map<GraphLink, GraphLink['relativePosition']>
  restBefore: Map<string, [number, number]>
  mainNetwork: Set<string> // its centre stays put
}
const layoutPreview = shallowRef<LayoutPreview | null>(null)
const layoutSettings = ref<Required<LayoutSettings>>({ ...DEFAULT_LAYOUT_SETTINGS })
const layoutSolving = ref(false)
// The most relevant changes do most of the relaxing; the long tail is not worth its diff.
const LAYOUT_PREVIEW_SHARE = 0.2
// A shown connection stays in the share until another outranks it by this
// factor, so small setting changes don't swap connections in and out.
const LAYOUT_HYSTERESIS = 1.25
// A share, so the fader keeps its place when the solver finds more or fewer changes.
const layoutShare = ref(LAYOUT_PREVIEW_SHARE)
const layoutPreviewCount = computed({
  get: () => Math.round((layoutPreview.value?.changes.length ?? 0) * layoutShare.value),
  set: count => { layoutShare.value = count / Math.max(layoutPreview.value?.changes.length ?? 0, 1) }
})
const layoutPositionsOnly = ref(false)
const linkKey = (parentId: string, childId: string) => `${parentId}>${childId}`
let layoutWorker: Worker | null = null

async function startLayoutPreview() {
  if (layoutPreview.value || layoutSolving.value) return
  layoutSolving.value = true
  try {
    const { links: semanticPairs } = await trpc.graph.getSemanticNeighbours.query({ projectPath: projectStore.projectPath })
    const saved = withLayoutDefaults(dataStore.meta?.layout)
    layoutSettings.value = { ...saved }
    layoutShare.value = LAYOUT_PREVIEW_SHARE
    layoutPositionsOnly.value = false
    glideTarget.clear()
    glideShown.clear()
    const flowShares = endpointFlowShares(links.value.map(link => ({ sourceId: link.source.id, targetId: link.target.id, flowValue: link.flowValue })))
    const request: LayoutPreview['request'] = {
      nodes: nodes.value.map(node => ({ id: node.id, position: [node.pos[0], node.pos[1]], radius: node.r, movable: true })),
      links: links.value.map((link, index) => ({
        parentId: link.target.id,
        childId: link.source.id,
        relativePosition: [link.relativePosition[0], link.relativePosition[1]],
        editable: isIdeaNode(link.source) && isIdeaNode(link.target),
        strength: link.forceWeight,
        flowShare: Number.isNaN(flowShares[index]!) ? 0 : flowShares[index]!
      })),
      semanticPairs
    }
    layoutPreview.value = {
      request,
      saved,
      changes: [],
      placements: [],
      linkByKey: new Map(links.value.map(link => [linkKey(link.target.id, link.source.id), link])),
      stored: new Map(links.value.map(link => [link, link.relativePosition])),
      restBefore: positionsFromStoredOffsets(request.nodes, request.links),
      mainNetwork: largestNetworkIds(request.nodes, request.links)
    }
    layoutWorker = new Worker(new URL('../utils/autolayout.worker.ts', import.meta.url), { type: 'module' })
    layoutWorker.onmessage = ({ data }: MessageEvent<LayoutResult>) => showLayoutResult(data)
    layoutWorker.onerror = (event) => {
      useToastStore().error('Layout failed', new Error(event.message))
      cancelLayoutPreview()
    }
    layoutWorker.postMessage({ start: { ...request, settings: { ...layoutSettings.value } } } satisfies LayoutMessage)
  } catch (error) {
    useToastStore().error('Layout failed', error)
    layoutSolving.value = false
  }
}

function showLayoutResult({ changes, placements, done }: LayoutResult) {
  const preview = layoutPreview.value
  if (!preview) return
  const shown = new Set(appliedLayoutChanges.value.map(change => linkKey(change.parentId, change.childId)))
  const rank = (change: LayoutChange) => change.relevance * (shown.has(linkKey(change.parentId, change.childId)) ? LAYOUT_HYSTERESIS : 1)
  layoutPreview.value = { ...preview, changes: [...changes].sort((left, right) => rank(right) - rank(left)), placements }
  layoutSolving.value = !done
}

// After a lot of tuning the solved layout can drift far from the stored one:
// start again from it, keeping the settings.
function resetLayoutPositions() {
  const preview = layoutPreview.value
  if (!preview || !layoutWorker) return
  layoutSolving.value = true
  layoutWorker.postMessage({ start: { ...preview.request, settings: { ...layoutSettings.value } } } satisfies LayoutMessage)
}

watch(layoutSettings, settings => {
  if (!layoutWorker) return
  layoutSolving.value = true
  layoutWorker.postMessage({ settings: { ...settings } } satisfies LayoutMessage)
}, { deep: true })

const appliedLayoutChanges = computed(() => {
  const preview = layoutPreview.value
  return !preview || layoutPositionsOnly.value ? [] : preview.changes.slice(0, layoutPreviewCount.value)
})

// Ideas glide toward the shift the preview wants for them: each frame covers
// a share of the rest of the way, the simulation keeps working meanwhile.
const LAYOUT_GLIDE = 0.15
const glideTarget = new Map<GraphNode, [number, number]>()
const glideShown = new Map<GraphNode, [number, number]>()
let glideFrame = 0
function glide() {
  glideFrame = 0
  for (const [node, [targetX, targetY]] of glideTarget) {
    const [shownX, shownY] = glideShown.get(node) ?? [0, 0]
    const restX = targetX - shownX
    const restY = targetY - shownY
    const share = Math.abs(restX) + Math.abs(restY) < 0.5 ? 1 : LAYOUT_GLIDE
    node.pos = [node.pos[0] + restX * share, node.pos[1] + restY * share]
    glideShown.set(node, [shownX + restX * share, shownY + restY * share])
    if (share < 1) continue
    glideTarget.delete(node)
    if (targetX === 0 && targetY === 0) glideShown.delete(node)
  }
  if (glideTarget.size > 0) glideFrame = requestAnimationFrame(glide)
}
const startGlide = () => {
  if (!glideFrame && glideTarget.size > 0) glideFrame = requestAnimationFrame(glide)
}
onUnmounted(() => cancelAnimationFrame(glideFrame))

// Shows the current result: each link gets its proposed or its stored offset
// (new arrays: the stored ones are shared with the data store and must stay
// untouched), each idea glides to how far its rest position moved.
watch(appliedLayoutChanges, applied => {
  const preview = layoutPreview.value
  if (!preview) return
  for (const [link, relativePosition] of preview.stored) link.relativePosition = relativePosition
  for (const change of applied) {
    const link = preview.linkByKey.get(linkKey(change.parentId, change.childId))
    if (link) link.relativePosition = [...change.relativePosition]
  }
  const placement = new Map(preview.placements.map(({ id, position }) => [id, position]))
  const offset = new Map(applied.map(change => [linkKey(change.parentId, change.childId), change.relativePosition]))
  const rest = positionsFromStoredOffsets(
    preview.request.nodes.map(node => ({ ...node, position: placement.get(node.id) ?? node.position })),
    preview.request.links.map(link => ({ ...link, relativePosition: offset.get(linkKey(link.parentId, link.childId)) ?? link.relativePosition }))
  )
  // Applied offsets carry the solver's lean in the direction the tree grows;
  // the main network's centre stays where it is.
  const shiftOf = new Map<string, [number, number]>()
  let centreX = 0
  let centreY = 0
  for (const [id, from] of preview.restBefore) {
    const to = rest.get(id)
    if (!to) continue
    shiftOf.set(id, [to[0] - from[0], to[1] - from[1]])
    if (!preview.mainNetwork.has(id)) continue
    centreX += to[0] - from[0]
    centreY += to[1] - from[1]
  }
  centreX /= Math.max(preview.mainNetwork.size, 1)
  centreY /= Math.max(preview.mainNetwork.size, 1)
  for (const node of nodes.value) {
    const shift = shiftOf.get(node.id)
    if (!shift) continue
    const target: [number, number] = [shift[0] - centreX, shift[1] - centreY]
    const shown = glideShown.get(node) ?? [0, 0]
    if (target[0] !== shown[0] || target[1] !== shown[1]) glideTarget.set(node, target)
  }
  startGlide()
})

function closeLayoutPreview() {
  layoutWorker?.terminate()
  layoutWorker = null
  layoutSolving.value = false
  layoutPreview.value = null
}

// New graph data rebuilds the links, which drops the preview.
watch(links, () => {
  if (!layoutPreview.value) return
  closeLayoutPreview()
  useToastStore().info('The graph changed, so the layout preview was closed.')
})

// Everything glides back.
function cancelLayoutPreview() {
  const preview = layoutPreview.value
  if (!preview) return
  closeLayoutPreview()
  for (const [link, relativePosition] of preview.stored) link.relativePosition = relativePosition
  for (const node of glideShown.keys()) glideTarget.set(node, [0, 0])
  startGlide()
}

// Placed ideas keep their preview position; the simulation's periodic save
// stores it in this browser. The settings go to meta.json when they changed.
async function applyLayoutPreview() {
  const preview = layoutPreview.value
  if (!preview) return
  const applied = appliedLayoutChanges.value
  const settings = { ...layoutSettings.value }
  closeLayoutPreview()
  if (applied.length > 0) await dataStore.setConnectionPositions(projectStore.projectPath, applied)
  if (!sameLayoutSettings(settings, preview.saved)) {
    dataStore.meta = await trpc.project.setLayoutSettings.mutate({ projectPath: projectStore.projectPath, layout: settings })
  }
  const files = new Set(applied.map(change => change.parentId)).size
  useToastStore().info(`Layout saved ${applied.length} connections in ${files} idea files and placed ${preview.placements.length} unconnected ideas.`)
}

// Helper: split node text into lines for label rendering
function getNodeTitleLines(text: string): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = words[0] || ''
  const maxChars = 12

  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    if (word === undefined) continue

    if (currentLine.length + 1 + word.length <= maxChars) {
      currentLine += (currentLine.length > 0 ? ' ' : '') + word
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }
  lines.push(currentLine)

  if (lines.length > 4) {
    lines.length = 3
    lines[2] += '...'
  }
  return lines
}

// Toggle the spin-off preview: enter it using the currently selected idea as the
// single root, or exit if already previewing.
function toggleSpinOffPreview() {
  if (graphUIStore.graphColorMode === 'spin-off') {
    graphUIStore.clearSpinOffPreview()
  } else {
    // Seed with the current selection if any; otherwise start empty and let the
    // user pick roots by clicking ideas.
    const seed = graphUIStore.graphSelectedIdeaId ? [graphUIStore.graphSelectedIdeaId] : []
    graphUIStore.previewSpinOff(seed)
  }
}
</script>

<template>
  <div class="graph-view">
    <!-- WebGL Canvas for nodes and edges -->
    <canvas
        ref="canvasRef"
        class="graph-canvas"
        @mousedown.capture="handleCanvasMouseDown"
        @mouseup.capture="handleCanvasMouseUp"
        @click="handleCanvasClick"
        :class="{ 'is-zooming': isZooming }"
    ></canvas>

    <!-- SVG Overlay for labels and interactive elements -->
    <svg
        ref="svgOverlayRef"
        class="graph-overlay"
        :class="{ 'hide-labels': !graphUIStore.graphShowLabels }"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
    >
      <g :transform="transform">
        <!-- Labels rendered as SVG text on top of WebGL -->
        <g class="labels" v-if="graphUIStore.graphShowLabels">
          <g
            v-for="node in renderNodes"
            :key="node.id"
            :transform="`translate(${node.x},${node.y})`"
            class="node-label-group"
            :class="{ selected: node.selected }"
            @mousedown="onNodeDown($event, node as any)"
            @touchstart="onNodeDown($event, node as any)"
            @mouseup="onNodeUp(node as any)"
            @touchend="onNodeUp(node as any)"
            @click.stop="onNodeClick(node as any)"
          >
            <g :transform="`scale(${node.r})`" v-if="node.r * node.scale > 20">
              <text
                dominant-baseline="central"
                text-anchor="middle"
                fill="#fff"
                font-size="0.25"
                class="node-label"
              >
                <tspan
                  v-for="(line, i) in getNodeTitleLines(node.text)"
                  :key="i"
                  x="0"
                  :dy="i === 0 ? (-(getNodeTitleLines(node.text).length - 1) * 0.6) + 'em' : '1.2em'"
                >
                  {{ line }}
                </tspan>
              </text>
            </g>
          </g>
        </g>
        <GraphFlowHandle
          v-if="selectedLinkData && selectedLinkVisuals"
          :link="selectedLinkData"
          :source-pos="selectedLinkVisuals.sourcePos"
          :target-pos="selectedLinkVisuals.targetPos"
          :source-r="selectedLinkVisuals.sourceR"
          :target-r="selectedLinkVisuals.targetR"
        />
      </g>
    </svg>
    <PhaseSearchModal
      v-if="showPhaseFilter"
      title="Filter by Phase"
      placeholder="Search phases..."
      @select="handlePhaseSelect"
      @close="showPhaseFilter = false"
    />

    <SpinOffApplyModal />

    <LayoutPreviewPanel
      v-if="layoutPreview"
      v-model:count="layoutPreviewCount"
      v-model:positions-only="layoutPositionsOnly"
      v-model:settings="layoutSettings"
      :changes="layoutPreview.changes"
      :placed="layoutPreview.placements.length"
      :saved="layoutPreview.saved"
      :solving="layoutSolving"
      @apply="applyLayoutPreview"
      @cancel="cancelLayoutPreview"
      @reset-positions="resetLayoutPositions"
    />
    <GraphSidePanel v-else-if="graphUIStore.graphColorMode !== 'spin-off'" />
    <div class="top-controls">
      <span
        v-if="dataStore.unreadableIdeas.length"
        class="unreadable-warning"
        :title="unreadableIdeasSummary"
      >! {{ dataStore.unreadableIdeas.length }} unreadable</span>
      <button class="control-btn" @click="dataStore.loadAllIdeas(projectStore.projectPath)" title="Reload Data">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>
      <button class="control-btn" @click="randomizeLayout" title="Randomize Layout">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 3 21 3 21 8"></polyline>
          <line x1="4" y1="20" x2="21" y2="3"></line>
          <polyline points="21 16 21 21 16 21"></polyline>
          <line x1="15" y1="15" x2="21" y2="21"></line>
          <line x1="4" y1="4" x2="9" y2="9"></line>
        </svg>
      </button>
      <button
        class="control-btn"
        :class="{ active: layoutPreview }"
        :disabled="!!layoutPreview || layoutSolving"
        @click="startLayoutPreview"
        title="Shorter connections, room between ideas, similar branches nearby; tune and preview live, saves on Apply"
      >
        Layout
      </button>

      <button
        class="control-btn"
        @click="recenterGraph"
        title="Recenter camera and fit the nearest 90% of ideas with 1.2× breathing room"
        aria-label="Recenter graph"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 2v4"></path>
          <path d="M12 18v4"></path>
          <path d="M2 12h4"></path>
          <path d="M18 12h4"></path>
        </svg>
      </button>

      <button 
        class="control-btn" 
        :class="{ active: graphUIStore.graphShowLabels }"
        @click="graphUIStore.toggleGraphShowLabels()"
        title="Toggle Labels"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M4 7V4h16v3"></path>
           <path d="M9 20h6"></path>
           <path d="M12 4v16"></path>
        </svg>
      </button>
      
      <!-- During spin-off mode the color-mode switch is replaced by the legend
           (they share .segmented-control styling). -->
      <div v-if="graphUIStore.graphColorMode !== 'spin-off'" class="segmented-control">
        <button
            class="segment-btn"
            :class="{ active: graphUIStore.graphColorMode === 'status' }"
            @click="graphUIStore.setGraphColorMode('status')"
        >Status</button>
        <button
            class="segment-btn"
            :class="{ active: graphUIStore.graphColorMode === 'priority' }"
            @click="graphUIStore.setGraphColorMode('priority')"
        >Prio</button>
        <button
            class="segment-btn"
            :class="{ active: graphUIStore.graphColorMode === 'custom' }"
            @click="graphUIStore.setGraphColorMode('custom')"
        >Custom</button>
      </div>

      <div v-else class="segmented-control spinoff-legend">
        <span class="so-dot so-green"></span>kept
        <span class="so-dot so-orange"></span>both
        <span class="so-dot so-red"></span>spun&nbsp;off
      </div>

      <button
          v-if="graphUIStore.graphColorMode !== 'spin-off'"
          class="control-btn"
          @click="toggleSpinOffPreview"
          title="Spin-off preview: click ideas to toggle them as roots (green = kept, orange = both, red = spun off)"
      ><GitBranch /> Spin-off</button>

      <!-- In spin-off mode the button splits into apply + cancel (X exits the preview). -->
      <div v-else class="spinoff-split">
        <button
            class="spinoff-split-apply"
            :disabled="graphUIStore.spinOffPreviewRootIds.length === 0"
            @click="modalStore.openSpinOffApplyModal()"
            title="Apply the spin-off: write the selected branch into a new graph"
        ><GitBranch /> Apply</button>
        <button
            class="spinoff-split-cancel"
            @click="graphUIStore.clearSpinOffPreview()"
            title="Exit spin-off preview"
        ><X /></button>
      </div>

      <div v-if="graphUIStore.phaseFilter" class="phase-badge">
        <span>{{ graphUIStore.phaseFilter.phaseName }}</span>
        <button class="phase-badge-clear" @click="graphUIStore.clearPhaseFilter()" title="Clear phase filter"><X /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-view {
  width: 100%;
  height: 100%;
  background: #131313; /* GRAPH_BACKGROUND in webgl/background.ts */
  overflow: hidden;
  position: relative;
}

.graph-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.graph-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.graph-overlay .labels {
  pointer-events: auto;
}

.node-label-group {
  cursor: pointer;
}

.node-label {
  pointer-events: none;
  user-select: none;
}

/* Optimize rendering while zooming */
.is-zooming .labels,
.hide-labels .labels {
    display: none;
}

.unreadable-warning {
  color: #f85149;
  font-weight: bold;
  cursor: help;
}

.top-controls {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 10px;
  z-index: 100;
  align-items: center;
}

.control-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #fff;
  padding: 6px;
  opacity: 0.6;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.control-btn.active {
    opacity: 1;
    background: rgba(74, 222, 128, 0.2);
    border-color: rgba(74, 222, 128, 0.5);
    color: #4ade80;
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.2);
}

.segmented-control {
    display: flex;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 2px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.segment-btn {
    background: transparent;
    border: none;
    color: #888;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
}

.segment-btn:hover {
    color: #ccc;
}

.segment-btn.active {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-weight: 500;
}

.phase-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(74, 222, 128, 0.15);
    border: 1px solid rgba(74, 222, 128, 0.4);
    border-radius: 4px;
    padding: 4px 8px;
    color: #4ade80;
    font-size: 0.8rem;

    .phase-badge-clear {
        background: none;
        border: none;
        color: #4ade80;
        cursor: pointer;
        padding: 0 2px;
        font-size: 1rem;
        line-height: 1;
        opacity: 0.7;
        &:hover { opacity: 1; }
    }
}

/* Spin-off preview legend reuses .segmented-control's box; just lays out the dots. */
.spinoff-legend {
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    color: #ddd;
    font-size: 0.8rem;
}

/* Apply + × cancel live in one box matching the spin-off mode button chrome. */
.spinoff-split {
    display: flex;
    align-items: stretch;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
}
.spinoff-split button {
    background: transparent;
    border: none;
    color: #fff;
    padding: 6px 10px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
}
.spinoff-split button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
}
.spinoff-split .spinoff-split-apply:disabled {
    color: #666;
    cursor: not-allowed;
}
.spinoff-split .spinoff-split-cancel {
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    color: #f85149;
    font-size: 1rem;
    line-height: 1;
}
.spinoff-split .spinoff-split-cancel:hover {
    background: rgba(248, 81, 73, 0.2);
}

.so-dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 2px;
}
.so-green { background: #3fb950; }
.so-orange { background: #f0883e; }
.so-red { background: #f85149; }
</style>
