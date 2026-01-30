/**
 * Dynamic VBO Buffer Management
 *
 * Implements hybrid buffer update strategy:
 * - Double buffering (ping-pong) during animation for no GPU stalls
 * - Partial updates when static for minimal data transfer
 *
 * Based on VBO_BUFFER_STRATEGY.md
 */

export interface BufferConfig {
  maxItems: number
  stride: number // floats per item
  usage?: number // gl.STATIC_DRAW | gl.DYNAMIC_DRAW
}

/**
 * Double buffer (ping-pong) implementation
 */
class DoubleBuffer {
  private buffers: [WebGLBuffer, WebGLBuffer]
  private frontIndex: number = 0

  constructor(
    private gl: WebGLRenderingContext,
    private config: BufferConfig
  ) {
    const buffer1 = gl.createBuffer()
    const buffer2 = gl.createBuffer()
    if (!buffer1 || !buffer2) {
      throw new Error('Failed to create WebGL buffers')
    }

    this.buffers = [buffer1, buffer2]

    // Pre-allocate both buffers
    const bufferSize = config.maxItems * config.stride * 4 // 4 bytes per float
    const usage = config.usage ?? gl.DYNAMIC_DRAW

    for (const buffer of this.buffers) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, bufferSize, usage)
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  swap(): void {
    this.frontIndex = 1 - this.frontIndex
  }

  get front(): WebGLBuffer {
    return this.buffers[this.frontIndex]!
  }

  get back(): WebGLBuffer {
    return this.buffers[1 - this.frontIndex]!
  }

  destroy(): void {
    for (const buffer of this.buffers) {
      this.gl.deleteBuffer(buffer)
    }
  }
}

/**
 * Tracks which items changed since last frame
 */
class DirtyTracker {
  private dirty: Set<number> = new Set()
  private previousData: Float32Array | null = null

  /**
   * Track changes by comparing current data to previous frame
   * Returns set of changed item indices
   */
  trackChanges(data: Float32Array, stride: number): Set<number> {
    this.dirty.clear()

    if (!this.previousData || this.previousData.length !== data.length) {
      // First frame or size changed - everything is dirty
      this.previousData = new Float32Array(data)
      const itemCount = data.length / stride
      for (let i = 0; i < itemCount; i++) {
        this.dirty.add(i)
      }
      return this.dirty
    }

    // Compare each item
    const itemCount = data.length / stride
    for (let i = 0; i < itemCount; i++) {
      const offset = i * stride
      let changed = false

      // Check if any float in this item changed
      for (let j = 0; j < stride; j++) {
        if (data[offset + j] !== this.previousData[offset + j]) {
          changed = true
          break
        }
      }

      if (changed) {
        this.dirty.add(i)
      }
    }

    // Update previous data
    this.previousData.set(data)

    return this.dirty
  }

  /**
   * Check if enough items changed to justify full update
   */
  shouldUseFullUpdate(totalItems: number, threshold: number = 0.3): boolean {
    const changeRatio = this.dirty.size / totalItems
    return changeRatio > threshold
  }

  reset(): void {
    this.dirty.clear()
    this.previousData = null
  }
}

/**
 * Packs data into typed arrays for GPU upload
 */
export class BufferPacker {
  private buffer: Float32Array

  constructor(maxItems: number, private stride: number) {
    this.buffer = new Float32Array(maxItems * stride)
  }

  /**
   * Get the underlying buffer (reused to avoid allocations)
   */
  getBuffer(): Float32Array {
    return this.buffer
  }

  /**
   * Get a view of the buffer containing only the used portion
   */
  getView(itemCount: number): Float32Array {
    return this.buffer.subarray(0, itemCount * this.stride)
  }
}

/**
 * Dynamic buffer manager with automatic strategy selection
 */
export class DynamicBufferManager {
  private singleBuffer: WebGLBuffer
  private doubleBuffers: DoubleBuffer | null = null
  private isAnimating: boolean = false
  private dirtyTracker: DirtyTracker = new DirtyTracker()

  constructor(
    private gl: WebGLRenderingContext,
    private config: BufferConfig
  ) {
    // Create single buffer for static mode
    const buffer = gl.createBuffer()
    if (!buffer) {
      throw new Error('Failed to create WebGL buffer')
    }
    this.singleBuffer = buffer

    // Pre-allocate single buffer
    const bufferSize = config.maxItems * config.stride * 4
    const usage = config.usage ?? gl.DYNAMIC_DRAW

    gl.bindBuffer(gl.ARRAY_BUFFER, this.singleBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, bufferSize, usage)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  /**
   * Switch to animation mode (uses double buffering)
   */
  startAnimation(): void {
    if (!this.isAnimating) {
      this.isAnimating = true
      this.doubleBuffers = new DoubleBuffer(this.gl, this.config)

      // Copy current single buffer data to both double buffers
      // (In practice, the first update will populate them)
      this.dirtyTracker.reset()
    }
  }

  /**
   * Switch back to static mode (uses partial updates)
   */
  stopAnimation(): void {
    if (this.isAnimating) {
      this.isAnimating = false

      // Note: Current data is already in the double buffers
      // The next static update will use partial updates on single buffer

      if (this.doubleBuffers) {
        this.doubleBuffers.destroy()
        this.doubleBuffers = null
      }

      this.dirtyTracker.reset()
    }
  }

  /**
   * Update buffer with new data
   * Automatically chooses strategy based on animation state
   */
  updateBuffer(data: Float32Array): void {
    if (this.isAnimating) {
      this.updateDoubleBuffered(data)
    } else {
      this.updatePartial(data)
    }
  }

  /**
   * Double buffered update (for animation)
   * Writes to back buffer, then swaps
   */
  private updateDoubleBuffered(data: Float32Array): void {
    if (!this.doubleBuffers) return

    const gl = this.gl

    // Write to back buffer (GPU not using it)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.doubleBuffers.back)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)

    // Swap buffers for next frame
    this.doubleBuffers.swap()

    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  /**
   * Partial update (for static changes)
   * Only updates items that changed
   */
  private updatePartial(data: Float32Array): void {
    const gl = this.gl
    const itemCount = data.length / this.config.stride

    // Track which items changed
    const dirtyIndices = this.dirtyTracker.trackChanges(data, this.config.stride)

    // If too many items changed, do a full update instead
    if (this.dirtyTracker.shouldUseFullUpdate(itemCount)) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.singleBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      return
    }

    // Partial update: only changed items
    if (dirtyIndices.size > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.singleBuffer)

      for (const index of dirtyIndices) {
        const offset = index * this.config.stride
        const byteOffset = offset * 4 // 4 bytes per float
        const itemData = data.subarray(offset, offset + this.config.stride)
        gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, itemData)
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, null)
    }
  }

  /**
   * Get the current buffer to use for rendering
   */
  getRenderBuffer(): WebGLBuffer {
    if (this.isAnimating && this.doubleBuffers) {
      return this.doubleBuffers.front
    }
    return this.singleBuffer
  }

  /**
   * Check if currently in animation mode
   */
  isInAnimationMode(): boolean {
    return this.isAnimating
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.gl.deleteBuffer(this.singleBuffer)
    if (this.doubleBuffers) {
      this.doubleBuffers.destroy()
      this.doubleBuffers = null
    }
    this.dirtyTracker.reset()
  }
}

/**
 * Performance monitoring utilities
 */
export class BufferPerformanceMonitor {
  private updateTimes: number[] = []
  private maxSamples: number = 60

  recordUpdate(timeMs: number): void {
    this.updateTimes.push(timeMs)
    if (this.updateTimes.length > this.maxSamples) {
      this.updateTimes.shift()
    }
  }

  getAverageUpdateTime(): number {
    if (this.updateTimes.length === 0) return 0
    const sum = this.updateTimes.reduce((a, b) => a + b, 0)
    return sum / this.updateTimes.length
  }

  getP99UpdateTime(): number {
    if (this.updateTimes.length === 0) return 0
    const sorted = [...this.updateTimes].sort((a, b) => a - b)
    const p99Index = Math.floor(sorted.length * 0.99)
    return sorted[p99Index]!
  }

  reset(): void {
    this.updateTimes = []
  }

  getStats(): { avg: number; p99: number; samples: number } {
    return {
      avg: this.getAverageUpdateTime(),
      p99: this.getP99UpdateTime(),
      samples: this.updateTimes.length
    }
  }
}
