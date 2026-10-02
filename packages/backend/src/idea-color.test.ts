import { describe, expect, it } from 'vitest'
import { defaultIdeaColor, deriveChildIdeaColor } from './idea-color.js'

describe('default idea colors', () => {
  it('uses neutral grey for roots', () => {
    expect(defaultIdeaColor()).toBe('#666666')
  })

  it('derives similar but distinct deterministic sibling colors', () => {
    const first = deriveChildIdeaColor('#336699', 0)
    const second = deriveChildIdeaColor('#336699', 1)

    expect(first).toMatch(/^#[0-9a-f]{6}$/)
    expect(second).toMatch(/^#[0-9a-f]{6}$/)
    expect(first).not.toBe('#336699')
    expect(second).not.toBe(first)
    expect(deriveChildIdeaColor('#336699', 0)).toBe(first)
  })
})
