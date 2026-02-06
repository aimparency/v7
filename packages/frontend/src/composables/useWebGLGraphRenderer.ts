/**
 * Vue Composable for WebGL Graph Rendering
 *
 * Integrates WebGLGraphRenderer and ArrowRenderer with Vue reactivity and existing stores.
 */

import { ref, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { WebGLGraphRenderer, type NodeData } from '../webgl/WebGLGraphRenderer'
import { ArrowRenderer, type EdgeData } from '../webgl/ArrowRenderer'
import { calculateArrowGeometry } from '../webgl/utils/arrow-geometry'
import { useUIStore } from '../stores/ui'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import type { GraphNode, GraphLink } from './useGraphSimulation'

export function useWebGLGraphRenderer(
  canvasRef: Ref<HTMLCanvasElement | undefined>,
  nodes: Ref<GraphNode[]>,
  links: Ref<GraphLink[]>
) {
  const uiStore = useUIStore()
  const mapStore = useMapStore()

  let renderer: WebGLGraphRenderer | null = null
  let arrowRenderer: ArrowRenderer | null = null
  let animationFrameId: number | null = null

  const isInitialized = ref(false)
  const error = ref<string | null>(null)

  // Helper: Convert status to RGB color
  function statusToColor(status: string): [number, number, number] {
    switch (status) {
      case 'done': return [0.0, 0.47, 0.0]        // #007700
      case 'open': return [0.0, 0.33, 0.56]       // #00558e
      case 'cancelled': return [0.70, 0.0, 0.0]   // #b20000
      case 'failed': return [0.70, 0.28, 0.28]    // #b24747
      case 'partially': return [0.47, 0.47, 0.0]  // #777700
      case 'unclear': return [0.70, 0.45, 0.0]    // #b27300
      case 'archived': return [0.23, 0.23, 0.23]  // #3b3b3b
      default: return [0.23, 0.23, 0.23]          // #3b3b3b
    }
  }

  // Helper: Convert hex color to RGB
  function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return [0.5, 0.5, 0.5]

    return [
      parseInt(result[1]!, 16) / 255,
      parseInt(result[2]!, 16) / 255,
      parseInt(result[3]!, 16) / 255
    ]
  }

  // Convert graph nodes to WebGL format
  function convertNodes(graphNodes: GraphNode[]): NodeData[] {
    const currentAimId = uiStore.graphSelectedAimId
    const colorMode = uiStore.graphColorMode

    return graphNodes.map(node => {
      // Determine color (priority mode or status mode)
      let color: [number, number, number]

      if (colorMode === 'priority' && node.color) {
        // Priority color (interpolated)
        color = hexToRgb(node.color)
      } else {
        // Status color
        color = statusToColor(node.status)
      }

      return {
        id: node.id,
        x: node.renderPos[0],
        y: node.renderPos[1],
        r: node.r,
        color,
        selected: node.id === currentAimId
      }
    })
  }

  // Convert graph links to WebGL edge format
  function convertLinks(graphLinks: GraphLink[]): EdgeData[] {
    return graphLinks.map(link => {
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

      // Calculate arrow geometry with share-based width
      const geometry = calculateArrowGeometry(sourceNode, targetNode, link.share ?? 0.5)

      // Edge color - use a neutral gray
      const color: [number, number, number] = [0.5, 0.5, 0.5]

      return {
        id: `${link.source.id}->${link.target.id}`,
        sourceId: link.source.id,
        targetId: link.target.id,
        color,
        opacity: 0.6,
        geometry
      }
    })
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

    const canvas = renderer.getCanvas()

    // Calculate camera transform to match SVG coordinate system
    // SVG uses: translate(cx, cy) scale(visualScale) translate(offset)
    // Where cx, cy is the viewport center
    const visualScale = mapStore.scale * mapStore.halfSide / LOGICAL_HALF_SIDE
    const cx = mapStore.clientOffset[0] + mapStore.halfSide
    const cy = mapStore.clientOffset[1] + mapStore.halfSide

    // For WebGL: panX = cx + visualScale * offset[0]
    const panX = cx + visualScale * mapStore.offset[0]
    const panY = cy + visualScale * mapStore.offset[1]

    // Update camera from mapStore
    renderer.setCamera(panX, panY, visualScale)

    // Update arrow renderer camera
    if (arrowRenderer) {
      const viewMatrix = buildViewMatrix(panX, panY, visualScale)
      arrowRenderer.setCamera(viewMatrix)
    }

    // Clear and render nodes
    renderer.render()

    // Render arrows on top
    if (arrowRenderer) {
      arrowRenderer.render()
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

      // Initialize arrow renderer with same GL context
      const gl = canvasRef.value.getContext('webgl')
      if (gl) {
        arrowRenderer = new ArrowRenderer(gl, canvasRef.value)
        await arrowRenderer.init()
      }

      isInitialized.value = true
      error.value = null

      // Initial data update
      if (nodes.value.length > 0) {
        renderer.updateNodes(convertNodes(nodes.value))
      }
      if (links.value.length > 0 && arrowRenderer) {
        arrowRenderer.updateEdges(convertLinks(links.value))
      }

      // Start animation loop
      animate()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error'
      console.error('Failed to initialize WebGL renderer:', e)
    }
  }

  // Watch for node changes
  watch(nodes, (newNodes) => {
    if (!renderer || !isInitialized.value) return

    const nodeData = convertNodes(newNodes)
    renderer.updateNodes(nodeData)
  }, { immediate: true })

  // Watch for link changes
  watch(links, (newLinks) => {
    if (!arrowRenderer || !isInitialized.value) return

    const edgeData = convertLinks(newLinks)
    arrowRenderer.updateEdges(edgeData)
  }, { immediate: true })

  // Watch for selection changes
  watch(() => uiStore.graphSelectedAimId, () => {
    if (!renderer || !isInitialized.value) return

    const nodeData = convertNodes(nodes.value)
    renderer.updateNodes(nodeData)
  })

  // Watch for color mode changes
  watch(() => uiStore.graphColorMode, () => {
    if (!renderer || !isInitialized.value) return

    const nodeData = convertNodes(nodes.value)
    renderer.updateNodes(nodeData)
  })

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
    if (arrowRenderer) {
      arrowRenderer.destroy()
    }
    if (renderer) {
      renderer.destroy()
    }
  })

  // Force update (useful when simulation triggers)
  function forceUpdate() {
    if (!renderer || !isInitialized.value) return

    renderer.updateNodes(convertNodes(nodes.value))
    if (arrowRenderer) {
      arrowRenderer.updateEdges(convertLinks(links.value))
    }
  }

  return {
    isInitialized,
    error,
    forceUpdate,
    getRenderer: () => renderer,
    getQuadtree: () => renderer?.getQuadtree() ?? null
  }
}
