# Dynamic VBO Buffer Management Strategy

## Problem Statement

During force-directed graph layout animation, node positions change every frame. The naive approach of calling `gl.bufferData()` for the entire dataset each frame is inefficient:

- Full buffer reallocation on GPU
- Potential GPU stalls waiting for previous frame
- Unnecessary data transfer for nodes that moved minimally
- Poor performance with 10,000+ nodes

**Goal**: Design a buffer management strategy that minimizes GPU overhead during animated layouts while maintaining 60 FPS.

## Strategy Comparison

### Strategy 1: Full Buffer Upload (Baseline)

```typescript
// Every frame
gl.bufferData(gl.ARRAY_BUFFER, allNodeData, gl.DYNAMIC_DRAW)
```

**Pros**:
- Simple implementation
- No state tracking needed

**Cons**:
- ❌ Reallocates buffer memory
- ❌ Transfers all data even if unchanged
- ❌ Can cause GPU stalls
- ❌ Poor performance at scale

**Performance**: ~5-10ms for 10,000 nodes

### Strategy 2: Partial Buffer Updates (bufferSubData)

```typescript
// Track which nodes moved
const dirtyNodes = getMovedNodes()

// Update only dirty regions
for (const node of dirtyNodes) {
  const offset = node.index * STRIDE * 4 // bytes
  gl.bufferSubData(gl.ARRAY_BUFFER, offset, node.data)
}
```

**Pros**:
- ✅ No reallocation
- ✅ Only updates changed data
- ✅ Better for sparse updates

**Cons**:
- ⚠️ Still can cause stalls if GPU is using buffer
- ⚠️ Many small updates can be slower than one large update
- ⚠️ Requires dirty tracking

**Performance**: ~2-5ms for 10,000 nodes (10% dirty)

**When to use**: When < 30% of nodes move each frame

### Strategy 3: Double Buffering (Ping-Pong) ⭐ RECOMMENDED

```typescript
class DoubleBuffer {
  private buffers: [WebGLBuffer, WebGLBuffer]
  private frontIndex: number = 0

  swap() {
    this.frontIndex = 1 - this.frontIndex
  }

  get front(): WebGLBuffer {
    return this.buffers[this.frontIndex]!
  }

  get back(): WebGLBuffer {
    return this.buffers[1 - this.frontIndex]!
  }
}

// Each frame:
// 1. Write to back buffer (GPU not using it)
gl.bindBuffer(gl.ARRAY_BUFFER, buffers.back)
gl.bufferSubData(gl.ARRAY_BUFFER, 0, newNodeData)

// 2. Render using front buffer
gl.bindBuffer(gl.ARRAY_BUFFER, buffers.front)
renderNodes()

// 3. Swap buffers
buffers.swap()
```

**Pros**:
- ✅ No GPU stalls - back buffer is idle
- ✅ Can upload data while GPU renders previous frame
- ✅ Predictable performance
- ✅ Works well with full or partial updates

**Cons**:
- ⚠️ 2x GPU memory for buffers
- ⚠️ Slightly more complex implementation

**Performance**: ~1-3ms for 10,000 nodes (full update)

**When to use**: During continuous animation (force layout, transitions)

### Strategy 4: Triple Buffering

Similar to double buffering but with 3 buffers for maximum throughput.

**Pros**:
- ✅ Maximum pipeline utilization

**Cons**:
- ❌ 3x memory overhead
- ❌ Overkill for most use cases
- ❌ Added complexity

**When to use**: Rarely needed for 2D graph rendering

## Recommended Implementation: Hybrid Approach

**Use double buffering during animation, single buffer when static.**

```typescript
class DynamicBufferManager {
  private singleBuffer: WebGLBuffer
  private doubleBuffers: DoubleBuffer | null = null
  private isAnimating: boolean = false
  private dirtyNodes: Set<number> = new Set()

  // Switch to animation mode
  startAnimation() {
    if (!this.isAnimating) {
      this.isAnimating = true
      this.doubleBuffers = new DoubleBuffer(this.gl)
      // Copy current buffer to both ping-pong buffers
      this.initializeDoubleBuffers()
    }
  }

  // Switch back to static mode
  stopAnimation() {
    if (this.isAnimating) {
      this.isAnimating = false
      // Copy final state back to single buffer
      this.finalizeDoubleBuffers()
      this.doubleBuffers?.destroy()
      this.doubleBuffers = null
    }
  }

  // Update buffer based on current mode
  updatePositions(nodes: NodeData[]) {
    if (this.isAnimating) {
      // Use double buffering - full update each frame
      this.updateDoubleBuffered(nodes)
    } else {
      // Use partial updates for static changes
      this.updatePartial(nodes)
    }
  }

  private updateDoubleBuffered(nodes: NodeData[]) {
    const data = packNodeData(nodes)

    // Write to back buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.doubleBuffers!.back)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)

    // Swap for next frame
    this.doubleBuffers!.swap()
  }

  private updatePartial(nodes: NodeData[]) {
    // Only update dirty nodes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.singleBuffer)

    for (const nodeId of this.dirtyNodes) {
      const node = nodes[nodeId]
      const offset = nodeId * STRIDE * 4
      const data = packSingleNode(node)
      gl.bufferSubData(gl.ARRAY_BUFFER, offset, data)
    }

    this.dirtyNodes.clear()
  }

  // Get current render buffer
  getRenderBuffer(): WebGLBuffer {
    if (this.isAnimating) {
      return this.doubleBuffers!.front
    }
    return this.singleBuffer
  }
}
```

## Implementation Details

### Buffer Allocation

```typescript
// Allocate buffers with expected maximum size
const MAX_NODES = 50000
const STRIDE = 7 // position(2) + radius(1) + color(3) + selected(1)
const BUFFER_SIZE = MAX_NODES * STRIDE * 4 // 4 bytes per float

// Single buffer
const singleBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, singleBuffer)
gl.bufferData(gl.ARRAY_BUFFER, BUFFER_SIZE, gl.DYNAMIC_DRAW)

// Double buffers (only create when needed)
const buffer1 = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer1)
gl.bufferData(gl.ARRAY_BUFFER, BUFFER_SIZE, gl.DYNAMIC_DRAW)

const buffer2 = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer2)
gl.bufferData(gl.ARRAY_BUFFER, BUFFER_SIZE, gl.DYNAMIC_DRAW)
```

### Dirty Tracking

```typescript
class DirtyTracker {
  private dirty: Set<number> = new Set()
  private previousPositions: Map<number, [number, number]> = new Map()

  // Check which nodes moved since last frame
  trackChanges(nodes: NodeData[]): Set<number> {
    this.dirty.clear()

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const prev = this.previousPositions.get(i)

      if (!prev || prev[0] !== node.x || prev[1] !== node.y) {
        this.dirty.add(i)
        this.previousPositions.set(i, [node.x, node.y])
      }
    }

    return this.dirty
  }

  // Check if enough nodes changed to justify full update
  shouldUseFullUpdate(totalNodes: number): boolean {
    const changeRatio = this.dirty.size / totalNodes
    return changeRatio > 0.3 // 30% threshold
  }
}
```

### Optimized Data Packing

```typescript
// Pre-allocate typed array to avoid garbage collection
class BufferPacker {
  private buffer: Float32Array
  private STRIDE = 7

  constructor(maxNodes: number) {
    this.buffer = new Float32Array(maxNodes * this.STRIDE)
  }

  // Pack all nodes into typed array
  packAll(nodes: NodeData[]): Float32Array {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const offset = i * this.STRIDE

      this.buffer[offset + 0] = node.x
      this.buffer[offset + 1] = node.y
      this.buffer[offset + 2] = node.r
      this.buffer[offset + 3] = node.color[0]
      this.buffer[offset + 4] = node.color[1]
      this.buffer[offset + 5] = node.color[2]
      this.buffer[offset + 6] = node.selected ? 1.0 : 0.0
    }

    // Return view of used portion
    return this.buffer.subarray(0, nodes.length * this.STRIDE)
  }

  // Pack single node (for partial updates)
  packOne(node: NodeData): Float32Array {
    const temp = new Float32Array(this.STRIDE)
    temp[0] = node.x
    temp[1] = node.y
    temp[2] = node.r
    temp[3] = node.color[0]
    temp[4] = node.color[1]
    temp[5] = node.color[2]
    temp[6] = node.selected ? 1.0 : 0.0
    return temp
  }
}
```

## Performance Benchmarks

### Expected Performance (10,000 nodes)

| Strategy | Static Updates | Animation (60 FPS) | Memory | Complexity |
|----------|----------------|-------------------|---------|------------|
| Full buffer upload | 8-10ms | 8-10ms | 1x | ⭐ |
| Partial updates (10% dirty) | 2-3ms | N/A | 1x | ⭐⭐ |
| Double buffering | 3-4ms | 1-3ms | 2x | ⭐⭐⭐ |
| Hybrid (recommended) | 2-3ms | 1-3ms | 1-2x | ⭐⭐⭐ |

### Frame Budget Breakdown (60 FPS = 16.67ms)

```
Animation frame (10,000 nodes):
├─ Layout update (CPU): 3-4ms
├─ Buffer update (GPU): 1-3ms  ← Our optimization target
├─ Culling query: 0.5ms
├─ Rendering: 8-10ms
└─ Reserve: 2-3ms
Total: ~15-20ms → 50-60 FPS ✅
```

## Integration with WebGLGraphRenderer

```typescript
export class WebGLGraphRenderer {
  private bufferManager: DynamicBufferManager

  // Call when force simulation starts
  onAnimationStart() {
    this.bufferManager.startAnimation()
  }

  // Call when force simulation stops
  onAnimationStop() {
    this.bufferManager.stopAnimation()
  }

  updateNodes(nodes: NodeData[]) {
    this.nodes = nodes
    this.bufferManager.updatePositions(nodes)
    this.updateSpatialTree(nodes)
  }

  render() {
    // ... existing code ...

    // Bind the appropriate buffer
    const renderBuffer = this.bufferManager.getRenderBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, renderBuffer)

    // ... rest of rendering ...
  }
}
```

## Memory Considerations

### Memory Usage Calculation

```
Single buffer: 50,000 nodes × 7 floats × 4 bytes = 1.4 MB
Double buffer: 50,000 nodes × 7 floats × 4 bytes × 2 = 2.8 MB

For typical graphs (< 10,000 nodes):
Single: 280 KB
Double: 560 KB

Verdict: Memory overhead is negligible
```

### When to Avoid Double Buffering

- Mobile devices with < 512 MB GPU memory
- Graphs with > 100,000 nodes
- No animation/transitions (use partial updates instead)

## Adaptive Strategy

```typescript
// Automatically choose best strategy
class AdaptiveBufferManager {
  private strategy: BufferStrategy

  selectStrategy(nodeCount: number, isAnimating: boolean, platform: Platform) {
    // Mobile with many nodes: use partial updates
    if (platform.isMobile && nodeCount > 20000) {
      return new PartialUpdateStrategy()
    }

    // Animating: use double buffering
    if (isAnimating) {
      return new DoubleBufferingStrategy()
    }

    // Static with few changes: use partial updates
    return new PartialUpdateStrategy()
  }
}
```

## Testing & Validation

### Performance Tests

```typescript
async function benchmarkBufferStrategies() {
  const strategies = [
    new FullBufferStrategy(),
    new PartialUpdateStrategy(),
    new DoubleBufferingStrategy()
  ]

  for (const strategy of strategies) {
    const times: number[] = []

    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      strategy.updateBuffer(testNodes)
      const end = performance.now()
      times.push(end - start)
    }

    const avg = times.reduce((a, b) => a + b) / times.length
    const p99 = times.sort()[99]!

    console.log(`${strategy.name}:`)
    console.log(`  Avg: ${avg.toFixed(2)}ms`)
    console.log(`  P99: ${p99.toFixed(2)}ms`)
  }
}
```

## Recommendations

1. **Implement hybrid approach** with automatic switching
2. **Use double buffering during force layout animation** (most common use case)
3. **Use partial updates for single node edits** (selection, drag)
4. **Pre-allocate buffers** to maximum expected size
5. **Monitor performance** and adjust thresholds based on real usage

## Next Steps

1. ✅ Strategy designed
2. ⬜ Implement DynamicBufferManager class
3. ⬜ Integrate with WebGLGraphRenderer
4. ⬜ Add performance monitoring
5. ⬜ Benchmark with real graph data
6. ⬜ Tune thresholds based on results
