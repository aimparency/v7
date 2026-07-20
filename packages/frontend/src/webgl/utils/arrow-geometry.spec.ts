import { describe, expect, it } from 'vitest'
import { calculateArrowGeometry } from './arrow-geometry'

const source = { x: 0, y: 0, r: 1 }
const target = { x: 100, y: 0, r: 20 }

describe('calculateArrowGeometry source cap', () => {
  it('keeps normal arrows straight-capped by default', () => {
    const geometry = calculateArrowGeometry(source, target, 0.5)

    expect(geometry.sourceCapRadiusSq).toBe(0)
  })

  it('adds cap metadata and extends temporary arrows behind the source bound', () => {
    const straight = calculateArrowGeometry(source, target, 0.5, { widthFactor: 1 })
    const rounded = calculateArrowGeometry(source, target, 0.5, {
      widthFactor: 1,
      roundSourceCap: true
    })

    expect(rounded.sourceCapRadiusSq).toBeGreaterThan(0)
    expect(rounded.sourceCapCenter.x).toBeCloseTo(straight.sourceCapCenter.x)
    expect(rounded.sourceCapCenter.y).toBeCloseTo(straight.sourceCapCenter.y)
    expect(rounded.triangleV1).not.toEqual(straight.triangleV1)
  })
})
