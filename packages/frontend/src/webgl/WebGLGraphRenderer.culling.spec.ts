import { describe, expect, it } from 'vitest'
import { WebGLGraphRenderer, type NodeData } from './WebGLGraphRenderer'

describe('WebGLGraphRenderer culling bounds', () => {
  it('rebuilds quadtree bounds when nodes move outside prior extent', () => {
    const canvas = document.createElement('canvas')
    const renderer = new WebGLGraphRenderer(canvas)

    const initial: NodeData = {
      id: 'n1',
      x: 0,
      y: 0,
      r: 10,
      color: [1, 1, 1],
      selected: false,
      moving: false
    }
    renderer.updateNodes([initial])

    const moved: NodeData = {
      ...initial,
      x: 10_000,
      y: 10_000
    }
    renderer.updateNodes([moved])

    const quadtree = renderer.getQuadtree()
    expect(quadtree).not.toBeNull()

    const visible = quadtree!.query({
      minX: 9_980,
      minY: 9_980,
      maxX: 10_020,
      maxY: 10_020
    })
    expect(visible.map((item) => item.id)).toContain('n1')
  })
})
