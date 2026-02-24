/**
 * Arrow Rendering Example
 *
 * Demonstrates how to use the WebGL arrow renderer with the graph renderer.
 * Can be used for testing and benchmarking arrow rendering performance.
 */

import { WebGLGraphRenderer, type NodeData } from '../WebGLGraphRenderer'
import { ArrowRenderer, type EdgeData } from '../ArrowRenderer'
import { InteractionManager } from '../InteractionManager'
import { calculateArrowGeometry, type NodeGeometry } from '../utils/arrow-geometry'

export interface GraphData {
  nodes: NodeData[]
  edges: Array<{
    id: string
    sourceId: string
    targetId: string
    weight?: number
  }>
}

/**
 * Example: Initialize and render a graph with arrows
 */
export async function createArrowRenderingExample(
  canvas: HTMLCanvasElement,
  graphData: GraphData
): Promise<{
  nodeRenderer: WebGLGraphRenderer
  arrowRenderer: ArrowRenderer
  interactionManager: InteractionManager
  render: () => void
  destroy: () => void
}> {
  // Initialize node renderer
  const nodeRenderer = new WebGLGraphRenderer(canvas, {
    backgroundColor: [0.12, 0.12, 0.12, 1.0]
  })
  await nodeRenderer.init()

  // Initialize arrow renderer
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('WebGL not supported')

  const arrowRenderer = new ArrowRenderer(gl, canvas)
  await arrowRenderer.init()

  // Initialize interaction manager
  const interactionManager = new InteractionManager(canvas)

  // Set up nodes
  nodeRenderer.updateNodes(graphData.nodes)
  interactionManager.updateNodes(graphData.nodes)
  interactionManager.setQuadtree(nodeRenderer.getQuadtree())

  // Calculate arrow geometries
  const nodeMap = new Map<string, NodeGeometry>()
  for (const node of graphData.nodes) {
    nodeMap.set(node.id, { x: node.x, y: node.y, r: node.r })
  }

  const edgeDataWithGeometry: EdgeData[] = graphData.edges.map(edge => {
    const source = nodeMap.get(edge.sourceId)!
    const target = nodeMap.get(edge.targetId)!
    const weight = edge.weight ?? 1.0

    return {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      color: [0.5, 0.5, 0.5] as [number, number, number],
      opacity: 0.8,
      geometry: calculateArrowGeometry(source, target, weight),
      moving: false
    }
  })

  // Set up edges
  arrowRenderer.updateEdges(edgeDataWithGeometry)
  interactionManager.updateEdges(edgeDataWithGeometry)

  // Set up camera (identity matrix = no transform)
  const viewMatrix = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ])
  nodeRenderer.setCamera(0, 0, 1)
  arrowRenderer.setCamera(viewMatrix)
  interactionManager.setCamera(viewMatrix)

  // Render function
  const render = () => {
    // Render in correct order: arrows first (background), then nodes (foreground)
    arrowRenderer.render()
    nodeRenderer.render()
  }

  // Cleanup function
  const destroy = () => {
    nodeRenderer.destroy()
    arrowRenderer.destroy()
  }

  return {
    nodeRenderer,
    arrowRenderer,
    interactionManager,
    render,
    destroy
  }
}

/**
 * Example: Generate test graph data for performance testing
 */
export function generateTestGraphData(nodeCount: number, edgeDensity: number = 0.1): GraphData {
  const nodes: NodeData[] = []
  const edges: Array<{ id: string; sourceId: string; targetId: string; weight: number }> = []

  // Generate nodes in a grid layout
  const gridSize = Math.ceil(Math.sqrt(nodeCount))
  const spacing = 100

  for (let i = 0; i < nodeCount; i++) {
    const row = Math.floor(i / gridSize)
    const col = i % gridSize

    nodes.push({
      id: `node-${i}`,
      x: col * spacing,
      y: row * spacing,
      r: 10 + Math.random() * 5,
      color: [
        0.3 + Math.random() * 0.4,
        0.3 + Math.random() * 0.4,
        0.3 + Math.random() * 0.4
      ] as [number, number, number],
      selected: false,
      moving: false
    })
  }

  // Generate random edges
  const edgeCount = Math.floor(nodeCount * edgeDensity)

  for (let i = 0; i < edgeCount; i++) {
    const sourceIdx = Math.floor(Math.random() * nodeCount)
    let targetIdx = Math.floor(Math.random() * nodeCount)

    // Avoid self-loops
    while (targetIdx === sourceIdx) {
      targetIdx = Math.floor(Math.random() * nodeCount)
    }

    edges.push({
      id: `edge-${i}`,
      sourceId: `node-${sourceIdx}`,
      targetId: `node-${targetIdx}`,
      weight: Math.random() // Random weight 0-1
    })
  }

  return { nodes, edges }
}

/**
 * Example: Benchmark arrow rendering performance
 */
export async function benchmarkArrowRendering(
  canvas: HTMLCanvasElement,
  nodeCounts: number[] = [100, 500, 1000, 2000, 5000, 10000]
): Promise<void> {
  console.log('=== Arrow Rendering Performance Benchmark ===')

  for (const nodeCount of nodeCounts) {
    const edgeDensity = 0.15 // 15% edge density (1.5 edges per node on average)
    const graphData = generateTestGraphData(nodeCount, edgeDensity)

    const { render, destroy } = await createArrowRenderingExample(canvas, graphData)

    // Warm-up renders
    for (let i = 0; i < 10; i++) {
      render()
    }

    // Benchmark
    const iterations = 100
    const startTime = performance.now()

    for (let i = 0; i < iterations; i++) {
      render()
    }

    const endTime = performance.now()
    const avgFrameTime = (endTime - startTime) / iterations
    const fps = 1000 / avgFrameTime

    console.log(`Nodes: ${nodeCount}, Edges: ${graphData.edges.length}`)
    console.log(`  Avg frame time: ${avgFrameTime.toFixed(2)}ms`)
    console.log(`  FPS: ${fps.toFixed(1)}`)
    console.log('')

    destroy()
  }

  console.log('=== Benchmark Complete ===')
}

/**
 * Example: Interactive demo with mouse interaction
 */
export function setupInteractiveDemo(
  canvas: HTMLCanvasElement,
  interactionManager: InteractionManager,
  render: () => void
): void {
  // Mouse move handler for hover
  canvas.addEventListener('mousemove', (event) => {
    const { node, edge } = interactionManager.handleMouseMove(event)

    if (node) {
      canvas.style.cursor = 'pointer'
      console.log('Hovering over node:', node)
    } else if (edge) {
      canvas.style.cursor = 'pointer'
      console.log('Hovering over edge:', edge)
    } else {
      canvas.style.cursor = 'default'
    }

    render()
  })

  // Click handler
  canvas.addEventListener('click', (event) => {
    const { node, edge } = interactionManager.handleClick(event)

    if (node) {
      console.log('Clicked node:', node)
    } else if (edge) {
      console.log('Clicked edge:', edge)
    }

    render()
  })

  // Initial render
  render()
}
