import { describe, expect, it } from 'vitest'
import { centerScrollTop, revealScrollTop } from './useColumnScroll'

// Column of 1000px; the band is 150..850 of the viewport.
const viewport = 1000
const max = 10_000
const reveal = (top: number, height: number, scrollTop: number) => revealScrollTop({ top, height }, scrollTop, viewport, max)

describe('revealScrollTop', () => {
  it('leaves a focus inside the band alone', () => {
    expect(reveal(400, 100, 0)).toBe(0)
  })

  it('moves a fitting focus just into the band', () => {
    expect(reveal(900, 100, 0)).toBe(150) // bottom to 850
    expect(reveal(1000, 100, 1000)).toBe(850) // top to 150
  })

  it('fills the band with a tall focus by its nearer edge', () => {
    expect(reveal(2000, 1500, 0)).toBe(1850) // below: top to the band top
    expect(reveal(0, 1500, 3000)).toBe(650) // above: bottom to the band bottom
  })

  it('keeps a tall focus that already fills the band', () => {
    expect(reveal(0, 3000, 1000)).toBe(1000)
  })

  it('is idempotent: revealing again never moves', () => {
    for (const [top, height, scrollTop] of [[900, 100, 0], [2000, 1500, 0], [0, 1500, 3000], [5000, 40, 0]] as const) {
      const once = reveal(top, height, scrollTop)
      expect(reveal(top, height, once)).toBe(once)
    }
  })

  it('stays within the scroll range', () => {
    expect(reveal(10, 50, 500)).toBe(0)
    expect(revealScrollTop({ top: 1950, height: 50 }, 0, viewport, 1000)).toBe(1000)
  })

  it('builds on the destination, so repeated steps add up', () => {
    // Two steps up by 300px each from a scroll heading to 3000.
    const first = reveal(2800, 100, 3000)
    expect(first).toBe(2650)
    expect(reveal(2500, 100, first)).toBe(2350)
  })
})

describe('centerScrollTop', () => {
  it('puts the focus in the middle of the column, within the scroll range', () => {
    expect(centerScrollTop({ top: 900, height: 100 }, 400, 2000)).toBe(750)
    expect(centerScrollTop({ top: 50, height: 100 }, 400, 2000)).toBe(0)
    expect(centerScrollTop({ top: 1950, height: 50 }, 400, 1000)).toBe(1000)
  })
})
