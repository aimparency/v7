<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useDataStore } from '../stores/data'
import { 
  forceSimulation, 
  forceManyBody,
  forceCenter,
  forceCollide,
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
  relativePosition?: [number, number]
}

const svgRef = ref<SVGSVGElement>()
const contentRef = ref<SVGGElement>()
const width = ref(0)
const height = ref(0)

// Local state for simulation
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
        const scale = 1.5
        const x = width.value / 2 - (node.x ?? 0) * scale
        const y = height.value / 2 - (node.y ?? 0) * scale
        const transform = zoomIdentity.translate(x, y).scale(scale)
        select(svgRef.value).transition().duration(750).call(zoomBehavior.transform, transform)
      }
  }
})

const updateSimulationData = () => {
  const { nodes: newNodes, links: newLinks } = dataStore.graphData
  
  // Merge nodes to preserve state
  const nodeMap = new Map(nodes.value.map(n => [n.id, n]))
  const mergedNodes = newNodes.map(n => {
    const existing = nodeMap.get(n.id)
    if (existing) {
      return { ...existing, text: n.text, status: n.status, depth: n.depth }
    }
    return { ...n, r: 25 } as GraphNode
  })
  
  nodes.value = mergedNodes
  links.value = newLinks.map(l => ({ ...l })) as GraphLink[]

  if (simulation) {
    simulation.nodes(nodes.value)
    // No standard link force to update
    simulation.alpha(1).restart()
  }
}

// Custom Force: Relative Position
const forceRelativePosition = (alpha: number) => {
  // Strength factor - tune this
  const k = 0.5 * alpha 
  
  links.value.forEach((link) => {
    const source = link.source as GraphNode
    const target = link.target as GraphNode
    
    // Check if d3 has resolved references
    if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return

    // source = Parent, target = Child
    // relativePosition = [dx, dy] (Child relative to Parent? Or Parent relative to Child?)
    // In server/shared: relativePosition is stored on Parent->Child connection.
    // Let's assume standard vector math: Target = Source + Delta
    // So Delta = Target - Source.
    // If relativePosition is [1, 0], Target is to the right of Source.
    
    const rSum = (source.r || 25) + (target.r || 25) + 50 // + spacing
    const relPos = link.relativePosition || [0, 0]
    
    // Calculate desired position for Target (Child) relative to Source (Parent)
    // Note: If relativePosition is [0,0] (default), they overlap? 
    // If [0,0], we might want standard repulsion to handle it.
    // But if we want to enforce structure, we should use [0, 1] (child below parent) as default?
    // For now, respect the data.
    
    const targetX = source.x! + relPos[0] * rSum
    const targetY = source.y! + relPos[1] * rSum
    
    // Error vector
    const dx = targetX - target.x!
    const dy = targetY - target.y!
    
    // Apply forces
    // Move Target towards desired position
    // Move Source towards consistent position (reciprocal)
    
    const w = 0.5 // Equal weight
    
    if (!target.fx) {
      target.vx! += dx * k * w
      target.vy! += dy * k * w
    }
    if (!source.fx) {
      source.vx! -= dx * k * w
      source.vy! -= dy * k * w
    }
  })
}

onMounted(() => {
  // Initialize simulation with custom force
  simulation = forceSimulation<GraphNode>(nodes.value)
    .force('charge', forceManyBody().strength(-300)) // Repulsion
    .force('collide', forceCollide().radius(d => (d as GraphNode).r + 10).strength(0.8))
    .force('center', forceCenter(width.value / 2, height.value / 2).strength(0.05))
    // Add custom force
    .force('relative', forceRelativePosition) 
    .on('tick', () => {
      trigger.value++ 
    })

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
  updateSimulationData()
  
  if (uiStore.projectPath) {
    dataStore.loadAllAims(uiStore.projectPath)
  }
})

onUnmounted(() => {
  if (simulation) simulation.stop()
  window.removeEventListener('resize', updateDimensions)
})

watch(() => dataStore.graphData, updateSimulationData, { deep: true })

const trigger = ref(0)
const renderNodes = computed(() => { trigger.value; return nodes.value })
const renderLinks = computed(() => { trigger.value; return links.value })

// Drag logic
const draggedNode = ref<GraphNode | null>(null)
const isDragging = ref(false)

const startDrag = (event: MouseEvent | TouchEvent, node: GraphNode) => {
  event.preventDefault()
  event.stopPropagation()
  if (!simulation) return
  simulation.alphaTarget(0.3).restart()
  node.fx = node.x
  node.fy = node.y
  draggedNode.value = node
  isDragging.value = false
  
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
    const transform = zoomTransform(svgRef.value)
    const [simX, simY] = transform.invert([event.clientX - rect.left, event.clientY - rect.top])
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
    const transform = zoomTransform(svgRef.value)
    const [simX, simY] = transform.invert([touch.clientX - rect.left, touch.clientY - rect.top])
    node.fx = simX
    node.fy = simY
  }
}

const onDragEnd = () => {
  if (!simulation) return
  simulation.alphaTarget(0)
  
  const node = draggedNode.value
  if (node) {
    if (isDragging.value) {
        // Calculate and save new relative positions for all parents
        links.value.forEach(link => {
            const target = link.target as GraphNode
            const source = link.source as GraphNode
            
            if (target.id === node.id) {
                // This link is Parent (source) -> Child (node)
                // Update relativePosition on Parent
                
                // Use consistent radius/spacing logic
                const rSum = (source.r || 25) + (target.r || 25) + 50 
                
                const deltaX = node.x! - source.x!
                const deltaY = node.y! - source.y!
                
                const relX = deltaX / rSum
                const relY = deltaY / rSum
                
                // Update store
                dataStore.updateConnectionPosition(
                    uiStore.projectPath, 
                    source.id, 
                    node.id, 
                    [relX, relY]
                )
                
                // Update local link state immediately for smoothness
                link.relativePosition = [relX, relY]
            }
        })
    } else {
        onNodeClick(node)
    }
    node.fx = null
    node.fy = null
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
          <!-- TODO: Update GraphLink to support custom relative path rendering if needed -->
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
</style>