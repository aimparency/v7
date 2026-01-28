/**
 * WebGL Graph Renderer
 *
 * High-performance WebGL-based renderer for graph visualization.
 * Renders nodes as circles using instanced rendering.
 */

export interface NodeData {
  id: string
  x: number
  y: number
  r: number
  color: [number, number, number] // RGB 0-1
  selected: boolean
}

export interface RendererOptions {
  backgroundColor?: [number, number, number, number] // RGBA 0-1
}

export class WebGLGraphRenderer {
  private canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null

  // Buffers
  private quadBuffer: WebGLBuffer | null = null // Static quad corners
  private instanceBuffer: WebGLBuffer | null = null // Node data (positions, colors, etc.)

  // Attributes
  private a_corner: number = -1
  private a_position: number = -1
  private a_radius: number = -1
  private a_color: number = -1
  private a_selected: number = -1

  // Uniforms
  private u_viewMatrix: WebGLUniformLocation | null = null
  private u_viewportSize: WebGLUniformLocation | null = null

  // Camera state
  private viewMatrix: Float32Array = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ])

  // Data
  private nodes: NodeData[] = []
  private instanceData: Float32Array = new Float32Array(0)

  // Options
  private options: Required<RendererOptions>

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas
    this.options = {
      backgroundColor: options.backgroundColor || [0.12, 0.12, 0.12, 1.0]
    }
  }

  async init(): Promise<void> {
    // Get WebGL context
    this.gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      depth: false,
      preserveDrawingBuffer: false
    })

    if (!this.gl) {
      throw new Error('WebGL not supported')
    }

    const gl = this.gl

    // Load and compile shaders
    const vertexShader = await this.loadShader(gl.VERTEX_SHADER, '/src/webgl/shaders/node.vert.glsl')
    const fragmentShader = await this.loadShader(gl.FRAGMENT_SHADER, '/src/webgl/shaders/node.frag.glsl')

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

    // Get uniform locations
    this.u_viewMatrix = gl.getUniformLocation(this.program, 'u_viewMatrix')
    this.u_viewportSize = gl.getUniformLocation(this.program, 'u_viewportSize')

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

    // Create instance buffer (will be updated with node data)
    this.instanceBuffer = gl.createBuffer()

    // Enable blending for transparency
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Set clear color
    const bg = this.options.backgroundColor
    gl.clearColor(bg[0], bg[1], bg[2], bg[3])
  }

  private async loadShader(type: number, url: string): Promise<WebGLShader> {
    const gl = this.gl!
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

  updateNodes(nodes: NodeData[]): void {
    this.nodes = nodes

    // Pack node data into interleaved array
    // Format: [x, y, r, r, g, b, selected] per node (7 floats)
    const stride = 7
    this.instanceData = new Float32Array(nodes.length * stride)

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const offset = i * stride

      this.instanceData[offset + 0] = node.x
      this.instanceData[offset + 1] = node.y
      this.instanceData[offset + 2] = node.r
      this.instanceData[offset + 3] = node.color[0]
      this.instanceData[offset + 4] = node.color[1]
      this.instanceData[offset + 5] = node.color[2]
      this.instanceData[offset + 6] = node.selected ? 1.0 : 0.0
    }

    // Upload to GPU
    if (this.gl && this.instanceBuffer) {
      const gl = this.gl
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceData, gl.DYNAMIC_DRAW)
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

  render(): void {
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

    // Clear
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Use program
    gl.useProgram(this.program)

    // Set uniforms
    gl.uniformMatrix3fv(this.u_viewMatrix, false, this.viewMatrix)
    gl.uniform2f(this.u_viewportSize, this.canvas.width, this.canvas.height)

    // Bind quad vertices (per-vertex attribute)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.a_corner)
    gl.vertexAttribPointer(this.a_corner, 2, gl.FLOAT, false, 0, 0)

    // Bind instance data (per-instance attributes)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    const stride = 7 * 4 // 7 floats * 4 bytes

    gl.enableVertexAttribArray(this.a_position)
    gl.vertexAttribPointer(this.a_position, 2, gl.FLOAT, false, stride, 0)

    gl.enableVertexAttribArray(this.a_radius)
    gl.vertexAttribPointer(this.a_radius, 1, gl.FLOAT, false, stride, 2 * 4)

    gl.enableVertexAttribArray(this.a_color)
    gl.vertexAttribPointer(this.a_color, 3, gl.FLOAT, false, stride, 3 * 4)

    gl.enableVertexAttribArray(this.a_selected)
    gl.vertexAttribPointer(this.a_selected, 1, gl.FLOAT, false, stride, 6 * 4)

    // Draw instances
    // Note: WebGL 1.0 doesn't have instanced rendering built-in
    // We'll draw each node with a separate draw call for now
    // TODO: Use ANGLE_instanced_arrays extension or upgrade to WebGL2

    for (let i = 0; i < this.nodes.length; i++) {
      // Set instance-specific attributes by updating buffer slice
      // For now, we'll just draw all in one go with manual loop
      // This is a simplified version - proper instancing requires extension
    }

    // For initial prototype, draw using triangle strip (4 vertices = 2 triangles = quad)
    // We need to repeat this for each instance manually
    const ext = gl.getExtension('ANGLE_instanced_arrays')

    if (ext) {
      // Use instanced rendering if available
      ext.vertexAttribDivisorANGLE(this.a_position, 1)
      ext.vertexAttribDivisorANGLE(this.a_radius, 1)
      ext.vertexAttribDivisorANGLE(this.a_color, 1)
      ext.vertexAttribDivisorANGLE(this.a_selected, 1)

      ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, this.nodes.length)

      // Reset divisors
      ext.vertexAttribDivisorANGLE(this.a_position, 0)
      ext.vertexAttribDivisorANGLE(this.a_radius, 0)
      ext.vertexAttribDivisorANGLE(this.a_color, 0)
      ext.vertexAttribDivisorANGLE(this.a_selected, 0)
    } else {
      // Fallback: draw each instance manually
      console.warn('ANGLE_instanced_arrays not available, using slow fallback')
      // This would require restructuring the draw call
      // For now, just draw once (will only show first node)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
  }

  destroy(): void {
    if (!this.gl) return

    const gl = this.gl

    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer)
    if (this.program) gl.deleteProgram(this.program)

    this.gl = null
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas
  }
}
