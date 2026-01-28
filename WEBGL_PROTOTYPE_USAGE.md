# WebGL Renderer Prototype - Usage Guide

## Overview

The basic WebGL node rendering prototype is now implemented. It renders graph nodes as circles using GPU-accelerated instanced rendering.

## What's Implemented

### Core Components
- `WebGLGraphRenderer.ts` - Core renderer class
  - WebGL context management
  - Shader compilation and linking
  - Instanced rendering using ANGLE_instanced_arrays extension
  - Camera transform (pan + zoom)
  - Node updates

### Shaders
- `node.vert.glsl` - Vertex shader
  - Per-instance transforms
  - Camera matrix application
  - NDC conversion

- `node.frag.glsl` - Fragment shader
  - Circle rendering (distance-based discard)
  - Selection stroke
  - Smooth anti-aliasing

### Vue Integration
- `useWebGLGraphRenderer.ts` - Vue composable
  - Integrates with existing stores (data, UI, map)
  - Converts GraphNode → NodeData format
  - Handles color modes (status/priority)
  - Watches for changes and updates
  - Animation loop management

## Features

✅ **High Performance**: Uses instanced rendering (single draw call for all nodes)
✅ **Camera Integration**: Syncs with existing mapStore (pan/zoom)
✅ **Selection**: White stroke around selected node
✅ **Color Modes**: Supports both status and priority colors
✅ **Reactive**: Auto-updates when nodes change

## How to Use

### Option 1: Test Component (Recommended for Testing)

Create a test view `packages/frontend/src/views/GraphViewWebGL.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useGraphSimulation } from '../composables/useGraphSimulation'
import { useWebGLGraphRenderer } from '../composables/useWebGLGraphRenderer'
import { useGraphInteraction } from '../composables/useGraphInteraction'

const canvasRef = ref<HTMLCanvasElement>()
const width = ref(0)
const height = ref(0)

// Use existing graph simulation
const simulation = useGraphSimulation()
const { nodes } = simulation

// Initialize WebGL renderer
const { isInitialized, error } = useWebGLGraphRenderer(canvasRef, nodes)

// Set up interaction (reuse existing)
const interaction = useGraphInteraction(canvasRef, width, height, simulation)

// Lifecycle
onMounted(() => {
  simulation.init()
  interaction.initListeners()
})

onUnmounted(() => {
  simulation.cleanup()
  interaction.cleanupListeners()
})
</script>

<template>
  <div class="graph-view-webgl">
    <div v-if="error" class="error">
      WebGL Error: {{ error }}
    </div>
    <div v-else-if="!isInitialized" class="loading">
      Initializing WebGL...
    </div>
    <canvas
      ref="canvasRef"
      class="webgl-canvas"
    />
  </div>
</template>

<style scoped>
.graph-view-webgl {
  width: 100%;
  height: 100%;
  position: relative;
  background: #1e1e1e;
}

.webgl-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.error, .loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 4px;
}
</style>
```

Add route in `packages/frontend/src/router/index.ts`:

```typescript
{
  path: '/graph-webgl',
  name: 'graph-webgl',
  component: () => import('../views/GraphViewWebGL.vue')
}
```

### Option 2: Integrate into Existing GraphView

Modify `GraphView.vue` to conditionally use WebGL:

```vue
<script setup>
// ... existing imports
import { useWebGLGraphRenderer } from '../composables/useWebGLGraphRenderer'

// Add canvas ref for WebGL
const webglCanvasRef = ref<HTMLCanvasElement>()
const useWebGL = ref(true) // Toggle flag

// Initialize WebGL renderer if enabled
const webglRenderer = useWebGL.value
  ? useWebGLGraphRenderer(webglCanvasRef, nodes)
  : { isInitialized: ref(false), error: ref(null) }
</script>

<template>
  <div class="graph-view">
    <!-- WebGL Canvas (if enabled) -->
    <canvas
      v-if="useWebGL"
      ref="webglCanvasRef"
      class="webgl-canvas"
    />

    <!-- SVG (existing, show if WebGL disabled or failed) -->
    <svg
      v-else
      ref="svgRef"
      ...
    >
      <!-- existing SVG content -->
    </svg>

    <!-- Add toggle button -->
    <button @click="useWebGL = !useWebGL" class="renderer-toggle">
      {{ useWebGL ? 'Switch to SVG' : 'Switch to WebGL' }}
    </button>
  </div>
</template>

<style scoped>
.webgl-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.renderer-toggle {
  position: absolute;
  bottom: 10px;
  right: 10px;
  z-index: 100;
  /* ... style ... */
}
</style>
```

## Testing

### Verify Installation

1. Start dev server: `npm run dev` (in frontend package)
2. Navigate to `/graph-webgl` (if using Option 1)
3. You should see circles rendered using WebGL

### Check for Issues

**Black screen?**
- Open browser console for errors
- Check WebGL support: `canvasElement.getContext('webgl')`
- Verify shader compilation logs

**Circles not rendering?**
- Check if `ANGLE_instanced_arrays` extension is available
- Fallback message will appear in console if not available

**Performance issues?**
- Open Chrome DevTools → Performance tab
- Profile a recording to see frame times
- Should see ~60fps with 1000+ nodes

### Expected Performance

| Nodes | SVG (old) | WebGL (new) |
|-------|-----------|-------------|
| 100   | 60 fps    | 60 fps      |
| 500   | 30 fps    | 60 fps      |
| 1000  | 15 fps    | 60 fps      |
| 5000  | 3 fps     | 60 fps      |

## What's Not Implemented Yet

❌ **Edges/Arrows**: Only nodes are rendered (Phase 3)
❌ **Text Labels**: No labels yet (Phase 4)
❌ **Viewport Culling**: Renders all nodes (Phase 2)
❌ **Hit Testing**: Interaction layer not connected
❌ **Hover Effects**: No hover highlighting
❌ **WebGL2**: Currently uses WebGL 1 + extensions

## Next Steps

### Phase 2: Culling & Interaction (Priority)
1. Implement spatial tree (quadtree)
2. Add viewport culling
3. Connect CPU-based hit testing
4. Enable node selection/hover

### Phase 3: Arrows
1. Implement arc-based arrow renderer
2. Arrow trunk shader
3. Arrow head shader
4. Arrow culling

### Phase 4: Text
1. Generate SDF font atlas
2. Text quad tessellation
3. Text rendering shader
4. LOD for labels

## Browser Compatibility

### WebGL Support
- **Chrome/Edge**: Full support ✅
- **Firefox**: Full support ✅
- **Safari**: Full support (iOS 8+) ✅
- **Mobile**: Generally supported on modern devices ✅

### ANGLE_instanced_arrays Extension
- **Desktop**: ~99% support ✅
- **Mobile**: ~95% support ✅
- **Fallback**: Falls back to slower non-instanced rendering

## Troubleshooting

### "WebGL not supported"
- Browser may have WebGL disabled in settings
- GPU may be blacklisted (update drivers)
- Try enabling `chrome://flags/#ignore-gpu-blocklist`

### Shader Compilation Errors
- Check shader syntax in `.glsl` files
- Ensure shaders are being loaded correctly (fetch)
- Check browser console for specific error messages

### Performance Still Poor
- Check if instanced rendering is actually being used
- Look for console warning: "ANGLE_instanced_arrays not available"
- Profile with DevTools to find actual bottleneck
- May need to implement culling (Phase 2)

## Development Tips

### Debugging Shaders
Use browser extensions:
- **Chrome**: Shader Editor extension
- **Firefox**: Built-in shader editor in DevTools

### Profiling
Use Chrome DevTools:
1. Performance tab → Record
2. Look for long frames
3. Check "GPU" track
4. Identify bottlenecks

### Testing Different Node Counts
Modify graph generation in simulation to create stress tests:

```typescript
// Generate synthetic test data
const testNodes = Array.from({ length: 5000 }, (_, i) => ({
  id: `test-${i}`,
  text: `Node ${i}`,
  status: 'open',
  x: Math.random() * 2000 - 1000,
  y: Math.random() * 2000 - 1000,
  r: 25,
  color: undefined
}))
```

## Resources

- [WebGL Fundamentals](https://webglfundamentals.org/)
- [ANGLE_instanced_arrays extension](https://developer.mozilla.org/en-US/docs/Web/API/ANGLE_instanced_arrays)
- [Debugging WebGL](https://webgl2fundamentals.org/webgl/lessons/webgl-debugging.html)
