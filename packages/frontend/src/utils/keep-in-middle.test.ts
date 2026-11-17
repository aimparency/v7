import { describe, expect, it } from 'vitest'
import { keepInMiddle } from './keep-in-middle'

const element = (top: number, height: number, scrollTop = 0) => ({
  scrollTop,
  getBoundingClientRect: () => ({ top, bottom: top + height, height }),
}) as unknown as HTMLElement

describe('keepInMiddle', () => {
  it('leaves an item in the middle two thirds where it is', () => {
    const container = element(0, 600, 100)
    keepInMiddle(container, element(250, 50))
    expect(container.scrollTop).toBe(100)
  })

  it('scrolls an item below the middle just up to its lower edge', () => {
    const container = element(0, 600, 100)
    keepInMiddle(container, element(560, 50))
    expect(container.scrollTop).toBe(210)
  })

  it('scrolls an item above the middle just down to its upper edge', () => {
    const container = element(0, 600, 300)
    keepInMiddle(container, element(20, 50))
    expect(container.scrollTop).toBe(220)
  })
})
