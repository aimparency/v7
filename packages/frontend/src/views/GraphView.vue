<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import GraphNodeComponent from '../components/GraphNode.vue'
import GraphLinkComponent from '../components/GraphLink.vue'
import GraphConnector from '../components/GraphConnector.vue'
import GraphFlowHandle from '../components/GraphFlowHandle.vue'
import GraphSidePanel from '../components/GraphSidePanel.vue'
import * as vec2 from '../utils/vec2'
import { useGraphSimulation } from '../composables/useGraphSimulation'
import { useGraphInteraction } from '../composables/useGraphInteraction'

const dataStore = useDataStore()
const uiStore = useUIStore()
const mapStore = useMapStore()

const svgRef = ref<SVGSVGElement>()
const width = ref(0)
const height = ref(0)

// Composables
const simulation = useGraphSimulation()
const { nodes, links, trigger, randomizeLayout, semanticForceMultiplier, setSemanticForce } = simulation

const interaction = useGraphInteraction(svgRef, width, height, simulation)
const { onNodeDown, onNodeUp, onNodeClick, onBackgroundClick } = interaction

// Lifecycle
onMounted(() => {
    mapStore.isTracking = true
    simulation.init()
    interaction.initListeners()
    window.addEventListener('keydown', onKeydown)
})

watch(() => uiStore.graphSelectedAimId, () => {
    mapStore.isTracking = true
})

onUnmounted(() => {
    simulation.cleanup()
    interaction.cleanupListeners()
    window.removeEventListener('keydown', onKeydown)
})

const onKeydown = (e: KeyboardEvent) => {
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        uiStore.setGraphColorMode(uiStore.graphColorMode === 'status' ? 'priority' : 'status')
    }
}

// Rendering Computeds
const transform = computed(() => {
    trigger.value // dependency
    const cx = mapStore.clientOffset[0] + mapStore.halfSide
    const cy = mapStore.clientOffset[1] + mapStore.halfSide
    const s = mapStore.scale * mapStore.halfSide / LOGICAL_HALF_SIDE
    return `translate(${cx}, ${cy}) scale(${s}) translate(${mapStore.offset[0]}, ${mapStore.offset[1]})`
})

const renderNodes = computed(() => { 
    trigger.value; 
    const currentAimId = uiStore.graphSelectedAimId
    return nodes.value.map(n => ({
        ...n,
        x: n.renderPos[0],
        y: n.renderPos[1],
        selected: n.id === currentAimId
    })) 
})

const renderLinks = computed(() => { 
    trigger.value; 
    return links.value.map(l => ({
        source: { ...l.source, x: l.source.renderPos[0], y: l.source.renderPos[1] },
        target: { ...l.target, x: l.target.renderPos[0], y: l.target.renderPos[1] },
        weight: l.weight,
        share: l.share
    })) 
})

const selectedLinkData = computed(() => {
  trigger.value
  if (!uiStore.selectedLink) return null
  const link = links.value.find(l => 
    l.source.id === uiStore.selectedLink!.childId && 
    l.target.id === uiStore.selectedLink!.parentId
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
</script>

<template>
  <div class="graph-view">
    <svg ref="svgRef" width="100%" height="100%" @click="onBackgroundClick">
      <g :transform="transform">
        <g class="links">
          <GraphLinkComponent 
            v-for="(link, i) in renderLinks" 
            :key="i"
            :link="link" 
          />
        </g>
        <GraphConnector />
        <g class="nodes">
          <GraphNodeComponent 
            v-for="node in renderNodes" 
            :key="node.id" 
            :node="node"
            :selected="node.selected"
            @mousedown="onNodeDown($event, node as any)"
            @touchstart="onNodeDown($event, node as any)"
            @mouseup="onNodeUp(node as any)"
            @touchend="onNodeUp(node as any)"
            @click.stop="onNodeClick(node as any)"
          />
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
      <button class="control-btn" @click="dataStore.loadAllAims(uiStore.projectPath)" title="Reload Data">
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
      
      <div class="segmented-control">
        <button 
            class="segment-btn" 
            :class="{ active: uiStore.graphColorMode === 'status' }"
            @click="uiStore.setGraphColorMode('status')"
        >Status</button>
        <button 
            class="segment-btn" 
            :class="{ active: uiStore.graphColorMode === 'priority' }"
            @click="uiStore.setGraphColorMode('priority')"
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