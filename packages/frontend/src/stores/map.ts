import { defineStore } from 'pinia'
import * as vec2 from '../utils/vec2'

export const LOGICAL_HALF_SIDE = 1000

// Minimal interface for what map needs
export interface MapNode {
  id: string
  pos: vec2.T
  r: number
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
    },
    startConnecting(node: MapNode) {
      this.connectFrom = node
      this.connecting = true
    },
    stopAnim() {
      this.anim.update = undefined
    },
    centerOnNode(node: MapNode, duration = 1000) {
      const offset0 = vec2.clone(this.offset) 
      const scale0 = this.scale
      this.anim.t0 = Date.now()
      this.anim.duration = duration / 1000 // Seconds? Logic uses / duration / this.anim.duration.
      // Reference logic: let progress = (Date.now() - this.anim.t0) / duration / this.anim.duration 
      // If duration is passed as ms, and this.anim.duration is 0.5 (default).
      // Wait, reference: anim.duration = 0.5. centerOnAim(..., duration=1000).
      // progress = (...) / 1000 / 0.5.
      // If 500ms passed: 500 / 1000 / 0.5 = 1.
      // So transition takes duration * anim.duration ms?
      // I'll assume duration is total ms.
      
      this.anim.update = () => {
        let progress = (Date.now() - this.anim.t0) / duration
        if(progress >= 1) {
          progress = 1
          this.anim.update = undefined
        } else {
          // Ease out (cos)
          progress = (1 - Math.cos(progress * Math.PI)) / 2
        }
        // vec2.add(this.offset, vec2.crScale(offset0, 1 - progress), vec2.crScale(aim.pos, -progress))
        // Target offset is -aim.pos.
        // Interpolate offset
        const targetOffset = vec2.crScale(node.pos, -1)
        vec2.mix(this.offset, targetOffset, offset0, progress)
        
        // this.scale = scale0 * (1 - progress) + 200 / aim.r * progress
        // Target scale? Reference uses 200 / aim.r. 
        // 200 is 2 * LOGICAL_HALF_SIDE? No, 1000.
        // Maybe it wants aim to be a certain size on screen.
        const targetScale = 200 / node.r // Heuristic
        this.scale = scale0 * (1 - progress) + targetScale * progress
      }
    }
  }
})
