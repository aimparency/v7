import { describe, expect, it } from 'vitest'
import { applyBrightness, cssColorToRgb, hexToRgb, statusToColor } from './status-colors'

describe('status colors', () => {
  it('darkens colors for WebGL readability', () => {
    const [r, g, b] = applyBrightness([1, 0.6, 0.3])
    expect(r).toBeCloseTo(2 / 3)
    expect(g).toBeCloseTo(0.4)
    expect(b).toBeCloseTo(0.2)
  })

  it('uses configured status color when provided', () => {
    const [r, g, b] = hexToRgb('#123456')
    expect(statusToColor('open', [{ key: 'open', color: '#123456' }])).toEqual([
      r * (2 / 3),
      g * (2 / 3),
      b * (2 / 3)
    ])
  })

  it('falls back to default mapping for known statuses', () => {
    const done = hexToRgb('#007700')
    const open = hexToRgb('#00558e')
    expect(statusToColor('done')).toEqual([done[0] * (2 / 3), done[1] * (2 / 3), done[2] * (2 / 3)])
    expect(statusToColor('open')).toEqual([open[0] * (2 / 3), open[1] * (2 / 3), open[2] * (2 / 3)])
  })

  it('falls back to archived color for unknown statuses', () => {
    const archived = hexToRgb('#3b3b3b')
    expect(statusToColor('custom-status')).toEqual([
      archived[0] * (2 / 3),
      archived[1] * (2 / 3),
      archived[2] * (2 / 3)
    ])
  })

  it('parses rgb and rgba color strings', () => {
    expect(cssColorToRgb('rgb(255, 128, 0)')).toEqual([1, 128 / 255, 0])
    expect(cssColorToRgb('rgba(0, 64, 255, 0.5)')).toEqual([0, 64 / 255, 1])
  })
})
