import { defineStore } from 'pinia'
import * as vec2 from '../utils/vec2'

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

function getNodeFocusScale(node: MapNode): number {
  return 22 / node.r
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
    centerOnConnection(idA: string, idB: string, duration = 1000) {
      const nodeA = this.getNode(idA)
      const nodeB = this.getNode(idB)
      if (!nodeA || !nodeB) return

      const padding = Math.max(nodeA.r, nodeB.r) * 0.75
      const minX = Math.min(nodeA.pos[0] - nodeA.r, nodeB.pos[0] - nodeB.r) - padding
      const maxX = Math.max(nodeA.pos[0] + nodeA.r, nodeB.pos[0] + nodeB.r) + padding
      const minY = Math.min(nodeA.pos[1] - nodeA.r, nodeB.pos[1] - nodeB.r) - padding
      const maxY = Math.max(nodeA.pos[1] + nodeA.r, nodeB.pos[1] + nodeB.r) + padding

      const maxNodeScale = Math.min(getNodeFocusScale(nodeA), getNodeFocusScale(nodeB))
      this.animateCameraToRect({ minX, minY, maxX, maxY }, duration, maxNodeScale)
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
    animateCameraToRect(targetRect: CameraRect, duration: number, maxScale = Number.POSITIVE_INFINITY) {
      const start: CameraFrame = { offset: vec2.clone(this.offset), scale: this.scale }
      const destination = fitCameraRect(targetRect, this.xratio, this.yratio, 0.3, maxScale)
      const overview = fitCameraRect(
        unionCameraRects(this.currentViewportRect(), targetRect),
        this.xratio,
        this.yratio,
        0.75,
      )

      this.anim.t0 = Date.now()
      this.anim.duration = duration
      this.anim.update = () => {
        const progress = Math.min((Date.now() - this.anim.t0) / duration, 1)
        const firstHalf = progress <= 0.5
        const localProgress = firstHalf ? progress * 2 : (progress - 0.5) * 2
        const eased = (1 - Math.cos(localProgress * Math.PI)) / 2
        const from = firstHalf ? start : overview
        const to = firstHalf ? overview : destination
        vec2.mix(this.offset, to.offset, from.offset, eased)
        this.scale = from.scale * (1 - eased) + to.scale * eased
        if (progress >= 1) this.anim.update = undefined
      }
    },
    centerOnNode(node: MapNode, duration = 1000) {
      const radius = node.r
      this.animateCameraToRect({
        minX: node.pos[0] - radius,
        minY: node.pos[1] - radius,
        maxX: node.pos[0] + radius,
        maxY: node.pos[1] + radius,
      }, duration, getNodeFocusScale(node))
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
