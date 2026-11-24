import { describe, expect, it } from 'vitest'
import { graphOutline, outlineContains, outlinePath } from '../graph-outline'

const circles = [{ x: 0, y: 0, r: 30 }, { x: 200, y: 40, r: 10 }, { x: 80, y: -150, r: 50 }]

describe('the string around a linked space', () => {
  it('encloses every idea whole, however it wobbles', () => {
    for (const time of [0, 0.7, 2.1, 5]) {
      const outline = graphOutline(circles, 20, time)!
      for (const c of circles) {
        for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
          expect(outlineContains(outline, c.x + c.r * Math.cos(a), c.y + c.r * Math.sin(a))).toBe(true)
        }
      }
    }
  })

  it('leaves out what is far from the ideas', () => {
    const outline = graphOutline(circles, 20)!
    expect(outlineContains(outline, 600, 0)).toBe(false)
    expect(outlineContains(outline, -200, 200)).toBe(false)
  })

  it('moves with time and is drawn as one closed path', () => {
    expect(graphOutline(circles, 20, 0)!.radii).not.toEqual(graphOutline(circles, 20, 1)!.radii)
    expect(outlinePath(graphOutline(circles, 20)!)).toMatch(/^M.*Z$/)
    expect(graphOutline([], 20)).toBeNull()
  })
})
