import { describe, expect, it } from 'vitest'
import { defaultIdeaColor, deriveChildIdeaColor } from './idea-color.js'

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (h * 60 + 360) % 360
}

describe('default idea colors', () => {
  it('uses neutral grey for roots', () => {
    expect(defaultIdeaColor()).toBe('#666666')
  })

  it('keeps a child within the deviation of its parent hue', () => {
    for (const r of [0, 0.5, 0.999]) {
      const child = deriveChildIdeaColor('#336699', 0.05, () => r)
      expect(child).toMatch(/^#[0-9a-f]{6}$/)
      expect(Math.abs(hue(child) - hue('#336699'))).toBeLessThanOrEqual(18.5)
    }
  })

  it('starts a colored branch below a grey parent', () => {
    const child = deriveChildIdeaColor('#666666', 0.05, () => 0.5)
    expect(child).not.toBe('#666666')
    expect(Math.round(hue(child))).toBe(180)
  })
})
