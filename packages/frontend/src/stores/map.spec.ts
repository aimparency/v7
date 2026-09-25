import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { LOGICAL_HALF_SIDE, graphOverviewFrame, useMapStore, zoomPath } from './map'

describe('map store camera focus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('does not over-zoom when centering on very close connected aims', () => {
    const mapStore = useMapStore()
    mapStore.xratio = 1
    mapStore.yratio = 1
    mapStore.scale = 1

    mapStore.setNodeGetter((id: string) => {
      if (id === 'a') return { id: 'a', pos: [0, 0], r: 25 }
      if (id === 'b') return { id: 'b', pos: [10, 10], r: 25 }
      return undefined
    })

    mapStore.centerOnConnection('a', 'b', 1000)
    mapStore.anim.t0 = Date.now() - 1000
    mapStore.anim.update?.()

    expect(mapStore.scale).toBeLessThanOrEqual(LOGICAL_HALF_SIDE / (5 * 25))
    expect(mapStore.offset[0]).toBeCloseTo(-5, 5)
    expect(mapStore.offset[1]).toBeCloseTo(-5, 5)
  })

  it('zooms out enough to fit distant connected aims', () => {
    const mapStore = useMapStore()
    mapStore.xratio = 1
    mapStore.yratio = 1
    mapStore.scale = 1

    mapStore.setNodeGetter((id: string) => {
      if (id === 'a') return { id: 'a', pos: [0, 0], r: 25 }
      if (id === 'b') return { id: 'b', pos: [1600, 0], r: 25 }
      return undefined
    })

    mapStore.centerOnConnection('a', 'b', 1000)
    mapStore.anim.t0 = Date.now() - 1000
    mapStore.anim.update?.()

    expect(mapStore.scale).toBeLessThan(LOGICAL_HALF_SIDE / (5 * 25))
    expect(mapStore.offset[0]).toBeCloseTo(-800, 5)
    expect(mapStore.offset[1]).toBeCloseTo(0, 5)
  })

  it('focuses an aim so its bounding square fills 1/25 of the canvas', () => {
    const mapStore = useMapStore()
    mapStore.xratio = 16 / 9
    mapStore.yratio = 1
    mapStore.scale = 0.3
    mapStore.offset = [400, -200]

    const node = { id: 'a', pos: [120, 80] as [number, number], r: 30 }
    mapStore.centerOnNode(node, 1000)
    mapStore.anim.t0 = Date.now() - 1000
    mapStore.anim.update?.()

    const view = mapStore.currentViewportRect()
    const viewArea = (view.maxX - view.minX) * (view.maxY - view.minY)
    expect((2 * node.r) ** 2 / viewArea).toBeCloseTo(1 / 25, 5)
    expect(mapStore.offset[0]).toBeCloseTo(-120, 5)
    expect(mapStore.offset[1]).toBeCloseTo(-80, 5)
  })

  it('zooms out far enough mid-flight that both aims are on screen', () => {
    const scale = LOGICAL_HALF_SIDE / (5 * 20)
    const path = zoomPath(
      { offset: [0, 0], scale },
      { offset: [-5000, -3000], scale },
      1,
    )
    const bothVisible = (t: number) => {
      const frame = path.at(t)
      const halfSide = LOGICAL_HALF_SIDE / frame.scale
      return [[0, 0], [5000, 3000]].every(([x, y]) =>
        Math.abs(x! + frame.offset[0]) < halfSide && Math.abs(y! + frame.offset[1]) < halfSide)
    }

    expect(bothVisible(0)).toBe(false)
    expect(bothVisible(0.5)).toBe(true)
    expect(path.at(1).offset[0]).toBeCloseTo(-5000, 5)
    expect(path.at(1).scale).toBeCloseTo(scale, 5)
  })

  it('zooms monotonically without panning when the target shares the center', () => {
    const path = zoomPath({ offset: [10, 10], scale: 1 }, { offset: [10, 10], scale: 8 }, 1)
    let previous = 1
    for (let t = 0.1; t <= 1; t += 0.1) {
      const frame = path.at(t)
      expect(frame.scale).toBeGreaterThan(previous)
      expect(frame.offset[0]).toBeCloseTo(10, 5)
      previous = frame.scale
    }
    expect(path.at(1).scale).toBeCloseTo(8, 5)
  })
})

describe('graph overview camera', () => {
  it('centers by aim surface and fits node radii with 1.2x breathing room', () => {
    const frame = graphOverviewFrame([
      { id: 'large', pos: [0, 0], r: 20 },
      { id: 'small', pos: [100, 0], r: 10 },
    ], 1, 1)

    expect(frame).not.toBeNull()
    expect(frame!.offset[0]).toBeCloseTo(-20)
    expect(frame!.offset[1]).toBeCloseTo(0)
    expect(frame!.scale).toBeCloseTo((1000 / 90) / 1.2)
  })

  it('ignores the farthest 10% of aims and recenters the retained set', () => {
    const nodes = Array.from({ length: 9 }, (_, index) => ({
      id: `central-${index}`,
      pos: [index - 4, 0] as [number, number],
      r: 1,
    }))
    nodes.push({ id: 'outlier', pos: [10_000, 0], r: 1 })

    const frame = graphOverviewFrame(nodes, 1, 1, { percentile: 0.9, zoomOut: 1.2 })

    expect(frame).not.toBeNull()
    expect(frame!.offset[0]).toBeCloseTo(0)
    expect(frame!.scale).toBeGreaterThan(100)
  })

  it('returns null for an empty graph', () => {
    expect(graphOverviewFrame([], 1, 1)).toBeNull()
  })
})
