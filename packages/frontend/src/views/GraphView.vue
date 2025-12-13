<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, shallowRef } from 'vue'
import { useDataStore, type Aim } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom'
import { select } from 'd3-selection'
import 'd3-transition'
import GraphNodeComponent from '../components/GraphNode.vue'
import GraphLinkComponent from '../components/GraphLink.vue'
import * as vec2 from '../utils/vec2'
// @ts-ignore
import boxIntersect from 'box-intersect'

const dataStore = useDataStore()
const uiStore = useUIStore()

// Types matching Reference Logic
interface GraphNode {
  id: string
  text: string
  status: string
  r: number
  // Physics state
  pos: vec2.T
  shift: vec2.T
  color?: string
}

interface GraphLink {
  source: GraphNode
  target: GraphNode
  relativePosition: vec2.T
  weight: number
}

const svgRef = ref<SVGSVGElement>()
const contentRef = ref<SVGGElement>()
const width = ref(0)
const height = ref(0)

// Physics State
const nodes = shallowRef<GraphNode[]>([])
const links = shallowRef<GraphLink[]>([])
// Map for fast lookup
const nodeMap = new Map<string, GraphNode>()

let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>
let animFrameId: number | null = null

// --- Reference Constants ---
const OUTER_MARGIN_FACTOR = 2
const FLOW_FORCE = 0.5
const GLOBAL_FORCE = 0.14
const LOGICAL_HALF_SIDE = 100 // Reference default?
const NODE_RADIUS_BASE = 25 // Visual size

// --- Layout Engine (Ported from Map.vue) ---
const reusable = {
  r: [] as number[],
  pos: [] as vec2.T[],
  boxes: [] as number[][]
}

const hShift = vec2.create()

const layout = () => {
  const currentNodes = nodes.value
  const currentLinks = links.value
  const count = currentNodes.length
  
  if (count === 0) return

  // 1. Prepare Arrays
  const r = reusable.r
  const positions = reusable.pos
  const boxes = reusable.boxes
  
  // Resize arrays if needed
  if (r.length < count) {
    r.length = count
    positions.length = count
    boxes.length = count
  }

  // Reset shifts and fill physics arrays
  for (let i = 0; i < count; i++) {
    const n = currentNodes[i]!
    r[i] = n.r
    positions[i] = n.pos
    vec2.scale(n.shift, n.shift, 0) // Reset shift (inplace)
    
    // Bounding box for collision
    const br = n.r * OUTER_MARGIN_FACTOR
    boxes[i] = [n.pos[0] - br, n.pos[1] - br, n.pos[0] + br, n.pos[1] + br]
  }

  // 2. Flow Forces (Relative Position)
  const delta = vec2.create()
  const targetPos = vec2.create()
  const targetShift = vec2.create()

  for (const link of currentLinks) {
    const from = link.source
    const into = link.target
    
    const rSum = from.r + into.r
    
    // Calculate desired delta based on relativePosition and radii
    vec2.scale(delta, link.relativePosition, rSum)
    
    // Force on Into (Child/Target)
    vec2.add(targetPos, from.pos, delta)
    vec2.sub(targetShift, targetPos, into.pos)
    vec2.scale(targetShift, targetShift, from.r / rSum) // Weight by From radius
    vec2.add(into.shift, into.shift, targetShift)
    
    // Force on From (Parent/Source)
    vec2.sub(targetPos, into.pos, delta)
    vec2.sub(targetShift, targetPos, from.pos)
    vec2.scale(targetShift, targetShift, into.r / rSum) // Weight by Into radius
    vec2.add(from.shift, from.shift, targetShift)
  }

  // Apply Flow Force Strength
  for (let i = 0; i < count; i++) {
    const n = currentNodes[i]!
    vec2.scale(n.shift, n.shift, FLOW_FORCE)
  }

  // 3. Collisions (Box Intersect)
  const intersections = boxIntersect(boxes)
  const ab = vec2.create()
  
  for (const [iA, iB] of intersections) {
    // Only check if valid indices
    if (iA >= count || iB >= count) continue

    const nA = currentNodes[iA]!
    const nB = currentNodes[iB]!
    
    // Vector from A to B
    vec2.sub(ab, nB.pos, nA.pos)
    const rSum = nA.r + nB.r
    let d = vec2.len(ab)
    
    if (d === 0) {
      // Jitter if exact overlap
      const x = Math.random() * 2 - 1
      const y = Math.sqrt(1 - x * x) * (Math.random() > 0.5 ? 1 : -1)
      ab[0] = x * rSum; ab[1] = y * rSum
      d = rSum
    }
    
    // Hard collision (inner)
    if (d < rSum) {
      calcShiftAndApply(1, d, ab, nA.r, nB.r, rSum, nA.shift, nB.shift)
    }
    // Soft collision (outer margin)
    if (d < rSum * OUTER_MARGIN_FACTOR) {
      calcShiftAndApply(OUTER_MARGIN_FACTOR, d, ab, nA.r, nB.r, rSum, nA.shift, nB.shift)
    }
  }

  // 4. Global Force (Damping/Centering) & Apply Shifts
  let totalMovement = 0
  
  for (let i = 0; i < count; i++) {
    const n = currentNodes[i]!
    // Apply global force
    vec2.scale(n.shift, n.shift, GLOBAL_FORCE)
    
    // Check if dragging (pinned)
    if (draggedNode.value && draggedNode.value.id === n.id) {
       // Don't move dragged node via physics
       vec2.scale(n.shift, n.shift, 0)
    } else {
       vec2.add(n.pos, n.pos, n.shift)
       totalMovement += Math.abs(n.shift[0]) + Math.abs(n.shift[1])
    }
  }
  
  // Trigger Vue update
  trigger.value++
  
  animFrameId = requestAnimationFrame(layout)
}

const calcShiftAndApply = (
  marginFactor: number, 
  d: number, 
  ab: vec2.T, 
  rA: number, 
  rB: number, 
  rSum: number,
  shiftA: vec2.T, 
  shiftB: vec2.T
) => {
  const amount = (marginFactor - d / rSum) / rSum 

  vec2.scale(hShift, ab, -rB * amount) 
  vec2.add(shiftA, shiftA, hShift)

  vec2.scale(hShift, ab, +rA * amount) 
  vec2.add(shiftB, shiftB, hShift)
}

// --- Data Sync ---
const updateGraphData = () => {
  const { nodes: rawNodes, links: rawLinks } = dataStore.graphData
  
  // Resolve/Merge Nodes
  const newNodes: GraphNode[] = []
  
  rawNodes.forEach(raw => {
    let existing = nodeMap.get(raw.id)
    if (!existing) {
      existing = {
        id: raw.id,
        text: raw.text,
        status: raw.status,
        r: NODE_RADIUS_BASE,
        pos: [Math.random() * 100 - 50, Math.random() * 100 - 50],
        shift: [0, 0],
        color: undefined
      }
      nodeMap.set(raw.id, existing)
    } else {
      existing.text = raw.text
      existing.status = raw.status
    }
    newNodes.push(existing)
  })
  
  // Prune map
  if (nodeMap.size > newNodes.length) {
    const newIds = new Set(newNodes.map(n => n.id))
    for (const id of nodeMap.keys()) {
      if (!newIds.has(id)) nodeMap.delete(id)
    }
  }
  
  nodes.value = newNodes
  
  // Resolve Links
  const newLinks: GraphLink[] = []
  rawLinks.forEach(l => {
    const source = nodeMap.get(l.source)
    const target = nodeMap.get(l.target)
    if (source && target) {
      newLinks.push({
        source,
        target,
        relativePosition: l.relativePosition || [0, 0],
        weight: l.weight || 1
      })
    }
  })
  links.value = newLinks
  
  // Restart layout loop
  if (!animFrameId) layout()
}

// --- Interaction ---
const draggedNode = ref<GraphNode | null>(null)
const isDragging = ref(false)
const isUserInteracting = ref(false)

const startDrag = (event: MouseEvent | TouchEvent, node: GraphNode) => {
  event.preventDefault()
  event.stopPropagation()
  isDragging.value = false
  draggedNode.value = node
  
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', onDragEnd)
}

const onDragMove = (event: MouseEvent) => {
  const node = draggedNode.value
  if (node && svgRef.value) {
    isDragging.value = true
    isUserInteracting.value = true
    
    const rect = svgRef.value.getBoundingClientRect()
    const transform = zoomTransform(svgRef.value)
    const [x, y] = transform.invert([event.clientX - rect.left, event.clientY - rect.top])
    
    node.pos[0] = x
    node.pos[1] = y
  }
}

const onTouchMove = (event: TouchEvent) => {
  event.preventDefault()
  const node = draggedNode.value
  const touch = event.touches[0]
  if (node && svgRef.value && touch) {
    isDragging.value = true
    isUserInteracting.value = true
    
    const rect = svgRef.value.getBoundingClientRect()
    const transform = zoomTransform(svgRef.value)
    const [x, y] = transform.invert([touch.clientX - rect.left, touch.clientY - rect.top])
    
    node.pos[0] = x
    node.pos[1] = y
  }
}

const onDragEnd = () => {
  const node = draggedNode.value
  if (node) {
    if (isDragging.value) {
        // Drag finished
        links.value.forEach(link => {
            if (link.target === node) {
                const parent = link.source
                
                const deltaX = node.pos[0] - parent.pos[0]
                const deltaY = node.pos[1] - parent.pos[1]
                const rSum = parent.r + node.r 
                
                const relX = deltaX / rSum
                const relY = deltaY / rSum
                
                // Cast store to any to avoid type check error
                ;(dataStore as any).updateConnectionPosition(
                    uiStore.projectPath,
                    parent.id,
                    node.id,
                    [relX, relY]
                )
                link.relativePosition = [relX, relY]
            }
        })
    } else {
        onNodeClick(node)
    }
    draggedNode.value = null
  }
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('touchmove', onTouchMove)
  document.removeEventListener('touchend', onDragEnd)
}

const onNodeClick = (node: GraphNode) => {
  uiStore.navigateToAim(node.id)
}

// Camera Logic
watch(() => uiStore.getCurrentAim(), (aim) => {
  if (aim && svgRef.value && width.value > 0) {
      isUserInteracting.value = false 
      
      const node = nodeMap.get(aim.id)
      if (node && zoomBehavior) {
        const scale = 1.5
        const x = width.value / 2 - node.pos[0] * scale
        const y = height.value / 2 - node.pos[1] * scale
        const transform = zoomIdentity.translate(x, y).scale(scale)
        select(svgRef.value).transition().duration(750).call(zoomBehavior.transform, transform)
      }
  }
}, { immediate: true })

const updateDimensions = () => {
  if (svgRef.value) {
    const rect = svgRef.value.getBoundingClientRect()
    width.value = rect.width
    height.value = rect.height
  }
}

// --- Lifecycle ---
onMounted(() => {
  if (svgRef.value) {
    zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
         if (event.sourceEvent) isUserInteracting.value = true
         if (contentRef.value) {
           contentRef.value.setAttribute('transform', event.transform.toString())
         }
      })
    select(svgRef.value).call(zoomBehavior)
  }

  window.addEventListener('resize', updateDimensions)
  updateDimensions()
  
  layout()
  
  if (uiStore.projectPath) {
    dataStore.loadAllAims(uiStore.projectPath)
  }
  
  updateGraphData()
})

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  window.removeEventListener('resize', updateDimensions)
})

watch(() => dataStore.graphData, updateGraphData, { deep: true })

// Template Helpers
const trigger = ref(0)
const renderNodes = computed(() => { 
    trigger.value; 
    return nodes.value.map(n => ({
        ...n,
        x: n.pos[0],
        y: n.pos[1]
    })) 
})
const renderLinks = computed(() => { 
    trigger.value; 
    return links.value.map(l => ({
        source: { ...l.source, x: l.source.pos[0], y: l.source.pos[1] },
        target: { ...l.target, x: l.target.pos[0], y: l.target.pos[1] },
        weight: l.weight
    })) 
})
</script>

<template>
  <div class="graph-view">
    <svg ref="svgRef" width="100%" height="100%">
      <g ref="contentRef">
        <g class="links">
          <GraphLinkComponent 
            v-for="(link, i) in renderLinks" 
            :key="i"
            :link="link" 
          />
        </g>
        <g class="nodes">
          <GraphNodeComponent 
            v-for="node in renderNodes" 
            :key="node.id" 
            :node="node"
            @mousedown="startDrag($event, node as any)"
            @touchstart="startDrag($event, node as any)"
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