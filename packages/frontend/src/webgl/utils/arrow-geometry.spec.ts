import { describe, expect, it } from 'vitest'
import { calculateArrowGeometry, connectionArrowWidth, fixedCurvature, gapCurvature, narrowestHitLink } from './arrow-geometry'

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

describe('gapCurvature', () => {
  it('bends touching equal ideas into a semicircle around their touchpoint', () => {
    const geometry = calculateArrowGeometry({ x: 0, y: 0, r: 10 }, { x: 20, y: 0, r: 10 }, 4, { curvature: gapCurvature })

    expect(geometry.arcCenter.x).toBeCloseTo(10)
    expect(geometry.arcCenter.y).toBeCloseTo(0)
    expect(geometry.centerRadius).toBeCloseTo(10)
  })

  it('matches the fixed 0.5 curvature at a gap of three times the summed radii', () => {
    const near = { x: 0, y: 0, r: 10 }
    const far = { x: 80, y: 0, r: 10 }

    expect(gapCurvature(near, far, 80)).toBeCloseTo(0.5)
    expect(calculateArrowGeometry(near, far, 4, { curvature: gapCurvature }).centerRadius)
      .toBeCloseTo(calculateArrowGeometry(near, far, 4, { curvature: fixedCurvature(0.5) }).centerRadius)
  })

  it('flattens longer connections further', () => {
    const near = { x: 0, y: 0, r: 10 }
    expect(gapCurvature(near, { x: 200, y: 0, r: 10 }, 200)).toBeGreaterThan(0.5)
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
  // Two arrows between the same nodes overlap along the whole arc; its
  // middle lies on the perpendicular bisector, away from the arc center.
  const link = (attributionShare: number) => ({
    source: { renderPos: [0, 0], r: 10 },
    target: { renderPos: [100, 0], r: 10 },
    attributionShare
  })
  const arc = calculateArrowGeometry({ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 10 }, 20)
  const onPath = {
    x: 50,
    y: arc.arcCenter.y + Math.sign(-arc.arcCenter.y) * arc.centerRadius
  }

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
