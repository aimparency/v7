/**
 * WebGL Arrow Renderer
 *
 * Renders arc-based arrows using WebGL instanced rendering.
 * Supports both trunk and head rendering with separate shaders.
 */

import type { ArrowGeometry } from './utils/arrow-geometry'
import {
  DynamicBufferManager,
  BufferPacker,
  BufferPerformanceMonitor
} from './buffers/DynamicBufferManager'

export interface EdgeData {
  id: string
  sourceId: string
  targetId: string
  color: [number, number, number] // RGB 0-1
  opacity: number
  geometry: ArrowGeometry
}

export class ArrowRenderer {
  private gl: WebGLRenderingContext
  private canvas: HTMLCanvasElement

  // Shader programs
  private trunkProgram: WebGLProgram | null = null
  private headProgram: WebGLProgram | null = null

  // Buffers
  private quadBuffer: WebGLBuffer | null = null // Static quad corners
  private trunkBufferManager: DynamicBufferManager | null = null
  private headBufferManager: DynamicBufferManager | null = null
  private trunkBufferPacker: BufferPacker | null = null
  private headBufferPacker: BufferPacker | null = null
  private trunkPerformanceMonitor: BufferPerformanceMonitor = new BufferPerformanceMonitor()
  private headPerformanceMonitor: BufferPerformanceMonitor = new BufferPerformanceMonitor()

  // Trunk shader attributes
  private trunk_a_corner: number = -1
  private trunk_a_startPos: number = -1
  private trunk_a_endPos: number = -1
  private trunk_a_arcCenter1: number = -1
  private trunk_a_arcCenter2: number = -1
  private trunk_a_radiusInnerSq: number = -1
  private trunk_a_radiusOuterSq: number = -1
  private trunk_a_radiusCenterSq: number = -1
  private trunk_a_taperFactor: number = -1
  private trunk_a_color: number = -1
  private trunk_a_opacity: number = -1

  // Trunk shader uniforms
  private trunk_u_viewMatrix: WebGLUniformLocation | null = null
  private trunk_u_viewportSize: WebGLUniformLocation | null = null

  // Head shader attributes
  private head_a_corner: number = -1
  private head_a_tailPos: number = -1
  private head_a_pointPos: number = -1
  private head_a_arcCenter1: number = -1
  private head_a_arcCenter2: number = -1
  private head_a_radiusInner: number = -1
  private head_a_radiusOuter: number = -1
  private head_a_radiusCenter: number = -1
  private head_a_color: number = -1
  private head_a_opacity: number = -1

  // Head shader uniforms
  private head_u_viewMatrix: WebGLUniformLocation | null = null
  private head_u_viewportSize: WebGLUniformLocation | null = null

  // Data
  private edges: EdgeData[] = []

  // Camera state (shared with node renderer)
  private viewMatrix: Float32Array = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ])

  constructor(gl: WebGLRenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl
    this.canvas = canvas
  }

  async init(): Promise<void> {
    const gl = this.gl

    // Load and compile shaders
    const trunkVertexShader = await this.loadShader(gl.VERTEX_SHADER, '/src/webgl/shaders/arrow.vert.glsl')
    const trunkFragmentShader = await this.loadShader(gl.FRAGMENT_SHADER, '/src/webgl/shaders/arrow.frag.glsl')
    const headVertexShader = await this.loadShader(gl.VERTEX_SHADER, '/src/webgl/shaders/arrow-head.vert.glsl')
    const headFragmentShader = await this.loadShader(gl.FRAGMENT_SHADER, '/src/webgl/shaders/arrow-head.frag.glsl')

    // Create trunk program
    this.trunkProgram = gl.createProgram()
    if (!this.trunkProgram) throw new Error('Failed to create trunk program')

    gl.attachShader(this.trunkProgram, trunkVertexShader)
    gl.attachShader(this.trunkProgram, trunkFragmentShader)
    gl.linkProgram(this.trunkProgram)

    if (!gl.getProgramParameter(this.trunkProgram, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(this.trunkProgram)
      throw new Error('Trunk program link failed: ' + info)
    }

    // Create head program
    this.headProgram = gl.createProgram()
    if (!this.headProgram) throw new Error('Failed to create head program')

    gl.attachShader(this.headProgram, headVertexShader)
    gl.attachShader(this.headProgram, headFragmentShader)
    gl.linkProgram(this.headProgram)

    if (!gl.getProgramParameter(this.headProgram, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(this.headProgram)
      throw new Error('Head program link failed: ' + info)
    }

    // Get trunk attribute locations
    this.trunk_a_corner = gl.getAttribLocation(this.trunkProgram, 'a_corner')
    this.trunk_a_startPos = gl.getAttribLocation(this.trunkProgram, 'a_startPos')
    this.trunk_a_endPos = gl.getAttribLocation(this.trunkProgram, 'a_endPos')
    this.trunk_a_arcCenter1 = gl.getAttribLocation(this.trunkProgram, 'a_arcCenter1')
    this.trunk_a_arcCenter2 = gl.getAttribLocation(this.trunkProgram, 'a_arcCenter2')
    this.trunk_a_radiusInnerSq = gl.getAttribLocation(this.trunkProgram, 'a_radiusInnerSq')
    this.trunk_a_radiusOuterSq = gl.getAttribLocation(this.trunkProgram, 'a_radiusOuterSq')
    this.trunk_a_radiusCenterSq = gl.getAttribLocation(this.trunkProgram, 'a_radiusCenterSq')
    this.trunk_a_taperFactor = gl.getAttribLocation(this.trunkProgram, 'a_taperFactor')
    this.trunk_a_color = gl.getAttribLocation(this.trunkProgram, 'a_color')
    this.trunk_a_opacity = gl.getAttribLocation(this.trunkProgram, 'a_opacity')

    // Get trunk uniform locations
    this.trunk_u_viewMatrix = gl.getUniformLocation(this.trunkProgram, 'u_viewMatrix')
    this.trunk_u_viewportSize = gl.getUniformLocation(this.trunkProgram, 'u_viewportSize')

    // Get head attribute locations
    this.head_a_corner = gl.getAttribLocation(this.headProgram, 'a_corner')
    this.head_a_tailPos = gl.getAttribLocation(this.headProgram, 'a_tailPos')
    this.head_a_pointPos = gl.getAttribLocation(this.headProgram, 'a_pointPos')
    this.head_a_arcCenter1 = gl.getAttribLocation(this.headProgram, 'a_arcCenter1')
    this.head_a_arcCenter2 = gl.getAttribLocation(this.headProgram, 'a_arcCenter2')
    this.head_a_radiusInner = gl.getAttribLocation(this.headProgram, 'a_radiusInner')
    this.head_a_radiusOuter = gl.getAttribLocation(this.headProgram, 'a_radiusOuter')
    this.head_a_radiusCenter = gl.getAttribLocation(this.headProgram, 'a_radiusCenter')
    this.head_a_color = gl.getAttribLocation(this.headProgram, 'a_color')
    this.head_a_opacity = gl.getAttribLocation(this.headProgram, 'a_opacity')

    // Get head uniform locations
    this.head_u_viewMatrix = gl.getUniformLocation(this.headProgram, 'u_viewMatrix')
    this.head_u_viewportSize = gl.getUniformLocation(this.headProgram, 'u_viewportSize')

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

    // Create dynamic buffer managers for instance data
    const MAX_EDGES = 50000
    const TRUNK_STRIDE = 17 // startPos(2) + endPos(2) + arcCenter1(2) + arcCenter2(2) + radiusInnerSq(1) + radiusOuterSq(1) + radiusCenterSq(1) + taperFactor(1) + color(3) + opacity(1) + padding(1)
    const HEAD_STRIDE = 15 // tailPos(2) + pointPos(2) + arcCenter1(2) + arcCenter2(2) + radiusInner(1) + radiusOuter(1) + radiusCenter(1) + color(3) + opacity(1)

    this.trunkBufferManager = new DynamicBufferManager(gl, {
      maxItems: MAX_EDGES,
      stride: TRUNK_STRIDE,
      usage: gl.DYNAMIC_DRAW
    })

    this.headBufferManager = new DynamicBufferManager(gl, {
      maxItems: MAX_EDGES,
      stride: HEAD_STRIDE,
      usage: gl.DYNAMIC_DRAW
    })

    this.trunkBufferPacker = new BufferPacker(MAX_EDGES, TRUNK_STRIDE)
    this.headBufferPacker = new BufferPacker(MAX_EDGES, HEAD_STRIDE)
  }

  private async loadShader(type: number, url: string): Promise<WebGLShader> {
    const gl = this.gl
    const response = await fetch(url)
    const source = await response.text()

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

  updateEdges(edges: EdgeData[]): void {
    this.edges = edges
  }

  setCamera(viewMatrix: Float32Array): void {
    this.viewMatrix = viewMatrix
  }

  render(): void {
    if (!this.trunkProgram || !this.headProgram || this.edges.length === 0) return
    if (!this.trunkBufferPacker || !this.headBufferPacker) return
    if (!this.trunkBufferManager || !this.headBufferManager) return

    const gl = this.gl

    // Pack trunk instance data
    const trunkStride = 17
    const trunkBuffer = this.trunkBufferPacker.getBuffer()

    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i]!
      const t = edge.geometry.trunk
      const offset = i * trunkStride

      trunkBuffer[offset + 0] = t.startPos.x
      trunkBuffer[offset + 1] = t.startPos.y
      trunkBuffer[offset + 2] = t.endPos.x
      trunkBuffer[offset + 3] = t.endPos.y
      trunkBuffer[offset + 4] = t.arcCenter1.x
      trunkBuffer[offset + 5] = t.arcCenter1.y
      trunkBuffer[offset + 6] = t.arcCenter2.x
      trunkBuffer[offset + 7] = t.arcCenter2.y
      trunkBuffer[offset + 8] = t.radiusInnerSq
      trunkBuffer[offset + 9] = t.radiusOuterSq
      trunkBuffer[offset + 10] = t.radiusCenterSq
      trunkBuffer[offset + 11] = t.taperFactor
      trunkBuffer[offset + 12] = edge.color[0]
      trunkBuffer[offset + 13] = edge.color[1]
      trunkBuffer[offset + 14] = edge.color[2]
      trunkBuffer[offset + 15] = edge.opacity
    }

    // Upload trunk data using buffer manager
    const trunkInstanceData = this.trunkBufferPacker.getView(this.edges.length)
    const trunkUpdateStart = performance.now()
    this.trunkBufferManager.updateBuffer(trunkInstanceData)
    const trunkUpdateEnd = performance.now()
    this.trunkPerformanceMonitor.recordUpdate(trunkUpdateEnd - trunkUpdateStart)

    // Pack head instance data
    const headStride = 15
    const headBuffer = this.headBufferPacker.getBuffer()

    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i]!
      const h = edge.geometry.head
      const offset = i * headStride

      headBuffer[offset + 0] = h.tailPos.x
      headBuffer[offset + 1] = h.tailPos.y
      headBuffer[offset + 2] = h.pointPos.x
      headBuffer[offset + 3] = h.pointPos.y
      headBuffer[offset + 4] = h.arcCenter1.x
      headBuffer[offset + 5] = h.arcCenter1.y
      headBuffer[offset + 6] = h.arcCenter2.x
      headBuffer[offset + 7] = h.arcCenter2.y
      headBuffer[offset + 8] = h.radiusInner
      headBuffer[offset + 9] = h.radiusOuter
      headBuffer[offset + 10] = h.radiusCenter
      headBuffer[offset + 11] = edge.color[0]
      headBuffer[offset + 12] = edge.color[1]
      headBuffer[offset + 13] = edge.color[2]
      headBuffer[offset + 14] = edge.opacity
    }

    // Upload head data using buffer manager
    const headInstanceData = this.headBufferPacker.getView(this.edges.length)
    const headUpdateStart = performance.now()
    this.headBufferManager.updateBuffer(headInstanceData)
    const headUpdateEnd = performance.now()
    this.headPerformanceMonitor.recordUpdate(headUpdateEnd - headUpdateStart)

    // Get instancing extension
    const ext = gl.getExtension('ANGLE_instanced_arrays')
    if (!ext) {
      console.warn('ANGLE_instanced_arrays not available')
      return
    }

    // Render trunks
    this.renderTrunks(ext)

    // Render heads
    this.renderHeads(ext)
  }

  private renderTrunks(ext: ANGLE_instanced_arrays): void {
    const gl = this.gl

    // Upload trunk data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trunkInstanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.trunkInstanceData, gl.DYNAMIC_DRAW)

    // Use trunk program
    gl.useProgram(this.trunkProgram)

    // Set uniforms
    gl.uniformMatrix3fv(this.trunk_u_viewMatrix, false, this.viewMatrix)
    gl.uniform2f(this.trunk_u_viewportSize, this.canvas.width, this.canvas.height)

    // Bind quad vertices
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.trunk_a_corner)
    gl.vertexAttribPointer(this.trunk_a_corner, 2, gl.FLOAT, false, 0, 0)

    // Bind instance data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trunkInstanceBuffer)
    const byteStride = 17 * 4

    gl.enableVertexAttribArray(this.trunk_a_startPos)
    gl.vertexAttribPointer(this.trunk_a_startPos, 2, gl.FLOAT, false, byteStride, 0)

    gl.enableVertexAttribArray(this.trunk_a_endPos)
    gl.vertexAttribPointer(this.trunk_a_endPos, 2, gl.FLOAT, false, byteStride, 2 * 4)

    gl.enableVertexAttribArray(this.trunk_a_arcCenter1)
    gl.vertexAttribPointer(this.trunk_a_arcCenter1, 2, gl.FLOAT, false, byteStride, 4 * 4)

    gl.enableVertexAttribArray(this.trunk_a_arcCenter2)
    gl.vertexAttribPointer(this.trunk_a_arcCenter2, 2, gl.FLOAT, false, byteStride, 6 * 4)

    gl.enableVertexAttribArray(this.trunk_a_radiusInnerSq)
    gl.vertexAttribPointer(this.trunk_a_radiusInnerSq, 1, gl.FLOAT, false, byteStride, 8 * 4)

    gl.enableVertexAttribArray(this.trunk_a_radiusOuterSq)
    gl.vertexAttribPointer(this.trunk_a_radiusOuterSq, 1, gl.FLOAT, false, byteStride, 9 * 4)

    gl.enableVertexAttribArray(this.trunk_a_radiusCenterSq)
    gl.vertexAttribPointer(this.trunk_a_radiusCenterSq, 1, gl.FLOAT, false, byteStride, 10 * 4)

    gl.enableVertexAttribArray(this.trunk_a_taperFactor)
    gl.vertexAttribPointer(this.trunk_a_taperFactor, 1, gl.FLOAT, false, byteStride, 11 * 4)

    gl.enableVertexAttribArray(this.trunk_a_color)
    gl.vertexAttribPointer(this.trunk_a_color, 3, gl.FLOAT, false, byteStride, 12 * 4)

    gl.enableVertexAttribArray(this.trunk_a_opacity)
    gl.vertexAttribPointer(this.trunk_a_opacity, 1, gl.FLOAT, false, byteStride, 15 * 4)

    // Set attribute divisors for instancing
    ext.vertexAttribDivisorANGLE(this.trunk_a_startPos, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_endPos, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_arcCenter1, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_arcCenter2, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_radiusInnerSq, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_radiusOuterSq, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_radiusCenterSq, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_taperFactor, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_color, 1)
    ext.vertexAttribDivisorANGLE(this.trunk_a_opacity, 1)

    // Draw
    ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, this.edges.length)

    // Reset divisors
    ext.vertexAttribDivisorANGLE(this.trunk_a_startPos, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_endPos, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_arcCenter1, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_arcCenter2, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_radiusInnerSq, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_radiusOuterSq, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_radiusCenterSq, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_taperFactor, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_color, 0)
    ext.vertexAttribDivisorANGLE(this.trunk_a_opacity, 0)
  }

  private renderHeads(ext: ANGLE_instanced_arrays): void {
    const gl = this.gl

    // Upload head data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.headInstanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.headInstanceData, gl.DYNAMIC_DRAW)

    // Use head program
    gl.useProgram(this.headProgram)

    // Set uniforms
    gl.uniformMatrix3fv(this.head_u_viewMatrix, false, this.viewMatrix)
    gl.uniform2f(this.head_u_viewportSize, this.canvas.width, this.canvas.height)

    // Bind quad vertices
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.head_a_corner)
    gl.vertexAttribPointer(this.head_a_corner, 2, gl.FLOAT, false, 0, 0)

    // Bind instance data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.headInstanceBuffer)
    const byteStride = 15 * 4

    gl.enableVertexAttribArray(this.head_a_tailPos)
    gl.vertexAttribPointer(this.head_a_tailPos, 2, gl.FLOAT, false, byteStride, 0)

    gl.enableVertexAttribArray(this.head_a_pointPos)
    gl.vertexAttribPointer(this.head_a_pointPos, 2, gl.FLOAT, false, byteStride, 2 * 4)

    gl.enableVertexAttribArray(this.head_a_arcCenter1)
    gl.vertexAttribPointer(this.head_a_arcCenter1, 2, gl.FLOAT, false, byteStride, 4 * 4)

    gl.enableVertexAttribArray(this.head_a_arcCenter2)
    gl.vertexAttribPointer(this.head_a_arcCenter2, 2, gl.FLOAT, false, byteStride, 6 * 4)

    gl.enableVertexAttribArray(this.head_a_radiusInner)
    gl.vertexAttribPointer(this.head_a_radiusInner, 1, gl.FLOAT, false, byteStride, 8 * 4)

    gl.enableVertexAttribArray(this.head_a_radiusOuter)
    gl.vertexAttribPointer(this.head_a_radiusOuter, 1, gl.FLOAT, false, byteStride, 9 * 4)

    gl.enableVertexAttribArray(this.head_a_radiusCenter)
    gl.vertexAttribPointer(this.head_a_radiusCenter, 1, gl.FLOAT, false, byteStride, 10 * 4)

    gl.enableVertexAttribArray(this.head_a_color)
    gl.vertexAttribPointer(this.head_a_color, 3, gl.FLOAT, false, byteStride, 11 * 4)

    gl.enableVertexAttribArray(this.head_a_opacity)
    gl.vertexAttribPointer(this.head_a_opacity, 1, gl.FLOAT, false, byteStride, 14 * 4)

    // Set attribute divisors for instancing
    ext.vertexAttribDivisorANGLE(this.head_a_tailPos, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_pointPos, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_arcCenter1, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_arcCenter2, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_radiusInner, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_radiusOuter, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_radiusCenter, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_color, 1)
    ext.vertexAttribDivisorANGLE(this.head_a_opacity, 1)

    // Draw
    ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, this.edges.length)

    // Reset divisors
    ext.vertexAttribDivisorANGLE(this.head_a_tailPos, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_pointPos, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_arcCenter1, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_arcCenter2, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_radiusInner, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_radiusOuter, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_radiusCenter, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_color, 0)
    ext.vertexAttribDivisorANGLE(this.head_a_opacity, 0)
  }

  destroy(): void {
    const gl = this.gl

    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.trunkInstanceBuffer) gl.deleteBuffer(this.trunkInstanceBuffer)
    if (this.headInstanceBuffer) gl.deleteBuffer(this.headInstanceBuffer)
    if (this.trunkProgram) gl.deleteProgram(this.trunkProgram)
    if (this.headProgram) gl.deleteProgram(this.headProgram)
  }
}
