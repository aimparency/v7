import { ref, shallowRef, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import * as vec2 from '../utils/vec2'
import { loadAllPositions, savePositions, loadCamera, saveCamera } from '../utils/db'
import { trpc } from '../trpc'

// Constants
const OUTER_MARGIN_FACTOR = 2
const FLOW_FORCE = 0.5
const GLOBAL_FORCE = 0.14
const BASE_SEMANTIC_STIFFNESS = 0.75

type Box = [number, number, number, number]

export interface GraphNode {
  id: string
  // MapNode props
  pos: vec2.T
  renderPos: vec2.T
  r: number
  // Graph props
  text: string
  status: string
  value: number
  shift: vec2.T
  freezeFactor: number
  color?: string
  freezeCounter?: number
}

export interface GraphLink {
  source: GraphNode
  target: GraphNode
  relativePosition: vec2.T
  weight: number
  share: number
}

// Helper: Sweep and Prune (1-axis sort)
function sweepAndPrune(boxes: Box[], indices: Uint32Array, n: number) {
  const view = indices.subarray(0, n)

  // Sort indices based on minX (box[0]) - fast if nearly sorted
  view.sort((a, b) => {
      const boxA = boxes[a]
      const boxB = boxes[b]
      if (!boxA || !boxB) return 0
      return boxA[0] - boxB[0]
  })

  const results: [number, number][] = []

  for (let i = 0; i < n; i++) {
    const iA = view[i]!
    const boxA = boxes[iA] 
    if (!boxA) continue

    for (let j = i + 1; j < n; j++) {
      const iB = view[j]!
      const boxB = boxes[iB]
      if (!boxB) continue

      // Break if no overlap on X axis possible
      if (boxB[0] > boxA[2]) break

      // Check Y overlap
      if (boxA[3] >= boxB[1] && boxA[1] <= boxB[3]) {
        results.push([iA, iB] as [number, number])
      }
    }
  }
  return results
}

// Helper to interpolate colors (Orange #FF8000 -> Azure #0080FF)
function interpolateColor(t: number): string {
  // Clamp t to [0, 1]
  t = Math.max(0, Math.min(1, t))
  
  // Start: [255, 128, 0]
  // End:   [0, 128, 255]
  
  const r = Math.round(255 + (0 - 255) * t)
  const g = 128
  const b = Math.round(0 + (255 - 0) * t)
  
  return `rgb(${r}, ${g}, ${b})`
}

export function useGraphSimulation() {
  const dataStore = useDataStore()
  const uiStore = useUIStore()
  const graphUIStore = useGraphUIStore()
  const mapStore = useMapStore()

  // State
  const nodes = shallowRef<GraphNode[]>([])
  const links = shallowRef<GraphLink[]>([])
  const nodeMap = new Map<string, GraphNode>()
  const semanticLinks = shallowRef<any[]>([])
  
  // Layout State
  const loadedPositions = new Map<string, { x: number, y: number }>()
  const freezings = new Map<string, number>()
  const semanticMaxGap = ref(2000)
  const cameraTarget = vec2.create()
  let lastSelectedAimId: string | null = null
  let wasTracking = false
  
  // Simulation Control
  let animFrameId: number | null = null
  let saveIntervalId: number | null = null
  const trigger = ref(0) // For driving computed props
  const tickCallbacks: (() => void)[] = []

  const onTick = (cb: () => void) => {
    tickCallbacks.push(cb)
  }

  // Semantic Force Control (New Feature)
  const semanticForceMultiplier = ref(0) // Starts at 0 (off/weak)
  const targetSemanticForce = ref(0)
  
  const setSemanticForce = (active: boolean) => {
    targetSemanticForce.value = active ? 1.0 : 0.0
  }

  // --- Data Sync ---
  const updateGraphData = () => {
    const { nodes: rawNodes, links: rawLinks } = dataStore.graphData
    
    // Calculate Average Value for sizing
    let totalValue = 0
    for (const n of rawNodes) totalValue += (n.value || 0)
    const avgValue = rawNodes.length > 0 ? totalValue / rawNodes.length : 0
    
    // Calculate Priority Range if needed
    let maxPriority = 0
    if (graphUIStore.graphColorMode === 'priority') {
      for (const n of rawNodes) {
        const p = dataStore.getAimPriority(n.id)
        if (p !== Number.POSITIVE_INFINITY && p > maxPriority) {
          maxPriority = p
        }
      }
      // Logarithmic scaling often works better for distributions like this
      if (maxPriority <= 0) maxPriority = 1
    }
    
    const SPACING_FACTOR = 64
    const newNodes: GraphNode[] = []

    rawNodes.forEach(raw => {
      let existing = nodeMap.get(raw.id)
      const val = raw.value || 0
      const radius = Math.sqrt((val / (avgValue || 1)) + 0.1) * 150
      
      let color: string | undefined = undefined
      if (graphUIStore.graphColorMode === 'priority') {
        const p = dataStore.getAimPriority(raw.id)
        if (p === Number.POSITIVE_INFINITY) {
          color = '#FFFF00' // Max Yellow
        } else {
          // Linear mapping for now: priority / max
          // Or sqrt mapping to highlight lower-mid range?
          // Let's try simple linear first
          const t = p / maxPriority
          color = interpolateColor(t)
        }
      }

      if (!existing) {
        const loaded = loadedPositions.get(raw.id)
        const pos: vec2.T = loaded ? [loaded.x, loaded.y] : [Math.random() * 100 - 50, Math.random() * 100 - 50]
        existing = {
          id: raw.id,
          text: raw.text,
          status: raw.status,
          r: radius,
          value: val,
          pos,
          renderPos: vec2.clone(pos),
          shift: [0, 0],
          freezeFactor: 0,
          freezeCounter: 0,
          color
        }
        nodeMap.set(raw.id, existing)
      } else {
        existing.text = raw.text
        existing.status = raw.status
        existing.value = val
        existing.r = radius
        existing.color = color // Update color
        if (!existing.renderPos) existing.renderPos = vec2.clone(existing.pos)
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
    
    if (newNodes.length > 0) {
        let totalArea = 0
        for (const n of newNodes) totalArea += Math.PI * (n.r * n.r)
        const expandedArea = totalArea * SPACING_FACTOR
        semanticMaxGap.value = Math.sqrt(expandedArea)
    }
  }

  // --- Physics Helpers ---
  const reusable = {
    r: [] as number[],
    pos: [] as vec2.T[],
    boxes: [] as Box[],
    indices: new Uint32Array(0),
    lastCount: 0
  }
  const hShift = vec2.create()
  const abVector = vec2.create()

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

  // --- Main Simulation Loop ---
      const layout = () => {
      let hasVisualChange = false
  
      // 1. Smooth Semantic Force
      const diff = targetSemanticForce.value - semanticForceMultiplier.value
      if (Math.abs(diff) > 0.0001) {
          // Ease In (diff > 0) is slow (0.01), Ease Out (diff < 0) is fast (0.1)
          const factor = diff > 0 ? 0.01 : 0.1
          semanticForceMultiplier.value += diff * factor
      } else {
          semanticForceMultiplier.value = targetSemanticForce.value
      }
      
      // Dynamic Gap Scaling: Shrink space by half (side * 0.707) when active
      const gapMultiplier = 1.0 + ((Math.SQRT1_2 - 1.0) * semanticForceMultiplier.value)
      const effectiveMaxGap = (semanticMaxGap.value || 2000) * gapMultiplier
  
      // Run registered callbacks (e.g. interaction updates)
      tickCallbacks.forEach(cb => cb())

    if (mapStore.anim.update) {
      mapStore.anim.update()
    }
    
    // Camera Pan/Zoom Logic (simplified port from View)
    // We'll keep the interaction-dependent relative update logic here? 
    // Or assume it's handled by interaction composable updating mapStore?
    // The "updateRelativeDeltaWhileLayouting" function depends on mapStore.layoutCandidate
    // We should export a way to do that or keep it here if we pass layoutCandidate in.
    // Ideally, the physics loop just respects the positions.
    // But updateRelativeDeltaWhileLayouting modifies relativePosition based on drag.
    // Let's include that function here as it touches Data (Link relative pos).
    
    const lc = mapStore.layoutCandidate
    if (mapStore.layouting && lc) {
        // We need layoutingHandlePos from interaction... 
        // This is a coupling point. 
        // For now, let's assume the View or Interaction updates the link.relativePosition
        // OR we duplicate the logic here if we can access the handle pos.
        // Actually, updateRelativeDeltaWhileLayouting was in View.
        // Let's defer this specific interaction logic to be called from View or Interaction,
        // or passed in.
    }

    // Camera Auto-Pan (Smooth)
    const currentAimId = graphUIStore.graphSelectedAimId
    
    // Detect target change or tracking start to prevent jumps
    if (currentAimId !== lastSelectedAimId || (mapStore.isTracking && !wasTracking)) {
        cameraTarget[0] = mapStore.offset[0]
        cameraTarget[1] = mapStore.offset[1]
    }
    lastSelectedAimId = currentAimId
    wasTracking = mapStore.isTracking

    if (!mapStore.panBeginning && !mapStore.dragBeginning && !mapStore.anim.update && mapStore.isTracking) {
        // Recovery from NaN
        if (isNaN(mapStore.offset[0]) || isNaN(mapStore.offset[1])) {
            console.warn('Recovering from NaN offset')
            mapStore.offset[0] = 0
            mapStore.offset[1] = 0
            cameraTarget[0] = 0
            cameraTarget[1] = 0
        }
        if (isNaN(mapStore.scale) || !isFinite(mapStore.scale)) {
            mapStore.scale = 1
        }

        if (currentAimId) {
            const node = nodeMap.get(currentAimId)
            if (node) {
                // Shift target to account for sidebar (center in remaining space)
                let shiftX = 0
                if (graphUIStore.graphSelectedAimId || graphUIStore.selectedLink) {
                    const panelW = (graphUIStore.graphPanelWidth || 300) + 20
                    const physicalShift = -panelW / 2
                    // Convert to logical
                    const s = (mapStore.scale * mapStore.halfSide) / LOGICAL_HALF_SIDE
                    if (s > 0.0001) {
                        shiftX = physicalShift / s
                    }
                }

                const ultimateTargetX = -node.pos[0] + shiftX
                const ultimateTargetY = -node.pos[1]
                
                // Distance to ultimate target for zoom logic
                const totalDx = ultimateTargetX - mapStore.offset[0]
                const totalDy = ultimateTargetY - mapStore.offset[1]
                const totalDist = Math.sqrt(totalDx*totalDx + totalDy*totalDy)

                // 1. Update cameraTarget (smoothing layer)
                cameraTarget[0] += (ultimateTargetX - cameraTarget[0]) * 0.1
                cameraTarget[1] += (ultimateTargetY - cameraTarget[1]) * 0.1
                
                // 2. Update real offset (ease-in effect)
                const dx = cameraTarget[0] - mapStore.offset[0]
                const dy = cameraTarget[1] - mapStore.offset[1]

                if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
                    mapStore.offset[0] += dx * 0.1
                    mapStore.offset[1] += dy * 0.1
                }

                // 3. Dynamic zoom based on total distance
                const zoomPadding = 7 // Zoomed out (was 3)
                let targetScale = LOGICAL_HALF_SIDE / (zoomPadding * node.r + totalDist * 0.75)

                if (isNaN(targetScale) || !isFinite(targetScale)) {
                    targetScale = 1
                }

                const dScale = targetScale - mapStore.scale
                // Stop if relative difference is less than 1% (hysteresis/deadzone)
                // BUT only if we are close to the target (dist < radius).
                // If we are far, we want to track precise zoom-out based on distance.
                const deadzone = mapStore.scale * 0.01
                if (totalDist > node.r || Math.abs(dScale) > deadzone) {
                    mapStore.scale += dScale * 0.05
                }
            }
        }
    }

    const currentNodes = nodes.value
    const currentLinks = links.value
    const count = currentNodes.length

    if (count > 0) {
        // Prepare Arrays
        const r = reusable.r
        const positions = reusable.pos
        const boxes = reusable.boxes
        
        if (r.length < count) {
            r.length = count
            positions.length = count
            boxes.length = count
        }

        // Manage indices buffer
        if (reusable.indices.length < count) {
            const newSize = Math.max(count, Math.ceil(reusable.indices.length * 1.5))
            reusable.indices = new Uint32Array(newSize)
            reusable.lastCount = 0 // Force reset
        }
        
        // If node count changed, reset indices to identity to ensure validity.
        // We rely on sorting in sweepAndPrune to restore order.
        if (reusable.lastCount !== count) {
            for(let i=0; i<count; i++) reusable.indices[i] = i
            reusable.lastCount = count
        }

        for (let i = 0; i < count; i++) {
            const n = currentNodes[i]!
            r[i] = n.r
            positions[i] = n.pos
            vec2.scale(n.shift, n.shift, 0)
            const br = n.r * OUTER_MARGIN_FACTOR
            boxes[i] = [n.pos[0] - br, n.pos[1] - br, n.pos[0] + br, n.pos[1] + br]
        }

        // Debug Setup - Track force contributions for selected node
        const debugId = graphUIStore.graphSelectedAimId
        const debugNode = debugId ? nodeMap.get(debugId) : null
        const shouldLog = debugNode && (trigger.value % 60 === 0)

        // Track force contributions: how much each force type contributes to the selected node's movement
        const forceContributions = {
          flow: vec2.create() as vec2.T,
          semantic: vec2.create() as vec2.T,
          collision: vec2.create() as vec2.T,
          global: vec2.create() as vec2.T
        }

        // Flow Forces
        const delta = vec2.create()
        const targetPos = vec2.create()
        const targetShift = vec2.create()
        // const flowMultiplier = 1.0 + (9.0 * semanticForceMultiplier.value) // Removed for jitter testing

        for (const link of currentLinks) {
            const from = link.source
            const into = link.target
            const rSum = from.r + into.r
            
            vec2.scale(delta, link.relativePosition, rSum)
            
            // Parent
            vec2.sub(targetPos, from.pos, delta)
            vec2.sub(targetShift, targetPos, into.pos)
            vec2.scale(targetShift, targetShift, (from.r / rSum)) // Removed flowMultiplier
            vec2.add(into.shift, into.shift, targetShift)
            
            // Child
            vec2.add(targetPos, into.pos, delta)
            vec2.sub(targetShift, targetPos, from.pos)
            vec2.scale(targetShift, targetShift, (into.r / rSum)) // Removed flowMultiplier
            vec2.add(from.shift, from.shift, targetShift)
        }

        // Capture flow force contribution (shift accumulated so far is from flow forces only)
        if (shouldLog && debugNode) {
            forceContributions.flow[0] = debugNode.shift[0]
            forceContributions.flow[1] = debugNode.shift[1]
        }

        // Semantic Forces
        if (semanticLinks.value.length > 0 && semanticForceMultiplier.value > 0.001) {
            const maxGap = effectiveMaxGap
            const effectiveStiffness = BASE_SEMANTIC_STIFFNESS * semanticForceMultiplier.value

            for (const link of semanticLinks.value) {
                const nodeA = nodeMap.get(link.source)
                const nodeB = nodeMap.get(link.target)
                if (!nodeA || !nodeB) continue

                vec2.sub(abVector, nodeB.pos, nodeA.pos)
                let currentDist = vec2.len(abVector)

                if (currentDist < 0.1) {
                    abVector[0] = Math.random() - 0.5
                    abVector[1] = Math.random() - 0.5
                    currentDist = vec2.len(abVector)
                }

                vec2.scale(abVector, abVector, 1 / currentDist)

                const minDist = nodeA.r + nodeB.r
                const targetGap = (link.distance / 2.0) * maxGap * 1.2 // Enlarge by 1.2
                const targetDist = minDist + targetGap
                const displacement = currentDist - targetDist
                
                const forceMagnitude = displacement * effectiveStiffness

                vec2.scale(hShift, abVector, forceMagnitude)
                vec2.add(nodeA.shift, nodeA.shift, hShift)
                vec2.sub(nodeB.shift, nodeB.shift, hShift)
            }
        }

        // Calculate semantic force contribution (total shift minus flow = semantic)
        if (shouldLog && debugNode) {
            vec2.sub(forceContributions.semantic, debugNode.shift, forceContributions.flow)
        }

        for (let i = 0; i < count; i++) {
            const n = currentNodes[i]!
            vec2.scale(n.shift, n.shift, FLOW_FORCE)
        }

        // Collisions
        const intersections = sweepAndPrune(boxes, reusable.indices, count)
        const ab = vec2.create()
        
        for (const [iA, iB] of intersections) {
            if (iA === undefined || iB === undefined || iA >= count || iB >= count) continue
            const nA = currentNodes[iA]
            const nB = currentNodes[iB]
            if (!nA || !nB) continue
            
            vec2.sub(ab, nB.pos, nA.pos)
            const rSum = nA.r + nB.r
            let d = vec2.len(ab)
            
            if (d === 0) {
                const x = Math.random() * 2 - 1
                const y = Math.sqrt(1 - x * x) * (Math.random() > 0.5 ? 1 : -1)
                ab[0] = x * rSum; ab[1] = y * rSum
            }
            
            if (d < rSum) {
                calcShiftAndApply(1, d, ab, nA.r, nB.r, rSum, nA.shift, nB.shift)
            }
            if (d < rSum * OUTER_MARGIN_FACTOR) {
                calcShiftAndApply(OUTER_MARGIN_FACTOR, d, ab, nA.r, nB.r, rSum, nA.shift, nB.shift)
            }
        }

        // Capture shift before scaling to get collision contribution
        let shiftBeforeGlobal: vec2.T | null = null
        if (shouldLog && debugNode) {
            shiftBeforeGlobal = vec2.clone(debugNode.shift)
            // Collision contribution = total shift minus (flow + semantic)
            const flowAndSemantic = vec2.create()
            vec2.add(flowAndSemantic, forceContributions.flow, forceContributions.semantic)
            vec2.sub(forceContributions.collision, debugNode.shift, flowAndSemantic)
        }

        // Global Force & Apply
        const now = Date.now()
        const FREEZE_DURATION = 10000
        const GRAVITY_CONSTANT = 0.6 
        
        // Scale gravity by semantic multiplier (Disable gravity when not in auto-arrange)
        const effectiveGravity = GRAVITY_CONSTANT * semanticForceMultiplier.value
        const CENTERING_FORCE = effectiveGravity / (effectiveMaxGap || 2000)
        
        // Calculate rendering scale factor 's'
        const currentScale = mapStore.scale || 1
        const s = (currentScale * mapStore.halfSide) / (LOGICAL_HALF_SIDE || 1000) || 1

        for (let i = 0; i < count; i++) {
            const n = currentNodes[i]!

            vec2.scale(n.shift, n.shift, GLOBAL_FORCE)

            if (effectiveGravity > 0.001) {
                vec2.scale(hShift, n.pos, -CENTERING_FORCE)
                vec2.add(n.shift, n.shift, hShift)
            }

            // Debug logging for selected node
            if (shouldLog && n.id === debugId && shiftBeforeGlobal) {
                // Global contribution = shift after global - shift before global (scaled)
                const scaledBeforeGlobal = vec2.create()
                vec2.scale(scaledBeforeGlobal, shiftBeforeGlobal, GLOBAL_FORCE)
                vec2.sub(forceContributions.global, n.shift, scaledBeforeGlobal)

                console.group(`[GraphForce] ${n.text} (every 60 frames)`)
                console.table({
                    Flow: { x: forceContributions.flow[0].toFixed(2), y: forceContributions.flow[1].toFixed(2) },
                    Semantic: { x: forceContributions.semantic[0].toFixed(2), y: forceContributions.semantic[1].toFixed(2) },
                    Collision: { x: forceContributions.collision[0].toFixed(2), y: forceContributions.collision[1].toFixed(2) },
                    Global: { x: forceContributions.global[0].toFixed(2), y: forceContributions.global[1].toFixed(2) },
                    TotalShift: { x: n.shift[0].toFixed(2), y: n.shift[1].toFixed(2) },
                    Position: { x: n.pos[0].toFixed(2), y: n.pos[1].toFixed(2) }
                })
                console.groupEnd()
            }
            
            const releaseTime = freezings.get(n.id)
            if (releaseTime !== undefined) {
                const elapsed = now - releaseTime
                if (elapsed < FREEZE_DURATION) {
                    const currentFreeze = 1 - (elapsed / FREEZE_DURATION)
                    const moveFactor = 1 - currentFreeze
                    vec2.scale(n.shift, n.shift, moveFactor)
                } else {
                    freezings.delete(n.id)
                }
            }
            
            // Check dragging
            if (n.id === mapStore.dragCandidate?.id && mapStore.dragBeginning) {
                // Sync renderPos to pos during drag
                n.renderPos[0] = n.pos[0]
                n.renderPos[1] = n.pos[1]
                hasVisualChange = true
                n.freezeCounter = 0
            } else if (mapStore.layouting && mapStore.layoutCandidate?.frozenAimId === n.id) {
                // While dragging a connection handle, keep the opposite endpoint stable.
                n.shift[0] = 0
                n.shift[1] = 0
                n.renderPos[0] = n.pos[0]
                n.renderPos[1] = n.pos[1]
            } else {
                // Removed skip logic to ensure realtime updates and prevent jumps.
                // Internal vs render position split handles performance optimization.
                
                // Clamp maximum movement to prevent chaos (10% of world side)
                            const maxMove = effectiveMaxGap * 0.1
                            if (n.shift[0] > maxMove) n.shift[0] = maxMove
                            else if (n.shift[0] < -maxMove) n.shift[0] = -maxMove
                            
                            if (n.shift[1] > maxMove) n.shift[1] = maxMove
                            else if (n.shift[1] < -maxMove) n.shift[1] = -maxMove
                
                            // Physics Update: Always apply shift to resolve tensions
                            vec2.add(n.pos, n.pos, n.shift)
                            
                            // Visual Update Logic: Manhattan distance > 0.5px screen space
                            const dx = Math.abs(n.pos[0] - n.renderPos[0])
                            const dy = Math.abs(n.pos[1] - n.renderPos[1])
                
                            if ((dx + dy) * s > 0.5) {
                    n.renderPos[0] = n.pos[0]
                    n.renderPos[1] = n.pos[1]
                    hasVisualChange = true
                }
            }
        }
    }
    
    if (hasVisualChange || mapStore.anim.update || mapStore.layouting || mapStore.dragBeginning) {
        trigger.value++
    }
    animFrameId = requestAnimationFrame(layout)
  }

  const randomizeLayout = () => {
    // Use the tighter semantic spacing (half area / 0.707 side) for randomization
    const range = (semanticMaxGap.value || 2000) * Math.SQRT1_2
    nodes.value.forEach(n => {
      n.pos[0] = (Math.random() - 0.5) * range
      n.pos[1] = (Math.random() - 0.5) * range
      vec2.scale(n.shift, n.shift, 0)
    })
    freezings.clear()
  }

  // --- Lifecycle ---
  const init = async () => {
    mapStore.setNodeGetter((id) => nodeMap.get(id))
    
    // Load Data
    if (uiStore.projectPath) {
      dataStore.loadAllAims(uiStore.projectPath)
      
      trpc.graph.getSemanticForces.query({ projectPath: uiStore.projectPath })
        .then(graph => {
          semanticLinks.value = graph.links
        })
        .catch(err => console.error("[Graph] Failed to load semantic forces:", err))
    }
    
    // Load positions
    try {
      const positions = await loadAllPositions()
      positions.forEach((v, k) => loadedPositions.set(k, v))
      for (const [id, pos] of positions) {
        const node = nodeMap.get(id)
        if (node) node.pos = [pos.x, pos.y]
      }
      
      const camera = await loadCamera()
      if (camera) {
        mapStore.offset = vec2.fromValues(camera.x, camera.y)
        mapStore.scale = camera.scale
        cameraTarget[0] = mapStore.offset[0]
        cameraTarget[1] = mapStore.offset[1]
      }
    } catch (e) {
      console.error("Failed to load positions", e)
    }

    updateGraphData()
    trigger.value++ // Force initial render to pick up calculated sizes/positions
    layout()
    
    saveIntervalId = setInterval(async () => {
        if (nodes.value.length > 0) {
            const toSave = nodes.value.map(n => ({ id: n.id, x: n.pos[0], y: n.pos[1] }))
            await savePositions(toSave)
            await saveCamera({ x: mapStore.offset[0], y: mapStore.offset[1] }, mapStore.scale)
        }
    }, 2000) as any
    
    watch(() => dataStore.graphData, updateGraphData, { deep: true })
    watch(() => graphUIStore.graphColorMode, updateGraphData)
  }

  const cleanup = () => {
    if (animFrameId) cancelAnimationFrame(animFrameId)
    if (saveIntervalId) clearInterval(saveIntervalId)
    // Save state on exit to ensure persistence
    if (nodes.value.length > 0) {
        const toSave = nodes.value.map(n => ({ id: n.id, x: n.pos[0], y: n.pos[1] }))
        savePositions(toSave)
        saveCamera({ x: mapStore.offset[0], y: mapStore.offset[1] }, mapStore.scale)
    }
  }

  return {
    nodes,
    links,
    nodeMap,
    trigger,
    semanticForceMultiplier,
    targetSemanticForce,
    setSemanticForce,
    randomizeLayout,
    init,
    cleanup,
    freezings, // Exported for interaction usage (e.g. setting freeze on drag end)
    onTick
  }
}
