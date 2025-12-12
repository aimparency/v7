<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useDataStore } from '../stores/data'
import { 
  forceSimulation, 
  forceLink, 
    forceManyBody,
    forceCenter,
    forceCollide,
    forceY,
    type Simulation,
    type SimulationNodeDatum,
    type SimulationLinkDatum
  } from 'd3-force'
  import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom'
  import { select } from 'd3-selection'
  import 'd3-transition'
  import GraphNodeComponent from '../components/GraphNode.vue'
  import GraphLinkComponent from '../components/GraphLink.vue'
  import { useUIStore } from '../stores/ui'
  
  const dataStore = useDataStore()
  const uiStore = useUIStore()
  
  // Types for our graph data
  interface GraphNode extends SimulationNodeDatum {
    id: string
    text: string
    status: string
    r: number
    depth: number
  }
  
  interface GraphLink extends SimulationLinkDatum<GraphNode> {
    source: string | GraphNode
    target: string | GraphNode
    type: string
  }
  
  const svgRef = ref<SVGSVGElement>()
const contentRef = ref<SVGGElement>()
const width = ref(0)
const height = ref(0)

// Local state for simulation to preserve positions
const nodes = ref<GraphNode[]>([])
const links = ref<GraphLink[]>([])

let simulation: Simulation<GraphNode, GraphLink>
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>

const updateDimensions = () => {
  if (svgRef.value) {
    const rect = svgRef.value.getBoundingClientRect()
    width.value = rect.width
    height.value = rect.height
    
    if (simulation) {
      simulation.force('center', forceCenter(width.value / 2, height.value / 2))
      simulation.alpha(0.3).restart()
    }
  }
}

const onNodeClick = (node: GraphNode) => {
  uiStore.navigateToAim(node.id)
}

// Center view on selected aim
watch(() => uiStore.getCurrentAim(), (aim) => {
  if (aim && svgRef.value && width.value > 0) {
      const node = nodes.value.find(n => n.id === aim.id)
      if (node && zoomBehavior) {
        // Center view on node
        const scale = 1.5 // Zoom level
        // transform.x = width/2 - node.x * scale
        // transform.y = height/2 - node.y * scale
        const x = width.value / 2 - (node.x ?? 0) * scale
        const y = height.value / 2 - (node.y ?? 0) * scale
        const transform = zoomIdentity.translate(x, y).scale(scale)
        
        select(svgRef.value).transition().duration(750).call(zoomBehavior.transform, transform)
      }
  }
})

const updateSimulationData = () => {
  const { nodes: newNodes, links: newLinks } = dataStore.graphData
  
  // Merge new nodes with existing ones to preserve state (x, y, vx, vy)
  const nodeMap = new Map(nodes.value.map(n => [n.id, n]))
  
  const mergedNodes = newNodes.map(n => {
    const existing = nodeMap.get(n.id)
    if (existing) {
      // Update properties but keep position data
      return { ...existing, text: n.text, status: n.status, depth: n.depth }
    }
    return { ...n, r: 20 } as GraphNode // Default radius
  })
  
  nodes.value = mergedNodes
  
  // Links are simpler, just replace them (D3 handles object references)
  // We need to map source/target to IDs if they are objects, but d3 expects objects or IDs.
  // Since we replace links, d3 will re-initialize them.
  // To avoid jitter, we might want to preserve them too, but links usually don't store much state.
  links.value = newLinks.map(l => ({ ...l })) as GraphLink[]

  if (simulation) {
    simulation.nodes(nodes.value)
    const linkForce = simulation.force('link') as any
    if (linkForce) {
      linkForce.links(links.value)
    }
    simulation.alpha(1).restart()
  }
}

onMounted(() => {
  // Initialize simulation
  simulation = forceSimulation<GraphNode>(nodes.value)
    .force('link', forceLink<GraphNode, GraphLink>(links.value).id(d => d.id).distance(100))
    .force('charge', forceManyBody().strength(-300))
    .force('collide', forceCollide().radius(d => (d as GraphNode).r + 5))
    .force('center', forceCenter(width.value / 2, height.value / 2))
    .force('y', forceY<GraphNode>(d => height.value/4 + d.depth * 150).strength(0.3))
    .on('tick', () => {
      // Trigger Vue reactivity for position updates?
      // For performance with many nodes, we might want to avoid this 
      // and update DOM directly, but for < 500 nodes Vue 3 is usually fast enough.
      // However, we need to make sure 'nodes' ref is triggered.
      // D3 modifies the objects *inside* the array in place.
      // Vue's reactive proxy might intercept this, but deep watch is expensive.
      // A simpler way is to use a trigger ref.
      trigger.value++ 
    })

  // Initialize Zoom
  if (svgRef.value) {
    zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
         if (contentRef.value) {
           contentRef.value.setAttribute('transform', event.transform.toString())
         }
      })
    
    select(svgRef.value).call(zoomBehavior)
  }

  window.addEventListener('resize', updateDimensions)
  updateDimensions()
  
  // Initial data load
  updateSimulationData()
  
  // Ensure we have all data
  if (uiStore.projectPath) {
    dataStore.loadAllAims(uiStore.projectPath)
  }
})

onUnmounted(() => {
  if (simulation) simulation.stop()
  window.removeEventListener('resize', updateDimensions)
})

// Watch for store changes
watch(() => dataStore.graphData, updateSimulationData, { deep: true })

// Trigger for template updates
const trigger = ref(0)

// Computed helpers that depend on trigger to force re-render
const renderNodes = computed(() => {
  trigger.value // dependency
  return nodes.value
})

const renderLinks = computed(() => {
  trigger.value // dependency
  return links.value
})

// Drag behavior (simple implementation)
const draggedNode = ref<GraphNode | null>(null)
const isDragging = ref(false)

const startDrag = (event: MouseEvent | TouchEvent, node: GraphNode) => {
  event.preventDefault() // Prevent text selection/scroll
  event.stopPropagation() // Prevent zoom triggering
  if (!simulation) return
  simulation.alphaTarget(0.3).restart()
  node.fx = node.x
  node.fy = node.y
  draggedNode.value = node
  isDragging.value = false
  
  // Global listeners for drag move/end
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', onDragEnd)
}

const onDragMove = (event: MouseEvent) => {
  const node = draggedNode.value
  if (node && svgRef.value) {
    isDragging.value = true
    const rect = svgRef.value.getBoundingClientRect()
    // Mouse relative to SVG container
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    
    // Apply inverse transform
    const transform = zoomTransform(svgRef.value)
    const [simX, simY] = transform.invert([mouseX, mouseY])
    
    node.fx = simX
    node.fy = simY
  }
}

const onTouchMove = (event: TouchEvent) => {
  event.preventDefault()
  const node = draggedNode.value
  const touch = event.touches[0]
  if (node && svgRef.value && touch) {
    isDragging.value = true
    const rect = svgRef.value.getBoundingClientRect()
    const touchX = touch.clientX - rect.left
    const touchY = touch.clientY - rect.top
    
    const transform = zoomTransform(svgRef.value)
    const [simX, simY] = transform.invert([touchX, touchY])
    
    node.fx = simX
    node.fy = simY
  }
}

const onDragEnd = () => {
  if (!simulation) return
  simulation.alphaTarget(0)
  if (draggedNode.value) {
    if (!isDragging.value) {
        onNodeClick(draggedNode.value)
    }
    draggedNode.value.fx = null
    draggedNode.value.fy = null
    draggedNode.value = null
  }
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('touchmove', onTouchMove)
  document.removeEventListener('touchend', onDragEnd)
}

</script>

<template>
  <div class="graph-view">
    <svg ref="svgRef" width="100%" height="100%">
      <g ref="contentRef">
        <g class="links">
          <GraphLinkComponent 
            v-for="link in renderLinks" 
            :key="link.index"
            :link="link as any" 
          />
        </g>
        <g class="nodes">
          <GraphNodeComponent 
            v-for="node in renderNodes" 
            :key="node.id" 
            :node="node as any"
            @mousedown="startDrag($event, node)"
            @touchstart="startDrag($event, node)"
          />
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.graph-view {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  overflow: hidden;
}

.node-group {
  cursor: grab;
}

.node-group:active {
  cursor: grabbing;
}

.node-circle {
  transition: fill 0.3s;
}
</style>
