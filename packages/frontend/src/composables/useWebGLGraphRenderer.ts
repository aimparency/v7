/**
 * Vue Composable for WebGL2 Graph Rendering
 *
 * Integrates WebGLGraphRenderer and ArrowRenderer with Vue reactivity and existing stores.
 */

import { ref, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { WebGLGraphRenderer, type NodeData } from '../webgl/WebGLGraphRenderer'
import { ArrowRenderer, type EdgeData } from '../webgl/ArrowRenderer'
import { SelectionSpinnerRenderer } from '../webgl/SelectionSpinnerRenderer'
import { TAAPass } from '../webgl/TAAPass'
import { calculateArrowGeometry } from '../webgl/utils/arrow-geometry'
import { applyBrightness, cssColorToRgb, statusToColor, type StatusColorEntry } from '../webgl/status-colors'
import { planSpinOff } from 'shared'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { useDataStore } from '../stores/data'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import type { GraphNode, GraphLink } from './useGraphSimulation'

export function useWebGLGraphRenderer(
  canvasRef: Ref<HTMLCanvasElement | undefined>,
  nodes: Ref<GraphNode[]>,
  links: Ref<GraphLink[]>
) {
  const graphUIStore = useGraphUIStore()
  const dataStore = useDataStore()
  const mapStore = useMapStore()

  let renderer: WebGLGraphRenderer | null = null
  let arrowRenderer: ArrowRenderer | null = null
  let spinnerRenderer: SelectionSpinnerRenderer | null = null
  let taaPass: TAAPass | null = null
  let animationFrameId: number | null = null

  const isInitialized = ref(false)
  const error = ref<string | null>(null)

  // Camera movement tracking for TAA (full screen override when panning/zooming)
  let lastPanX = 0
  let lastPanY = 0
  let lastZoom = 0
  let isMoving = false
  let movementTimeout: ReturnType<typeof setTimeout> | null = null

  // Spinner clock: only advances when the camera is still, so the selection
  // spinner appears frozen relative to the scene while panning/zooming.
  let spinnerTime = 0
  let lastFrameTime = performance.now()

  // Per-element movement tracking
  // Tracks previous positions and movement state for each node
  // Movement state: 0 = static, 1 = just started moving (skip pos update), 2 = moving
  const nodeMovementState = new Map<string, { x: number, y: number, state: number }>()

  // Cached vertex data
  let cachedNodeData: NodeData[] = []
  let cachedEdgeData: EdgeData[] = []

  // Convert graph nodes to WebGL format with per-element movement tracking
  function convertNodes(graphNodes: GraphNode[]): NodeData[] {
    const currentAimId = graphUIStore.graphSelectedAimId
    const colorMode = graphUIStore.graphColorMode
    const configuredStatuses = (dataStore.getStatuses || []) as StatusColorEntry[]

    // Spin-off preview: classify every aim into red (spun off) / orange (overlap)
    // once per pass; nodes not in the map are green (kept). Computed client-side
    // from the loaded aims — same planSpinOff the backend will execute.
    const spinOffBuckets = (() => {
      if (colorMode !== 'spin-off') return null
      const roots = graphUIStore.spinOffPreviewRootIds
      if (!roots.length) return null
      const plan = planSpinOff(Object.values(dataStore.aims), roots)
      const m = new Map<string, 'red' | 'orange'>()
      for (const id of plan.spinOffIds) m.set(id, 'red')
      for (const id of plan.overlapIds) m.set(id, 'orange')
      return m
    })()

    return graphNodes.map(node => {
      const x = node.renderPos[0]
      const y = node.renderPos[1]

      // Get or create movement state for this node
      let state = nodeMovementState.get(node.id)
      if (!state) {
        state = { x, y, state: 0 }
        nodeMovementState.set(node.id, state)
      }

      // Check if position changed
      const posChanged = state.x !== x || state.y !== y

      // Update movement state machine:
      // 0 = static, 1 = just started (use old pos), 2 = moving, then decrement after stop
      let useOldPos = false
      if (posChanged) {
        if (state.state === 0) {
          // Just started moving - keep old position for one frame
          state.state = 1
          useOldPos = true
        } else {
          // Continuing to move
          state.state = 2
        }
      } else {
        // Position unchanged - decrement state (stay moving for 1 extra frame)
        if (state.state > 0) {
          state.state--
        }
      }

      // Determine color: status, priority, and custom are separate coloring modes.
      // Custom mode shows the custom aim color if set, falling back to a neutral grey.
      let color: [number, number, number]
      if (colorMode === 'spin-off') {
        // green = kept (source only), orange = overlap (both), red = spun off
        const bucket = spinOffBuckets?.get(node.id)
        const hex = bucket === 'red' ? '#f85149' : bucket === 'orange' ? '#f0883e' : '#3fb950'
        color = applyBrightness(cssColorToRgb(hex))
      } else if (colorMode === 'custom') {
        if (node.customColor) {
          color = applyBrightness(cssColorToRgb(node.customColor))
        } else {
          color = applyBrightness(cssColorToRgb('#555555'))
        }
      } else if (colorMode === 'priority' && node.color) {
        color = applyBrightness(cssColorToRgb(node.color))
      } else {
        color = statusToColor(node.status, configuredStatuses)
      }

      const result: NodeData = {
        id: node.id,
        x: useOldPos ? state.x : x,
        y: useOldPos ? state.y : y,
        r: node.r,
        color,
        selected: node.id === currentAimId,
        loadable: node.loadable ?? false,
        moving: state.state > 0
      }

      // Update cached position (after using old pos if needed)
      if (!useOldPos) {
        state.x = x
        state.y = y
      }

      return result
    })
  }

  // Edge state includes cached geometry for "skip position update" on movement start
  interface EdgeState {
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourceR: number
    targetR: number
    share: number
    state: number
  }
  const edgeStateMap = new Map<string, EdgeState>()

  // Convert graph links to WebGL edge format with per-element movement tracking
  function convertLinks(graphLinks: GraphLink[]): EdgeData[] {
    // The selected connection (link.source is the child/supporting aim,
    // link.target is the parent/supported aim — see data store link build).
    const selectedLink = graphUIStore.selectedLink

    // Connection color always matches its supporting aim (the source/child).
    // Reuse the node colors computed this frame so it respects the active
    // color mode (status / priority / custom / spin-off) for free.
    const nodeColorById = new Map(cachedNodeData.map(node => [node.id, node.color]))

    const renderedLinks = graphLinks.map(link => {
      const sourceX = link.source.renderPos[0]
      const sourceY = link.source.renderPos[1]
      const targetX = link.target.renderPos[0]
      const targetY = link.target.renderPos[1]
      const sourceR = link.source.r
      const targetR = link.target.r
      const share = link.share ?? 0.5

      const edgeKey = `${link.source.id}->${link.target.id}`

      // Get or create state for this edge
      let state = edgeStateMap.get(edgeKey)
      if (!state) {
        state = { sourceX, sourceY, targetX, targetY, sourceR, targetR, share, state: 0 }
        edgeStateMap.set(edgeKey, state)
      }

      // Check if positions changed
      const posChanged = state.sourceX !== sourceX || state.sourceY !== sourceY ||
                         state.targetX !== targetX || state.targetY !== targetY

      // Update movement state machine
      let useOldPos = false
      if (posChanged) {
        if (state.state === 0) {
          // Just started moving - keep old position for one frame
          state.state = 1
          useOldPos = true
        } else {
          state.state = 2
        }
      } else {
        if (state.state > 0) {
          state.state--
        }
      }

      // Use old or new positions for geometry calculation
      const sourceNode = {
        x: useOldPos ? state.sourceX : sourceX,
        y: useOldPos ? state.sourceY : sourceY,
        r: sourceR
      }
      const targetNode = {
        x: useOldPos ? state.targetX : targetX,
        y: useOldPos ? state.targetY : targetY,
        r: targetR
      }

      // Calculate arrow geometry with share-based width
      const geometry = calculateArrowGeometry(sourceNode, targetNode, share)

      // Update cached positions (after using old pos if needed)
      if (!useOldPos) {
        state.sourceX = sourceX
        state.sourceY = sourceY
        state.targetX = targetX
        state.targetY = targetY
        state.sourceR = sourceR
        state.targetR = targetR
        state.share = share
      }

      // Edge color: the supporting aim's (source) node color in the active
      // color mode, falling back to neutral gray if the node isn't found.
      const color: [number, number, number] = nodeColorById.get(link.source.id) ?? [0.5, 0.5, 0.5]

      const selected = !!selectedLink &&
        link.source.id === selectedLink.childId &&
        link.target.id === selectedLink.parentId

      return {
        id: edgeKey,
        sourceId: link.source.id,
        targetId: link.target.id,
        color,
        opacity: 0.6,
        geometry,
        moving: state.state > 0,
        selected
      }
    })

    if (mapStore.connecting && mapStore.connectFrom) {
      const source = mapStore.mouse.logical
      const target = mapStore.connectFrom

      renderedLinks.push({
        id: `temp-connector-${target.id}`,
        sourceId: '__cursor__',
        targetId: target.id,
        color: [0.5, 0.5, 0.5],
        opacity: 0.6,
        geometry: calculateArrowGeometry(
          {
            x: source[0],
            y: source[1],
            r: 1
          },
          {
            x: target.pos[0],
            y: target.pos[1],
            r: target.r
          },
          0.5,
          { widthFactor: 1 }
        ),
        moving: true,
        selected: false
      })
    }

    return renderedLinks
  }

  // Build view matrix for arrow renderer (shared format)
  function buildViewMatrix(panX: number, panY: number, zoom: number): Float32Array {
    return new Float32Array([
      zoom, 0, 0,
      0, zoom, 0,
      panX, panY, 1
    ])
  }

  // Animation loop
  function animate() {
    if (!renderer) return

    // Calculate camera transform to match SVG coordinate system
    // SVG uses: translate(cx, cy) scale(visualScale) translate(offset)
    // Where cx, cy is the viewport center
    const visualScale = mapStore.scale * mapStore.halfSide / LOGICAL_HALF_SIDE
    const cx = mapStore.clientOffset[0] + mapStore.halfSide
    const cy = mapStore.clientOffset[1] + mapStore.halfSide

    // For WebGL: panX = cx + visualScale * offset[0]
    const panX = cx + visualScale * mapStore.offset[0]
    const panY = cy + visualScale * mapStore.offset[1]

    // Detect camera movement
    const cameraMoved = panX !== lastPanX || panY !== lastPanY || visualScale !== lastZoom
    lastPanX = panX
    lastPanY = panY
    lastZoom = visualScale

    // Track movement state with debounce
    if (cameraMoved) {
      isMoving = true
      if (movementTimeout) {
        clearTimeout(movementTimeout)
      }
      // Consider "stopped moving" after 100ms of no camera changes
      movementTimeout = setTimeout(() => {
        isMoving = false
      }, 100)
    }

    // Update camera from mapStore
    renderer.setCamera(panX, panY, visualScale)

    // Update arrow renderer camera
    if (arrowRenderer) {
      const viewMatrix = buildViewMatrix(panX, panY, visualScale)
      arrowRenderer.setCamera(viewMatrix)
    }

    // Generate jitter for TAA: 0 when camera moving, random when static
    // (per-element jitter is handled by moving flag in vertex data)
    const jitterX = isMoving ? 0 : Math.random() - 0.5
    const jitterY = isMoving ? 0 : Math.random() - 0.5

    // Update node/edge data every frame
    // Per-element movement tracking is handled inside convertNodes/convertLinks
    cachedNodeData = convertNodes(nodes.value)
    cachedEdgeData = convertLinks(links.value)
    renderer.updateNodes(cachedNodeData)
    if (arrowRenderer) {
      arrowRenderer.updateEdges(cachedEdgeData)
    }

    // Advance the spinner/animation clock only while the camera is still, so
    // the selection animations appear frozen relative to the scene during
    // moves. Shared by the selection spinner and the selected-connection stripes.
    const now = performance.now()
    if (!isMoving) {
      spinnerTime += (now - lastFrameTime) / 1000
    }
    lastFrameTime = now

    // Begin TAA pass (render to current framebuffer with MRT)
    if (taaPass) {
      taaPass.begin()
    }

    // Render arrows first, then nodes on top
    if (arrowRenderer) {
      arrowRenderer.render(jitterX, jitterY, spinnerTime)
    }

    renderer.render(jitterX, jitterY)

    // End TAA pass (blend with history, render to screen)
    if (taaPass) {
      taaPass.setCameraMoving(isMoving)
      taaPass.end()
    }

    // Post-TAA overlay: draw the selection spinner crisply onto the resolved
    // screen image (the dots move, so we keep them out of the TAA history).
    if (spinnerRenderer) {
      const selected = cachedNodeData.filter(node => node.selected)
      spinnerRenderer.updateInstances(
        selected.map(node => ({ x: node.x, y: node.y, r: node.r }))
      )
      spinnerRenderer.setCamera(buildViewMatrix(panX, panY, visualScale))
      spinnerRenderer.render(spinnerTime)
    }

    // Continue loop
    animationFrameId = requestAnimationFrame(animate)
  }

  // Initialize renderer
  async function initRenderer() {
    if (!canvasRef.value) {
      error.value = 'Canvas ref not available'
      return
    }

    try {
      renderer = new WebGLGraphRenderer(canvasRef.value)
      await renderer.init()

      // Initialize arrow renderer and TAA with same WebGL2 context
      const gl = canvasRef.value.getContext('webgl2')
      if (gl) {
        arrowRenderer = new ArrowRenderer(gl, canvasRef.value)
        await arrowRenderer.init()

        spinnerRenderer = new SelectionSpinnerRenderer(gl, canvasRef.value)
        await spinnerRenderer.init()

        taaPass = new TAAPass(gl, canvasRef.value)
        await taaPass.init()
      }

      isInitialized.value = true
      error.value = null

      // Initial data update
      if (nodes.value.length > 0) {
        cachedNodeData = convertNodes(nodes.value)
        renderer.updateNodes(cachedNodeData)
      }
      if (links.value.length > 0 && arrowRenderer) {
        cachedEdgeData = convertLinks(links.value)
        arrowRenderer.updateEdges(cachedEdgeData)
      }

      // Start animation loop
      animate()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error'
      console.error('Failed to initialize WebGL2 renderer:', e)
    }
  }

  // Watch for selection changes
  watch(() => graphUIStore.graphSelectedAimId, () => {
    if (!renderer || !isInitialized.value) return
    // Selection change doesn't affect positions, just re-render with current cached data
    cachedNodeData = convertNodes(nodes.value)
    renderer.updateNodes(cachedNodeData)
  })

  // Watch for color mode changes and spin-off preview root changes
  watch(
    () => [graphUIStore.graphColorMode, graphUIStore.spinOffPreviewRootIds] as const,
    () => {
      if (!renderer || !isInitialized.value) return
      cachedNodeData = convertNodes(nodes.value)
      renderer.updateNodes(cachedNodeData)
    },
    { deep: true }
  )

  // Lifecycle
  onMounted(async () => {
    // Wait a tick for canvas ref to be available
    await new Promise(resolve => setTimeout(resolve, 0))
    await initRenderer()
  })

  onUnmounted(() => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
    }
    if (movementTimeout) {
      clearTimeout(movementTimeout)
    }
    if (taaPass) {
      taaPass.destroy()
    }
    if (arrowRenderer) {
      arrowRenderer.destroy()
    }
    if (spinnerRenderer) {
      spinnerRenderer.destroy()
    }
    if (renderer) {
      renderer.destroy()
    }
  })

  // Force update - no longer needed since animate() updates every frame
  // and per-element movement is tracked automatically in convertNodes/convertLinks
  function forceUpdate() {
    // No-op: animate() handles all updates with per-element movement tracking
  }

  return {
    isInitialized,
    error,
    forceUpdate,
    getRenderer: () => renderer,
    getQuadtree: () => renderer?.getQuadtree() ?? null
  }
}
