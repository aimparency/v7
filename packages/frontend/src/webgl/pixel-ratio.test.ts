import { describe, expect, it } from 'vitest'
import { canvasPixelRatio } from './pixel-ratio'

describe('canvasPixelRatio', () => {
  it('preserves ordinary and high-density display ratios', () => {
    expect(canvasPixelRatio(1)).toBe(1)
    expect(canvasPixelRatio(2.625)).toBe(2.625)
  })

  it('caps extreme ratios to bound framebuffer cost', () => {
    expect(canvasPixelRatio(4)).toBe(3)
  })

  it('falls back safely for invalid ratios', () => {
    expect(canvasPixelRatio(0)).toBe(1)
    expect(canvasPixelRatio(Number.NaN)).toBe(1)
  })
})
