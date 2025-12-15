import { defineStore } from 'pinia'
import * as vec2 from '../utils/vec2'

export const LOGICAL_HALF_SIDE = 1000

// Minimal interface for what map needs
export interface MapNode {
  id: string
  pos: vec2.T
  r: number
}

export interface LayoutCandidate {
  fromWeight: number
  start: vec2.T
  dScale: number
  link: any // Avoid circular dependency with GraphLink
}

export const useMapStore = defineStore('map', {
  state: () => ({
    scale: 1, 
    offset: vec2.fromValues(0,0),
    mouse: {
      logical: vec2.fromValues(0,0), 
      physical: vec2.fromValues(0,0)
    },
    halfSide: 0, 
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

      const minX = Math.min(nodeA.pos[0], nodeB.pos[0])
      const maxX = Math.max(nodeA.pos[0], nodeB.pos[0])
      const minY = Math.min(nodeA.pos[1], nodeB.pos[1])
      const maxY = Math.max(nodeA.pos[1], nodeB.pos[1])

      const w = Math.max(maxX - minX, 100) // Ensure non-zero
      const h = Math.max(maxY - minY, 100)
      
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      
      // Target: center on (centerX, centerY)
      // offset = -center
      const targetOffset = vec2.fromValues(-centerX, -centerY)
      
      // Target scale: 30% of viewport
      // ViewLogicalSize = (Physical / halfSide) * (LOGICAL / scale)
      // We want: BoxSize / ViewLogicalSize = 0.3
      // BoxSize = 0.3 * (2 * ratio) * (LOGICAL / scale)
      // scale = 0.6 * ratio * LOGICAL / BoxSize
      
      const scaleX = (0.6 * this.xratio * LOGICAL_HALF_SIDE) / w
      const scaleY = (0.6 * this.yratio * LOGICAL_HALF_SIDE) / h
      const targetScale = Math.min(scaleX, scaleY)

      this.animateCamera(targetOffset, targetScale, duration)
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
    centerOnNode(node: MapNode, duration = 1000) {
      const targetOffset = vec2.crScale(node.pos, -1)
      const targetScale = 200 / node.r // Heuristic
      this.animateCamera(targetOffset, targetScale, duration)
    }
  }
})
