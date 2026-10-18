import { describe, expect, it } from 'vitest'
import { measureLayout } from '../layout-metrics'

const R = 10 // every idea has this radius, so one radius sum is 20
const node = (id: string, x: number, y: number) => ({ id, position: [x, y] as const, radius: R })
const link = (parentId: string, childId: string, strength?: number) => ({ parentId, childId, strength })

describe('measureLayout', () => {
  it('counts crossings between unrelated connections, crowding and overlaps', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 200), node('c', 0, 200), node('d', 200, 0), node('e', 30, 0), node('f', 215, 0)]
    const metrics = measureLayout(nodes, [link('a', 'b'), link('c', 'd'), link('a', 'd')])
    expect(metrics.crossings).toBe(1) // a–d shares an idea with both
    expect(metrics.crowdedPairs).toBe(2) // a and e: 1.5 radius sums, d and f: 0.75
    expect(metrics.overlaps).toBe(1)
    expect(metrics.meanLength).toBeCloseTo((2 * 200 * Math.SQRT2 + 200) / 3 / 20)
  })

  it('weighs crossings by strength and flags shallow ones', () => {
    // Arcs bulge to the same side, so a–b and c–d cross once, flat.
    const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 0, 40), node('d', 400, -40), node('e', 200, -300), node('f', 200, 300)]
    const metrics = measureLayout(nodes, [link('a', 'b', 0.75), link('c', 'd', 0.25), link('e', 'f')])
    expect(metrics.crossings).toBe(3)
    expect(metrics.shallowCrossings).toBe(1)
    expect(metrics.weightedCrossings).toBeCloseTo((0.75 * 0.25 + 0.75 * 0.5 + 0.25 * 0.5) / 0.25)
  })

  it('counts connections passing through an idea that is not their end', () => {
    // The arc from b to a bulges 41 to one side of the straight line.
    const nodes = [node('a', 0, 0), node('b', 200, 0), node('under', 100, -40), node('beside', 100, 5)]
    expect(measureLayout(nodes, [link('a', 'b')]).underIdea).toBe(1)
  })

  it('shares the arrow ink that lies on other arrows', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 200, -200), node('d', 200, 200), node('e', 0, 1000), node('f', 400, 1000)]
    const wide = (parentId: string, childId: string) => ({ parentId, childId, width: 20 })
    expect(measureLayout(nodes, [wide('a', 'b'), wide('e', 'f')]).arrowOverlap).toBe(0)
    const crossing = measureLayout(nodes, [wide('a', 'b'), wide('c', 'd')]).arrowOverlap
    expect(crossing).toBeGreaterThan(0)
    expect(crossing).toBeLessThan(0.1)
    expect(measureLayout(nodes, [link('a', 'b')]).arrowOverlap).toBeNaN()
  })

  it('rates the narrowest angle at an idea against an even spread', () => {
    const nodes = [node('hub', 0, 0), node('east', 100, 0), node('north', 0, 100), node('west', -100, 0)]
    // Gaps of 90°, 90° and 180°; even would be 120°.
    const metrics = measureLayout(nodes, [link('hub', 'east'), link('hub', 'north'), link('hub', 'west')])
    expect(metrics.angleMedian).toBeCloseTo(0.75)
  })

  it('measures how far lengths miss the spacing', () => {
    const nodes = [node('a', 0, 0), node('b', 60, 0), node('c', 0, 100)]
    expect(measureLayout(nodes, [link('a', 'b'), link('a', 'c')], undefined, { spacing: 4 }).lengthMisfit).toBeCloseTo((1 + 1) / 2)
  })

  it('measures displacement net of the centre of all ideas shifting', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 0), node('alone', 500, 0)]
    const start = new Map<string, readonly [number, number]>([['a', [0, 0]], ['b', [100, 0]], ['alone', [500, 0]]])
    const moved = new Map<string, readonly [number, number]>([['a', [50, 0]], ['b', [150, 0]], ['alone', [500, 0]]])
    const metrics = measureLayout(nodes, [link('a', 'b')], moved, { start })
    // The centre moved 100 / 3: `a` and `b` 50 / 3 past it, `alone` 100 / 3 behind
    expect(metrics.displacementMean).toBeCloseTo((2 * 50 / 3 + 100 / 3) / 3 / (2 * R))
    expect(metrics.displacementMax).toBeCloseTo(100 / 3 / (2 * R))
  })

  it('checks whether the most similar ideas are the nearest on screen', () => {
    const nodes = [node('a', 0, 0), node('near', 50, 0), node('far', 1000, 0)]
    const semanticPairs = [{ source: 'a', target: 'far', distance: 0.1 }, { source: 'near', target: 'a', distance: 0.1 }]
    expect(measureLayout(nodes, [], undefined, { semanticPairs, neighbours: 1 }).semanticNeighbourhood).toBeCloseTo(0.5)
  })

  it('shares children behind their parent, seen from the grandparent', () => {
    const nodes = [node('root', 0, 0), node('parent', 100, 0), node('ahead', 200, 0), node('behind', 50, 80)]
    expect(measureLayout(nodes, [link('root', 'parent'), link('parent', 'ahead'), link('parent', 'behind')]).outwardViolations).toBeCloseTo(0.5)
  })
})
