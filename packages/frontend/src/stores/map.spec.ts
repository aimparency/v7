import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fitCameraRect, unionCameraRects, useMapStore } from './map'

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

    expect(mapStore.scale).toBeCloseTo(22 / 25, 5)
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

    expect(mapStore.scale).toBeLessThan(22 / 25)
    expect(mapStore.offset[0]).toBeCloseTo(-800, 5)
    expect(mapStore.offset[1]).toBeCloseTo(0, 5)
  })

  it('passes through the fitted union of the current viewport and destination', () => {
    const mapStore = useMapStore()
    mapStore.xratio = 1
    mapStore.yratio = 1
    mapStore.scale = 2
    mapStore.offset = [-100, 50]
    const fromRect = mapStore.currentViewportRect()
    const toRect = { minX: 1900, minY: -100, maxX: 2100, maxY: 100 }
    const expectedOverview = fitCameraRect(unionCameraRects(fromRect, toRect), 1, 1, 0.75)

    mapStore.animateCameraToRect(toRect, 1000)
    mapStore.anim.t0 = Date.now() - 500
    mapStore.anim.update?.()

    expect(mapStore.offset[0]).toBeCloseTo(expectedOverview.offset[0], 2)
    expect(mapStore.offset[1]).toBeCloseTo(expectedOverview.offset[1], 2)
    expect(mapStore.scale).toBeCloseTo(expectedOverview.scale, 2)
  })
})
