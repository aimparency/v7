import type { IdeaPath } from '../stores/ui'

export type MergedPath = {
  /** Navigation target: the first full path of the group. */
  path: IdeaPath
  /** The common end of the group's paths, the part worth showing. */
  shownIdeas: IdeaPath['ideas']
  /** Some path in the group has more steps before the shown end ("…"). */
  merged: boolean
}

// Paths in one phase that end in the same `shared` ideas (e.g. reach the same
// parent) become one entry: A>B>C and D>B>C show as … > B > C.
export function mergePathsByEnd(paths: IdeaPath[], shared: number): MergedPath[] {
  const groups = new Map<string, IdeaPath[]>()
  paths.forEach((path, index) => {
    const end = path.ideas.slice(-shared)
    const key = end.length < shared ? `#${index}` : [path.phaseId ?? '', ...end.map(idea => idea.id)].join('/')
    groups.set(key, [...(groups.get(key) ?? []), path])
  })
  return [...groups.values()].map(group => {
    const first = group[0]!
    if (group.length === 1) return { path: first, shownIdeas: first.ideas, merged: false }
    const stepFromEnd = (path: IdeaPath, steps: number) => path.ideas[path.ideas.length - 1 - steps]?.id
    let common = Math.min(shared, first.ideas.length)
    while (group.every(path => path.ideas.length > common && stepFromEnd(path, common) === stepFromEnd(first, common))) common++
    return {
      path: first,
      shownIdeas: first.ideas.slice(-common),
      merged: group.some(path => path.ideas.length > common)
    }
  })
}
