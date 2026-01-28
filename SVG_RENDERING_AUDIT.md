# SVG Rendering Performance Audit

## Executive Summary

The current graph visualization uses Vue 3 + SVG for rendering nodes and edges. This audit identifies performance bottlenecks that limit scalability to large graphs (5000+ nodes).

## Current Architecture

### Rendering Pipeline
1. **Data Flow**: `useGraphSimulation` → computed properties → Vue components → SVG DOM
2. **Node Rendering**: Individual `<GraphNodeComponent>` for each node
3. **Edge Rendering**: Individual `<GraphLinkComponent>` for each edge
4. **Layout Engine**: CPU-based force simulation with Sweep & Prune collision detection

### Component Structure
- **GraphView.vue**: Main container, handles transforms and orchestration
- **GraphNode.vue**: Renders circle + multi-line text labels
- **GraphLink.vue**: Renders curved paths using `makeCircularPath()`

## Identified Bottlenecks

### 1. **Vue Component Overhead** (HIGH IMPACT)
**Issue**: Each node and edge creates a separate Vue component instance.

**Impact**:
- For 1000 nodes: 1000+ component instances
- For 5000 nodes: 5000+ component instances + 10000+ edges = 15,000+ components
- Each component has reactive overhead (watchers, lifecycle hooks)
- Memory consumption scales linearly with node count

**Evidence**:
```vue
<!-- GraphView.vue lines 147-159 -->
<GraphNodeComponent
  v-for="node in renderNodes"
  :key="node.id"
  :node="node"
  :scale="node.scale"
  ...
/>
```

**Estimated Cost**: ~10ms per frame for 1000 nodes, ~50ms+ for 5000 nodes (below 60fps threshold of 16.67ms)

### 2. **Computed Property Recalculation** (MEDIUM-HIGH IMPACT)
**Issue**: `renderNodes` and `renderLinks` computed properties rebuild entire arrays on every simulation tick.

**Impact**:
- All node positions copied into new array each frame during animation
- `map()` operations create temporary arrays
- Affects memory allocation/GC pressure

**Evidence**:
```typescript
// GraphView.vue lines 72-82
const renderNodes = computed(() => {
  trigger.value;
  return nodes.value.map(n => ({
    ...n,  // Spreading all properties
    x: n.renderPos[0],
    y: n.renderPos[1],
    selected: n.id === currentAimId,
    scale: visualScale.value
  }))
})
```

**Estimated Cost**: ~2-5ms per frame for 1000 nodes

### 3. **SVG Path Generation** (MEDIUM IMPACT)
**Issue**: Each edge calls `makeCircularPath()` which generates SVG path string.

**Impact**:
- String concatenation and geometry calculations per edge per frame
- Bezier curve calculations for curved paths
- Path string parsing by browser

**Evidence**:
```typescript
// GraphLink.vue lines 34-50
const d = computed(() => {
  // ...
  return makeCircularPath(
    { pos: [source.x, source.y], r: fromR },
    width,
    { pos: [target.x, target.y], r: intoR }
  ) || ''
})
```

**Estimated Cost**: ~0.01ms per edge, ~100ms for 10000 edges

### 4. **Text Rendering** (MEDIUM IMPACT)
**Issue**: Multi-line text labels with dynamic line breaking and SVG `<tspan>` elements.

**Impact**:
- Word splitting and line calculation per node (CPU)
- Multiple `<tspan>` elements per label (4 lines max)
- SVG text rendering is slower than canvas/WebGL text

**Evidence**:
```typescript
// GraphNode.vue lines 41-67
const titleLines = computed(() => {
  const words = props.node.text.split(' ')
  const lines: string[] = []
  // ... line breaking logic
})
```

**Estimated Cost**: ~0.05ms per visible label, ~50ms for 1000 visible labels

### 5. **No Viewport Culling** (HIGH IMPACT)
**Issue**: All nodes and edges are rendered even when off-screen.

**Impact**:
- Rendering 10000 nodes when only 200 visible in viewport
- Wasted CPU/GPU cycles
- DOM tree contains all elements (memory overhead)

**Evidence**:
```typescript
// GraphLink.vue line 19
const isVisible = computed(() => {
  return true  // No actual culling!
})
```

**Estimated Cost**: 50-80% of rendering time wasted on off-screen elements

### 6. **CSS Transitions and Hover Effects** (LOW-MEDIUM IMPACT)
**Issue**: CSS transitions on stroke-width, opacity, fill-opacity per element.

**Impact**:
- Browser must track transition state for each element
- Hover effects trigger repaints
- `mix-blend-mode: lighten` on edges is expensive

**Evidence**:
```css
/* GraphNode.vue */
.node-circle {
  transition: stroke-width 0.2s ease-in-out;
}

/* GraphLink.vue */
.graph-link {
  transition: fill-opacity 0.3s, stroke 0.2s ease, opacity 0.2s ease;
  mix-blend-mode: lighten;
}
```

**Estimated Cost**: ~5-10ms per frame during transitions

### 7. **Label Visibility Calculation** (LOW IMPACT)
**Issue**: Per-node computation to determine if label should be visible based on zoom.

**Impact**:
- Simple calculation but runs for every node every frame
- Could be batched or computed once per zoom level

**Evidence**:
```typescript
// GraphNode.vue lines 18-24
const shouldShowLabel = computed(() => {
  const currentScale = props.scale || 1
  return (props.node.r * currentScale) > 20
})
```

**Estimated Cost**: ~0.5ms for 1000 nodes

## Performance Baseline Estimates

### Current Performance Profile

| Graph Size | Nodes | Edges | Est. FPS (Static) | Est. FPS (Animating) |
|------------|-------|-------|-------------------|----------------------|
| Small      | 100   | 200   | 60 fps            | 60 fps               |
| Medium     | 500   | 1000  | 45 fps            | 30 fps               |
| Large      | 1000  | 2000  | 25 fps            | 15 fps               |
| Very Large | 5000  | 10000 | 8 fps             | 3 fps                |

### Bottleneck Breakdown (for 1000 nodes, 2000 edges)
- Vue component overhead: ~50ms (40%)
- Computed property rebuilding: ~5ms (4%)
- SVG path generation: ~20ms (16%)
- Text rendering: ~25ms (20%)
- No culling overhead: ~25ms (20%)
- **Total frame time**: ~125ms (~8 FPS)

## Memory Usage

### Current Estimates
- **Per Node**: ~2-3KB (Vue component + DOM + reactive state)
- **Per Edge**: ~1-2KB
- **1000 nodes + 2000 edges**: ~5-7MB
- **5000 nodes + 10000 edges**: ~25-35MB

## Optimization Opportunities

### Immediate Wins (SVG Optimizations)
1. **Implement viewport culling**: Filter `renderNodes` and `renderLinks` based on viewport bounds
   - Expected improvement: 50-80% FPS boost when zoomed in
   - Implementation: Use spatial tree (quadtree) from layout engine

2. **Disable transitions during animation**: Add `.is-animating` class during force simulation
   - Expected improvement: 10-20% FPS boost during layout
   - Implementation: Simple class toggle

3. **Batch label visibility**: Calculate once per zoom level instead of per node
   - Expected improvement: 5-10% FPS boost
   - Implementation: Move computation to parent

### Long-term Solutions (WebGL Migration)
1. **WebGL rendering**: Replace SVG with WebGL for nodes and edges
   - Expected improvement: 10-50x FPS boost (60fps with 10000+ nodes)
   - Can render 100,000+ nodes at 60fps with proper culling

2. **Instanced rendering**: Use WebGL instancing for nodes (single draw call)
   - All nodes rendered in one GPU command

3. **Texture atlas for text**: Pre-render text labels to texture atlas
   - Or use SDF (Signed Distance Field) fonts for resolution-independent text

## Testing Recommendations

### Performance Profiling
1. Use Chrome DevTools Performance profiler to measure:
   - Frame time breakdown
   - JavaScript execution time
   - Style recalculation
   - Layout thrashing
   - Paint/Composite time

2. Test with synthetic datasets:
   - 100, 500, 1000, 2000, 5000, 10000 nodes
   - Measure FPS during:
     - Static rendering
     - Force simulation animation
     - Pan/zoom operations
     - Node hover/selection

3. Memory profiling:
   - Heap snapshots at different node counts
   - Check for memory leaks during data updates

### Target Metrics for WebGL Implementation
- **Static rendering**: 60fps with 10,000+ nodes
- **Animated layout**: 60fps with 5,000+ nodes
- **Memory**: <100MB for 10,000 nodes
- **Time to interactive**: <1 second for 5,000 nodes

## Recommendations

### Priority 1: Viewport Culling (Can do now with SVG)
Implement spatial tree-based culling to only render visible elements. This is the highest ROI optimization that doesn't require rewriting the renderer.

### Priority 2: Performance Baseline
Actually measure current performance with Chrome DevTools to validate these estimates and identify real bottlenecks.

### Priority 3: WebGL Migration Plan
Based on actual measurements, create detailed WebGL migration plan starting with:
1. Basic node rendering prototype
2. Arc-based arrows (as spec'd in NEW_ARROWS.md)
3. Text rendering solution
4. Full integration

## Appendix: Code Locations

### Files to Profile
- `packages/frontend/src/views/GraphView.vue` - Main orchestration
- `packages/frontend/src/components/GraphNode.vue` - Node rendering
- `packages/frontend/src/components/GraphLink.vue` - Edge rendering
- `packages/frontend/src/composables/useGraphSimulation.ts` - Layout engine

### Key Functions
- `updateGraphData()` - Data sync (line ~130)
- `renderNodes` computed - Node data prep (line 72)
- `renderLinks` computed - Edge data prep (line 84)
- `makeCircularPath()` - SVG path generation
- `sweepAndPrune()` - Collision detection (line 42)

## Next Steps

1. ✅ **Document current architecture** (this document)
2. ⏭️ **Run actual performance profiling** with Chrome DevTools
3. ⏭️ **Implement viewport culling** prototype
4. ⏭️ **Measure improvement** from culling
5. ⏭️ **Begin WebGL prototyping** based on real numbers
