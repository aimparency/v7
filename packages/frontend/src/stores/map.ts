import { defineStore } from 'pinia'
import * as vec2 from '../utils/vec2'
import { useGraphUIStore } from './ui/graph-store'

export const LOGICAL_HALF_SIDE = 1000

// Minimal interface for what map needs
export interface MapNode {
  id: string
  pos: vec2.T
  r: number
}

export interface CameraRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface CameraFrame {
  offset: vec2.T
  scale: number
}

export interface GraphOverviewOptions {
  percentile?: number
  zoomOut?: number
}

export interface LayoutCandidate {
  fromWeight: number
  start: vec2.T
  dScale: number
  link: any // Avoid circular dependency with GraphLink
  activeAimId?: string
  frozenAimId?: string
}

// Fraction of the canvas area the focused aim's bounding square should cover.
const NODE_FOCUS_AREA_FILL = 1 / 25

function getNodeFocusScale(node: MapNode, xratio: number, yratio: number): number {
  // Visible area in logical units is (2 * L)^2 * xratio * yratio / scale^2;
  // solve (2r)^2 = fill * visibleArea for scale.
  return LOGICAL_HALF_SIDE * Math.sqrt(NODE_FOCUS_AREA_FILL * xratio * yratio) / Math.max(node.r, 0.000001)
}

// Van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003), the same
// model as d3.interpolateZoom. The camera is (center, width) with width the
// visible extent of the short canvas side. The resulting path zooms out while
// travelling far and back in on arrival; a larger rho zooms out further.
// rho^2 = 2.56 puts the peak width at ~1.28x the travel distance, so both
// endpoints are on screen around the middle of a long move.
const ZOOM_PATH_RHO = 1.6

export interface ZoomPath {
  // Path length in the model's units (roughly "screen widths travelled").
  length: number
  at(t: number): CameraFrame
}

export function zoomPath(from: CameraFrame, to: CameraFrame, shortRatio: number, rho = ZOOM_PATH_RHO): ZoomPath {
  const widthOf = (scale: number) => 2 * LOGICAL_HALF_SIDE * shortRatio / Math.max(scale, 0.000001)
  const scaleOf = (width: number) => 2 * LOGICAL_HALF_SIDE * shortRatio / width
  const x0 = -from.offset[0]
  const y0 = -from.offset[1]
  const w0 = widthOf(from.scale)
  const dx = -to.offset[0] - x0
  const dy = -to.offset[1] - y0
  const w1 = widthOf(to.scale)
  const d2 = dx * dx + dy * dy
  const rho2 = rho * rho

  const frame = (u: number, width: number): CameraFrame => ({
    offset: vec2.fromValues(-(x0 + u * dx), -(y0 + u * dy)),
    scale: scaleOf(width),
  })

  if (d2 < 1e-12) {
    const length = Math.abs(Math.log(w1 / w0)) / rho
    return {
      length,
      at: t => frame(t, w0 * Math.pow(w1 / w0, t)),
    }
  }

  const d1 = Math.sqrt(d2)
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * d2) / (2 * w0 * rho2 * d1)
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * d2) / (2 * w1 * rho2 * d1)
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)
  const length = (r1 - r0) / rho
  const coshR0 = Math.cosh(r0)
  const sinhR0 = Math.sinh(r0)

  return {
    length,
    at: t => {
      if (t >= 1) return frame(1, w1)
      const s = t * length
      const u = w0 / (rho2 * d1) * (coshR0 * Math.tanh(rho * s + r0) - sinhR0)
      return frame(u, w0 * coshR0 / Math.cosh(rho * s + r0))
    },
  }
}

export function unionCameraRects(a: CameraRect, b: CameraRect): CameraRect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function fitCameraRect(
  rect: CameraRect,
  xratio: number,
  yratio: number,
  fill = 0.6,
  maxScale = Number.POSITIVE_INFINITY,
): CameraFrame {
  const width = Math.max(rect.maxX - rect.minX, 1)
  const height = Math.max(rect.maxY - rect.minY, 1)
  const scaleX = (2 * fill * xratio * LOGICAL_HALF_SIDE) / width
  const scaleY = (2 * fill * yratio * LOGICAL_HALF_SIDE) / height
  return {
    offset: vec2.fromValues(-(rect.minX + rect.maxX) / 2, -(rect.minY + rect.maxY) / 2),
    scale: Math.min(scaleX, scaleY, maxScale),
  }
}

function surfaceWeightedCenter(nodes: MapNode[]): vec2.T {
  let weightedX = 0
  let weightedY = 0
  let totalWeight = 0

  for (const node of nodes) {
    const weight = Math.max(node.r, 0.000001) ** 2
    weightedX += node.pos[0] * weight
    weightedY += node.pos[1] * weight
    totalWeight += weight
  }

  return totalWeight > 0
    ? vec2.fromValues(weightedX / totalWeight, weightedY / totalWeight)
    : vec2.fromValues(0, 0)
}

export function graphOverviewFrame(
  nodes: MapNode[],
  xratio: number,
  yratio: number,
  options: GraphOverviewOptions = {},
): CameraFrame | null {
  const validNodes = nodes.filter(node =>
    Number.isFinite(node.pos[0])
    && Number.isFinite(node.pos[1])
    && Number.isFinite(node.r)
    && node.r >= 0
  )
  if (validNodes.length === 0) return null

  const percentile = Math.min(1, Math.max(0.01, options.percentile ?? 0.9))
  const zoomOut = Math.max(1, options.zoomOut ?? 1.2)
  const initialCenter = surfaceWeightedCenter(validNodes)
  const retainedCount = Math.max(1, Math.ceil(validNodes.length * percentile))
  const retainedNodes = [...validNodes]
    .sort((a, b) => {
      const distanceA = Math.hypot(
        a.pos[0] - initialCenter[0],
        a.pos[1] - initialCenter[1],
      ) + a.r
      const distanceB = Math.hypot(
        b.pos[0] - initialCenter[0],
        b.pos[1] - initialCenter[1],
      ) + b.r
      return distanceA - distanceB
    })
    .slice(0, retainedCount)

  // Recompute after trimming so a distant outlier cannot still pull the
  // camera away from the 90% of aims we intend to frame.
  const center = surfaceWeightedCenter(retainedNodes)
  let halfWidth = 1
  let halfHeight = 1
  for (const node of retainedNodes) {
    halfWidth = Math.max(halfWidth, Math.abs(node.pos[0] - center[0]) + node.r)
    halfHeight = Math.max(halfHeight, Math.abs(node.pos[1] - center[1]) + node.r)
  }

  return fitCameraRect({
    minX: center[0] - halfWidth,
    minY: center[1] - halfHeight,
    maxX: center[0] + halfWidth,
    maxY: center[1] + halfHeight,
  }, xratio, yratio, 1 / zoomOut)
}

export const useMapStore = defineStore('map', {
  state: () => ({
    scale: 1,
    offset: vec2.fromValues(0,0),
    mouse: {
      logical: vec2.fromValues(0,0),
      physical: vec2.fromValues(0,0)
    },
    halfSide: 400,  // Default to reasonable value (prevents NaN from division by zero)
    xratio: 1,
    yratio: 1, 
    mousePhysBegin: vec2.create(), 
    panBeginning: undefined as undefined | { offset: vec2.T },
    dragBeginning: undefined as undefined | { pos: vec2.T },
    layouting: false,
    layoutCandidate: undefined as undefined | LayoutCandidate,
    connecting: false, 
    cursorMoved: false,
    clientOffset: vec2.create(),
    isTracking: false,
    connectFrom: undefined as undefined | MapNode,
    dragCandidate: undefined as undefined | MapNode, 
    
    anim: {
      duration: 0.5, 
      t0: 0, 
      update: undefined as undefined | (() => void),
    }
  }), 
  actions: {
    updateMouse(physicalMouse: vec2.T) {
      this.mouse.physical = physicalMouse
      this.mouse.logical = this.physicalToLogicalCoord(physicalMouse)
    }, 
    physicalToLogicalCoord(coord: vec2.T) : vec2.T {
      let result = vec2.clone(coord) 
      vec2.sub(result, result, this.clientOffset) 
      vec2.scale(result, result, 1 / this.halfSide) 
      vec2.sub(result, result, [1,1]) 
      vec2.scale(result, result, LOGICAL_HALF_SIDE / this.scale) 
      vec2.sub(result, result, this.offset) 
      return result
    }, 
    zoom(f: number, mouse: vec2.T) {
      let mouseBefore = this.physicalToLogicalCoord(mouse)
      this.scale *= f
      let mouseAfter = this.physicalToLogicalCoord(mouse) 
      vec2.sub(mouseAfter, mouseAfter, mouseBefore) 
      vec2.add(this.offset, this.offset, mouseAfter) 
    },
    startDragging(node: MapNode) {
      this.dragCandidate = node
      this.connecting = false
      this.connectFrom = undefined
    },
    startConnecting(node: MapNode) {
      this.connectFrom = node
      this.connecting = true
      this.dragCandidate = undefined
    },
    startLayouting(candidate: LayoutCandidate) {
      this.layoutCandidate = candidate
      this.layouting = true
    },
    stopAnim() {
      this.anim.update = undefined
    },
    // Dependency injection for node lookup
    getNode: (id: string) => undefined as MapNode | undefined,
    setNodeGetter(fn: (id: string) => MapNode | undefined) {
      this.getNode = fn
    },
    centerOnConnection(idA: string, idB: string, duration?: number) {
      const nodeA = this.getNode(idA)
      const nodeB = this.getNode(idB)
      if (!nodeA || !nodeB) return

      const padding = Math.max(nodeA.r, nodeB.r) * 0.75
      const minX = Math.min(nodeA.pos[0] - nodeA.r, nodeB.pos[0] - nodeB.r) - padding
      const maxX = Math.max(nodeA.pos[0] + nodeA.r, nodeB.pos[0] + nodeB.r) + padding
      const minY = Math.min(nodeA.pos[1] - nodeA.r, nodeB.pos[1] - nodeB.r) - padding
      const maxY = Math.max(nodeA.pos[1] + nodeA.r, nodeB.pos[1] + nodeB.r) + padding

      const maxNodeScale = Math.min(
        getNodeFocusScale(nodeA, this.xratio, this.yratio),
        getNodeFocusScale(nodeB, this.xratio, this.yratio),
      )
      const destination = fitCameraRect({ minX, minY, maxX, maxY }, this.xratio, this.yratio, 0.3, maxNodeScale)
      this.flyCamera(destination.offset, destination.scale, duration)
    },
    animateCamera(targetOffset: vec2.T, targetScale: number, duration: number) {
      const offset0 = vec2.clone(this.offset)
      const scale0 = this.scale
      
      this.anim.t0 = Date.now()
      this.anim.duration = duration
      
      this.anim.update = () => {
        let progress = (Date.now() - this.anim.t0) / duration
        if(progress >= 1) {
          progress = 1
          this.anim.update = undefined
        } else {
          progress = (1 - Math.cos(progress * Math.PI)) / 2
        }
        
        vec2.mix(this.offset, targetOffset, offset0, progress)
        this.scale = scale0 * (1 - progress) + targetScale * progress
      }
    },
    currentViewportRect(): CameraRect {
      const safeScale = Math.max(this.scale, 0.000001)
      const centerX = -this.offset[0]
      const centerY = -this.offset[1]
      const halfWidth = this.xratio * LOGICAL_HALF_SIDE / safeScale
      const halfHeight = this.yratio * LOGICAL_HALF_SIDE / safeScale
      return {
        minX: centerX - halfWidth,
        minY: centerY - halfHeight,
        maxX: centerX + halfWidth,
        maxY: centerY + halfHeight,
      }
    },
    // Smooth zoom-and-pan from the current camera to the target frame. Without
    // an explicit duration it scales with how far the path travels.
    flyCamera(targetOffset: vec2.T, targetScale: number, duration?: number) {
      const path = zoomPath(
        { offset: vec2.clone(this.offset), scale: this.scale },
        { offset: vec2.clone(targetOffset), scale: targetScale },
        Math.min(this.xratio, this.yratio),
      )
      const ms = duration ?? Math.min(1600, Math.max(500, path.length * 450))

      this.anim.t0 = Date.now()
      this.anim.duration = ms
      this.anim.update = () => {
        const progress = Math.min((Date.now() - this.anim.t0) / ms, 1)
        const eased = (1 - Math.cos(progress * Math.PI)) / 2
        const frame = path.at(progress >= 1 ? 1 : eased)
        this.offset[0] = frame.offset[0]
        this.offset[1] = frame.offset[1]
        this.scale = frame.scale
        if (progress >= 1) this.anim.update = undefined
      }
    },
    // Camera frame that focuses an aim. Shared by the fly-to animation and the
    // tracking auto-pan so they agree on where to rest and never fight.
    nodeFocusFrame(node: MapNode): CameraFrame {
      const scale = getNodeFocusScale(node, this.xratio, this.yratio)
      // Center the aim in the space left of the side panel.
      let shiftX = 0
      const graphUIStore = useGraphUIStore()
      if (graphUIStore.graphSelectedAimId || graphUIStore.selectedLink) {
        const panelW = (graphUIStore.graphPanelWidth || 300) + 20
        const physicalToLogical = LOGICAL_HALF_SIDE / (scale * this.halfSide)
        shiftX = -panelW / 2 * physicalToLogical
      }
      return { offset: vec2.fromValues(-node.pos[0] + shiftX, -node.pos[1]), scale }
    },
    centerOnNode(node: MapNode, duration?: number) {
      const frame = this.nodeFocusFrame(node)
      this.flyCamera(frame.offset, frame.scale, duration)
    },
    centerOnGraph(nodes: MapNode[], duration = 1000, options: GraphOverviewOptions = {}) {
      const destination = graphOverviewFrame(nodes, this.xratio, this.yratio, options)
      if (!destination) return
      this.animateCamera(destination.offset, destination.scale, duration)
    },
    resetView() {
      // Reset pan/zoom to defaults (called when switching projects)
      this.scale = 1
      this.offset = vec2.fromValues(0, 0)
      this.connecting = false
      this.connectFrom = undefined
      this.dragCandidate = undefined
      this.layouting = false
      this.layoutCandidate = undefined
      this.isTracking = false
      this.anim.update = undefined
    }
  }
})
