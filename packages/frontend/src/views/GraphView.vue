<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { useProjectStore } from '../stores/project-store'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import GraphFlowHandle from '../components/GraphFlowHandle.vue'
import GraphSidePanel from '../components/GraphSidePanel.vue'
import * as vec2 from '../utils/vec2'
import { useGraphSimulation } from '../composables/useGraphSimulation'
import { useGraphInteraction } from '../composables/useGraphInteraction'
import { useWebGLGraphRenderer } from '../composables/useWebGLGraphRenderer'
import { calculateArrowGeometry, hitTestArrow } from '../webgl/utils/arrow-geometry'

const dataStore = useDataStore()
const uiStore = useUIStore()
const graphUIStore = useGraphUIStore()
const projectStore = useProjectStore()
const mapStore = useMapStore()

const canvasRef = ref<HTMLCanvasElement>()
const svgOverlayRef = ref<SVGSVGElement>()
const width = ref(0)
const height = ref(0)

// Composables
const simulation = useGraphSimulation()
const { nodes, links, trigger, randomizeLayout, semanticForceMultiplier, setSemanticForce } = simulation

// WebGL renderer
const webglRenderer = useWebGLGraphRenderer(canvasRef, nodes, links)

// Use canvas for interaction (same API as SVG)
const interaction = useGraphInteraction(canvasRef, width, height, simulation)
const { onNodeDown, onNodeUp, onNodeClick, onBackgroundClick, onMouseDown, onMouseMove, onMouseUp, isZooming } = interaction

// Hit test helper - find node at physical position
function hitTestNode(physX: number, physY: number) {
  const logicalPos = mapStore.physicalToLogicalCoord([physX, physY])
  return nodes.value.find(node => {
    const dx = node.renderPos[0] - logicalPos[0]
    const dy = node.renderPos[1] - logicalPos[1]
    const distSq = dx * dx + dy * dy
    return distSq <= node.r * node.r
  })
}

// Hit test helper - find link at physical position (reverse order for front-to-back)
function hitTestLink(physX: number, physY: number) {
  const logicalPos = mapStore.physicalToLogicalCoord([physX, physY])
  const point = { x: logicalPos[0], y: logicalPos[1] }

  console.log('hitTestLink: physPos=', physX, physY, 'logicalPos=', point)

  // Iterate in reverse (last rendered = on top)
  for (let i = links.value.length - 1; i >= 0; i--) {
    const link = links.value[i]!
    const sourceNode = {
      x: link.source.renderPos[0],
      y: link.source.renderPos[1],
      r: link.source.r
    }
    const targetNode = {
      x: link.target.renderPos[0],
      y: link.target.renderPos[1],
      r: link.target.r
    }

    const geom = calculateArrowGeometry(sourceNode, targetNode, link.share ?? 0.5)

    console.log('  testing link', link.source.id, '->', link.target.id, 'arcCenter=', geom.arcCenter, 'centerRadius=', geom.centerRadius)

    // Debug first link only to avoid spam
    if (hitTestArrow(geom, point, i === links.value.length - 1)) {
      console.log('  HIT!')
      return link
    }
  }
  console.log('  no hit')
  return undefined
}

// Track node hit on mousedown for drag handling
let mouseDownNode: typeof nodes.value[0] | undefined = undefined

function handleCanvasMouseDown(e: MouseEvent) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  const physX = e.clientX - rect.left
  const physY = e.clientY - rect.top
  mouseDownNode = hitTestNode(physX, physY)

  if (mouseDownNode) {
    onNodeDown(e, mouseDownNode)
  }
}

function handleCanvasMouseUp(e: MouseEvent) {
  if (mouseDownNode) {
    const rect = canvasRef.value?.getBoundingClientRect()
    if (rect) {
      const physX = e.clientX - rect.left
      const physY = e.clientY - rect.top
      const releasedNode = hitTestNode(physX, physY)
      if (releasedNode) {
        onNodeUp(releasedNode)
      }
    }
  }
  mouseDownNode = undefined
}

function handleCanvasClick(e: MouseEvent) {
  // Skip hit tests if cursor moved (pan/drag ended) - just handle as background
  if (mapStore.cursorMoved) {
    onBackgroundClick()
    return
  }

  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return onBackgroundClick()

  const physX = e.clientX - rect.left
  const physY = e.clientY - rect.top

  // Nodes render on top of arrows, so test nodes first
  const clickedNode = hitTestNode(physX, physY)
  if (clickedNode) {
    onNodeClick(clickedNode)
    return
  }

  // Test links (arrows) if no node hit
  // Link goes from source (child) to target (parent), but selectLink expects (parentId, childId)
  const clickedLink = hitTestLink(physX, physY)
  if (clickedLink) {
    graphUIStore.selectLink(clickedLink.target.id, clickedLink.source.id)
    graphUIStore.setGraphSelection(null)
    return
  }

  onBackgroundClick()
}

// Lifecycle
onMounted(() => {
    mapStore.isTracking = true
    simulation.init()
    interaction.initListeners()
    window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
    simulation.cleanup()
    interaction.cleanupListeners()
    window.removeEventListener('keydown', onKeydown)
})

// Force WebGL update when simulation triggers
watch(trigger, () => {
    webglRenderer.forceUpdate()
})

const onKeydown = (e: KeyboardEvent) => {
    // Ignore if user is typing in an input or textarea
    const target = e.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    if (isInput) return

    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        graphUIStore.setGraphColorMode(graphUIStore.graphColorMode === 'status' ? 'priority' : 'status')
    }
}

// Rendering Computeds
const visualScale = computed(() => {
    return mapStore.scale * mapStore.halfSide / LOGICAL_HALF_SIDE
})

const transform = computed(() => {
    trigger.value // dependency
    const cx = mapStore.clientOffset[0] + mapStore.halfSide
    const cy = mapStore.clientOffset[1] + mapStore.halfSide
    const s = visualScale.value
    return `translate(${cx}, ${cy}) scale(${s}) translate(${mapStore.offset[0]}, ${mapStore.offset[1]})`
})

const renderNodes = computed(() => {
    trigger.value;
    const currentAimId = graphUIStore.graphSelectedAimId
    const activeAim = uiStore.getCurrentAim()
    return nodes.value.map(n => ({
        ...n,
        x: n.renderPos[0],
        y: n.renderPos[1],
        r: n.r,
        text: n.text,
        selected: n.id === currentAimId,
        active: n.id === activeAim?.id,
        scale: visualScale.value
    }))
})

const renderLinks = computed(() => { 
    trigger.value; 
    return links.value.map(l => ({
        source: { ...l.source, x: l.source.renderPos[0], y: l.source.renderPos[1] },
        target: { ...l.target, x: l.target.renderPos[0], y: l.target.renderPos[1] },
        weight: l.weight,
        share: l.share,
        scale: visualScale.value
    })) 
})

const selectedLinkData = computed(() => {
  trigger.value
  if (!graphUIStore.selectedLink) return null
  const link = links.value.find(l => 
    l.source.id === graphUIStore.selectedLink!.childId && 
    l.target.id === graphUIStore.selectedLink!.parentId
  )
  if (!link) return null
  return {
    ...link,
    relativePosition: [link.relativePosition[0], link.relativePosition[1]] as vec2.T
  }
})

const selectedLinkVisuals = computed(() => {
  trigger.value
  const link = selectedLinkData.value
  if (!link) return null
  return {
    sourcePos: [link.source.renderPos[0], link.source.renderPos[1]] as vec2.T,
    targetPos: [link.target.renderPos[0], link.target.renderPos[1]] as vec2.T,
    sourceR: link.source.r || 25,
    targetR: link.target.r || 25
  }
})

// Semantic Force UI Logic
const isSemanticForceActive = computed(() => simulation.targetSemanticForce.value > 0.5)
const startSemanticForce = () => setSemanticForce(true)
const stopSemanticForce = () => setSemanticForce(false)

// Helper: split node text into lines for label rendering
function getNodeTitleLines(text: string): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = words[0] || ''
  const maxChars = 12

  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    if (word === undefined) continue

    if (currentLine.length + 1 + word.length <= maxChars) {
      currentLine += (currentLine.length > 0 ? ' ' : '') + word
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }
  lines.push(currentLine)

  if (lines.length > 4) {
    lines.length = 3
    lines[2] += '...'
  }
  return lines
}
</script>

<template>
  <div class="graph-view">
    <!-- WebGL Canvas for nodes and edges -->
    <canvas
        ref="canvasRef"
        class="graph-canvas"
        @mousedown.capture="handleCanvasMouseDown"
        @mouseup.capture="handleCanvasMouseUp"
        @click="handleCanvasClick"
        :class="{ 'is-zooming': isZooming }"
    ></canvas>

    <!-- SVG Overlay for labels and interactive elements -->
    <svg
        ref="svgOverlayRef"
        class="graph-overlay"
        :class="{ 'hide-labels': !graphUIStore.graphShowLabels }"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
    >
      <g :transform="transform">
        <!-- Labels rendered as SVG text on top of WebGL -->
        <g class="labels" v-if="graphUIStore.graphShowLabels">
          <g
            v-for="node in renderNodes"
            :key="node.id"
            :transform="`translate(${node.x},${node.y})`"
            class="node-label-group"
            :class="{ selected: node.selected }"
            @mousedown="onNodeDown($event, node as any)"
            @touchstart="onNodeDown($event, node as any)"
            @mouseup="onNodeUp(node as any)"
            @touchend="onNodeUp(node as any)"
            @click.stop="onNodeClick(node as any)"
          >
            <g :transform="`scale(${node.r})`" v-if="node.r * node.scale > 20">
              <text
                dominant-baseline="central"
                text-anchor="middle"
                fill="#fff"
                font-size="0.25"
                class="node-label"
              >
                <tspan
                  v-for="(line, i) in getNodeTitleLines(node.text)"
                  :key="i"
                  x="0"
                  :dy="i === 0 ? (-(getNodeTitleLines(node.text).length - 1) * 0.6) + 'em' : '1.2em'"
                >
                  {{ line }}
                </tspan>
              </text>
            </g>
          </g>
        </g>
        <GraphFlowHandle
          v-if="selectedLinkData && selectedLinkVisuals"
          :link="selectedLinkData"
          :source-pos="selectedLinkVisuals.sourcePos"
          :target-pos="selectedLinkVisuals.targetPos"
          :source-r="selectedLinkVisuals.sourceR"
          :target-r="selectedLinkVisuals.targetR"
        />
      </g>
    </svg>
    <GraphSidePanel />
    <div class="top-controls">
      <button class="control-btn" @click="dataStore.loadAllAims(projectStore.projectPath)" title="Reload Data">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>
      <button class="control-btn" @click="randomizeLayout" title="Randomize Layout">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 3 21 3 21 8"></polyline>
          <line x1="4" y1="20" x2="21" y2="3"></line>
          <polyline points="21 16 21 21 16 21"></polyline>
          <line x1="15" y1="15" x2="21" y2="21"></line>
          <line x1="4" y1="4" x2="9" y2="9"></line>
        </svg>
      </button>
      <button 
        class="control-btn" 
        :class="{ active: isSemanticForceActive }"
        @mousedown="startSemanticForce"
        @mouseup="stopSemanticForce"
        @mouseleave="stopSemanticForce"
        @touchstart.prevent="startSemanticForce"
        @touchend.prevent="stopSemanticForce"
        title="Hold to Apply Semantic Force"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <circle cx="12" cy="12" r="10"></circle>
           <line x1="2" y1="12" x2="22" y2="12"></line>
           <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
      </button>

      <button 
        class="control-btn" 
        :class="{ active: graphUIStore.graphShowLabels }"
        @click="graphUIStore.toggleGraphShowLabels()"
        title="Toggle Labels"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M4 7V4h16v3"></path>
           <path d="M9 20h6"></path>
           <path d="M12 4v16"></path>
        </svg>
      </button>
      
      <div class="segmented-control">
        <button 
            class="segment-btn" 
            :class="{ active: graphUIStore.graphColorMode === 'status' }"
            @click="graphUIStore.setGraphColorMode('status')"
        >Status</button>
        <button 
            class="segment-btn" 
            :class="{ active: graphUIStore.graphColorMode === 'priority' }"
            @click="graphUIStore.setGraphColorMode('priority')"
        >Prio</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-view {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  overflow: hidden;
  position: relative;
}

.graph-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.graph-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.graph-overlay .labels {
  pointer-events: auto;
}

.node-label-group {
  cursor: pointer;
}

.node-label {
  pointer-events: none;
  user-select: none;
}

/* Optimize rendering while zooming */
.is-zooming .labels,
.hide-labels .labels {
    display: none;
}

.top-controls {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 10px;
  z-index: 100;
  align-items: center;
}

.control-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #fff;
  padding: 6px;
  opacity: 0.6;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.control-btn.active {
    opacity: 1;
    background: rgba(74, 222, 128, 0.2);
    border-color: rgba(74, 222, 128, 0.5);
    color: #4ade80;
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.2);
}

.segmented-control {
    display: flex;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 2px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.segment-btn {
    background: transparent;
    border: none;
    color: #888;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
}

.segment-btn:hover {
    color: #ccc;
}

.segment-btn.active {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-weight: 500;
}
</style>
