/**
 * Selection Spinner Renderer (WebGL2)
 *
 * Draws a rotating row of half-dots just OUTSIDE the outline of each selected
 * node. Rendered as a post-TAA overlay straight to the screen at a fixed 50%
 * opacity, so the moving dots don't get smeared by temporal accumulation.
 */

import spinnerVertexShaderSource from './shaders/selection-spinner.vert.glsl?raw'
import spinnerFragmentShaderSource from './shaders/selection-spinner.frag.glsl?raw'

export interface SpinnerInstance {
  x: number
  y: number
  r: number
}

// Dot radius in node-radius units. Gap spacing (4*dotRadius in the shader) and
// the quad margin below both derive from this, so changing it scales the whole
// spinner — dots and gaps together.
const DOT_RADIUS = 0.1125
// Quad half-size as a multiple of node radius, leaving 2*dotRadius of margin
// so the outer half-dots have room to render.
const QUAD_SCALE = 1.0 + 2.0 * DOT_RADIUS

const STRIDE = 3 // x, y, r

export class SelectionSpinnerRenderer {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement

  private program: WebGLProgram | null = null
  private quadBuffer: WebGLBuffer | null = null
  private instanceBuffer: WebGLBuffer | null = null
  private instanceData: Float32Array

  private a_corner: number = -1
  private a_position: number = -1
  private a_radius: number = -1

  private u_viewMatrix: WebGLUniformLocation | null = null
  private u_viewportSize: WebGLUniformLocation | null = null
  private u_quadScale: WebGLUniformLocation | null = null
  private u_time: WebGLUniformLocation | null = null
  private u_dotRadius: WebGLUniformLocation | null = null

  private viewMatrix: Float32Array = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
  private count: number = 0

  private maxInstances: number

  constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, maxInstances: number = 256) {
    this.gl = gl
    this.canvas = canvas
    this.maxInstances = maxInstances
    this.instanceData = new Float32Array(maxInstances * STRIDE)
  }

  async init(): Promise<void> {
    const gl = this.gl

    const vertShader = this.loadShader(gl.VERTEX_SHADER, spinnerVertexShaderSource)
    const fragShader = this.loadShader(gl.FRAGMENT_SHADER, spinnerFragmentShaderSource)

    this.program = gl.createProgram()
    if (!this.program) throw new Error('Failed to create spinner program')

    gl.attachShader(this.program, vertShader)
    gl.attachShader(this.program, fragShader)
    gl.linkProgram(this.program)

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Spinner program link failed: ' + gl.getProgramInfoLog(this.program))
    }

    this.a_corner = gl.getAttribLocation(this.program, 'a_corner')
    this.a_position = gl.getAttribLocation(this.program, 'a_position')
    this.a_radius = gl.getAttribLocation(this.program, 'a_radius')

    this.u_viewMatrix = gl.getUniformLocation(this.program, 'u_viewMatrix')
    this.u_viewportSize = gl.getUniformLocation(this.program, 'u_viewportSize')
    this.u_quadScale = gl.getUniformLocation(this.program, 'u_quadScale')
    this.u_time = gl.getUniformLocation(this.program, 'u_time')
    this.u_dotRadius = gl.getUniformLocation(this.program, 'u_dotRadius')

    // Static quad corners (triangle strip)
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ])
    this.quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)

    this.instanceBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW)
  }

  private loadShader(type: number, source: string): WebGLShader {
    const gl = this.gl
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

  setCamera(viewMatrix: Float32Array): void {
    this.viewMatrix = viewMatrix
  }

  updateInstances(instances: SpinnerInstance[]): void {
    this.count = Math.min(instances.length, this.maxInstances)
    for (let i = 0; i < this.count; i++) {
      const inst = instances[i]!
      const offset = i * STRIDE
      this.instanceData[offset + 0] = inst.x
      this.instanceData[offset + 1] = inst.y
      this.instanceData[offset + 2] = inst.r
    }
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, this.count * STRIDE))
  }

  /**
   * Render the spinner overlay to the currently bound framebuffer (the screen).
   * Expects alpha blending to already be enabled.
   */
  render(time: number): void {
    if (!this.program || this.count === 0) return

    const gl = this.gl
    gl.useProgram(this.program)

    gl.uniformMatrix3fv(this.u_viewMatrix, false, this.viewMatrix)
    gl.uniform2f(this.u_viewportSize, this.canvas.width, this.canvas.height)
    gl.uniform1f(this.u_quadScale, QUAD_SCALE)
    gl.uniform1f(this.u_time, time)
    gl.uniform1f(this.u_dotRadius, DOT_RADIUS)

    // Per-vertex quad corners (not instanced)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.a_corner)
    gl.vertexAttribPointer(this.a_corner, 2, gl.FLOAT, false, 0, 0)

    // Per-instance attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    const byteStride = STRIDE * 4
    gl.enableVertexAttribArray(this.a_position)
    gl.vertexAttribPointer(this.a_position, 2, gl.FLOAT, false, byteStride, 0)
    gl.vertexAttribDivisor(this.a_position, 1)
    gl.enableVertexAttribArray(this.a_radius)
    gl.vertexAttribPointer(this.a_radius, 1, gl.FLOAT, false, byteStride, 2 * 4)
    gl.vertexAttribDivisor(this.a_radius, 1)

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)

    gl.vertexAttribDivisor(this.a_position, 0)
    gl.vertexAttribDivisor(this.a_radius, 0)
  }

  destroy(): void {
    const gl = this.gl
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer)
    if (this.program) gl.deleteProgram(this.program)
  }
}
