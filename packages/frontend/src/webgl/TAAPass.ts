/**
 * Temporal Anti-Aliasing Pass (WebGL2)
 *
 * Uses MRT to render color + movement flag separately.
 * Movement flag in alpha of history propagates for 2-frame override.
 * Ping-pong buffers for proper history accumulation.
 */

import taaVertexShaderSource from './shaders/taa.vert.glsl?raw'
import taaFragmentShaderSource from './shaders/taa.frag.glsl?raw'

export class TAAPass {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement

  private blendProgram: WebGLProgram | null = null
  private quadBuffer: WebGLBuffer | null = null

  // Current frame framebuffer (2 attachments: color + movement)
  private currentFB: WebGLFramebuffer | null = null
  private currentColorTex: WebGLTexture | null = null
  private currentMovementTex: WebGLTexture | null = null

  // Ping-pong history buffers (swap each frame)
  private historyFB: [WebGLFramebuffer | null, WebGLFramebuffer | null] = [null, null]
  private historyTex: [WebGLTexture | null, WebGLTexture | null] = [null, null]
  private writeIndex: number = 0 // Which history buffer to write to

  // Uniform/attribute locations
  private a_position: number = -1
  private u_currentColor: WebGLUniformLocation | null = null
  private u_currentMovement: WebGLUniformLocation | null = null
  private u_historyColor: WebGLUniformLocation | null = null
  private u_resolution: WebGLUniformLocation | null = null
  private u_blendAmount: WebGLUniformLocation | null = null
  private u_cameraMoving: WebGLUniformLocation | null = null

  // Camera movement state (set before end() call)
  private cameraMoving: boolean = false

  private fbWidth: number = 0
  private fbHeight: number = 0
  private canRenderToFloat: boolean = false

  constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl
    this.canvas = canvas
    // Check if we can render to float textures
    this.canRenderToFloat = gl.getExtension('EXT_color_buffer_float') !== null
  }

  async init(): Promise<void> {
    const gl = this.gl

    // Load blend shader
    const vertShader = this.loadShader(gl.VERTEX_SHADER, taaVertexShaderSource)
    const fragShader = this.loadShader(gl.FRAGMENT_SHADER, taaFragmentShaderSource)

    this.blendProgram = gl.createProgram()
    if (!this.blendProgram) throw new Error('Failed to create TAA program')

    gl.attachShader(this.blendProgram, vertShader)
    gl.attachShader(this.blendProgram, fragShader)
    gl.linkProgram(this.blendProgram)

    if (!gl.getProgramParameter(this.blendProgram, gl.LINK_STATUS)) {
      throw new Error('TAA program link failed: ' + gl.getProgramInfoLog(this.blendProgram))
    }

    // Get locations
    this.a_position = gl.getAttribLocation(this.blendProgram, 'a_position')
    this.u_currentColor = gl.getUniformLocation(this.blendProgram, 'u_currentColor')
    this.u_currentMovement = gl.getUniformLocation(this.blendProgram, 'u_currentMovement')
    this.u_historyColor = gl.getUniformLocation(this.blendProgram, 'u_historyColor')
    this.u_resolution = gl.getUniformLocation(this.blendProgram, 'u_resolution')
    this.u_blendAmount = gl.getUniformLocation(this.blendProgram, 'u_blendAmount')
    this.u_cameraMoving = gl.getUniformLocation(this.blendProgram, 'u_cameraMoving')

    // Create quad buffer
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ])

    this.quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)

    // Create framebuffers
    this.createFramebuffers()
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

  private createFramebuffers(): void {
    const gl = this.gl

    const width = this.canvas.width || 1
    const height = this.canvas.height || 1

    // Clean up old buffers if size changed
    if (this.currentFB && (this.fbWidth !== width || this.fbHeight !== height)) {
      gl.deleteFramebuffer(this.currentFB)
      gl.deleteFramebuffer(this.historyFB[0] ?? null)
      gl.deleteFramebuffer(this.historyFB[1] ?? null)
      gl.deleteTexture(this.currentColorTex)
      gl.deleteTexture(this.currentMovementTex)
      gl.deleteTexture(this.historyTex[0] ?? null)
      gl.deleteTexture(this.historyTex[1] ?? null)
      this.currentFB = null
      this.historyFB = [null, null]
      this.historyTex = [null, null]
    }

    if (this.currentFB) return

    this.fbWidth = width
    this.fbHeight = height

    // Helper to create texture (RGBA16F for history if available, RGBA8 fallback)
    const createTexture = (forHistory: boolean = false): WebGLTexture => {
      const tex = gl.createTexture()
      if (!tex) throw new Error('Failed to create texture')
      gl.bindTexture(gl.TEXTURE_2D, tex)
      if (forHistory && this.canRenderToFloat) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return tex
    }

    // Current frame FB with MRT (color + movement)
    this.currentColorTex = createTexture()
    this.currentMovementTex = createTexture()

    this.currentFB = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.currentFB)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.currentColorTex, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.currentMovementTex, 0)

    // Set draw buffers for MRT (WebGL2 native)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Current framebuffer incomplete')
    }

    // Create two history buffers for ping-pong (float16 for accumulation precision)
    for (let i = 0; i < 2; i++) {
      const historyTex = createTexture(true)
      const historyFB = gl.createFramebuffer()

      this.historyTex[i] = historyTex
      this.historyFB[i] = historyFB
      gl.bindFramebuffer(gl.FRAMEBUFFER, historyFB)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, historyTex, 0)

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error(`History framebuffer ${i} incomplete`)
      }

      // Initialize with alpha = 1 (signals "no valid data" / full override)
      gl.clearColor(0.0, 0.0, 0.0, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  /**
   * Set camera movement state (call before end())
   * When true, all pixels will use full override (no accumulation)
   */
  setCameraMoving(moving: boolean): void {
    this.cameraMoving = moving
  }

  /**
   * Begin rendering to current frame buffer with MRT
   */
  begin(): void {
    const gl = this.gl

    // Ensure framebuffers match canvas size
    if (this.canvas.width !== this.fbWidth || this.canvas.height !== this.fbHeight) {
      this.createFramebuffers()
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.currentFB)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.viewport(0, 0, this.fbWidth, this.fbHeight)

    // Clear both attachments
    gl.clearColor(0.12, 0.12, 0.12, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /**
   * End rendering, blend with history, output to screen
   */
  end(): void {
    const gl = this.gl
    if (!this.blendProgram) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }

    // Ping-pong: read from old history, write to new history
    const readIndex = 1 - this.writeIndex
    const writeHistoryFB = this.historyFB[this.writeIndex] ?? null
    const readHistoryTex = this.historyTex[readIndex] ?? null
    const writeHistoryTex = this.historyTex[this.writeIndex] ?? null

    // Render blended result to write history buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeHistoryFB)
    gl.viewport(0, 0, this.fbWidth, this.fbHeight)

    gl.useProgram(this.blendProgram)

    // Bind textures
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.currentColorTex)
    gl.uniform1i(this.u_currentColor, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.currentMovementTex)
    gl.uniform1i(this.u_currentMovement, 1)

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, readHistoryTex)
    gl.uniform1i(this.u_historyColor, 2)

    gl.uniform2f(this.u_resolution, this.fbWidth, this.fbHeight)
    gl.uniform1f(this.u_blendAmount, 0.12) // Base blend for static pixels
    gl.uniform1f(this.u_cameraMoving, this.cameraMoving ? 1.0 : 0.0)

    // Bind quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.a_position)
    gl.vertexAttribPointer(this.a_position, 2, gl.FLOAT, false, 0, 0)

    // Disable blending for TAA pass
    gl.disable(gl.BLEND)

    // Draw to write history (reading from read history - no feedback!)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Blit write history to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, writeHistoryTex)
    gl.uniform1i(this.u_currentColor, 0)
    gl.uniform1f(this.u_blendAmount, 1.0) // Full current for blit

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Re-enable blending for next frame
    gl.enable(gl.BLEND)

    // Swap buffers for next frame
    this.writeIndex = readIndex

    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  destroy(): void {
    const gl = this.gl

    if (this.currentFB) gl.deleteFramebuffer(this.currentFB)
    if (this.historyFB[0]) gl.deleteFramebuffer(this.historyFB[0] ?? null)
    if (this.historyFB[1]) gl.deleteFramebuffer(this.historyFB[1] ?? null)
    if (this.currentColorTex) gl.deleteTexture(this.currentColorTex)
    if (this.currentMovementTex) gl.deleteTexture(this.currentMovementTex)
    if (this.historyTex[0]) gl.deleteTexture(this.historyTex[0] ?? null)
    if (this.historyTex[1]) gl.deleteTexture(this.historyTex[1] ?? null)
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.blendProgram) gl.deleteProgram(this.blendProgram)
  }
}
