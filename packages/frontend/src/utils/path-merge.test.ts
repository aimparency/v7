import { describe, expect, it } from 'vitest'
import { mergePathsByEnd } from './path-merge'
import type { IdeaPath } from '../stores/ui'

const path = (phaseId: string | undefined, ...ids: string[]): IdeaPath =>
  ({ phaseId, ideas: ids.map(id => ({ id, text: id.toUpperCase() })) } as unknown as IdeaPath)
const shown = (paths: IdeaPath[], shared: number) =>
  mergePathsByEnd(paths, shared).map(({ shownIdeas, merged }) => `${merged ? '…/' : ''}${shownIdeas.map(idea => idea.id).join('/')}`)

describe('mergePathsByEnd', () => {
  it('merges paths through the same parent into their common end', () => {
    expect(shown([path('p', 'a', 'b', 'c'), path('p', 'd', 'b', 'c')], 1)).toEqual(['…/b/c'])
  })

  it('keeps paths through different parents, and paths in other phases, apart', () => {
    expect(shown([path('p', 'a', 'c'), path('p', 'b', 'd'), path('q', 'e', 'c')], 1)).toEqual(['a/c', 'b/d', 'e/c'])
  })

  it('needs `shared` common steps: the idea itself plus its parent', () => {
    expect(shown([path('p', 'a', 'x'), path('p', 'b', 'x')], 2)).toEqual(['a/x', 'b/x'])
    expect(shown([path('p', 'a', 'b', 'x'), path('p', 'c', 'b', 'x')], 2)).toEqual(['…/b/x'])
  })

  it('navigates along the first full path', () => {
    const first = path('p', 'a', 'b', 'c')
    expect(mergePathsByEnd([first, path('p', 'd', 'b', 'c')], 1)[0]!.path).toBe(first)
  })
})
