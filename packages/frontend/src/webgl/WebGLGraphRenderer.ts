/**
 * WebGL2 Graph Renderer
 *
 * High-performance WebGL2-based renderer for graph visualization.
 * Renders nodes as circles using instanced rendering with viewport culling.
 */

import { Quadtree, type QuadtreeItem, type Bounds } from './spatial/Quadtree'
import {
  DynamicBufferManager,
  BufferPacker,
  BufferPerformanceMonitor
} from './buffers/DynamicBufferManager'
import nodeVertexShaderSource from './shaders/node.vert.glsl?raw'
import nodeFragmentShaderSource from './shaders/node.frag.glsl?raw'

export interface NodeData {
  id: string
  x: number
  y: number
  r: number
  color: [number, number, number] // RGB 0-1
  selected: boolean
  moving: boolean  // Movement flag for TAA
}

export interface RendererOptions {
  backgroundColor?: [number, number, number, number] // RGBA 0-1
}

export class WebGLGraphRenderer {
  private canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null

  // Buffers
  private quadBuffer: WebGLBuffer | null = null // Static quad corners
  private bufferManager: DynamicBufferManager | null = null // Dynamic instance buffer manager
  private bufferPacker: BufferPacker | null = null // Packs node data into typed arrays
  private performanceMonitor: BufferPerformanceMonitor = new BufferPerformanceMonitor()

  // Attributes
  private a_corner: number = -1
  private a_position: number = -1
  private a_radius: number = -1
  private a_color: number = -1
  private a_selected: number = -1
  private a_moving: number = -1

  // Uniforms
  private u_viewMatrix: WebGLUniformLocation | null = null
  private u_viewportSize: WebGLUniformLocation | null = null
  private u_jitter: WebGLUniformLocation | null = null

  // Camera state
  private viewMatrix: Float32Array = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ])

  // Data
  private nodes: NodeData[] = []
  private visibleNodes: NodeData[] = []

  // Spatial indexing for culling
  private quadtree: Quadtree | null = null
  private enableCulling: boolean = true

  // Options
  private options: Required<RendererOptions>

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas
    this.options = {
      backgroundColor: options.backgroundColor || [0.12, 0.12, 0.12, 1.0]
    }
  }

  async init(): Promise<void> {
    // Get WebGL2 context
    this.gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false
    })

    if (!this.gl) {
      throw new Error('WebGL2 not supported')
    }

    const gl = this.gl

    // Load and compile shaders
    const vertexShader = this.loadShader(gl.VERTEX_SHADER, nodeVertexShaderSource)
    const fragmentShader = this.loadShader(gl.FRAGMENT_SHADER, nodeFragmentShaderSource)

    // Create program
    this.program = gl.createProgram()
    if (!this.program) throw new Error('Failed to create program')

    gl.attachShader(this.program, vertexShader)
    gl.attachShader(this.program, fragmentShader)
    gl.linkProgram(this.program)

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(this.program)
      throw new Error('Program link failed: ' + info)
    }

    // Get attribute locations
    this.a_corner = gl.getAttribLocation(this.program, 'a_corner')
    this.a_position = gl.getAttribLocation(this.program, 'a_position')
    this.a_radius = gl.getAttribLocation(this.program, 'a_radius')
    this.a_color = gl.getAttribLocation(this.program, 'a_color')
    this.a_selected = gl.getAttribLocation(this.program, 'a_selected')
    this.a_moving = gl.getAttribLocation(this.program, 'a_moving')

    // Get uniform locations
    this.u_viewMatrix = gl.getUniformLocation(this.program, 'u_viewMatrix')
    this.u_viewportSize = gl.getUniformLocation(this.program, 'u_viewportSize')
    this.u_jitter = gl.getUniformLocation(this.program, 'u_jitter')

    // Create static quad buffer (4 corners of a quad)
    const quadVertices = new Float32Array([
      -1, -1,  // Bottom-left
       1, -1,  // Bottom-right
      -1,  1,  // Top-left
       1,  1   // Top-right
    ])

    this.quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)

    // Create dynamic buffer manager for instance data
    const MAX_NODES = 50000
    const STRIDE = 8 // position(2) + radius(1) + color(3) + selected(1) + moving(1)

    this.bufferManager = new DynamicBufferManager(gl as any, {
      maxItems: MAX_NODES,
      stride: STRIDE,
      usage: gl.DYNAMIC_DRAW
    })

    this.bufferPacker = new BufferPacker(MAX_NODES, STRIDE)

    // Enable blending for transparency
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Set clear color
    const bg = this.options.backgroundColor
    gl.clearColor(bg[0], bg[1], bg[2], bg[3])
  }

  private loadShader(type: number, source: string): WebGLShader {
    const gl = this.gl!

    const shader = gl.createShader(type)
    if (!shader) throw new Error('Failed to create shader')

    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error('Shader compilation failed: ' + info)
    }

    return shader
  }

  updateNodes(nodes: NodeData[]): void {
    this.nodes = nodes

    // Build spatial index for viewport culling
    if (this.enableCulling && nodes.length > 0) {
      // Calculate bounds from nodes
      let minX = Infinity, minY = Infinity
      let maxX = -Infinity, maxY = -Infinity

      for (const node of nodes) {
        minX = Math.min(minX, node.x - node.r)
        minY = Math.min(minY, node.y - node.r)
        maxX = Math.max(maxX, node.x + node.r)
        maxY = Math.max(maxY, node.y + node.r)
      }

      // Add 10% padding
      const padX = (maxX - minX) * 0.1
      const padY = (maxY - minY) * 0.1
      const bounds: Bounds = {
        minX: minX - padX,
        minY: minY - padY,
        maxX: maxX + padX,
        maxY: maxY + padY
      }

      // Recreate quadtree with current world bounds.
      // Reusing a tree with stale root bounds can drop nodes that moved
      // outside the original extent, causing apparent clipping.
      this.quadtree = new Quadtree(bounds)

      // Convert nodes to quadtree items and build
      const items: QuadtreeItem[] = nodes.map(node => ({
        id: node.id,
        x: node.x,
        y: node.y,
        r: node.r
      }))

      this.quadtree.build(items)
    }
  }

  setCamera(panX: number, panY: number, zoom: number): void {
    // Build view matrix: translate then scale
    // [zoom, 0, panX]
    // [0, zoom, panY]
    // [0, 0, 1]
    this.viewMatrix[0] = zoom
    this.viewMatrix[4] = zoom
    this.viewMatrix[6] = panX
    this.viewMatrix[7] = panY
  }

  /**
   * Calculate viewport bounds in world space
   */
  private getViewportBounds(): Bounds {
    const zoom = this.viewMatrix[0] ?? 1
    const panX = this.viewMatrix[6] ?? 0
    const panY = this.viewMatrix[7] ?? 0
    const zoomSafe = Math.abs(zoom) > Number.EPSILON ? zoom : 1

    const width = this.canvas.width
    const height = this.canvas.height

    // Transform viewport corners from NDC to world space
    // Inverse of: ndc = (viewPos.xy / viewport) * 2.0 - 1.0
    // viewPos = camera * worldPos
    // worldPos = inverse(camera) * viewPos

    // Corner 1: top-left (NDC: -1, 1)
    const ndc1X = -1, ndc1Y = 1
    const view1X = ((ndc1X + 1) / 2) * width
    const view1Y = ((ndc1Y * -1 + 1) / 2) * height

    // Inverse transform: world = (view - pan) / zoom
    const world1X = (view1X - panX) / zoomSafe
    const world1Y = (view1Y - panY) / zoomSafe

    // Corner 2: bottom-right (NDC: 1, -1)
    const ndc2X = 1, ndc2Y = -1
    const view2X = ((ndc2X + 1) / 2) * width
    const view2Y = ((ndc2Y * -1 + 1) / 2) * height

    const world2X = (view2X - panX) / zoomSafe
    const world2Y = (view2Y - panY) / zoomSafe

    return {
      minX: Math.min(world1X, world2X),
      minY: Math.min(world1Y, world2Y),
      maxX: Math.max(world1X, world2X),
      maxY: Math.max(world1Y, world2Y)
    }
  }

  render(jitterX: number = 0, jitterY: number = 0): void {
    if (!this.gl || !this.program || this.nodes.length === 0) return

    const gl = this.gl

    // Resize canvas if needed
    const displayWidth = this.canvas.clientWidth
    const displayHeight = this.canvas.clientHeight

    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth
      this.canvas.height = displayHeight
      gl.viewport(0, 0, displayWidth, displayHeight)
    }

    // Perform viewport culling
    if (this.enableCulling && this.quadtree) {
      const viewBounds = this.getViewportBounds()
      const visibleItems = this.quadtree.query(viewBounds)

      // Convert visible item IDs to NodeData
      const visibleIds = new Set(visibleItems.map(item => item.id))
      this.visibleNodes = this.nodes.filter(node => visibleIds.has(node.id))
    } else {
      // No culling - render all nodes
      this.visibleNodes = this.nodes
    }

    // Pack visible nodes into buffer
    if (!this.bufferPacker || !this.bufferManager) return

    const stride = 8
    const buffer = this.bufferPacker.getBuffer()

    for (let i = 0; i < this.visibleNodes.length; i++) {
      const node = this.visibleNodes[i]!
      const offset = i * stride

      buffer[offset + 0] = node.x
      buffer[offset + 1] = node.y
      buffer[offset + 2] = node.r
      buffer[offset + 3] = node.color[0]
      buffer[offset + 4] = node.color[1]
      buffer[offset + 5] = node.color[2]
      buffer[offset + 6] = node.selected ? 1.0 : 0.0
      buffer[offset + 7] = node.moving ? 1.0 : 0.0
    }

    // Get view of used portion
    const instanceData = this.bufferPacker.getView(this.visibleNodes.length)

    // Upload to GPU using buffer manager (with performance monitoring)
    const updateStart = performance.now()
    this.bufferManager.updateBuffer(instanceData)
    const updateEnd = performance.now()
    this.performanceMonitor.recordUpdate(updateEnd - updateStart)

    // Note: Don't clear here - TAA pass handles framebuffer clearing

    // No nodes visible? Done.
    if (this.visibleNodes.length === 0) return

    // Use program
    gl.useProgram(this.program)

    // Set uniforms
    gl.uniformMatrix3fv(this.u_viewMatrix, false, this.viewMatrix)
    gl.uniform2f(this.u_viewportSize, this.canvas.width, this.canvas.height)
    gl.uniform2f(this.u_jitter, jitterX, jitterY)

    // Bind quad vertices (per-vertex attribute)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.a_corner)
    gl.vertexAttribPointer(this.a_corner, 2, gl.FLOAT, false, 0, 0)

    // Bind instance data (per-instance attributes)
    const instanceBuffer = this.bufferManager.getRenderBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
    const byteStride = 8 * 4 // 8 floats * 4 bytes

    gl.enableVertexAttribArray(this.a_position)
    gl.vertexAttribPointer(this.a_position, 2, gl.FLOAT, false, byteStride, 0)

    gl.enableVertexAttribArray(this.a_radius)
    gl.vertexAttribPointer(this.a_radius, 1, gl.FLOAT, false, byteStride, 2 * 4)

    gl.enableVertexAttribArray(this.a_color)
    gl.vertexAttribPointer(this.a_color, 3, gl.FLOAT, false, byteStride, 3 * 4)

    gl.enableVertexAttribArray(this.a_selected)
    gl.vertexAttribPointer(this.a_selected, 1, gl.FLOAT, false, byteStride, 6 * 4)

    gl.enableVertexAttribArray(this.a_moving)
    gl.vertexAttribPointer(this.a_moving, 1, gl.FLOAT, false, byteStride, 7 * 4)

    // Set attribute divisors for instancing (WebGL2 native)
    gl.vertexAttribDivisor(this.a_position, 1)
    gl.vertexAttribDivisor(this.a_radius, 1)
    gl.vertexAttribDivisor(this.a_color, 1)
    gl.vertexAttribDivisor(this.a_selected, 1)
    gl.vertexAttribDivisor(this.a_moving, 1)

    // Draw all visible instances in one call (WebGL2 native)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.visibleNodes.length)

    // Reset divisors
    gl.vertexAttribDivisor(this.a_position, 0)
    gl.vertexAttribDivisor(this.a_radius, 0)
    gl.vertexAttribDivisor(this.a_color, 0)
    gl.vertexAttribDivisor(this.a_selected, 0)
    gl.vertexAttribDivisor(this.a_moving, 0)
  }

  destroy(): void {
    if (!this.gl) return

    const gl = this.gl

    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.bufferManager) this.bufferManager.destroy()
    if (this.program) gl.deleteProgram(this.program)

    this.bufferManager = null
    this.bufferPacker = null
    this.gl = null
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas
  }

  /**
   * Enable or disable viewport culling
   */
  setCullingEnabled(enabled: boolean): void {
    this.enableCulling = enabled
  }

  /**
   * Get culling statistics
   */
  getCullingStats(): {
    totalNodes: number
    visibleNodes: number
    cullingEnabled: boolean
    quadtreeStats: any
  } {
    return {
      totalNodes: this.nodes.length,
      visibleNodes: this.visibleNodes.length,
      cullingEnabled: this.enableCulling,
      quadtreeStats: this.quadtree ? this.quadtree.getStats() : null
    }
  }

  /**
   * Get the spatial tree for hit testing
   */
  getQuadtree(): Quadtree | null {
    return this.quadtree
  }

  /**
   * Start animation mode (enables double buffering for better performance)
   * Call this when force simulation starts or any continuous animation begins
   */
  startAnimation(): void {
    if (this.bufferManager) {
      this.bufferManager.startAnimation()
    }
  }

  /**
   * Stop animation mode (switches to partial updates)
   * Call this when force simulation stops or animation ends
   */
  stopAnimation(): void {
    if (this.bufferManager) {
      this.bufferManager.stopAnimation()
    }
  }

  /**
   * Get buffer update performance statistics
   */
  getBufferPerformanceStats(): {
    avg: number
    p99: number
    samples: number
    animationMode: boolean
  } {
    return {
      ...this.performanceMonitor.getStats(),
      animationMode: this.bufferManager?.isInAnimationMode() ?? false
    }
  }
}
