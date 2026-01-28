# WebGL Graph Rendering Architecture

## Overview

This document outlines the architecture for migrating from SVG to WebGL rendering for the aimparency graph visualization. The goal is to achieve 60fps with 10,000+ nodes through GPU-accelerated rendering.

## Design Principles

1. **Incremental Migration**: Coexist with SVG during development, allow fallback
2. **Separation of Concerns**: Layout engine (CPU) remains separate from renderer (GPU)
3. **Data-Oriented Design**: Minimize CPU-GPU data transfer
4. **Progressive Enhancement**: Start simple, add features incrementally

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                     Application Layer                    │
│  (Vue Components, Stores, User Interaction)             │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│                  Layout Engine (CPU)                     │
│  • Force simulation (useGraphSimulation)                │
│  • Collision detection (Sweep & Prune)                  │
│  • Spatial indexing (Quadtree/R-tree)                   │
│  • Position updates                                      │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ Node positions, edges
                 │
┌────────────────▼────────────────────────────────────────┐
│              WebGL Rendering System                      │
│  ┌──────────────────────────────────────────────┐      │
│  │  Viewport Culling (CPU)                      │      │
│  │  • Spatial tree query                        │      │
│  │  • Frustum culling                           │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                    │
│  ┌──────────────────▼───────────────────────────┐      │
│  │  Buffer Management                           │      │
│  │  • VBO upload/update                         │      │
│  │  • Double buffering                          │      │
│  │  • Attribute packing                         │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                    │
│  ┌──────────────────▼───────────────────────────┐      │
│  │  Rendering Pipeline                          │      │
│  │  • Node renderer (instanced circles)         │      │
│  │  • Arrow renderer (arc-based)                │      │
│  │  • Text renderer (SDF/texture atlas)         │      │
│  │  • Effects (selection, hover)                │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                    │
│  ┌──────────────────▼───────────────────────────┐      │
│  │  Interaction Layer (CPU)                     │      │
│  │  • Hit testing via spatial tree              │      │
│  │  • Hover detection                           │      │
│  │  • Selection handling                        │      │
│  └──────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

## Component Design

### 1. WebGL Renderer Core

#### Responsibilities
- Initialize WebGL context
- Manage shader programs
- Coordinate rendering pipeline
- Handle canvas resize
- Manage camera transform

#### Interface
```typescript
class WebGLGraphRenderer {
  constructor(canvas: HTMLCanvasElement, options?: RendererOptions)

  // Lifecycle
  init(): Promise<void>
  destroy(): void

  // Data updates
  updateNodes(nodes: NodeData[]): void
  updateEdges(edges: EdgeData[]): void

  // Camera
  setViewport(bounds: Bounds): void
  setZoom(zoom: number): void
  setPan(x: number, y: number): void

  // Rendering
  render(): void

  // Interaction
  pickNode(screenX: number, screenY: number): string | null
  pickEdge(screenX: number, screenY: number): EdgeId | null
}
```

### 2. Spatial Tree for Culling & Hit Testing

#### Purpose
- Fast viewport culling (only render visible elements)
- Fast hit testing for mouse interaction
- Reuse existing structure from layout engine if possible

#### Structure
```typescript
interface SpatialTree {
  // Build from node positions
  build(nodes: NodeData[]): void

  // Query visible nodes within bounds
  queryRegion(bounds: Bounds): string[]

  // Find node at screen position (with radius tolerance)
  queryPoint(x: number, y: number, radius: number): string | null

  // Update incrementally during animation
  update(nodeId: string, oldPos: Vec2, newPos: Vec2): void
}
```

#### Implementation Choice: Quadtree
- **Pros**: Simple, good for 2D, easy to understand
- **Cons**: Can be unbalanced with non-uniform distributions
- **Alternative**: R-tree (more complex, better for varied sizes)

### 3. Node Renderer

#### Rendering Approach: Instanced Rendering
- Single draw call for all visible nodes
- GPU handles per-instance transforms

#### Vertex Buffer Layout
```
Per-Instance Attributes (updated frequently):
- position: vec2 (x, y)
- radius: float
- color: vec3 (r, g, b) [packed as RGB]
- selected: float (0.0 or 1.0)

Per-Vertex Attributes (static):
- corner: vec2 (-1,-1), (1,-1), (-1,1), (1,1) [quad corners]
```

#### Shader Program
```glsl
// Vertex Shader
attribute vec2 a_corner;
attribute vec2 a_position;  // instanced
attribute float a_radius;    // instanced
attribute vec3 a_color;      // instanced
attribute float a_selected;  // instanced

uniform mat3 u_viewMatrix;
uniform vec2 u_viewport;

varying vec2 v_uv;
varying vec3 v_color;
varying float v_selected;

void main() {
  // Transform corner to world space
  vec2 worldPos = a_position + a_corner * a_radius;

  // Apply camera transform
  vec3 viewPos = u_viewMatrix * vec3(worldPos, 1.0);

  // Convert to NDC
  vec2 ndc = viewPos.xy / u_viewport * 2.0 - 1.0;
  ndc.y *= -1.0; // Flip Y

  gl_Position = vec4(ndc, 0.0, 1.0);

  v_uv = a_corner;
  v_color = a_color;
  v_selected = a_selected;
}

// Fragment Shader
varying vec2 v_uv;
varying vec3 v_color;
varying float v_selected;

void main() {
  // Draw circle (discard outside radius)
  float dist = length(v_uv);
  if (dist > 1.0) discard;

  // Apply selection stroke
  float strokeWidth = v_selected > 0.5 ? 0.15 : 0.0;
  float alpha = 1.0;
  if (dist > 1.0 - strokeWidth) {
    alpha = smoothstep(1.0, 1.0 - strokeWidth, dist);
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha); // White stroke
  } else {
    gl_FragColor = vec4(v_color, 1.0);
  }
}
```

### 4. Arrow Renderer (Arc-Based)

See `NEW_ARROWS.md` for detailed specification.

#### Key Points
- Two quads per arrow: trunk + head
- Fragment shader uses square distance checks
- Phase-based width tapering
- Instanced rendering for all arrows

#### Vertex Buffer Layout
```
Per-Instance Attributes:
- startPos: vec2
- endPos: vec2
- arcCenter1: vec2
- arcCenter2: vec2
- radiusInnerSq: float
- radiusOuterSq: float
- color: vec3
- opacity: float
```

### 5. Text Renderer

#### Approach: Signed Distance Field (SDF) Fonts

**Why SDF**:
- Resolution-independent (scale without blur)
- Single texture for all characters
- Efficient GPU rendering
- Sharp at any zoom level

**Pipeline**:
1. **Pre-processing** (build time):
   - Generate SDF texture atlas from font
   - Store character UV coordinates and metrics

2. **Runtime**:
   - Tessellate text to quads (one per character)
   - Upload positions + UVs to VBO
   - Sample SDF texture in fragment shader
   - Apply distance-based alpha

#### Alternative: Multi-Channel SDF (MSDF)
- Even sharper results
- Better for small text
- Slightly more complex shader

#### Fallback: Canvas-to-Texture
- Render text to canvas
- Upload as texture
- Update when text changes or zoom threshold crossed
- Simpler but less scalable

### 6. Buffer Management

#### Strategy: Double Buffering (Ping-Pong)
```typescript
class BufferManager {
  private frontBuffer: WebGLBuffer
  private backBuffer: WebGLBuffer

  // Update back buffer while front buffer is in use
  updatePositions(nodes: NodeData[]): void {
    // Write to backBuffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.backBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positionArray)
  }

  // Swap buffers after update complete
  swap(): void {
    [this.frontBuffer, this.backBuffer] = [this.backBuffer, this.frontBuffer]
  }
}
```

#### Optimization: Partial Updates
- Track which nodes moved (dirty flags)
- Only upload changed data
- Use `bufferSubData` instead of `bufferData`

### 7. Camera & Viewport Management

#### Coordinate Spaces
1. **World Space**: Node positions from layout engine
2. **View Space**: After camera transform (pan + zoom)
3. **Clip Space**: After projection
4. **Screen Space**: Final pixel coordinates

#### Transform Matrix
```typescript
// View matrix = Translation × Scale
const viewMatrix = mat3.create()
mat3.translate(viewMatrix, viewMatrix, [panX, panY])
mat3.scale(viewMatrix, viewMatrix, [zoom, zoom])
```

#### Frustum Culling
```typescript
function getViewBounds(viewport: Rect, viewMatrix: mat3): Bounds {
  // Transform viewport corners to world space
  const corners = [
    [0, 0],
    [viewport.width, 0],
    [viewport.width, viewport.height],
    [0, viewport.height]
  ]

  const invMatrix = mat3.invert(mat3.create(), viewMatrix)
  const worldCorners = corners.map(c =>
    vec2.transformMat3(vec2.create(), c, invMatrix)
  )

  // Compute axis-aligned bounding box
  return computeBounds(worldCorners)
}
```

### 8. Interaction Layer

#### Hit Testing
```typescript
class InteractionManager {
  constructor(
    private spatialTree: SpatialTree,
    private renderer: WebGLGraphRenderer
  ) {}

  // Convert screen coords to world coords
  screenToWorld(screenX: number, screenY: number): Vec2 {
    // Account for camera transform
    // ...
  }

  // Find node under cursor
  findNodeAt(screenX: number, screenY: number): string | null {
    const worldPos = this.screenToWorld(screenX, screenY)
    const tolerance = 10 / this.currentZoom // 10 pixels in world units
    return this.spatialTree.queryPoint(worldPos.x, worldPos.y, tolerance)
  }

  // Find edge near cursor
  findEdgeAt(screenX: number, screenY: number): EdgeId | null {
    // Query nearby edges from spatial tree
    // Check distance to edge path
    // Return closest if within tolerance
  }
}
```

**Why CPU hit testing**:
- Lower latency than GPU picking
- No need to read back pixels
- Reuses spatial tree from culling
- Simpler implementation

## Data Flow

### Initialization
1. Layout engine builds graph structure
2. Spatial tree is built from node positions
3. WebGL context initialized
4. Shader programs compiled
5. Vertex buffers allocated
6. Initial render

### Animation Loop (Force Simulation Active)
1. Layout engine updates node positions
2. Spatial tree updated incrementally
3. Viewport culling queries visible nodes
4. Positions uploaded to VBO (back buffer)
5. Buffer swap
6. Render frame (nodes → arrows → text)
7. Trigger next tick

### User Interaction
1. Mouse event captured
2. Screen coords → World coords
3. Spatial tree query for hit
4. Update selection state
5. Mark node VBO dirty
6. Re-render

### Zoom/Pan
1. Update camera matrix
2. Recompute view bounds
3. Query spatial tree for new visible set
4. Upload new visibility data
5. Render

## Performance Targets

### Target Frame Budget (60fps = 16.67ms)
- **Layout update**: 2-3ms
- **Culling query**: 0.5ms
- **Buffer update**: 1-2ms
- **Rendering**: 8-10ms
- **Interaction**: 1ms
- **Reserve**: 2-3ms

### Scalability Goals
| Nodes | Edges | FPS (Static) | FPS (Animating) |
|-------|-------|--------------|-----------------|
| 1,000 | 2,000 | 60 | 60 |
| 5,000 | 10,000 | 60 | 60 |
| 10,000 | 20,000 | 60 | 60 |
| 20,000 | 40,000 | 60 | 45+ |
| 50,000 | 100,000 | 45+ | 30+ |

## Implementation Phases

### Phase 1: Foundation (1-2 weeks)
- [ ] WebGL context setup
- [ ] Basic shader pipeline
- [ ] Node rendering (circles only, no text)
- [ ] Camera controls (pan/zoom)
- [ ] Integration with existing layout engine

**Deliverable**: Can render 5000+ circles at 60fps

### Phase 2: Culling & Interaction (1 week)
- [ ] Spatial tree implementation
- [ ] Viewport culling
- [ ] CPU-based hit testing
- [ ] Node selection/hover
- [ ] Performance benchmarks

**Deliverable**: 60fps with 10,000 nodes, working interaction

### Phase 3: Arrows (1-2 weeks)
- [ ] Arc-based arrow shader (per NEW_ARROWS.md)
- [ ] Arrow trunk rendering
- [ ] Arrow head rendering
- [ ] Arrow culling
- [ ] Weight visualization

**Deliverable**: Full graph with arrows at 60fps

### Phase 4: Text (1-2 weeks)
- [ ] SDF font generation
- [ ] Text atlas creation
- [ ] Text quad tessellation
- [ ] Text rendering shader
- [ ] Label culling (LOD)

**Deliverable**: Labels visible at appropriate zoom levels

### Phase 5: Polish (1 week)
- [ ] Selection effects
- [ ] Hover highlighting
- [ ] Smooth transitions
- [ ] Fallback to SVG for older browsers
- [ ] Performance optimization pass

**Deliverable**: Production-ready WebGL renderer

## Technology Choices

### Option 1: Raw WebGL (Recommended)
**Pros**:
- Full control over performance
- No library overhead
- Direct understanding of GPU pipeline
- Smaller bundle size

**Cons**:
- More verbose code
- Manual resource management
- Must implement own helpers

**Verdict**: Best for this use case - relatively simple rendering requirements, maximum performance needed

### Option 2: regl (Functional WebGL)
**Pros**:
- Simpler API than raw WebGL
- Functional paradigm reduces state bugs
- Still very close to metal
- Small library (~80KB)

**Cons**:
- Another dependency
- Slight abstraction overhead

**Verdict**: Good alternative if raw WebGL feels too low-level

### Option 3: three.js
**Pros**:
- Rich ecosystem
- Built-in 2D rendering
- Many examples

**Cons**:
- Large bundle size (~500KB)
- Designed for 3D
- Overhead for simple 2D needs
- Harder to optimize for specific use case

**Verdict**: Overkill for 2D graph rendering

### Option 4: pixi.js
**Pros**:
- Optimized for 2D
- Good performance
- Sprite batching
- Nice API

**Cons**:
- ~250KB bundle
- Scene graph overhead
- Less control over rendering pipeline

**Verdict**: Good for sprite-based 2D, but our needs are more specialized

## Risk Mitigation

### Compatibility
- **Risk**: WebGL not available on all browsers
- **Mitigation**: Feature detection + fallback to SVG
- **Detection**: `canvas.getContext('webgl') || canvas.getContext('experimental-webgl')`

### Memory
- **Risk**: Running out of VRAM with large graphs
- **Mitigation**: Progressive loading, LOD, texture compression
- **Monitoring**: Track buffer allocations, fail gracefully

### Shader Compilation
- **Risk**: Shader compilation errors on some GPUs
- **Mitigation**: Test on various hardware, provide fallback shaders
- **Development**: Shader validation tools, clear error messages

### Text Rendering
- **Risk**: SDF generation is complex
- **Mitigation**: Start with canvas-to-texture approach, upgrade to SDF later
- **Fallback**: Use HTML overlay for critical labels

## References & Resources

### WebGL Best Practices
- [MDN WebGL Tutorial](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial)
- [WebGL Fundamentals](https://webglfundamentals.org/)
- [WebGL2 Fundamentals](https://webgl2fundamentals.org/)

### Graph Visualization Examples
- [deck.gl](https://deck.gl/) - Large-scale geospatial visualization
- [Reagraph](https://reagraph.dev/) - WebGL graph visualization
- [El Grapho](https://www.elgrapho.com/) - High-performance graph engine

### SDF Text Rendering
- [Valve SDF Paper](https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf)
- [Multi-channel SDF](https://github.com/Chlumsky/msdfgen)
- [troika-three-text](https://github.com/protectwise/troika/tree/main/packages/troika-three-text)

### Performance
- [Rendering One Million Datapoints with D3 and WebGL](https://blog.scottlogic.com/2020/05/01/rendering-one-million-points-with-d3.html)
- [High-Performance Graphics](https://www.realtimerendering.com/)

## Appendix: Code Structure

```
packages/frontend/src/
├── webgl/
│   ├── core/
│   │   ├── WebGLRenderer.ts          # Main renderer class
│   │   ├── ShaderProgram.ts          # Shader compilation/linking
│   │   ├── BufferManager.ts          # VBO management
│   │   └── Camera.ts                 # View matrix management
│   ├── renderers/
│   │   ├── NodeRenderer.ts           # Circle rendering
│   │   ├── ArrowRenderer.ts          # Arc-based arrows
│   │   └── TextRenderer.ts           # SDF text
│   ├── spatial/
│   │   ├── SpatialTree.ts            # Quadtree/R-tree
│   │   └── InteractionManager.ts     # Hit testing
│   ├── shaders/
│   │   ├── node.vert.glsl
│   │   ├── node.frag.glsl
│   │   ├── arrow.vert.glsl
│   │   ├── arrow.frag.glsl
│   │   ├── text.vert.glsl
│   │   └── text.frag.glsl
│   └── utils/
│       ├── mat3.ts                   # 3x3 matrix math
│       └── vec2.ts                   # Vector math (existing)
└── composables/
    └── useWebGLGraphRenderer.ts      # Vue composable
```
