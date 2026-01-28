/**
 * Vue Composable for WebGL Graph Rendering
 *
 * Integrates WebGLGraphRenderer with Vue reactivity and existing stores.
 */

import { ref, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { WebGLGraphRenderer, type NodeData } from '../webgl/WebGLGraphRenderer'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useMapStore } from '../stores/map'
import type { GraphNode } from './useGraphSimulation'

export function useWebGLGraphRenderer(
  canvasRef: Ref<HTMLCanvasElement | undefined>,
  nodes: Ref<GraphNode[]>
) {
  const dataStore = useDataStore()
  const uiStore = useUIStore()
  const mapStore = useMapStore()

  let renderer: WebGLGraphRenderer | null = null
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

    return graphNodes.map(node => {
      // Determine color (priority mode or status mode)
      let color: [number, number, number]

      if (node.color) {
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

  // Animation loop
  function animate() {
    if (!renderer) return

    // Update camera from mapStore
    renderer.setCamera(
      mapStore.offset[0],
      mapStore.offset[1],
      mapStore.scale
    )

    // Render frame
    renderer.render()

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
      isInitialized.value = true
      error.value = null

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
    if (renderer) {
      renderer.destroy()
    }
  })

  return {
    isInitialized,
    error
  }
}
