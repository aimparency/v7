import { beforeEach, describe, expect, it } from 'vitest'
import { centreOf, loadSubspaceLayout, placeAround, saveSubspaceLayout } from '../subspace-layout'

describe('subspace layout', () => {
  beforeEach(() => localStorage.clear())

  it('opens a space as it was kept, its centre of mass where its node is', () => {
    saveSubspaceLayout('/parent', 'space', [{ id: 'a', pos: [100, 100] }, { id: 'b', pos: [300, 100] }])
    expect(loadSubspaceLayout('/other-parent', 'space')).toEqual({})

    const placed = placeAround([10, 20], ['a', 'b'], loadSubspaceLayout('/parent', 'space'))
    expect(placed.get('a')).toEqual([-90, 20])
    expect(placed.get('b')).toEqual([110, 20])
  })

  it('keeps the centre of mass on the node when ideas without a kept position join', () => {
    const placed = placeAround([5, -5], ['a', 'new-1', 'new-2'], { a: [50, 0] })
    const [x, y] = centreOf([...placed.values()])
    expect(x).toBeCloseTo(5)
    expect(y).toBeCloseTo(-5)
  })
})
