import { describe, expect, it } from 'vitest'
import { calculateArrowGeometry, connectionArrowWidth, narrowestHitLink } from './arrow-geometry'

const source = { x: 0, y: 0, r: 1 }
const target = { x: 100, y: 0, r: 20 }

describe('calculateArrowGeometry source cap', () => {
  it('keeps normal arrows straight-capped by default', () => {
    const geometry = calculateArrowGeometry(source, target, 10)

    expect(geometry.sourceCapRadiusSq).toBe(0)
  })

  it('adds cap metadata and extends temporary arrows behind the source bound', () => {
    const straight = calculateArrowGeometry(source, target, 10)
    const rounded = calculateArrowGeometry(source, target, 10, { roundSourceCap: true })

    expect(rounded.sourceCapRadiusSq).toBeGreaterThan(0)
    expect(rounded.sourceCapCenter.x).toBeCloseTo(straight.sourceCapCenter.x)
    expect(rounded.sourceCapCenter.y).toBeCloseTo(straight.sourceCapCenter.y)
    expect(rounded.triangleV1).not.toEqual(straight.triangleV1)
  })
})

describe('connectionArrowWidth', () => {
  const link = (attributionShare: number) => ({ source: { r: 10 }, attributionShare })

  it('is as wide as a node holding the delivered value', () => {
    expect(connectionArrowWidth(link(1))).toBe(20)
    expect(connectionArrowWidth(link(0.25))).toBe(10)
  })

  it('stays visible for tiny contributions', () => {
    expect(connectionArrowWidth(link(0))).toBe(1)
  })
})

describe('narrowestHitLink', () => {
  // Two arrows between the same nodes overlap along the whole arc, which
  // bulges through (50, 20.7).
  const link = (attributionShare: number) => ({
    source: { renderPos: [0, 0], r: 10 },
    target: { renderPos: [100, 0], r: 10 },
    attributionShare
  })
  const onPath = { x: 50, y: 20.7 }

  it('picks the narrowest of overlapping arrows, wherever it is drawn', () => {
    const thin = link(0.05)
    const thick = link(1)
    expect(narrowestHitLink([thin, thick], onPath)).toBe(thin)
    expect(narrowestHitLink([thick, thin], onPath)).toBe(thin)
  })

  it('breaks ties in favour of the arrow drawn on top', () => {
    const below = link(0.5)
    const onTop = link(0.5)
    expect(narrowestHitLink([below, onTop], onPath)).toBe(onTop)
  })

  it('misses when no arrow is under the point', () => {
    expect(narrowestHitLink([link(1)], { x: 50, y: 500 })).toBeUndefined()
  })
})
