<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, shallowRef } from 'vue'
import { useDataStore, type Aim } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useMapStore, type MapNode, LOGICAL_HALF_SIDE } from '../stores/map'
import GraphNodeComponent from '../components/GraphNode.vue'
import GraphLinkComponent from '../components/GraphLink.vue'
import GraphConnector from '../components/GraphConnector.vue'
import GraphFlowHandle from '../components/GraphFlowHandle.vue'
import GraphSidePanel from '../components/GraphSidePanel.vue'
import * as vec2 from '../utils/vec2'
import { loadAllPositions, savePositions, loadCamera, saveCamera } from '../utils/db'

// Naive implementation to avoid 'box-intersect' dependency issues in browser (Buffer undefined)
function naiveBoxIntersect(boxes: number[][]) {
  const results = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a && b && a[2]! >= b[0]! && a[0]! <= b[2]! && a[3]! >= b[1]! && a[1]! <= b[3]!) {
        results.push([i, j])
      }
    }
  }
  return results
}

const dataStore = useDataStore()
const uiStore = useUIStore()
const mapStore = useMapStore()

// Types matching Reference Logic
interface GraphNode extends MapNode {
  text: string
  status: string
  value: number
  // Physics state
  shift: vec2.T
  color?: string
}

interface GraphLink {
  source: GraphNode
  target: GraphNode
  relativePosition: vec2.T
  weight: number
  share: number
}

const svgRef = ref<SVGSVGElement>()
const width = ref(0)
const height = ref(0)

// Physics State
const nodes = shallowRef<GraphNode[]>([])
const links = shallowRef<GraphLink[]>([])
const nodeMap = new Map<string, GraphNode>()

// Layouting State
const layoutingHandlePos = vec2.create()
const loadedPositions = new Map<string, { x: number, y: number }>()

let animFrameId: number | null = null
let saveIntervalId: number | null = null

// --- Constants ---
const OUTER_MARGIN_FACTOR = 2
const FLOW_FORCE = 0.5
const GLOBAL_FORCE = 0.14

// --- Map / Interaction Logic ---

const updateHalfSide = () => {
  if (!svgRef.value) return
  let w = svgRef.value.clientWidth 
  let h = svgRef.value.clientHeight
  width.value = w
  height.value = h
  if(w > h) {
    mapStore.clientOffset = [ (w - h) / 2, 0 ]
    mapStore.halfSide = h / 2
    mapStore.xratio = w/h
    mapStore.yratio = 1
  } else {
    mapStore.clientOffset = [ 0, (h - w) / 2 ]
    mapStore.halfSide = w / 2
    mapStore.xratio = 1
    mapStore.yratio = h/w
  }
}

const updatePan = (d: vec2.T) => {
  const pb = mapStore.panBeginning; 
  if(pb !== undefined) {
    // d is in physical coords
    // Convert to logical scale
    // Scale factor: LOGICAL_HALF_SIDE / (halfSide * scale)
    const s = LOGICAL_HALF_SIDE / (mapStore.halfSide * mapStore.scale)
    const scaledD = vec2.crScale(d, s)
    
    const offset = vec2.clone(pb.offset)
    vec2.sub(offset, offset, scaledD)
    mapStore.offset = offset  
  }
}

const updateDrag = (d: vec2.T) => {
  const db = mapStore.dragBeginning;
  const node = mapStore.dragCandidate as GraphNode; 
  if(db && node) {
    const s = LOGICAL_HALF_SIDE / (mapStore.halfSide * mapStore.scale)
    const scaledD = vec2.crScale(d, s)
    
    const pos = vec2.clone(db.pos)
    vec2.sub(pos, pos, scaledD) 
    node.pos = pos
  }
}

const updateLayout = (d: vec2.T) => {
  const lc = mapStore.layoutCandidate
  if(lc) {
    const s = LOGICAL_HALF_SIDE / (mapStore.halfSide * mapStore.scale)
    const scaledD = vec2.crScale(d, s)
    vec2.sub(layoutingHandlePos, lc.start, scaledD)
    
    updateRelativeDeltaWhileLayouting()
  }
}

const updateRelativeDeltaWhileLayouting = () => {
  const lc = mapStore.layoutCandidate
  if (mapStore.layouting && lc) {
    const link = lc.link as GraphLink
    const M = vec2.crMix(
      link.source.pos, 
      link.target.pos, 
      lc.fromWeight
    )
    const arm = vec2.crSub(layoutingHandlePos, M) 
    // lc.flow.backupRelativeData() // Not implementing backup/undo yet
    vec2.scale(link.relativePosition, arm, lc.dScale)
  }
}

const beginWhatever = (mouse: vec2.T) => {
  mapStore.isTracking = false
  mapStore.updateMouse(mouse) 
  mapStore.mousePhysBegin = vec2.clone(mouse)
  
  if(mapStore.dragCandidate) {
    mapStore.dragBeginning = {
      pos: vec2.clone(mapStore.dragCandidate.pos) 
    }
  } else if (mapStore.layoutCandidate) {
    updateLayout(vec2.create())
  } else if (mapStore.connectFrom) {
    // connecting - just let updateWhatever update mouse pos
  } else {
    mapStore.panBeginning = {
      offset: vec2.clone(mapStore.offset)
    }
  } 
}

const endWhatever = () => {
  if(mapStore.panBeginning) {
    mapStore.panBeginning = undefined
  } else if (mapStore.dragBeginning) {
    // If dragged, update relative position for all links pointing to this node
    const node = mapStore.dragCandidate as GraphNode
    if (node && links.value) {
       links.value.forEach(link => {
            if (link.target === node) {
                const parent = link.source
                
                const deltaX = node.pos[0] - parent.pos[0]
                const deltaY = node.pos[1] - parent.pos[1]
                const rSum = parent.r + node.r 
                
                const relX = deltaX / rSum
                const relY = deltaY / rSum
                
                // Update Store
                ;(dataStore as any).updateConnectionPosition(
                    uiStore.projectPath,
                    parent.id,
                    node.id,
                    [relX, relY]
                )
                link.relativePosition = [relX, relY]
            }
        })
    }
    
    mapStore.dragBeginning = undefined
    mapStore.dragCandidate = undefined
  } else if (mapStore.layouting) {
    const lc = mapStore.layoutCandidate
    if (lc) {
      const link = lc.link as GraphLink
      // Persist change
      ;(dataStore as any).updateConnectionPosition(
          uiStore.projectPath,
          link.source.id,
          link.target.id,
          [link.relativePosition[0], link.relativePosition[1]]
      )
    }
    mapStore.layouting = false
    mapStore.layoutCandidate = undefined
  } else if (mapStore.connecting) {
    mapStore.connecting = false
    mapStore.connectFrom = undefined
  }
  
  setTimeout(() => { mapStore.cursorMoved = false })
}

const updateWhatever = (mouse: vec2.T) => {
  mapStore.updateMouse(mouse)
  const d = vec2.crSub(mapStore.mousePhysBegin, mouse)
  
  if(vec2.len2(d) > 25 || mapStore.cursorMoved) {
    let actionOngoing = true
    if(mapStore.panBeginning) {
      updatePan(d); 
    } else if (mapStore.dragBeginning) {
      updateDrag(d); 
    } else if (mapStore.layouting) {
      updateLayout(d);
    } else if (mapStore.connecting) {
      // Just update mouse pos (already done), but keep actionOngoing true
    } else {
      actionOngoing = false
    }
    if(actionOngoing) {
      mapStore.cursorMoved = true
      mapStore.stopAnim()
    }
  }
}

// Helper to get local coordinates
const getLocalPos = (clientX: number, clientY: number) => {
  if (!svgRef.value) return vec2.fromValues(0, 0)
  const rect = svgRef.value.getBoundingClientRect()
  return vec2.fromValues(clientX - rect.left, clientY - rect.top)
}

// Event Handlers
const onMouseMove = (e: MouseEvent) => {
  updateWhatever(getLocalPos(e.clientX, e.clientY))
}
const onMouseDown = (e: MouseEvent) => {
  const mouse = getLocalPos(e.clientX, e.clientY)
  beginWhatever(mouse)
}
const onMouseUp = () => endWhatever()
const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  mapStore.isTracking = false
  const mouse = getLocalPos(e.clientX, e.clientY)
  const f = Math.pow(1.1, -e.deltaY / 150)
  mapStore.zoom(f, mouse)
}

// Touch Handling
let touchState = {
  currentCount: 0, 
  dragFingerId: 0, 
}
let pinchBeginning: undefined | {
  first: number, 
  second: number, 
  mLogical: vec2.T, 
  distancePage: number, 
  offset: vec2.T, 
  scale: number, 
};

const onTouchStart = (e: TouchEvent) => {
  if(e.touches.length > 0) {
    if(e.touches.length > 1) {
      // 2 or more touches         
      if(touchState.currentCount < 2) {
        mapStore.connectFrom = undefined
        touchState.currentCount = 2
        
        const t1 = e.touches[0]!
        const t2 = e.touches[1]!
        
        // page coordinates
        let firstPage = getLocalPos(t1.clientX, t1.clientY)
        let secondPage = getLocalPos(t2.clientX, t2.clientY)
        let mPhysical = vec2.clone(firstPage) 
        vec2.add(mPhysical, mPhysical, secondPage) 
        vec2.scale(mPhysical, mPhysical, 0.5) 
        let mLogical = mapStore.physicalToLogicalCoord(mPhysical) 
        // model/svg coordinates
        pinchBeginning = {
          first: t1.identifier, 
          second: t2.identifier, 
          mLogical, 
          distancePage: vec2.dist(firstPage, secondPage), 
          offset: vec2.clone(mapStore.offset), 
          scale: mapStore.scale
        }
      } 
    } else {
      // 1 touch
      if(touchState.currentCount == 0) {
        // new touch 
        touchState.currentCount = 1
        const t = e.touches[0]!
        touchState.dragFingerId = t.identifier
        let mouse = getLocalPos(t.clientX, t.clientY)
        beginWhatever(mouse)
      } else if (touchState.currentCount > 1) {
        // from 2 or more to 1
        pinchBeginning = undefined // end pinch
      }
    }
  }
}

const onTouchMove = (e: TouchEvent) => {
  e.preventDefault()
  if(touchState.currentCount == 1) {
    // Check if we have at least one touch
    if (e.touches.length > 0) {
        const t = e.touches[0]!
        let mouse = getLocalPos(t.clientX, t.clientY)
        updateWhatever(mouse)
    }
  } else if (touchState.currentCount > 1) {
    if(pinchBeginning && e.touches.length > 1) {
      // update pinch
      const t1 = e.touches[0]!
      const t2 = e.touches[1]!
      
      let firstPage = getLocalPos(t1.clientX, t1.clientY)
      let secondPage = getLocalPos(t2.clientX, t2.clientY)
      let distancePage = vec2.dist(firstPage, secondPage)

      let mPhysical = vec2.clone(firstPage) 
      vec2.add(mPhysical, mPhysical, secondPage) 
      vec2.scale(mPhysical, mPhysical, 0.5) 
      let mLogical = mapStore.physicalToLogicalCoord(mPhysical) 

      // 
      let scaleChange = distancePage / pinchBeginning.distancePage 
      mapStore.scale = pinchBeginning.scale * scaleChange

      vec2.sub(mLogical, mLogical, pinchBeginning.mLogical) 

      vec2.add(mapStore.offset, mapStore.offset, mLogical) 
    }
  }
}

const onTouchEnd = (e: TouchEvent) => {
  if(touchState.currentCount > 1) {
    pinchBeginning = undefined
  } 
  if(touchState.currentCount > 0) {
    endWhatever()
  }
  touchState.currentCount = 0
}

import { trpc } from '../trpc'

// ...

// Node Interaction
const onNodeDown = (e: MouseEvent | TouchEvent, nodeCopy: GraphNode) => {
  const node = nodeMap.get(nodeCopy.id)
  if (!node) return

  const selectedId = uiStore.graphSelectedAimId
  if (selectedId && selectedId === node.id) {
    // Already selected -> start connecting
    mapStore.startConnecting(node)
  } else {
    // Not selected -> start dragging
    mapStore.startDragging(node)
  }
}

const onNodeUp = async (node: GraphNode) => {
  if (mapStore.connecting && mapStore.connectFrom) {
    if (mapStore.connectFrom.id !== node.id) {
      // Calculate relative position
      // DragFrom = Child (Supporting), DragTo = Parent (Supported)
      const child = mapStore.connectFrom
      const parent = node
      
      // Vector from Parent to Child (as expected by backend/store)
      const deltaX = child.pos[0] - parent.pos[0]
      const deltaY = child.pos[1] - parent.pos[1]
      const rSum = parent.r + child.r
      const relativePosition: [number, number] = [deltaX / rSum, deltaY / rSum]

      // Create connection
      try {
        await trpc.aim.connectAims.mutate({
            projectPath: uiStore.projectPath,
            parentAimId: parent.id,
            childAimId: child.id,
            relativePosition,
            // Indexes default
        })
        // Reload parent (node) to update UI
        const updatedParent = await trpc.aim.get.query({
            projectPath: uiStore.projectPath,
            aimId: parent.id
        })
        dataStore.replaceAim(parent.id, updatedParent)
        dataStore.recalculateValues()
      } catch (e) {
        console.error('Failed to connect aims:', e)
      }
    }
  }
}

const onNodeClick = async (node: GraphNode) => {
  // Debug Logging
  console.log(`Node Selected: ${node.text} (${node.id})`)
  console.log(`- Radius: ${node.r}`)
  console.log(`- Value: ${node.value}`)
  
  const connectedLinks = links.value.filter(l => l.source.id === node.id || l.target.id === node.id)
  console.log(`- Links (${connectedLinks.length}):`)
  connectedLinks.forEach(l => {
    const isSource = l.source.id === node.id
    const other = isSource ? l.target : l.source
    const width = 1.0 * (l.target.r || 25) * (l.share || 0)
    console.log(`  * ${isSource ? '->' : '<-'} ${other.text} (${other.id})`)
    console.log(`    - Share: ${l.share?.toFixed(3)}`)
    console.log(`    - Weight: ${l.weight}`)
    console.log(`    - Target R: ${l.target.r}`)
    console.log(`    - Width: ${width.toFixed(1)}`)
  })

  if (!mapStore.cursorMoved) {
    uiStore.setGraphSelection(node.id)
    uiStore.deselectLink()
  }
}

const onBackgroundClick = () => {
  if (!mapStore.cursorMoved && !mapStore.connecting) {
    uiStore.deselectLink()
    uiStore.setGraphSelection(null)
  }
}

// --- Layout ---
const reusable = {
  r: [] as number[],
  pos: [] as vec2.T[],
  boxes: [] as number[][]
}

const hShift = vec2.create()

const layout = () => {
  if (mapStore.anim.update) {
    mapStore.anim.update()
  }
  
  // Continuously update relative position if layouting (handle drag) is active
  if (mapStore.layouting) {
    updateRelativeDeltaWhileLayouting()
  }

  // Camera Smooth Pan (User requested ease out)
  // If not interacting and no active anim
  if (!mapStore.panBeginning && !mapStore.dragBeginning && !mapStore.anim.update && mapStore.isTracking) {
     const currentAimId = uiStore.graphSelectedAimId
     if (currentAimId) {
       const node = nodeMap.get(currentAimId)
       if (node) {
         // Target: center node. Offset = -node.pos
         const targetX = -node.pos[0]
         const targetY = -node.pos[1]
         
         const dx = targetX - mapStore.offset[0]
         const dy = targetY - mapStore.offset[1]
         
         // Threshold to stop micro-movements
         if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
             mapStore.offset[0] += dx * 0.1
             mapStore.offset[1] += dy * 0.1
         }
       }
     }
  }

  const currentNodes = nodes.value
  const currentLinks = links.value
  const count = currentNodes.length
  
  if (count > 0) {
      // 1. Prepare Arrays
      const r = reusable.r
      const positions = reusable.pos
      const boxes = reusable.boxes
      
      if (r.length < count) {
        r.length = count
        positions.length = count
        boxes.length = count
      }

      for (let i = 0; i < count; i++) {
        const n = currentNodes[i]!
        r[i] = n.r
        positions[i] = n.pos
        vec2.scale(n.shift, n.shift, 0)
        
        const br = n.r * OUTER_MARGIN_FACTOR
        boxes[i] = [n.pos[0] - br, n.pos[1] - br, n.pos[0] + br, n.pos[1] + br]
      }

      // 2. Flow Forces
      const delta = vec2.create()
      const targetPos = vec2.create()
      const targetShift = vec2.create()

      for (const link of currentLinks) {
        const from = link.source
        const into = link.target
        const rSum = from.r + into.r
        
        vec2.scale(delta, link.relativePosition, rSum)
        
        // Force on Into
        vec2.add(targetPos, from.pos, delta)
        vec2.sub(targetShift, targetPos, into.pos)
        vec2.scale(targetShift, targetShift, from.r / rSum)
        vec2.add(into.shift, into.shift, targetShift)
        
        // Force on From
        vec2.sub(targetPos, into.pos, delta)
        vec2.sub(targetShift, targetPos, from.pos)
        vec2.scale(targetShift, targetShift, into.r / rSum)
        vec2.add(from.shift, from.shift, targetShift)
      }

      for (let i = 0; i < count; i++) {
        const n = currentNodes[i]!
        vec2.scale(n.shift, n.shift, FLOW_FORCE)
      }

      // 3. Collisions
      const intersections = naiveBoxIntersect(boxes)
      const ab = vec2.create()
      
  for (const [iA, iB] of intersections) {
    if (iA === undefined || iB === undefined) continue
    // Only check if valid indices
    if (iA >= count || iB >= count) continue

    const nA = currentNodes[iA]
    const nB = currentNodes[iB]
    
    if (!nA || !nB) continue
    
    // Vector from A to B
    vec2.sub(ab, nB.pos, nA.pos) // Fix: Calculate vector between nodes
    
    const rSum = nA.r + nB.r
    let d = vec2.len(ab)
    
    if (d === 0) {
      const x = Math.random() * 2 - 1
      const y = Math.sqrt(1 - x * x) * (Math.random() > 0.5 ? 1 : -1)
      ab[0] = x * rSum; ab[1] = y * rSum
      // d remains 0 to trigger correct force calculation
    }
    
    if (d < rSum) {
          calcShiftAndApply(1, d, ab, nA.r, nB.r, rSum, nA.shift, nB.shift)
        }
        if (d < rSum * OUTER_MARGIN_FACTOR) {
          calcShiftAndApply(OUTER_MARGIN_FACTOR, d, ab, nA.r, nB.r, rSum, nA.shift, nB.shift)
        }
      }

      // 4. Global Force & Apply
      const viewMinShift = 0.1 * (LOGICAL_HALF_SIDE / mapStore.halfSide) / mapStore.scale

      for (let i = 0; i < count; i++) {
        const n = currentNodes[i]!
        vec2.scale(n.shift, n.shift, GLOBAL_FORCE)
        
        const minShift = Math.max(viewMinShift, n.r * 0.001)

        // Check dragging
        if (n.id === mapStore.dragCandidate?.id && mapStore.dragBeginning) {
           // Do not move via physics
        } else {
           if (Math.abs(n.shift[0]) > minShift || Math.abs(n.shift[1]) > minShift) {
               vec2.add(n.pos, n.pos, n.shift)
           }
        }
      }
  }
  
  // Trigger update
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
  
  let totalValue = 0
  for (const n of rawNodes) {
    totalValue += n.value || 0
  }
  const avgValue = rawNodes.length > 0 ? totalValue / rawNodes.length : 0
  
  const newNodes: GraphNode[] = []
  rawNodes.forEach(raw => {
    let existing = nodeMap.get(raw.id)
    const val = raw.value || 0
    // r = Math.sqrt(val + 0.1 * avgValue) * 1000
    const radius = Math.sqrt((val / (avgValue || 1)) + 0.1) * 150

    if (!existing) {
      const loaded = loadedPositions.get(raw.id)
      existing = {
        id: raw.id,
        text: raw.text,
        status: raw.status,
        r: radius,
        value: val,
        pos: loaded ? [loaded.x, loaded.y] : [Math.random() * 100 - 50, Math.random() * 100 - 50],
        shift: [0, 0],
        color: undefined
      }
      nodeMap.set(raw.id, existing)
    } else {
      existing.text = raw.text
      existing.status = raw.status
      existing.value = val
      existing.r = radius
    }
    newNodes.push(existing)
  })
  
  if (nodeMap.size > newNodes.length) {
    const newIds = new Set(newNodes.map(n => n.id))
    for (const id of nodeMap.keys()) {
      if (!newIds.has(id)) nodeMap.delete(id)
    }
  }
  
  nodes.value = newNodes
  
  const newLinks: GraphLink[] = []
  rawLinks.forEach(l => {
    const source = nodeMap.get(l.source)
    const target = nodeMap.get(l.target)
    if (source && target) {
      newLinks.push({
        source,
        target,
        relativePosition: l.relativePosition || [0, 0],
        weight: l.weight || 1,
        share: l.share || 0
      })
    }
  })
  links.value = newLinks
}

// --- Lifecycle ---
onMounted(async () => {
  mapStore.setNodeGetter((id) => nodeMap.get(id))

  window.addEventListener('resize', updateHalfSide)
  if (svgRef.value) {
      // Manual event listeners instead of D3
      svgRef.value.addEventListener("mousemove", onMouseMove)
      svgRef.value.addEventListener("mousedown", onMouseDown)
      svgRef.value.addEventListener("mouseup", onMouseUp)
      svgRef.value.addEventListener("wheel", onWheel, { passive: false })
      svgRef.value.addEventListener("touchstart", onTouchStart, { passive: false })
      svgRef.value.addEventListener("touchmove", onTouchMove, { passive: false })
      svgRef.value.addEventListener("touchend", onTouchEnd)
      svgRef.value.addEventListener("touchcancel", onTouchEnd)
  }
  updateHalfSide()
  layout()
  
  // Load positions
  try {
    const positions = await loadAllPositions()
    positions.forEach((v, k) => loadedPositions.set(k, v))
    // Apply to existing
    for (const [id, pos] of positions) {
      const node = nodeMap.get(id)
      if (node) {
        node.pos = [pos.x, pos.y]
      }
    }
    
    // Load Camera
    const camera = await loadCamera()
    if (camera) {
      mapStore.offset = vec2.fromValues(camera.x, camera.y)
      mapStore.scale = camera.scale
    }
  } catch (e) {
    console.error("Failed to load positions", e)
  }

  // Save interval
  saveIntervalId = setInterval(async () => {
    if (nodes.value.length > 0) {
        const toSave = nodes.value.map(n => ({ id: n.id, x: n.pos[0], y: n.pos[1] }))
        await savePositions(toSave)
        await saveCamera({ x: mapStore.offset[0], y: mapStore.offset[1] }, mapStore.scale)
    }
  }, 2000) as any // Cast to any to avoid Node vs Browser timer type issues
  
  if (uiStore.projectPath) {
    dataStore.loadAllAims(uiStore.projectPath)
  }
  updateGraphData()
})

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  if (saveIntervalId) clearInterval(saveIntervalId)
  window.removeEventListener('resize', updateHalfSide)
  if (svgRef.value) {
      svgRef.value.removeEventListener("mousemove", onMouseMove)
      svgRef.value.removeEventListener("mousedown", onMouseDown)
      svgRef.value.removeEventListener("mouseup", onMouseUp)
      svgRef.value.removeEventListener("wheel", onWheel)
      svgRef.value.removeEventListener("touchstart", onTouchStart)
      svgRef.value.removeEventListener("touchmove", onTouchMove)
      svgRef.value.removeEventListener("touchend", onTouchEnd)
      svgRef.value.removeEventListener("touchcancel", onTouchEnd)
  }
})

watch(() => dataStore.graphData, updateGraphData, { deep: true })

watch(() => uiStore.getCurrentAim(), (newAim) => {
  if (newAim) {
    // Sync Tree -> Graph (e.g. keyboard nav)
    uiStore.setGraphSelection(newAim.id)
    mapStore.isTracking = true
  }
}, { deep: true, immediate: true })

const trigger = ref(0)
const transform = computed(() => {
    trigger.value // dependency
    const cx = mapStore.clientOffset[0] + mapStore.halfSide
    const cy = mapStore.clientOffset[1] + mapStore.halfSide
    const s = mapStore.scale * mapStore.halfSide / LOGICAL_HALF_SIDE
    return `translate(${cx}, ${cy}) scale(${s}) translate(${mapStore.offset[0]}, ${mapStore.offset[1]})`
})

const selectedLinkData = computed(() => {
  if (!uiStore.selectedLink) return null
  return links.value.find(l => 
    l.source.id === uiStore.selectedLink!.childId && 
    l.target.id === uiStore.selectedLink!.parentId
  )
})

const selectedLinkVisuals = computed(() => {
  trigger.value // dependency for animation
  const link = selectedLinkData.value
  if (!link) return null
  return {
    sourcePos: [link.source.pos[0], link.source.pos[1]] as vec2.T,
    targetPos: [link.target.pos[0], link.target.pos[1]] as vec2.T,
    sourceR: link.source.r || 25,
    targetR: link.target.r || 25
  }
})

const renderNodes = computed(() => { 
    trigger.value; 
    const currentAimId = uiStore.graphSelectedAimId
    return nodes.value.map(n => ({
        ...n,
        x: n.pos[0],
        y: n.pos[1],
        selected: n.id === currentAimId
    })) 
})
const renderLinks = computed(() => { 
    trigger.value; 
    return links.value.map(l => ({
        source: { ...l.source, x: l.source.pos[0], y: l.source.pos[1] },
        target: { ...l.target, x: l.target.pos[0], y: l.target.pos[1] },
        weight: l.weight,
        share: l.share
    })) 
})
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