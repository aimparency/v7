import { describe, expect, it } from 'vitest'
import { columnsSettleTracker, MAX_FRAMES, STABLE_FRAMES } from './columns-settle'

describe('columnsSettleTracker', () => {
  it('counts a column as settled after staying unchanged', () => {
    const track = columnsSettleTracker()
    const column = { scrollTop: 0, scrollHeight: 100 }
    let settled = 0
    for (let frame = 0; frame <= STABLE_FRAMES; frame++) settled = track([column])
    expect(settled).toBe(1)
  })

  it('starts over when the scroll position or content height changes', () => {
    const track = columnsSettleTracker()
    const column = { scrollTop: 0, scrollHeight: 100 }
    track([column])
    track([column])
    column.scrollHeight = 240
    expect(track([column])).toBe(0)
    column.scrollTop = 50
    expect(track([column])).toBe(0)
  })

  it('tracks columns separately', () => {
    const track = columnsSettleTracker()
    const calm = { scrollTop: 0, scrollHeight: 100 }
    const busy = { scrollTop: 0, scrollHeight: 100 }
    let settled = 0
    for (let frame = 0; frame <= STABLE_FRAMES; frame++) {
      busy.scrollHeight += 10
      settled = track([calm, busy])
    }
    expect(settled).toBe(1)
  })

  it('gives up on a column that never stops changing', () => {
    const track = columnsSettleTracker()
    const column = { scrollTop: 0, scrollHeight: 100 }
    let settled = 0
    for (let frame = 0; frame < MAX_FRAMES; frame++) {
      column.scrollHeight++
      settled = track([column])
    }
    expect(settled).toBe(1)
  })
})
