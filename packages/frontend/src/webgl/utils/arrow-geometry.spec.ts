import { describe, expect, it } from 'vitest'
import { calculateArrowGeometry, connectionArrowWidth } from './arrow-geometry'

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
  const link = (value: number, flowValue: number, share = 0.5) => ({ source: { r: 10, value }, flowValue, share })

  it('is as wide as a node holding the delivered value', () => {
    expect(connectionArrowWidth(link(100, 100))).toBe(20)
    expect(connectionArrowWidth(link(100, 25))).toBe(10)
  })

  it('falls back to the weight share for ideas without value', () => {
    expect(connectionArrowWidth(link(0, 0, 0.25))).toBe(10)
  })

  it('stays visible for tiny contributions', () => {
    expect(connectionArrowWidth(link(100, 0))).toBe(1)
  })
})
