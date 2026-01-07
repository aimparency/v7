import { ref, shallowRef, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import * as vec2 from '../utils/vec2'
import { loadAllPositions, savePositions, loadCamera, saveCamera } from '../utils/db'
import { trpc } from '../trpc'

// Constants
const OUTER_MARGIN_FACTOR = 2
const FLOW_FORCE = 0.5
const GLOBAL_FORCE = 0.14
const BASE_SEMANTIC_STIFFNESS = 0.15

export interface GraphNode {
  id: string
  // MapNode props
  pos: vec2.T
  r: number
  // Graph props
  text: string
  status: string
  value: number
  shift: vec2.T
  freezeFactor: number
  color?: string
  freezeCounter?: number
  // Optimization
  lastRenderX?: number
  lastRenderY?: number
}

export interface GraphLink {
  source: GraphNode
  target: GraphNode
  relativePosition: vec2.T
  weight: number
  share: number
}

// Helper: Spatial Grid Intersect (O(N) avg instead of O(N^2))
function gridIntersect(boxes: number[][], cellSize: number) {
  const grid = new Map<string, number[]>()
  const results = []

  // 1. Bin objects
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (!b) continue
    const cx = (b[0]! + b[2]!) / 2
    const cy = (b[1]! + b[3]!) / 2
    const key = `${Math.floor(cx / cellSize)},${Math.floor(cy / cellSize)}`
    
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(i)
  }

  // 2. Check collisions
  for (let i = 0; i < boxes.length; i++) {
      const bA = boxes[i]
      if (!bA) continue
      const cx = Math.floor(((bA[0]! + bA[2]!) / 2) / cellSize)
      const cy = Math.floor(((bA[1]! + bA[3]!) / 2) / cellSize)
      
      // Check 9 neighbors
      for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
              const key = `${cx + dx},${cy + dy}`
              const cell = grid.get(key)
              if (cell) {
                  for (const j of cell) {
                      if (i < j) { // Unique pairs
                          const bB = boxes[j]
                          if (bB && bA[2]! >= bB[0]! && bA[0]! <= bB[2]! && bA[3]! >= bB[1]! && bA[1]! <= bB[3]!) {
                              results.push([i, j])
                          }
                      }
                  }
              }
          }
      }
  }
  return results
}

export function useGraphSimulation() {
  const dataStore = useDataStore()
  const uiStore = useUIStore()
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
    
    const SPACING_FACTOR = 64
    const newNodes: GraphNode[] = []

    rawNodes.forEach(raw => {
      let existing = nodeMap.get(raw.id)
      const val = raw.value || 0
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
          freezeFactor: 0,
          freezeCounter: 0,
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
    boxes: [] as number[][]
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
    // 1. Smooth Semantic Force
    const diff = targetSemanticForce.value - semanticForceMultiplier.value
    if (Math.abs(diff) > 0.0001) {
        // Ease In (diff > 0) is slow (0.01), Ease Out (diff < 0) is fast (0.1)
        const factor = diff > 0 ? 0.01 : 0.1
        semanticForceMultiplier.value += diff * factor
    } else {
        semanticForceMultiplier.value = targetSemanticForce.value
    }

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
    if (!mapStore.panBeginning && !mapStore.dragBeginning && !mapStore.anim.update && mapStore.isTracking) {
        const currentAimId = uiStore.graphSelectedAimId
        if (currentAimId) {
            const node = nodeMap.get(currentAimId)
            if (node) {
                const targetX = -node.pos[0]
                const targetY = -node.pos[1]
                const dx = targetX - mapStore.offset[0]
                const dy = targetY - mapStore.offset[1]
                if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
                    mapStore.offset[0] += dx * 0.1
                    mapStore.offset[1] += dy * 0.1
                }
                const targetScale = LOGICAL_HALF_SIDE / (3 * Math.max(node.r, 10))
                const dScale = targetScale - mapStore.scale
                if (Math.abs(dScale) > 0.001) {
                    mapStore.scale += dScale * 0.1
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

        for (let i = 0; i < count; i++) {
            const n = currentNodes[i]!
            r[i] = n.r
            positions[i] = n.pos
            vec2.scale(n.shift, n.shift, 0)
            const br = n.r * OUTER_MARGIN_FACTOR
            boxes[i] = [n.pos[0] - br, n.pos[1] - br, n.pos[0] + br, n.pos[1] + br]
        }

        // Flow Forces
        const delta = vec2.create()
        const targetPos = vec2.create()
        const targetShift = vec2.create()

        for (const link of currentLinks) {
            const from = link.source
            const into = link.target
            const rSum = from.r + into.r
            
            vec2.scale(delta, link.relativePosition, rSum)
            
            // Parent
            vec2.sub(targetPos, from.pos, delta)
            vec2.sub(targetShift, targetPos, into.pos)
            vec2.scale(targetShift, targetShift, from.r / rSum)
            vec2.add(into.shift, into.shift, targetShift)
            
            // Child
            vec2.add(targetPos, into.pos, delta)
            vec2.sub(targetShift, targetPos, from.pos)
            vec2.scale(targetShift, targetShift, into.r / rSum)
            vec2.add(from.shift, from.shift, targetShift)
        }

        // Semantic Forces
        if (semanticLinks.value.length > 0 && semanticForceMultiplier.value > 0.001) {
            const maxGap = semanticMaxGap.value
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
                const targetGap = (link.distance / 2.0) * maxGap
                const targetDist = minDist + targetGap
                const displacement = currentDist - targetDist
                
                const forceMagnitude = displacement * effectiveStiffness

                vec2.scale(hShift, abVector, forceMagnitude)
                vec2.add(nodeA.shift, nodeA.shift, hShift)
                vec2.sub(nodeB.shift, nodeB.shift, hShift)
            }
        }

        for (let i = 0; i < count; i++) {
            const n = currentNodes[i]!
            vec2.scale(n.shift, n.shift, FLOW_FORCE)
        }

        // Collisions
        const GRID_CELL_SIZE = 500
        const intersections = gridIntersect(boxes, GRID_CELL_SIZE)
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

        // Global Force & Apply
        const now = Date.now()
        const FREEZE_DURATION = 10000
        const GRAVITY_CONSTANT = 0.6 
        const CENTERING_FORCE = GRAVITY_CONSTANT / (semanticMaxGap.value || 2000)

        for (let i = 0; i < count; i++) {
            const n = currentNodes[i]!
            vec2.scale(n.shift, n.shift, GLOBAL_FORCE)
            
            vec2.scale(hShift, n.pos, -CENTERING_FORCE)
            vec2.add(n.shift, n.shift, hShift)
            
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
            
            const minShift = n.r * 0.001

            // Check dragging
            if (n.id === mapStore.dragCandidate?.id && mapStore.dragBeginning) {
                // Do not move via physics
            } else {
                if (n.freezeCounter && n.freezeCounter > 0) {
                    n.freezeCounter--
                    continue
                }
                if (Math.abs(n.shift[0]) > minShift || Math.abs(n.shift[1]) > minShift) {
                    vec2.add(n.pos, n.pos, n.shift)
                } else {
                    n.freezeCounter = 10
                }
            }
        }
    }
    
    trigger.value++
    animFrameId = requestAnimationFrame(layout)
  }

  const randomizeLayout = () => {
    const range = semanticMaxGap.value || 2000
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
      }
    } catch (e) {
      console.error("Failed to load positions", e)
    }

    updateGraphData()
    layout()
    
    saveIntervalId = setInterval(async () => {
        if (nodes.value.length > 0) {
            const toSave = nodes.value.map(n => ({ id: n.id, x: n.pos[0], y: n.pos[1] }))
            await savePositions(toSave)
            await saveCamera({ x: mapStore.offset[0], y: mapStore.offset[1] }, mapStore.scale)
        }
    }, 2000) as any
    
    watch(() => dataStore.graphData, updateGraphData, { deep: true })
  }

  const cleanup = () => {
    if (animFrameId) cancelAnimationFrame(animFrameId)
    if (saveIntervalId) clearInterval(saveIntervalId)
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