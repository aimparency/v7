/**
 * WebGL Arrow Renderer (Triangle-based Arc Rendering)
 *
 * Renders arrows as annulus segments using triangles.
 * Each arrow is one triangle: M (arc center) + two points on tangent line at tip.
 */

import type { ArrowGeometry } from './utils/arrow-geometry'

export interface EdgeData {
  id: string
  sourceId: string
  targetId: string
  color: [number, number, number]
  opacity: number
  geometry: ArrowGeometry
}

// Stride: arcCenter(2) + triangleV1(2) + triangleV2(2) + radiusOuterSq(1) + radiusInnerSq(1)
//       + sourceCenter(2) + targetCenter(2) + targetRadiusSq(1) + color(3) + opacity(1) = 17
const STRIDE = 17

export class ArrowRenderer {
  private gl: WebGLRenderingContext
  private canvas: HTMLCanvasElement

  private program: WebGLProgram | null = null
  private vertexIndexBuffer: WebGLBuffer | null = null
  private instanceBuffer: WebGLBuffer | null = null
  private instanceData: Float32Array

  // Attribute locations
  private a_vertexIndex: number = -1
  private a_arcCenter: number = -1
  private a_triangleV1: number = -1
  private a_triangleV2: number = -1
  private a_radiusOuterSq: number = -1
  private a_radiusInnerSq: number = -1
  private a_sourceCenter: number = -1
  private a_targetCenter: number = -1
  private a_targetRadiusSq: number = -1
  private a_color: number = -1
  private a_opacity: number = -1

  // Uniform locations
  private u_viewMatrix: WebGLUniformLocation | null = null
  private u_viewportSize: WebGLUniformLocation | null = null

  private edges: EdgeData[] = []
  private viewMatrix: Float32Array = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])

  private maxEdges: number

  constructor(gl: WebGLRenderingContext, canvas: HTMLCanvasElement, maxEdges: number = 50000) {
    this.gl = gl
    this.canvas = canvas
    this.maxEdges = maxEdges
    this.instanceData = new Float32Array(maxEdges * STRIDE)
  }

  async init(): Promise<void> {
    const gl = this.gl

    // Load shaders
    const vertShader = await this.loadShader(gl.VERTEX_SHADER, '/src/webgl/shaders/arrow.vert.glsl')
    const fragShader = await this.loadShader(gl.FRAGMENT_SHADER, '/src/webgl/shaders/arrow.frag.glsl')

    // Create program
    this.program = gl.createProgram()
    if (!this.program) throw new Error('Failed to create program')

    gl.attachShader(this.program, vertShader)
    gl.attachShader(this.program, fragShader)
    gl.linkProgram(this.program)

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(this.program))
    }

    // Get attribute locations
    this.a_vertexIndex = gl.getAttribLocation(this.program, 'a_vertexIndex')
    this.a_arcCenter = gl.getAttribLocation(this.program, 'a_arcCenter')
    this.a_triangleV1 = gl.getAttribLocation(this.program, 'a_triangleV1')
    this.a_triangleV2 = gl.getAttribLocation(this.program, 'a_triangleV2')
    this.a_radiusOuterSq = gl.getAttribLocation(this.program, 'a_radiusOuterSq')
    this.a_radiusInnerSq = gl.getAttribLocation(this.program, 'a_radiusInnerSq')
    this.a_sourceCenter = gl.getAttribLocation(this.program, 'a_sourceCenter')
    this.a_targetCenter = gl.getAttribLocation(this.program, 'a_targetCenter')
    this.a_targetRadiusSq = gl.getAttribLocation(this.program, 'a_targetRadiusSq')
    this.a_color = gl.getAttribLocation(this.program, 'a_color')
    this.a_opacity = gl.getAttribLocation(this.program, 'a_opacity')

    // Get uniform locations
    this.u_viewMatrix = gl.getUniformLocation(this.program, 'u_viewMatrix')
    this.u_viewportSize = gl.getUniformLocation(this.program, 'u_viewportSize')

    // Create vertex index buffer (3 vertices: 0, 1, 2)
    const vertexIndices = new Float32Array([0, 1, 2])
    this.vertexIndexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIndexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertexIndices, gl.STATIC_DRAW)

    // Create instance buffer
    this.instanceBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW)
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

    // Pack instance data
    for (let i = 0; i < edges.length && i < this.maxEdges; i++) {
      const e = edges[i]!
      const g = e.geometry
      const offset = i * STRIDE

      this.instanceData[offset + 0] = g.arcCenter.x
      this.instanceData[offset + 1] = g.arcCenter.y
      this.instanceData[offset + 2] = g.triangleV1.x
      this.instanceData[offset + 3] = g.triangleV1.y
      this.instanceData[offset + 4] = g.triangleV2.x
      this.instanceData[offset + 5] = g.triangleV2.y
      this.instanceData[offset + 6] = g.radiusOuterSq
      this.instanceData[offset + 7] = g.radiusInnerSq
      this.instanceData[offset + 8] = g.sourceCenter.x
      this.instanceData[offset + 9] = g.sourceCenter.y
      this.instanceData[offset + 10] = g.targetCenter.x
      this.instanceData[offset + 11] = g.targetCenter.y
      this.instanceData[offset + 12] = g.targetRadiusSq
      this.instanceData[offset + 13] = e.color[0]
      this.instanceData[offset + 14] = e.color[1]
      this.instanceData[offset + 15] = e.color[2]
      this.instanceData[offset + 16] = e.opacity
    }

    // Upload to GPU
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, edges.length * STRIDE))
  }

  setCamera(viewMatrix: Float32Array): void {
    this.viewMatrix = viewMatrix
  }

  render(): void {
    if (!this.program || this.edges.length === 0) return

    const gl = this.gl
    const ext = gl.getExtension('ANGLE_instanced_arrays')
    if (!ext) return

    gl.useProgram(this.program)

    // Set uniforms
    gl.uniformMatrix3fv(this.u_viewMatrix, false, this.viewMatrix)
    gl.uniform2f(this.u_viewportSize, this.canvas.width, this.canvas.height)

    // Bind vertex index buffer (per-vertex, not instanced)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIndexBuffer)
    gl.enableVertexAttribArray(this.a_vertexIndex)
    gl.vertexAttribPointer(this.a_vertexIndex, 1, gl.FLOAT, false, 0, 0)
    // NOT instanced - divisor stays 0

    // Bind instance buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    const byteStride = STRIDE * 4

    // Setup instance attributes (all with divisor 1)
    const attrs = [
      { loc: this.a_arcCenter, size: 2, offset: 0 },
      { loc: this.a_triangleV1, size: 2, offset: 2 },
      { loc: this.a_triangleV2, size: 2, offset: 4 },
      { loc: this.a_radiusOuterSq, size: 1, offset: 6 },
      { loc: this.a_radiusInnerSq, size: 1, offset: 7 },
      { loc: this.a_sourceCenter, size: 2, offset: 8 },
      { loc: this.a_targetCenter, size: 2, offset: 10 },
      { loc: this.a_targetRadiusSq, size: 1, offset: 12 },
      { loc: this.a_color, size: 3, offset: 13 },
      { loc: this.a_opacity, size: 1, offset: 16 }
    ]

    for (const attr of attrs) {
      if (attr.loc >= 0) {
        gl.enableVertexAttribArray(attr.loc)
        gl.vertexAttribPointer(attr.loc, attr.size, gl.FLOAT, false, byteStride, attr.offset * 4)
        ext.vertexAttribDivisorANGLE(attr.loc, 1)
      }
    }

    // Draw triangles (3 vertices per instance)
    ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 3, Math.min(this.edges.length, this.maxEdges))

    // Reset divisors
    for (const attr of attrs) {
      if (attr.loc >= 0) {
        ext.vertexAttribDivisorANGLE(attr.loc, 0)
      }
    }
  }

  destroy(): void {
    const gl = this.gl
    if (this.vertexIndexBuffer) gl.deleteBuffer(this.vertexIndexBuffer)
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer)
    if (this.program) gl.deleteProgram(this.program)
  }
}
