import { describe, expect, it } from 'vitest'
import { defaultAimColor, deriveChildAimColor } from './aim-color.js'

describe('default aim colors', () => {
  it('uses neutral grey for roots', () => {
    expect(defaultAimColor()).toBe('#666666')
  })

  it('derives similar but distinct deterministic sibling colors', () => {
    const first = deriveChildAimColor('#336699', 0)
    const second = deriveChildAimColor('#336699', 1)

    expect(first).toMatch(/^#[0-9a-f]{6}$/)
    expect(second).toMatch(/^#[0-9a-f]{6}$/)
    expect(first).not.toBe('#336699')
    expect(second).not.toBe(first)
    expect(deriveChildAimColor('#336699', 0)).toBe(first)
  })
})
