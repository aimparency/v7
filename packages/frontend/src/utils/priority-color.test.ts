import { describe, expect, it } from 'vitest'
import { priorityColor } from './priority-color'

describe('priorityColor', () => {
  it('renders non-positive priority as dark blue', () => {
    expect(priorityColor(0, 10)).toBe('rgb(11, 37, 69)')
    expect(priorityColor(-4, 10)).toBe('rgb(11, 37, 69)')
  })

  it('renders the highest finite priority as gold-orange', () => {
    expect(priorityColor(10, 10)).toBe('rgb(245, 158, 11)')
  })

  it('renders infinite priority as gold-orange', () => {
    expect(priorityColor(Number.POSITIVE_INFINITY, 10)).toBe('#f59e0b')
  })

  it('interpolates intermediate priorities from blue toward gold', () => {
    expect(priorityColor(5, 10)).toBe('rgb(128, 98, 40)')
  })

  it('uses a stable low-priority fallback when the range is empty', () => {
    expect(priorityColor(0, 0)).toBe('rgb(11, 37, 69)')
  })
})
